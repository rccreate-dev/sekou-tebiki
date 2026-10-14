'use strict';
/* ===== 事例の追加・編集シート(写真・動画は端末で整えてから、分割して送る) ===== */
const IMG_OK = /^image\/(jpeg|png|webp|gif|heic|heif)$/i, IMG_EXT = /\.(jpe?g|png|webp|gif|heic|heif)$/i;
const VID_EXT = /\.(mp4|m4v|mov|webm)$/i;
const FULL_MAX = 1.5 * 1000 * 1000, THUMB_MAX = 80 * 1000;   // SPEC §5.3(余裕を持たせて10進で計算)

const toBlob = (c, q) => new Promise(res => c.toBlob(res, 'image/jpeg', q));
function blobToB64(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
}
/* canvas を上限サイズに収まるJPEGにする(画質を段階的に下げる) */
async function shrinkJpeg(c, max, qs) {
  let b = null;
  for (const q of qs) { b = await toBlob(c, q); if (b && b.size <= max) return b; }
  return b;
}
function drawScaled(src, w, h, edge) {
  const s = Math.min(1, edge / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
/* 写真: 向きを直し、本体(長辺1600px・1.5MB以下)とサムネ(長辺480px・80KB以下)を作る */
async function makeImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e1) { try { bmp = await createImageBitmap(file); } catch (e2) { throw { code: 'decode_failed' }; } }
  try {
    const full = await shrinkJpeg(drawScaled(bmp, bmp.width, bmp.height, 1600), FULL_MAX, [.85, .75, .65, .55, .45]);
    const th = await shrinkJpeg(drawScaled(bmp, bmp.width, bmp.height, 480), THUMB_MAX, [.72, .6, .5, .4, .3]);
    if (!full || !th || full.size > FULL_MAX || th.size > THUMB_MAX) throw { code: 'decode_failed' };
    return { full, thumb: th };
  } finally { if (bmp.close) bmp.close(); }
}
/* 動画の1コマ目からサムネを作る。作れないときは「動画」と書いた画像 */
async function videoThumb(blob) {
  const url = URL.createObjectURL(blob), v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(); setTimeout(rej, 8000); v.src = url; });
    try { v.currentTime = Math.min(0.2, (v.duration || 1) / 2); await new Promise(res => { v.onseeked = res; setTimeout(res, 1500); }); } catch (e) {}
    if (!v.videoWidth) throw 0;
    const t = await shrinkJpeg(drawScaled(v, v.videoWidth, v.videoHeight, 480), THUMB_MAX, [.72, .6, .5, .4, .3]);
    if (t && t.size <= THUMB_MAX) return t;
    throw 0;
  } catch (e) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const g = c.getContext('2d'); g.fillStyle = '#333'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#fff'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.fillText('動画', 160, 100);
    return toBlob(c, .8);
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}

const SH = () => S.sheet;
const sheetEl = () => $('#sheet');
function sheetMsg(t, err) { const m = $('#sh-msg'); if (m) { m.textContent = t || ''; m.className = 'msg' + (err ? ' err' : ''); } }
function shVal(id) { const e = $('#' + id); return e ? e.value : ''; }

