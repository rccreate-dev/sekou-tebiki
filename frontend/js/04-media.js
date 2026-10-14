'use strict';
/* ===== 写真・動画の取得と端末内キャッシュ。写真・動画のIDは中身が変わらないので、一度取ったら端末に残す ===== */
const Media = (() => {
  const urls = new Map(), loading = new Map();
  let queue = [], timer = 0, io = null;

  function b64ToBlob(b64, mime) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: mime });
  }
  function once(k, fn) {
    if (loading.has(k)) return loading.get(k);
    const p = fn().finally(() => loading.delete(k));
    loading.set(k, p); return p;
  }
  async function flush() {
    const batch = queue.splice(0, 20);
    if (queue.length) timer = setTimeout(flush, 10);
    if (!batch.length) return;
    const ids = Array.from(new Set(batch.map(b => b.id)));
    const r = await api('getThumbs', { ids }, { quiet: true });
    const items = r.ok ? (r.data.items || {}) : {};
    batch.forEach(b => {
      const it = items[b.id];
      if (it) { const blob = b64ToBlob(it.data, it.mime || 'image/jpeg'); Store.mediaPut('t:' + b.id, blob); b.res(blob); } else b.res(null);
    });
  }
  const fetchThumb = id => new Promise(res => { queue.push({ id, res }); clearTimeout(timer); timer = setTimeout(flush, 40); });

  async function thumb(id) {
    const k = 't:' + id;
    if (urls.has(k)) return urls.get(k);
    return once(k, async () => {
      let b = await Store.mediaGet(k);
      if (!b) b = await fetchThumb(id);
      if (!b) return '';
      const u = URL.createObjectURL(b); urls.set(k, u); return u;
    });
  }
  async function full(id) {
    const k = 'f:' + id;
    if (urls.has(k)) return urls.get(k);
    return once(k, async () => {
      let b = await Store.mediaGet(k);
      if (!b) {
        const r = await api('getPart', { id, index: 0 }, { quiet: true });
        if (!r.ok) return '';
        b = b64ToBlob(r.data.data, r.data.mime || 'image/jpeg'); Store.mediaPut(k, b);
      }
      const u = URL.createObjectURL(b); urls.set(k, u); return u;
    });
  }
  /* 動画: 全部の片を取ってつなぐ。onProgress(取得済み片数, 全片数) */
  async function video(m, onProgress) {
    const k = 'v:' + m.id;
    if (urls.has(k)) return urls.get(k);
    return once(k, async () => {
      let b = await Store.mediaGet(k);
      if (!b) {
        const chunks = [];
        for (let i = 0; i < m.parts; i++) {
          if (onProgress) onProgress(i, m.parts);
          const r = await api('getPart', { id: m.id, index: i }, { quiet: true });
          if (!r.ok) return '';
          chunks.push(b64ToBlob(r.data.data, 'application/octet-stream'));
        }
        b = new Blob(chunks, { type: m.mime || 'video/mp4' }); Store.mediaPut(k, b);
      }
      const u = URL.createObjectURL(b); urls.set(k, u); return u;
    });
  }
  const cachedThumb = id => urls.get('t:' + id) || '';

  function load(img) {
    const id = img.getAttribute('data-mid');
    thumb(id).then(u => { if (u && img.isConnected) img.src = u; });
  }
  /* 画面の写真(data-mid)を、見える位置に来たものから読み込む */
  function hydrate(root) {
    const imgs = (root || document).querySelectorAll('img[data-mid]');
    if (!io && 'IntersectionObserver' in window) io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: '400px' });
    imgs.forEach(img => {
      if (img.getAttribute('src')) return;
      const u = cachedThumb(img.getAttribute('data-mid'));
      if (u) img.src = u; else if (io) io.observe(img); else load(img);
    });
  }
  return { thumb, full, video, cachedThumb, hydrate, b64ToBlob };
})();
