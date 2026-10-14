'use strict';
/* ===== 状態・権限・データの同期 ===== */
const S = {
  gate: 'boot',                 // boot / apply / pending / rejected / unauth / offline / ok
  me: null, meId: '', role: '', names: {}, users: null,
  rev: 0, groups: [], items: [], examples: [], hasData: false, offline: false, syncing: false, lastSync: 0,
  route: { n: 'home', id: null }, hist: 0, scroll: {},
  filter: 'all', sort: 'new', q: '', editing: false, openRow: null, confirm: null,
  sheet: null, lb: null, diag: null, diagBusy: false, busy: false, gateMsg: ''
};

const ok = () => S.gate === 'ok' && S.hasData;
const mode = () => !S.hasData ? 'loading' : (S.offline ? 'cached' : 'live');
const D = n => S[n] || [];
const visibleExamples = () => D('examples').filter(e => !e.hidden);
const isAdmin = () => ok() && S.role === 'admin';
const canPost = () => ok() && (S.role === 'poster' || S.role === 'admin');
const canStruct = () => isAdmin();
const canTouch = ex => canPost() && (S.role === 'admin' || (!!ex.by && ex.by === S.meId));

function counts() {
  const m = Object.create(null);
  visibleExamples().forEach(e => {
    const c = m[e.itemId] || (m[e.itemId] = { good: 0, bad: 0 });
    if (e.kind === 'bad') c.bad++; else c.good++;
  });
  return m;
}

/* 画面の再描画。入力中・動画再生中は保留して、終わってから描き直す */
let rafId = 0, pendingRender = false;
function holdRender() {
  const app = $('#app'), a = document.activeElement;
  if (app && a && app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  return !!(app && Array.prototype.some.call(app.querySelectorAll('video'), v => !v.paused && !v.ended));
}
function scheduleRender() {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    if (holdRender()) { pendingRender = true; return; }
    pendingRender = false; render();
  });
}
document.addEventListener('focusout', () => { if (pendingRender) setTimeout(scheduleRender, 60); });
document.addEventListener('pause', () => { if (pendingRender) scheduleRender(); }, true);
document.addEventListener('ended', () => { if (pendingRender) scheduleRender(); }, true);

/* ---------- サーバーのデータを取り込む ---------- */
function applyBoot(d, fromCache) {
  S.rev = d.rev || 0;
  S.me = d.me || null; S.meId = (d.me && d.me.id) || ''; S.role = (d.me && d.me.role) || '';
  S.groups = d.groups || []; S.items = d.items || []; S.examples = d.examples || [];
  S.names = d.names || {}; S.users = d.users || null;
  S.hasData = true;
  if (!fromCache) Store.kvSet('boot', d);
}

async function sync(force) {
  if (S.syncing) return false;
  S.syncing = true;
  try {
    const r = await api('bootstrap', force || !S.hasData ? {} : { since: S.rev }, { quiet: false });
    if (r.ok) {
      const wasOff = S.offline || S.gate !== 'ok';
      S.gate = 'ok'; S.offline = false; S.lastSync = Date.now();
      if (!r.data.unchanged) applyBoot(r.data);
      if (wasOff || !r.data.unchanged) scheduleRender();
      return true;
    }
    if (r.network) { if (!S.offline) { S.offline = true; scheduleRender(); } }
    return false;
  } finally { S.syncing = false; }
}

/* 承認されていない・登録が確認できないとき。保存してあった内容は消す(社外秘のため) */
function onAuthError(code) {
  S.gate = code === 'NOT_APPROVED' ? 'pending' : code === 'REJECTED' ? 'rejected' : 'unauth';
  if (S.hasData) { S.hasData = false; S.groups = []; S.items = []; S.examples = []; S.users = null; Store.clearData(); }
  scheduleRender();
}

/* 書き込みの共通処理。成功したら最新に同期する */
async function doWrite(fn, okMsg) {
  if (S.busy) return null;
  S.busy = true;
  try {
    const r = await fn();
    if (r.ok) { if (okMsg) toast(okMsg); await sync(true); return r; }
    toast(r.network ? ERR.NETWORK : errText(r.error));
    return null;
  } finally { S.busy = false; }
}

/* 自動更新: 画面が見えている間、1分ごと/見えるようになったとき/電波が戻ったとき */
function startPolling() {
  setInterval(() => { if (document.visibilityState === 'visible' && S.gate === 'ok' && !S.sheet) sync(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (S.gate === 'ok') sync(); else if (S.gate === 'pending') checkStatus(); } });
  window.addEventListener('online', () => { if (S.gate === 'ok') sync(); });
}
let pendTimer = 0;
async function checkStatus(manual) {
  const r = await api('status', {}, { quiet: true });
  if (!r.ok) { if (manual) toast(r.network ? ERR.NETWORK : errText(r.error)); return; }
  const st = r.data.status;
  if (st === 'approved') { await sync(true); render(); return; }
  S.gate = st === 'none' ? 'apply' : st === 'pending' ? 'pending' : 'rejected';
  if (S.gate === 'pending' && !pendTimer) pendTimer = setInterval(() => { if (S.gate !== 'pending') { clearInterval(pendTimer); pendTimer = 0; } else if (document.visibilityState === 'visible') checkStatus(); }, 15000);
  scheduleRender();
}
