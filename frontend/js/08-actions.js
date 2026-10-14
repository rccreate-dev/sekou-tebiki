'use strict';
/* ===== 操作(クリック・変更)の処理 ===== */
const routeKey = r => r.n + ':' + (r.id || '');
function hashOf(r) { return r.n === 'item' ? '#i-' + r.id : r.n === 'home' ? '' : '#' + r.n; }
function routeFromHash() {
  let h = ''; try { h = location.hash || ''; } catch (e) {}
  if (/^#i-./.test(h)) { try { return { n: 'item', id: decodeURIComponent(h.slice(3)) }; } catch (e) { return { n: 'home', id: null }; } }
  if (h === '#settings' || h === '#trash' || h === '#diag' || h === '#users') return { n: h.slice(1), id: null };
  return { n: 'home', id: null };
}
function go(r, forward) {
  S.scroll[routeKey(S.route)] = window.scrollY;
  S.route = r; S.confirm = null; S.openRow = null;
  if (r.n !== 'home') { S.q = ''; const q = $('#q'); if (q) q.value = ''; }
  try { const h = hashOf(r); if ((location.hash || '') !== h) { location.hash = h || ''; if (forward !== false) S.hist++; } } catch (e) {}
  render();
  window.scrollTo(0, forward === false ? (S.scroll[routeKey(r)] || 0) : 0);
}
function onHash() {
  const r = routeFromHash();
  if (routeKey(r) === routeKey(S.route)) return;
  S.scroll[routeKey(S.route)] = window.scrollY;
  S.route = r; S.confirm = null; S.openRow = null; render();
  window.scrollTo(0, S.scroll[routeKey(r)] || 0);
}

/* ---------- ライトボックス(本体の写真は開いたときに取得) ---------- */
function openLb(exId, i) {
  const ex = D('examples').find(e => e.id === exId); if (!ex) return;
  const ids = (ex.media || []).filter(m => m.type !== 'video').map(m => m.id);
  if (!ids.length) return;
  S.lb = { ids, i: Math.max(0, Math.min(i, ids.length - 1)), opener: document.activeElement };
  document.body.classList.add('lock'); $('#lb').hidden = false; showLb();
  $('#lb .lbc').focus();
}
async function showLb() {
  const l = S.lb; if (!l) return;
  const img = $('#lbimg'), id = l.ids[l.i];
  img.alt = '写真 ' + (l.i + 1) + '/' + l.ids.length;
  img.src = Media.cachedThumb(id) || '';          // まず小さい画像を出し、本体が届いたら差し替える
  $('#lb .lbp').hidden = $('#lb .lbn').hidden = l.ids.length < 2;
  const u = await Media.full(id);
  if (S.lb === l && l.ids[l.i] === id) { if (u) img.src = u; else toast('写真を読み込めませんでした。電波を確認してください。'); }
}
function closeLb() {
  const l = S.lb; if (!l) return;
  S.lb = null; $('#lb').hidden = true; $('#lbimg').removeAttribute('src');
  if (!S.sheet) document.body.classList.remove('lock');
  if (l.opener && document.contains(l.opener)) { try { l.opener.focus({ preventScroll: true }); } catch (e) {} }
}

/* ---------- 動画の再生: 押したときに取得してその場で再生 ---------- */
async function playVideo(t) {
  const ex = D('examples').find(e => e.id === t.dataset.ex), m = ex && (ex.media || []).find(x => x.id === t.dataset.mid);
  if (!m || t.dataset.busy) return;
  t.dataset.busy = '1';
  const label = t.querySelector('.pbtn');
  const u = await Media.video(m, (i, n) => { if (label) label.textContent = '読み込み中… ' + (i + 1) + '/' + n; });
  delete t.dataset.busy;
  if (!u) { if (label) label.textContent = '▶ 動画を見る'; return toast('動画を読み込めませんでした。電波を確認してください。'); }
  if (!t.isConnected) return;
  const v = document.createElement('video');
  v.src = u; v.controls = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.autoplay = true;
  v.setAttribute('aria-label', (ex.title || '') + ' の動画');
  t.replaceWith(v);
  v.play().catch(() => {});
}

/* ---------- 構成の並べ替え ---------- */
async function reorder(kind, id, dir) {
  const all = kind === 'g' ? D('groups') : D('items'), me = all.find(x => x.id === id); if (!me) return;
  const sib = (kind === 'g' ? all : all.filter(x => x.groupId === me.groupId)).slice().sort(byOrder);
  const i = sib.findIndex(x => x.id === id), j = i + dir;
  if (j < 0 || j >= sib.length) return;
  const t = sib[i]; sib[i] = sib[j]; sib[j] = t;
  const orders = sib.map((x, k) => ({ id: x.id, order: (k + 1) * 10 }));
  await doWrite(() => api('reorder', { kind: kind === 'g' ? 'group' : 'item', orders }));
}

/* ---------- 文章データのバックアップ(写真・動画は含まない) ---------- */
function backup() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const fn = 'sekou-tebiki-backup-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
  const data = JSON.stringify({ app: 'sekou-tebiki', version: VERSION, exportedAt: d.toISOString(), groups: S.groups, items: S.items, examples: S.examples, names: S.names }, null, 2);
  const u = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = u; a.download = fn; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000); toast('バックアップを保存しました');
}

