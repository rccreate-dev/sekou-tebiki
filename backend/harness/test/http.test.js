'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh } = require('./helpers');

async function withServer(fn) {
  const h = fresh();
  const port = await h.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try { await fn(h, base); } finally { await h.close(); }
}

test('HTTP: POST /api は text/plain の本文を受けて JSON を返し、どのオリジンからも読める', async () => {
  await withServer(async (h, base) => {
    const r = await fetch(base + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8', Origin: 'https://tebiki.rccreate.net' }, body: JSON.stringify({ v: 1, action: 'ping' }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepEqual((await r.json()).data, { version: 1 });
  });
});

test('HTTP: OPTIONS プリフライトに CORS ヘッダ付きで答える', async () => {
  await withServer(async (h, base) => {
    for (const p of ['/api', '/__mock/reset']) {
      const r = await fetch(base + p, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
      assert.ok(r.status === 204 || r.status === 200);
      assert.equal(r.headers.get('access-control-allow-origin'), '*');
      assert.match(r.headers.get('access-control-allow-methods'), /POST/);
      assert.match(r.headers.get('access-control-allow-headers'), /Content-Type/i);
    }
  });
});

test('HTTP: 壊れたJSON・大きすぎる本文もJSONで返る', async () => {
  await withServer(async (h, base) => {
    const bad = await (await fetch(base + '/api', { method: 'POST', body: '{{{' })).json();
    assert.equal(bad.error.code, 'BAD_REQUEST');
    const big = await (await fetch(base + '/api', { method: 'POST', body: JSON.stringify({ v: 1, action: 'ping', params: { x: 'A'.repeat(5000000) } }) })).json();
    assert.equal(big.error.code, 'TOO_LARGE');
  });
});

test('HTTP: GET ping / decide(HTML) / commit と未対応 action', async () => {
  await withServer(async (h, base) => {
    const ping = await (await fetch(base + '/api?action=ping')).json();
    assert.deepEqual(ping.data, { version: 1 });
    const dev = { dev: 'dev-http-device1', key: 'q'.repeat(40) };
    const ap = await (await fetch(base + '/api', { method: 'POST', body: JSON.stringify({ v: 1, action: 'apply', dev: dev.dev, key: dev.key, params: { name: '通信テスト' } }) })).json();
    assert.equal(ap.data.status, 'pending');
    const mail = (await (await fetch(base + '/__mock/mails')).json()).data.mails[0];
    const approve = mail.body.match(/https?:\/\/[^\s]+/g).find((u) => u.includes('d=approve'));
    assert.ok(approve.startsWith(base + '/api?action=decide'), approve);
    const page = await fetch(approve);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const html = await page.text();
    assert.match(html, /通信テスト/);
    const st1 = await (await fetch(base + '/api', { method: 'POST', body: JSON.stringify({ v: 1, action: 'status', dev: dev.dev, key: dev.key }) })).json();
    assert.equal(st1.data.status, 'pending', 'decide ページを開いただけでは決まらない');
    const commit = html.match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&');
    assert.match(await (await fetch(commit)).text(), /承認/);
    const st2 = await (await fetch(base + '/api', { method: 'POST', body: JSON.stringify({ v: 1, action: 'status', dev: dev.dev, key: dev.key }) })).json();
    assert.equal(st2.data.status, 'approved');
    const other = await (await fetch(base + '/api?action=bootstrap')).json();
    assert.equal(other.error.code, 'BAD_REQUEST');
  });
});

test('HTTP: /__mock の reset / user / setrole / drive / maintenance / mails', async () => {
  await withServer(async (h, base) => {
    const post = async (p, b) => (await fetch(base + '/__mock/' + p, { method: 'POST', body: JSON.stringify(b || {}) })).json();
    assert.equal((await post('reset', { variant: 'seeded' })).ok, true);
    const u = (await post('user', { role: 'poster' })).data;
    assert.ok(u.dev && u.key);
    const call = async (action, params) => (await fetch(base + '/api', { method: 'POST', body: JSON.stringify({ v: 1, action, dev: u.dev, key: u.key, params }) })).json();
    assert.equal((await call('bootstrap', {})).data.me.role, 'poster');
    await post('setrole', { id: u.dev, role: 'viewer' });
    assert.equal((await call('bootstrap', {})).data.me.role, 'viewer');
    await post('setrole', { id: u.dev, status: 'rejected' });
    assert.equal((await call('bootstrap', {})).error.code, 'REJECTED');
    const drive = await (await fetch(base + '/__mock/drive')).json();
    assert.deepEqual(drive.data.files, []);
    assert.equal((await post('maintenance', { offsetHours: 25 })).data.trashed, 0);
    assert.deepEqual((await (await fetch(base + '/__mock/mails')).json()).data.mails, []);
  });
});

test('HTTP: MOCK_LATENCY_MS 相当の遅延が効く', async () => {
  const h = fresh();
  h.latency = 120;
  const port = await h.listen(0);
  try {
    const t = Date.now();
    await fetch(`http://127.0.0.1:${port}/api?action=ping`);
    assert.ok(Date.now() - t >= 100);
  } finally { await h.close(); }
});