function openSheet(exId) {
  if (!canPost() || S.sheet) return;
  const ex = exId ? D('examples').find(e => e.id === exId) : null;
  if (exId && (!ex || !canTouch(ex))) return;
  const itemId = ex ? ex.itemId : (S.route.n === 'item' ? S.route.id : null);
  if (!itemId) return;
  S.sheet = {
    ex, itemId, id: ex ? ex.id : rid('e_'), opener: document.activeElement, pending: 0, dirty: false, busy: false, askDiscard: false,
    media: ex ? (ex.media || []).map(m => Object.assign({ keep: true }, m)) : []
  };
  const v = ex || { kind: S.filter === 'bad' ? 'bad' : 'good', title: '', reason: '', severity: '', timing: '', criteria: '', refNo: '' };
  const items = D('items'), groups = D('groups').slice().sort(byOrder);
  const opt = groups.map(g => {
    const its = items.filter(i => i.groupId === g.id).sort(byOrder);
    return its.length ? '<optgroup label="' + esc(g.name) + '">' + its.map(i => '<option value="' + esc(i.id) + '"' + (i.id === itemId ? ' selected' : '') + '>' + esc(i.name) + '</option>').join('') + '</optgroup>' : '';
  }).join('');
  const sev = v.severity || '';
  const open = !!(v.severity || v.timing || v.criteria || v.refNo);
  sheetEl().innerHTML = '<div class="scrim" data-act="sh-close"></div><div class="panel" role="dialog" aria-modal="true" aria-labelledby="sh-h">' +
    '<div class="panel-head"><h2 id="sh-h">' + (ex ? '事例を編集' : '事例を追加') + '</h2><button class="btn sm" type="button" data-act="sh-close">閉じる</button></div>' +
    '<label class="fl" for="sh-item">項目</label><select class="field" id="sh-item">' + opt + '</select>' +
    '<div class="fl" id="sh-kl">種類</div><div class="kind" role="radiogroup" aria-labelledby="sh-kl">' +
    '<input class="sr" type="radio" name="sh-kind" id="k-g" value="good"' + (v.kind !== 'bad' ? ' checked' : '') + '><label class="g" for="k-g">○ 良い例</label>' +
    '<input class="sr" type="radio" name="sh-kind" id="k-b" value="bad"' + (v.kind === 'bad' ? ' checked' : '') + '><label class="b" for="k-b">× 悪い例</label></div>' +
    '<label class="fl" for="sh-title">タイトル（必須）</label><input class="field" id="sh-title" maxlength="60" placeholder="例：開口部の補強が不足" value="' + esc(v.title) + '">' +
    '<label class="fl" for="sh-reason">理由・ポイント</label><textarea class="field" id="sh-reason" rows="4" maxlength="600" placeholder="なぜ良い／悪いのか、どう直すか">' + esc(v.reason) + '</textarea>' +
    '<details class="more"' + (open ? ' open' : '') + '><summary>くわしく書く（重要度・確認時期・基準）</summary><div>' +
    '<div class="fl" id="sh-sl">重要度</div><div class="sevseg" role="radiogroup" aria-labelledby="sh-sl">' +
    [['', 'なし'], ['A', 'A'], ['B', 'B'], ['C', 'C']].map(x => '<input class="sr" type="radio" name="sh-sev" id="sv-' + x[0] + '" value="' + x[0] + '"' + (sev === x[0] ? ' checked' : '') + '><label for="sv-' + x[0] + '">' + x[1] + '</label>').join('') + '</div>' +
    '<label class="fl" for="sh-timing">確認するタイミング</label><select class="field" id="sh-timing"><option value="">指定しない</option>' + TIMINGS.map(t => '<option' + (v.timing === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>' +
    '<label class="fl" for="sh-crit">確認基準（数値など）</label><textarea class="field" id="sh-crit" rows="2" maxlength="300" placeholder="例：端太角@300以下">' + esc(v.criteria || '') + '</textarea>' +
    '<label class="fl" for="sh-ref">管理表の番号</label><input class="field" id="sh-ref" maxlength="30" placeholder="例：重点管理 3-2" value="' + esc(v.refNo || '') + '">' +
    '</div></details>' +
    '<div class="fl">写真・動画（<span id="sh-cnt"></span>）</div>' +
    '<p class="hint" style="margin:0 0 6px">顔や名前が写らないようにしてください。</p>' +
    '<input class="sr file-in" type="file" id="sh-file" accept="image/*,video/*" multiple><label class="filebtn" for="sh-file" id="sh-fb">写真・動画を選ぶ／撮る</label>' +
    '<div class="prev" id="sh-prev"></div><p class="msg" id="sh-msg" role="status"></p>' +
    '<div id="sh-disc"></div>' +
    '<div class="actions"><button class="btn primary" type="button" id="sh-save" data-act="sh-save">' + (ex ? '変更を保存' : '登録する') + '</button><button class="btn" type="button" data-act="sh-close">キャンセル</button></div></div>';
  sheetEl().hidden = false; document.body.classList.add('lock');
  drawPrev();
  if (window.matchMedia && matchMedia('(hover:hover)').matches) $('#sh-title').focus();
  else { const p = $('#sheet .panel'); if (p) { p.tabIndex = -1; p.focus({ preventScroll: true }); } }
}

function drawPrev() {
  const sh = SH(); if (!sh) return;
  $('#sh-cnt').textContent = sh.media.length + '/' + MAX_MEDIA;
  $('#sh-fb').classList.toggle('off', sh.media.length >= MAX_MEDIA);
  $('#sh-prev').innerHTML = sh.media.map((m, i) => {
    const body = m.keep
      ? '<img data-mid="' + esc(m.id) + '" alt="登録済みの' + (m.type === 'video' ? '動画' : '写真') + ' ' + (i + 1) + '">' + (m.type === 'video' ? '<span class="vt">動画</span>' : '')
      : (m.type === 'video' ? '<img src="' + esc(m.turl) + '" alt="選んだ動画 ' + (i + 1) + '"><span class="vt">動画</span>' : '<img src="' + esc(m.turl) + '" alt="選んだ写真 ' + (i + 1) + '">');
    return '<div class="pv">' + body + '<button class="rm" type="button" data-act="sh-rm" data-i="' + i + '" aria-label="' + (i + 1) + '点目を外す"><i>×</i></button></div>';
  }).join('');
  Media.hydrate($('#sh-prev'));
}

/* 10MBを超える動画は、端末の中で画質を落として小さくする(画面に映して録画し直す方式。音声は付きません) */
const VID_MAX_SEC = 60;
async function compressVideo(file, sh, name) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw { code: 'too_large' };
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', ''); v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej({ code: 'decode_failed' }); setTimeout(() => rej({ code: 'decode_failed' }), 15000); });
    const dur = v.duration;
    if (!isFinite(dur) || dur <= 0) throw { code: 'decode_failed' };
    if (dur > VID_MAX_SEC) throw { code: 'video_long' };
    const sc = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(v.videoWidth * sc / 2) * 2); cv.height = Math.max(2, Math.round(v.videoHeight * sc / 2) * 2);
    const g = cv.getContext('2d');
    const mimes = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mt = mimes.find(m => MediaRecorder.isTypeSupported(m));
    if (!mt) throw { code: 'too_large' };
    const bps = Math.min(2500000, Math.floor(17 * 1048576 * 8 / dur));
    const rec = new MediaRecorder(cv.captureStream(24), { mimeType: mt, videoBitsPerSecond: bps });
    const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise(res => { rec.onstop = res; });
    g.drawImage(v, 0, 0, cv.width, cv.height);
    rec.start(1000);
    await v.play();
    await new Promise((res, rej) => {
      const tick = () => {
        if (SH() !== sh) return rej({ code: 'cancelled' });
        g.drawImage(v, 0, 0, cv.width, cv.height);
        sheetMsg('動画を小さくしています… ' + Math.min(99, Math.round(v.currentTime / dur * 100)) + '%（' + (name || '') + '）この画面のまま少しお待ちください');
        if (v.ended) return res();
        requestAnimationFrame(tick);
      };
      v.onended = res; v.onerror = () => rej({ code: 'decode_failed' }); tick();
      setTimeout(() => rej({ code: 'decode_failed' }), (dur + 20) * 1000);
    });
    await new Promise(r => setTimeout(r, 150));
    rec.stop(); await done;
    return { blob: new Blob(chunks, { type: mt.split(';')[0] }), mime: mt.split(';')[0] };
  } finally { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}

