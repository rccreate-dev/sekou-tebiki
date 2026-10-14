'use strict';
/* ===== 端末の識別と、サーバー(Apps Script)との通信。契約は SPEC.md §1 ===== */
const Device = {
  dev: '', key: '',
  async init() {
    let d = '', k = '';
    try { d = localStorage.getItem('tebiki.dev') || ''; k = localStorage.getItem('tebiki.key') || ''; } catch (e) {}
    if (!d || !k) { d = (await Store.kvGet('dev')) || ''; k = (await Store.kvGet('key')) || ''; }
    if (!/^[A-Za-z0-9-]{8,64}$/.test(d) || !/^[A-Za-z0-9]{32,64}$/.test(k)) { d = crypto.randomUUID ? crypto.randomUUID() : rid('d-') + rid(''); k = randKey(40); }
    this.dev = d; this.key = k; this.persist();
  },
  persist() {
    try { localStorage.setItem('tebiki.dev', this.dev); localStorage.setItem('tebiki.key', this.key); } catch (e) {}
    Store.kvSet('dev', this.dev); Store.kvSet('key', this.key);
  },
  async reset() { this.dev = ''; this.key = ''; try { localStorage.removeItem('tebiki.dev'); localStorage.removeItem('tebiki.key'); } catch (e) {} await Store.kvDel('dev'); await Store.kvDel('key'); await this.init(); }
};

const TIMEOUT = { uploadPart: 90000, getPart: 90000, getThumbs: 60000 };

/* 例外は投げない。 { ok, data } または { ok:false, error:{code,message}, network } を返す */
async function api(action, params, opts) {
  opts = opts || {};
  if (!CFG.API_URL) return { ok: false, network: true, error: { code: 'NETWORK', message: 'API_URL 未設定' } };
  if (navigator.onLine === false) return { ok: false, network: true, error: { code: 'NETWORK', message: 'offline' } };
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs || TIMEOUT[action] || 30000) : 0;
  const t0 = Date.now();
  try {
    const res = await fetch(CFG.API_URL, {
      method: 'POST', redirect: 'follow', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ v: 1, action, dev: Device.dev, key: Device.key, params: params || {} }),
      signal: ctrl ? ctrl.signal : undefined
    });
    const text = await res.text();
    let b = null; try { b = JSON.parse(text); } catch (e) { b = null; }
    if (!b || typeof b.ok !== 'boolean') return { ok: false, network: true, ms: Date.now() - t0, error: { code: 'NETWORK', message: 'bad response' } };
    if (!b.ok) {
      const er = b.error || { code: 'INTERNAL' };
      if (!opts.quiet && (er.code === 'UNAUTHENTICATED' || er.code === 'NOT_APPROVED' || er.code === 'REJECTED')) onAuthError(er.code);
      return { ok: false, error: er, ms: Date.now() - t0 };
    }
    return { ok: true, data: b.data, meta: b.meta, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, network: true, ms: Date.now() - t0, error: { code: 'NETWORK', message: String((e && e.message) || e) } };
  } finally { if (timer) clearTimeout(timer); }
}