/* ---------- 動作診断 ---------- */
function diagRow(label, st, detail) { S.diag.push({ label, st, detail: detail == null ? '' : String(detail) }); render(); }
async function runDiag() {
  if (S.diagBusy) return;
  S.diagBusy = true; S.diag = []; render();
  try {
    diagRow('アプリ', 'ok', VERSION + ' / 表示:' + mode() + ' / 区分:' + (S.role || '-') + ' / ホーム画面から起動:' + (isStandalone() ? 'はい' : 'いいえ'));
    diagRow('通信先の設定', CFG.API_URL ? 'ok' : 'ng', CFG.API_URL ? '設定済み' : '未設定(config.js の API_URL)');
    const p = await api('ping', {}, { quiet: true });
    diagRow('サーバーへの接続', p.ok ? 'ok' : 'ng', p.ok ? p.ms + 'ms' : (p.network ? '届きません: ' + (p.error.message || '') : p.error.code));
    const b = await api('bootstrap', {}, { quiet: true });
    diagRow('データの取得', b.ok ? 'ok' : 'ng', b.ok ? b.ms + 'ms / 事例 ' + (b.data.examples || []).length + '件' : (b.network ? '届きません' : b.error.code + ' ' + (b.error.message || '')));
    let idb = 'ng'; try { await Store.kvSet('diag', 1); idb = (await Store.kvGet('diag')) === 1 ? 'ok' : 'ng'; await Store.kvDel('diag'); } catch (e) {}
    diagRow('端末の保存(写真の保管)', idb, idb === 'ok' ? 'IndexedDB 使用可' : '使えません。写真が毎回読み込み直しになります');
    diagRow('端末の登録情報', Device.dev && Device.key ? 'ok' : 'ng', Device.dev ? '端末ID ' + Device.dev.slice(0, 8) + '…' : '未作成');
    diagRow('動画を小さくする機能', window.MediaRecorder && HTMLCanvasElement.prototype.captureStream ? 'ok' : 'ng', window.MediaRecorder ? 'MediaRecorder 使用可' : '使えません(10MB超の動画は小さくできません)');
    diagRow('オフライン対応', 'serviceWorker' in navigator ? 'ok' : 'ng', 'serviceWorker' in navigator ? navigator.serviceWorker.controller ? '有効' : '次回の起動から有効' : '使えません');
    diagRow('端末情報', 'ok', [navigator.userAgent, 'viewport ' + innerWidth + 'x' + innerHeight, 'ImageBitmap:' + (typeof createImageBitmap)].join(' / '));
  } finally { S.diagBusy = false; render(); }
}
async function diagVideo(file) {
  if (!file || !S.diag) return;
  S.diag.push({ label: '動画テスト: ' + file.name, st: 'skip', detail: 'type=' + (file.type || '(空)') + ' size=' + (file.size / 1048576).toFixed(1) + 'MB' });
  render();
  const row = S.diag[S.diag.length - 1];
  try {
    if (file.size > COMPRESS_OVER) {
      const t0 = Date.now();
      const r = await compressVideo(file, { }, file.name).catch(e => { throw e; });
      row.st = 'ok'; row.detail += ' → ' + (r.blob.size / 1048576).toFixed(1) + 'MB に圧縮(' + Math.round((Date.now() - t0) / 1000) + '秒)';
    } else { row.st = 'ok'; row.detail += ' → 圧縮なしでそのまま送れます'; }
  } catch (e) { row.st = 'ng'; row.detail += ' → ' + errText(e); }
  render();
}
function copyDiag() {
  const text = diagText();
  const fallback = () => { const t = $('#dtxt'); if (t) { t.focus(); t.select(); try { document.execCommand('copy'); toast('コピーしました'); } catch (e) { toast('文字を長押ししてコピーしてください'); } } };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('コピーしました'), fallback); else fallback();
}