async function addFiles(list) {
  const sh = SH(); if (!sh || sh.busy) return;
  const msgs = [];
  for (const f of Array.from(list)) {
    if (sh.media.length + sh.pending >= MAX_MEDIA) { msgs.push('登録できるのは' + MAX_MEDIA + '点までです。'); break; }
    const isVid = /^video\//i.test(f.type) || (!f.type && VID_EXT.test(f.name));
    const isImg = /^image\//i.test(f.type) || (!f.type && IMG_EXT.test(f.name));
    sh.pending++; $('#sh-save').disabled = true;
    try {
      if (isVid) {
        let vb = f, t = f.type === 'video/webm' ? 'video/webm' : 'video/mp4';
        if (f.size > COMPRESS_OVER) {
          try {
            const r = await compressVideo(f, sh, f.name);
            if (SH() !== sh) return;
            vb = r.blob; t = r.mime;
          } catch (ce) {
            if (ce && ce.code === 'cancelled') throw ce;
            if (f.size > MAX_FILE || !ce || ce.code === 'video_long') throw ce;   // 20MB以内なら、小さくできなくてもそのまま送る
          }
        }
        if (vb.size > MAX_FILE) throw { code: 'too_large' };
        const th = await videoThumb(vb);
        sh.media.push({ keep: false, id: rid('m_'), type: 'video', blob: vb, thumb: th, mime: t, turl: URL.createObjectURL(th), done: {} });
      } else if (isImg) {
        const r = await makeImage(f);
        if (SH() !== sh) return;
        sh.media.push({ keep: false, id: rid('m_'), type: 'image', blob: r.full, thumb: r.thumb, mime: 'image/jpeg', turl: URL.createObjectURL(r.thumb), done: {} });
      } else throw { code: 'unsupported_type' };
      sh.dirty = true;
    } catch (e) { if (e && e.code === 'cancelled') return; msgs.push(f.name + '：' + errText(e)); }
    finally { sh.pending--; if (SH() === sh && !sh.pending && !sh.busy) $('#sh-save').disabled = false; }
  }
  if (SH() !== sh) return;
  drawPrev(); sheetMsg(msgs.join(' '), msgs.length > 0);
}

