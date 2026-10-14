'use strict';
/* ===== 起動 ===== */
async function boot() {
  const r = await api('status', {}, { quiet: true });
  if (r.ok) {
    const st = r.data.status;
    if (st === 'approved') { if (!(await sync(true))) { S.gate = S.hasData ? 'ok' : 'offline'; } else S.gate = 'ok'; }
    else { S.gate = st === 'none' ? 'apply' : st === 'pending' ? 'pending' : 'rejected'; if (S.gate === 'pending') checkStatus(); }
  } else if (r.network) {
    if (S.hasData) { S.gate = 'ok'; S.offline = true; } else S.gate = 'offline';
  } else onAuthError(r.error.code);
  render();
}

async function init() {
  Prefs.load(); Prefs.apply(); S.sort = Prefs.d.sort || 'new';
  S.route = routeFromHash();
  initActions(); initSheet();
  window.addEventListener('hashchange', onHash);
  window.addEventListener('popstate', onHash);
  if (window.visualViewport) {
    const upd = () => { const v = window.visualViewport; document.documentElement.style.setProperty('--kb', Math.max(0, Math.round(innerHeight - v.height - v.offsetTop)) + 'px'); };
    visualViewport.addEventListener('resize', upd); visualViewport.addEventListener('scroll', upd); upd();
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // 新しい版に切り替わったら、入力中でなければ自動で読み込み直す(古い画面のまま使い続けないため)
    const hadSw = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadSw || reloaded) return;
      const tryReload = () => { if (S.sheet || S.busy) { setTimeout(tryReload, 3000); return; } reloaded = true; location.reload(); };
      tryReload();
    });
    navigator.serviceWorker.register('sw.js').then(r => { try { r.update(); } catch (e) {} }).catch(() => {});
  }
  await Device.init();
  // 前回の内容が端末に残っていれば、通信を待たずにまず表示する(電波が弱い現場向け)
  const cached = await Store.kvGet('boot');
  if (cached && cached.me) { applyBoot(cached, true); S.gate = 'ok'; S.offline = true; }
  render();
  startPolling();
  await boot();
}
init();
