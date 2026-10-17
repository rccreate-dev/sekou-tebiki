'use strict';
/* 通し確認: ハーネス(GAS互換)+静的サーバー+Playwright。 実行: NODE_PATH=$(npm root -g) node tests/e2e.js */
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { chromium } = require('playwright');
const FE = path.join(__dirname, '..', 'frontend'), HP = 8790, SP = 8791;
const API = 'http://localhost:' + HP + '/api', BASE = 'http://localhost:' + SP + '/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const stat = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  if (p === '/config.js') { res.setHeader('content-type', MIME['.js']); return res.end("window.TEBIKI_CONFIG={API_URL:'" + API + "',APP_VERSION:'test'};"); }
  const f = path.join(FE, p);
  if (!f.startsWith(FE) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  let b = fs.readFileSync(f);
  if (p === '/index.html') b = Buffer.from(b.toString().replace('connect-src \'self\'', "connect-src 'self' http://localhost:" + HP));
  res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(b);
});
const mock = (p, body) => fetch('http://localhost:' + HP + '/__mock/' + p, { method: 'POST', body: JSON.stringify(body || {}) }).then(r => r.json());
let fails = 0;
const check = (n, c, d) => { console.log((c ? 'OK  ' : 'NG  ') + n + (c ? '' : '  ' + (d || ''))); if (!c) fails++; };
(async () => {
  const hs = spawn('node', [path.join(__dirname, '..', 'backend', 'harness', 'server.js')], { env: Object.assign({}, process.env, { HARNESS_PORT: HP }), stdio: 'inherit' });
  await new Promise(r => stat.listen(SP, r)); await new Promise(r => setTimeout(r, 1200));
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  try {
    await mock('reset', { variant: 'seeded' });
    const ctx = await br.newContext({ viewport: { width: 400, height: 800 } });
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(BASE);
    await pg.waitForSelector('#ap-name');
    check('未登録は申請画面', true);
    await pg.fill('#ap-name', '細野 功介'); await pg.click('[data-act=apply]');
    await pg.waitForSelector('text=承認を待っています');
    check('申請→承認待ち', true);
    const mails = await (await fetch('http://localhost:' + HP + '/__mock/mails')).json();
    check('社長へメール', JSON.stringify(mails).includes('細野'));
    // 承認(ハーネスで直接)
    const sheet = await mock('sheet', { key: 'users' }); const rows = (sheet.data || sheet).rows;
    const row = rows.find(r => String(r).includes('細野')); const id = Array.isArray(row) ? row[0] : null;
    await mock('setrole', { id, role: 'admin', status: 'approved', bump: true });
    await pg.click('[data-act=check]');
    await pg.waitForSelector('text=準備', { timeout: 15000 });
    check('承認後にホーム表示(6グループ)', (await pg.locator('.grp').count()) >= 6);
    check('横スクロールなし(ホーム)', await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // 項目を開いて追加
    await pg.click('text=壁の建込'); await pg.waitForSelector('#addbar:not([hidden])');
    await pg.click('[data-act=add-ex]'); await pg.waitForSelector('#sh-title');
    await pg.fill('#sh-title', '開口部の補強が不足'); await pg.fill('#sh-reason', '端太が足りない');
    await pg.click('label[for=k-b]');
    // 写真(canvas で生成)
    const png = await pg.evaluate(async () => { const c = document.createElement('canvas'); c.width = 1200; c.height = 800; const g = c.getContext('2d'); for (let i = 0; i < 60; i++) { g.fillStyle = 'hsl(' + i * 6 + ',70%,50%)'; g.fillRect(i * 20, (i * 37) % 700, 60, 90); } return c.toDataURL('image/png').split(',')[1]; });
    const T1 = path.join(require('os').tmpdir(), 't1.png'); fs.writeFileSync(T1, Buffer.from(png, 'base64'));
    await pg.setInputFiles('#sh-file', T1);
    await pg.waitForSelector('#sh-prev .pv img');
    // 写真への書き込み(矢印とスタンプ→焼き込み→サムネも更新)
    const sz0 = await pg.evaluate(() => S.sheet.media[0].blob.size);
    await pg.click('[data-act=sh-ann]'); await pg.waitForSelector('#ann-cv');
    const stroke = async (fx, fy, tx, ty) => { const b = await pg.locator('#ann-cv').boundingBox(); await pg.mouse.move(b.x + b.width * fx, b.y + b.height * fy); await pg.mouse.down(); await pg.mouse.move(b.x + b.width * tx, b.y + b.height * ty, { steps: 6 }); await pg.mouse.up(); };
    await pg.click('[data-tool=arrow]'); await stroke(.1, .1, .5, .5);
    await pg.click('[data-tool=blur]'); await stroke(.6, .6, .9, .9);
    await pg.click('[data-tool=stamp]'); await pg.click('[data-stamp=NG]'); await stroke(.3, .7, .3, .7);
    check('書き込みが3つ入る(触れただけの図形は捨てる)', await pg.evaluate(() => !document.querySelector('[data-a=undo]').disabled));
    await pg.click('[data-a=undo]'); await pg.click('[data-a=done]');
    await pg.waitForFunction(() => S.sheet && S.sheet.media[0].ops && !S.sheet.pending, null, { timeout: 15000 });
    const ai = await pg.evaluate(() => ({ n: S.sheet.media[0].ops.length, size: S.sheet.media[0].blob.size, w: 0 }));
    check('書き込み2つが写真に焼き込まれる', ai.n === 2 && ai.size !== sz0, JSON.stringify(ai));
    check('「書込を直す」に変わる', (await pg.locator('.ann-btn').innerText()).includes('直す'));
    await pg.click('#sh-save');
    await pg.waitForSelector('article.ex', { timeout: 20000 });
    check('事例が登録され項目ページに出る', (await pg.locator('article.ex.bad').count()) === 1);
    await pg.waitForFunction(() => { const i = document.querySelector('article.ex img[data-mid]'); return i && i.src && i.naturalWidth > 0; }, null, { timeout: 15000 }).then(() => check('サムネ表示', true), () => check('サムネ表示', false));
    await pg.click('.m[data-act=zoom]'); await pg.waitForFunction(() => { const i = document.querySelector('#lbimg'); return i && i.naturalWidth > 600; }, null, { timeout: 15000 }).then(() => check('拡大で本体表示', true), () => check('拡大で本体表示', false));
    await pg.click('.lbc');
    check('横スクロールなし(項目)', await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // 削除→ごみ箱→戻す
    await pg.click('[data-act=del-ask]'); await pg.click('[data-act=del-yes]');
    await pg.waitForSelector('text=まだ事例がありません');
    check('削除で一覧から消える', true);
    await pg.goto(BASE + '#trash'); await pg.waitForSelector('text=開口部の補強が不足');
    await pg.click('[data-act=restore]'); await pg.waitForSelector('text=ごみ箱は空です');
    check('ごみ箱から復元', true);
    // 構成編集
    await pg.goto(BASE); await pg.waitForSelector('[data-act=edit-toggle]'); await pg.click('[data-act=edit-toggle]');
    await pg.fill('#ng', 'テストG'); await pg.click('[data-act=add-group]'); await pg.waitForSelector('text=テストG');
    check('グループ追加', true);
    // 閲覧者
    await mock('setrole', { id, role: 'viewer', bump: true });
    await pg.reload(); await pg.waitForSelector('#role:not([hidden])'); 
    check('閲覧者は「閲覧のみ」で構成編集なし', (await pg.locator('[data-act=edit-toggle]').count()) === 0);
    // オフライン: 前回内容が出る
    await ctx.setOffline(true); await pg.reload().catch(() => {}); await pg.waitForTimeout(1500);
    check('オフラインでも保存内容を表示', (await pg.locator('.grp').count()) >= 6, await pg.content().then(c => c.slice(0, 200)));
    await ctx.setOffline(false);
    // 却下→内容消去
    await mock('setrole', { id, status: 'rejected', bump: true });
    await pg.reload(); await pg.waitForSelector('text=承認されていません');
    check('却下で画面が閉じる', true);
    check('JSエラーなし', errs.length === 0, errs.join(' | '));
  } catch (e) { fails++; console.log('例外', e); }
  finally { await br.close(); hs.kill(); stat.close(); console.log(fails ? 'FAIL ' + fails : 'ALL PASS'); process.exit(fails ? 1 : 0); }
})();