function closeSheet() {
  const sh = SH(); if (!sh) return;
  sh.media.forEach(m => { if (m.turl) URL.revokeObjectURL(m.turl); });
  S.sheet = null;
  sheetEl().hidden = true; sheetEl().innerHTML = ''; document.body.classList.remove('lock');
  scheduleRender();
  const o = sh.opener && document.contains(sh.opener) ? sh.opener : $('#addbar button');
  if (o && o.focus) { try { o.focus({ preventScroll: true }); } catch (e) {} }
}
function tryCloseSheet() {
  const sh = SH(); if (!sh || sh.busy) return;
  if (sh.dirty || sh.media.some(m => !m.keep)) {
    if (sh.askDiscard) return;
    sh.askDiscard = true;
    $('#sh-disc').innerHTML = '<div class="discard"><p>入力した内容は保存されません。閉じますか？</p><div class="line"><button class="btn" type="button" data-act="sh-keep">入力に戻る</button><button class="btn danger solid" type="button" data-act="sh-discard">破棄して閉じる</button></div></div>';
    const b = $('#sh-disc button'); if (b) b.focus();
  } else closeSheet();
}

/* 1点を送る。動画は PART_BYTES ごとに分け、送れた片は覚えておく(失敗しても続きから) */
async function uploadMedia(m, label) {
  const total = Math.max(1, Math.ceil(m.blob.size / PART_BYTES));
  for (let i = 0; i < total; i++) {
    if (m.done[i]) continue;
    sheetMsg(label + (total > 1 ? '（' + (i + 1) + '/' + total + '）' : ''));
    const part = m.type === 'video' ? m.blob.slice(i * PART_BYTES, (i + 1) * PART_BYTES) : m.blob;
    const p = { mediaId: m.id, kind: m.type, mime: m.mime, index: i, total, data: await blobToB64(part), bytes: part.size };
    if (i === 0) p.thumb = await blobToB64(m.thumb);
    let r = null;
    for (let t = 0; t < 3; t++) { r = await api('uploadPart', p); if (r.ok || !r.network) break; await new Promise(x => setTimeout(x, 1500 * (t + 1))); }
    if (!r.ok) throw r.network ? { code: 'NETWORK' } : r.error;
    m.done[i] = true;
  }
  m.parts = total; m.bytes = m.blob.size;
}