/* ---------- 申請 ---------- */
async function applyNow() {
  const name = ($('#ap-name') || {}).value || '', company = ($('#ap-co') || {}).value || '';
  const msg = $('#ap-msg');
  if (!name.trim()) { if (msg) { msg.textContent = '氏名を入力してください。'; msg.className = 'msg err'; } return; }
  if (S.busy) return; S.busy = true;
  if (msg) { msg.textContent = '送信中…'; msg.className = 'msg'; }
  const r = await api('apply', { name: name.trim(), company: company.trim() }, { quiet: true });
  S.busy = false;
  if (!r.ok) { S.gateMsg = r.network ? ERR.NETWORK : errText(r.error); return render(); }
  S.gateMsg = '';
  await checkStatus();
}

const upd = async (params, okMsg) => doWrite(() => api('setUser', params), okMsg);

/* ---------- クリックの振り分け ---------- */
const ACT = {
  open: t => { S.filter = 'all'; go({ n: 'item', id: t.dataset.id }, true); },
  back: () => {
    const n = S.route.n, tgt = (n === 'trash' || n === 'diag' || n === 'users') ? { n: 'settings' } : { n: 'home' };
    if (S.hist > 0) { S.hist--; const k = routeKey(S.route); try { history.back(); } catch (e) {} setTimeout(() => { if (routeKey(S.route) === k) go(tgt, false); }, 200); }
    else go(tgt, false);
  },
  settings: () => go(S.route.n === 'settings' ? { n: 'home' } : { n: 'settings' }, true),
  goto: t => go({ n: t.dataset.v }, true),
  'edit-toggle': () => { S.editing = !S.editing; S.openRow = null; S.confirm = null; render(); },
  'row-toggle': t => { const k = t.dataset.key; S.openRow = S.openRow === k ? null : k; S.confirm = null; render(); },
  filter: t => { S.filter = t.dataset.v; render(); },
  fs: t => { Prefs.d.fs = t.dataset.v; Prefs.save(); Prefs.apply(); render(); },
  zoom: t => openLb(t.dataset.ex, +t.dataset.i),
  play: playVideo,
  'lb-prev': () => { if (S.lb) { S.lb.i = (S.lb.i + S.lb.ids.length - 1) % S.lb.ids.length; showLb(); } },
  'lb-next': () => { if (S.lb) { S.lb.i = (S.lb.i + 1) % S.lb.ids.length; showLb(); } },
  'lb-close': closeLb,
  'add-ex': () => openSheet(),
  'edit-ex': t => openSheet(t.dataset.id),
  'del-ask': t => { S.confirm = 'del:' + t.dataset.id; render(); },
  no: () => { S.confirm = null; render(); },
  'del-yes': async t => {
    const ex = D('examples').find(e => e.id === t.dataset.id); S.confirm = null;
    if (!ex || !canTouch(ex)) return render();
    await doWrite(() => api('deleteExample', { id: ex.id }), isAdmin() ? 'ごみ箱に移しました' : '削除しました');
  },
  rename: async t => {
    const name = (($('#rn-' + t.dataset.id) || {}).value || '').trim();
    if (!name) return toast('名前を入力してください。');
    if (!canStruct()) return;
    if (t.dataset.kind === 'g') await doWrite(() => api('saveGroup', { id: t.dataset.id, name }), '名前を変更しました');
    else { const it = itemById(t.dataset.id); if (it) await doWrite(() => api('saveItem', { id: it.id, groupId: it.groupId, name }), '名前を変更しました'); }
  },
  mv: t => { if (canStruct()) reorder(t.dataset.kind, t.dataset.id, +t.dataset.dir); },
  'mv-group': async t => {
    const gid = ($('#mg-' + t.dataset.id) || {}).value, it = itemById(t.dataset.id);
    if (!gid || !it || gid === it.groupId || !canStruct()) return;
    await doWrite(() => api('saveItem', { id: it.id, groupId: gid, name: it.name }), 'グループを移動しました');
  },
  'del-g-ask': t => { S.confirm = 'del-g:' + t.dataset.id; render(); },
  'del-i-ask': t => { S.confirm = 'del-i:' + t.dataset.id; render(); },
  'del-g-yes': async t => {
    S.confirm = null;
    if (D('items').some(i => i.groupId === t.dataset.id)) { render(); return toast('項目が残っているグループは削除できません。先に項目を移動・削除してください。'); }
    await doWrite(() => api('deleteGroup', { id: t.dataset.id }), 'グループを削除しました');
  },
  'del-i-yes': async t => {
    S.confirm = null;
    if (D('examples').some(e => e.itemId === t.dataset.id)) { render(); return toast('事例が残っている項目は削除できません。ごみ箱の事例も含みます。'); }
    await doWrite(() => api('deleteItem', { id: t.dataset.id }), '項目を削除しました');
  },
  'add-group': async () => {
    const el = $('#ng'), name = (el && el.value || '').trim(); if (!name) return toast('グループ名を入力してください。');
    el.value = ''; if (!(await doWrite(() => api('saveGroup', { name }), 'グループを追加しました'))) { const e2 = $('#ng'); if (e2 && !e2.value) e2.value = name; }
  },
  'add-item': async t => {
    const el = $('#ni-' + t.dataset.id), name = (el && el.value || '').trim(); if (!name) return toast('項目名を入力してください。');
    el.value = ''; if (!(await doWrite(() => api('saveItem', { groupId: t.dataset.id, name }), '項目を追加しました'))) { const e2 = $('#ni-' + t.dataset.id); if (e2 && !e2.value) e2.value = name; }
  },
  restore: async t => { await doWrite(() => api('restoreExample', { id: t.dataset.id }), '元に戻しました'); },
  'purge-ask': t => { S.confirm = 'purge:' + t.dataset.id; render(); },
  'purge-yes': async t => { S.confirm = null; await doWrite(() => api('purgeExample', { id: t.dataset.id }), '完全に削除しました'); },
  'user-approve': t => upd({ id: t.dataset.id, status: 'approved' }, '承認しました'),
  'user-reject': t => upd({ id: t.dataset.id, status: 'rejected' }, '却下しました'),
  backup, 'diag-run': runDiag, 'diag-copy': copyDiag,
  'hint-close': () => { Prefs.d.hintClosed = true; Prefs.save(); render(); },
  // 端末の保存(写真など)に加えて、アプリ本体の保存も消す。古い画面のまま動かないときの立て直し用
  'clear-cache': async () => {
    await Store.clearData();
    try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch (e) { /* 無視 */ }
    try { if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (e) { /* 無視 */ }
    location.reload();
  },
  apply: applyNow,
  check: () => checkStatus(true),
  retry: async () => { S.gate = 'boot'; render(); await boot(); },
  reregister: async () => { await Store.clearAll(); await Device.reset(); S.gate = 'apply'; S.gateMsg = ''; render(); }
};

function initActions() {
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
    const f = ACT[t.dataset.act]; if (f) { e.preventDefault(); f(t); }
  });
  document.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.chg; if (!k) return;
    if (k === 'sort') { S.sort = e.target.value; Prefs.d.sort = S.sort; Prefs.save(); render(); }
    else if (k === 'diag-video') { const f = e.target.files && e.target.files[0]; e.target.value = ''; diagVideo(f); }
    else if (k === 'user-role') upd({ id: e.target.dataset.id, role: e.target.value }, '区分を変更しました');
  });
  document.addEventListener('keydown', e => {
    if (!S.lb) return;
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowLeft') ACT['lb-prev']();
    else if (e.key === 'ArrowRight') ACT['lb-next']();
    else if (e.key === 'Tab') {
      const bs = Array.from($('#lb').querySelectorAll('button')).filter(b => !b.hidden);
      const i = bs.indexOf(document.activeElement);
      e.preventDefault(); bs[(i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
    }
  });
  $('#q').addEventListener('input', e => { S.q = e.target.value; render(); });
}