async function saveSheet() {
  const sh = SH(); if (!sh || sh.busy) return;
  const title = shVal('sh-title').trim();
  if (!title) { sheetMsg('タイトルを入力してください。', true); $('#sh-title').focus(); return; }
  if (sh.pending) { sheetMsg('写真を処理中です。少し待ってください。', true); return; }
  if (!canPost()) { sheetMsg('保存できる権限がありません。', true); return; }
  if (sh.media.length > MAX_MEDIA) { sheetMsg('登録できるのは' + MAX_MEDIA + '点までです。', true); return; }
  sh.busy = true; S.busy = true; sh.askDiscard = false; $('#sh-disc').innerHTML = '';
  const btn = $('#sh-save'); btn.disabled = true; btn.textContent = '保存中…';
  sheetEl().querySelectorAll('[data-act="sh-close"],[data-act="sh-rm"]').forEach(b => { b.disabled = true; });
  try {
    let n = 0; const total = sh.media.filter(m => !m.keep).length;
    for (const m of sh.media) { if (m.keep) continue; n++; await uploadMedia(m, 'アップロード中… ' + n + '/' + total); }
    const kind = (document.querySelector('input[name="sh-kind"]:checked') || {}).value === 'bad' ? 'bad' : 'good';
    const sevEl = document.querySelector('input[name="sh-sev"]:checked');
    const f = {
      id: sh.id, itemId: shVal('sh-item') || sh.itemId, kind, title, reason: shVal('sh-reason').trim(),
      severity: sevEl ? sevEl.value : '', timing: shVal('sh-timing'), criteria: shVal('sh-crit').trim(), refNo: shVal('sh-ref').trim(),
      media: sh.media.map(m => ({ id: m.id, type: m.type, mime: m.mime || (m.type === 'video' ? 'video/mp4' : 'image/jpeg'), parts: m.parts || 1, bytes: m.bytes || 0 }))
    };
    sheetMsg('保存中…');
    const r = await api('saveExample', f);
    if (!r.ok) throw r.network ? { code: 'NETWORK' } : r.error;
    const dest = f.itemId, wasAdd = !sh.ex;
    S.busy = false;
    closeSheet();
    toast(wasAdd ? '登録しました' : '保存しました');
    await sync(true);
    if (wasAdd || S.route.n !== 'item' || S.route.id !== dest) { S.filter = 'all'; go({ n: 'item', id: dest }, true); }
  } catch (e) {
    sh.busy = false; S.busy = false;
    if (!SH()) return;
    btn.disabled = false; btn.textContent = sh.ex ? '変更を保存' : '登録する';
    sheetEl().querySelectorAll('[data-act="sh-close"],[data-act="sh-rm"]').forEach(b => { b.disabled = false; });
    sheetMsg(errText(e) + '（入力内容は残っています。もう一度「' + (sh.ex ? '変更を保存' : '登録する') + '」を押してください）', true);
  }
}

function initSheet() {
  const el = sheetEl();
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-act]'); if (!t || !SH()) return;
    const a = t.dataset.act;
    if (a === 'sh-close') tryCloseSheet();
    else if (a === 'sh-save') saveSheet();
    else if (a === 'sh-keep') { SH().askDiscard = false; $('#sh-disc').innerHTML = ''; }
    else if (a === 'sh-discard') closeSheet();
    else if (a === 'sh-rm') {
      const sh = SH(); if (sh.busy) return;
      const m = sh.media.splice(+t.dataset.i, 1)[0];
      if (m && m.turl) URL.revokeObjectURL(m.turl);
      sh.dirty = true; drawPrev();
    }
  });
  el.addEventListener('input', () => { if (SH()) SH().dirty = true; });
  el.addEventListener('change', e => {
    if (e.target.id === 'sh-file') { const fs = Array.from(e.target.files || []); e.target.value = ''; addFiles(fs); }
    else if (SH()) SH().dirty = true;
  });
  el.addEventListener('keydown', e => {
    if (!SH()) return;
    if (e.key === 'Escape') { e.preventDefault(); tryCloseSheet(); return; }
    if (e.key !== 'Tab') return;
    const vis = Array.from(el.querySelectorAll('button:not(:disabled),input:not([type=radio]):not([type=file]),select,textarea,summary,label.filebtn')).filter(x => x.offsetParent !== null);
    if (!vis.length) return;
    const first = vis[0], last = vis[vis.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus && last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
