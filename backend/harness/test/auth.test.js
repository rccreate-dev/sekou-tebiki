'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { fresh } = require('./helpers');

const newDevice = () => ({ dev: 'dev-' + crypto.randomBytes(8).toString('hex'), key: crypto.randomBytes(24).toString('hex') });
const links = (mail) => {
  const urls = mail.body.match(/https?:\/\/[^\s]+/g) || [];
  const q = (u) => Object.fromEntries(new URL(u).searchParams);
  return { urls, approve: urls.map(q).find((p) => p.action === 'decide' && p.d === 'approve'), reject: urls.map(q).find((p) => p.action === 'decide' && p.d === 'reject') };
};

test('ping は認証不要', () => {
  const h = fresh();
  const r = h.call('ping');
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { version: 1 });
  assert.match(r.meta.serverTime, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/);
});

test('status: 未登録は none、鍵が違えば UNAUTHENTICATED', () => {
  const h = fresh();
  const d = newDevice();
  assert.deepEqual(h.call('status', {}, d).data, { status: 'none' });
  h.call('apply', { name: '山田' }, d);
  assert.equal(h.call('status', {}, d).data.status, 'pending');
  assert.equal(h.call('status', {}, d).data.name, '山田');
  const bad = h.call('status', {}, { dev: d.dev, key: 'x'.repeat(32) });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'UNAUTHENTICATED');
});

test('apply → 申請中 → メール → 確認ページでは決まらず → commit で承認', () => {
  const h = fresh();
  const d = newDevice();
  const rev0 = h.rev();
  const r = h.call('apply', { name: '山田 太郎', company: '山田工業' }, d);
  assert.deepEqual(r.data, { status: 'pending' });
  assert.ok(h.rev() > rev0, '新しい申請で rev が上がる');

  const mails = h.control('mails').data.mails;
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'owner@example.com');
  assert.equal(mails[0].subject, '【施工手引き】利用申請: 山田 太郎(山田工業)');
  assert.match(mails[0].body, /山田 太郎/);
  const { approve, reject, urls } = links(mails[0]);
  assert.ok(approve && reject, '承認/却下リンクがある');
  assert.equal(approve.id, d.dev);
  assert.match(approve.sig, /^[0-9a-f]{64}$/);
  assert.ok(!urls.some((u) => u.includes('action=commit')), 'メールに commit リンクは入れない');
  assert.match(mails[0].htmlBody, /承認する/);

  // 申請中のうちは使えない
  assert.equal(h.call('bootstrap', {}, d).error.code, 'NOT_APPROVED');
  assert.equal(h.call('getThumbs', { ids: ['m_aaaaaaaa'] }, d).error.code, 'NOT_APPROVED');

  // 確認ページ: HTMLが返るだけで状態は変わらない
  const rev1 = h.rev();
  const page = h.get(approve);
  assert.equal(page.json, false);
  assert.match(page.body, /承認/);
  assert.match(page.body, /action=commit/);
  assert.equal(h.call('status', {}, d).data.status, 'pending');
  assert.equal(h.rev(), rev1, 'decide は rev も変えない');

  // commit で決定
  const commitUrl = page.body.match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&');
  const cp = Object.fromEntries(new URL(commitUrl).searchParams);
  assert.equal(cp.action, 'commit');
  const done = h.get(cp);
  assert.match(done.body, /承認/);
  assert.equal(h.call('status', {}, d).data.status, 'approved');
  assert.equal(h.call('status', {}, d).data.role, 'viewer', '既定の区分は閲覧');
  assert.ok(h.rev() > rev1);
  assert.equal(h.call('bootstrap', {}, d).ok, true);
  assert.equal(h.control('state').data.lockHeld, false);

  // 同じリンクを再度開いても何も壊れない / 逆向きのリンクでも承認済みは変わらない
  assert.match(h.get(cp).body, /すでに/);
  const rejectCommit = h.get(Object.assign({}, reject, { action: 'commit' }));
  assert.match(rejectCommit.body, /すでに/);
  assert.equal(h.call('status', {}, d).data.status, 'approved');
});

test('却下リンク → REJECTED', () => {
  const h = fresh();
  const d = newDevice();
  h.call('apply', { name: '怪しい人' }, d);
  const { reject } = links(h.control('mails').data.mails[0]);
  h.get(Object.assign({}, reject, { action: 'commit' }));
  assert.equal(h.call('status', {}, d).data.status, 'rejected');
  assert.equal(h.call('bootstrap', {}, d).error.code, 'REJECTED');
  assert.equal(h.call('apply', { name: '怪しい人' }, d).data.status, 'rejected');
});

test('署名が違う・id/d が違うリンクは無効', () => {
  const h = fresh();
  const d = newDevice();
  h.call('apply', { name: '山田' }, d);
  const { approve } = links(h.control('mails').data.mails[0]);
  for (const bad of [
    Object.assign({}, approve, { sig: '0'.repeat(64) }),
    Object.assign({}, approve, { d: 'reject' }),
    Object.assign({}, approve, { sig: undefined }),
    Object.assign({}, approve, { id: 'other-device-1' }),
    Object.assign({}, approve, { d: 'delete' }),
  ]) {
    assert.match(h.get(bad).body, /無効/);
    assert.match(h.get(Object.assign({}, bad, { action: 'commit' })).body, /無効/);
  }
  assert.equal(h.call('status', {}, d).data.status, 'pending');
});

test('apply: 登録済みは何もしない・鍵が違えば UNAUTHENTICATED・メールは1通だけ', () => {
  const h = fresh();
  const d = newDevice();
  h.call('apply', { name: '山田', company: 'A社' }, d);
  const again = h.call('apply', { name: '別名', company: 'B社' }, d);
  assert.deepEqual(again.data, { status: 'pending' });
  assert.equal(h.control('mails').data.mails.length, 1);
  assert.equal(h.call('status', {}, d).data.name, '山田', '名前は上書きされない');
  const wrong = h.call('apply', { name: '山田' }, { dev: d.dev, key: 'y'.repeat(40) });
  assert.equal(wrong.error.code, 'UNAUTHENTICATED');
});

test('apply: 入力検査(氏名必須・40字・会社60字・不明キー・数式の先頭)', () => {
  const h = fresh();
  const d = () => newDevice();
  assert.equal(h.call('apply', {}, d()).error.code, 'VALIDATION_FAILED');
  assert.equal(h.call('apply', { name: '   ' }, d()).error.code, 'VALIDATION_FAILED');
  assert.equal(h.call('apply', { name: 'あ'.repeat(41) }, d()).error.code, 'VALIDATION_FAILED');
  assert.equal(h.call('apply', { name: 'あ'.repeat(40) }, d()).ok, true);
  assert.equal(h.call('apply', { name: 'a', company: 'あ'.repeat(61) }, d()).error.code, 'VALIDATION_FAILED');
  assert.equal(h.call('apply', { name: 'a', company: 'あ'.repeat(60) }, d()).ok, true);
  assert.equal(h.call('apply', { name: 'a', foo: 1 }, d()).error.code, 'BAD_REQUEST');
  assert.equal(h.call('apply', { name: 5 }, d()).error.code, 'BAD_REQUEST');
  const f = d();
  h.call('apply', { name: '=HYPERLINK("x")', company: '+81' }, f);
  const row = h.sheet('users').find((r) => r[0] === f.dev);
  assert.equal(row[2], ' =HYPERLINK("x")');
  assert.equal(row[3], ' +81');
});

test('dev / key の形式が不正なら UNAUTHENTICATED(ping 以外)', () => {
  const h = fresh();
  for (const u of [undefined, { dev: 'short', key: 'k'.repeat(32) }, { dev: 'dev-12345678', key: 'short' }, { dev: 'dev 1234567', key: 'k'.repeat(32) }, { dev: 'dev-12345678', key: 'k-'.repeat(20) }]) {
    for (const a of ['apply', 'status', 'bootstrap']) {
      const r = h.call(a, a === 'apply' ? { name: 'x' } : {}, u);
      assert.equal(r.error.code, 'UNAUTHENTICATED', a + ' ' + JSON.stringify(u));
    }
  }
});

test('未登録の端末は承認が要る操作で UNAUTHENTICATED', () => {
  const h = fresh();
  assert.equal(h.call('bootstrap', {}, newDevice()).error.code, 'UNAUTHENTICATED');
});

test('鍵は平文で保存されない: SHA-256(key+PEPPER) の16進だけ', () => {
  const h = fresh();
  const d = newDevice();
  h.call('apply', { name: '山田' }, d);
  const pepper = h.ctx.PropertiesService.getScriptProperties().getProperty('PEPPER');
  assert.ok(pepper && pepper.length >= 32);
  const row = h.sheet('users').find((r) => r[0] === d.dev);
  assert.equal(row[7], crypto.createHash('sha256').update(d.key + pepper).digest('hex'));
  assert.ok(!JSON.stringify(h.sheet('users')).includes(d.key));
  assert.ok(!JSON.stringify(h.control('state').data.logs).includes(d.key));
  // 別のPEPPERでは認証できない(PEPPER入りのハッシュである証拠)
  h.ctx.PropertiesService.getScriptProperties().setProperty('PEPPER', 'changed');
  assert.equal(h.call('status', {}, d).error.code, 'UNAUTHENTICATED');
});

test('メール: mailEnabled=FALSE で送らない / 6時間に20通まで', () => {
  const h = fresh();
  h.control('setting', { key: 'mailEnabled', value: 'FALSE' });
  h.call('apply', { name: 'A' }, newDevice());
  assert.equal(h.control('mails').data.mails.length, 0);
  h.control('setting', { key: 'mailEnabled', value: 'TRUE' });
  for (let i = 0; i < 25; i++) assert.equal(h.call('apply', { name: 'U' + i }, newDevice()).ok, true);
  assert.equal(h.control('mails').data.mails.length, 20);
  h.control('clock', { advanceHours: 6.1 });
  h.call('apply', { name: 'later' }, newDevice());
  assert.equal(h.control('mails').data.mails.length, 21);
});

test('apply の連打対策: 新しい申請は1時間に30件まで(登録済みの再申請は数えない)', () => {
  const h = fresh();
  const first = newDevice();
  assert.equal(h.call('apply', { name: 'U0' }, first).ok, true);
  for (let i = 1; i < 30; i++) assert.equal(h.call('apply', { name: 'U' + i }, newDevice()).ok, true);
  // 登録済みの端末の再申請は通る(行もメールも増えない)
  assert.deepEqual(h.call('apply', { name: 'U0' }, first).data, { status: 'pending' });
  const before = h.sheet('users').length;
  const r = h.call('apply', { name: 'over' }, newDevice());
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BUSY');
  assert.equal(h.sheet('users').length, before, '断ったときは行を増やさない');
  h.control('clock', { advanceHours: 1.1 });
  assert.equal(h.call('apply', { name: 'later' }, newDevice()).ok, true);
});

test('apply の連打対策: 申請中が50件あれば新しい申請を受けない', () => {
  const h = fresh();
  for (let i = 0; i < 49; i++) h.mk('viewer', { name: 'P' + i, status: 'pending' });
  h.mk('viewer', { name: '承認済み' }); // 承認済み・却下は数えない
  h.mk('viewer', { name: '却下', status: 'rejected' });
  assert.equal(h.call('apply', { name: '50件目' }, newDevice()).ok, true);
  const r = h.call('apply', { name: '51件目' }, newDevice());
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BUSY');
  assert.match(r.error.message, /管理者/);
  assert.equal(h.control('mails').data.mails.length, 1, '断った申請はメールを送らない');
});

test('メール本文の氏名はHTMLエスケープされる', () => {
  const h = fresh();
  h.call('apply', { name: '<b>x</b>', company: 'A&B' }, newDevice());
  const m = h.control('mails').data.mails[0];
  assert.ok(!m.htmlBody.includes('<b>x</b>'));
  assert.ok(m.htmlBody.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('doGet は decide / commit / ping 以外を受けない', () => {
  const h = fresh();
  const ping = JSON.parse(h.get({ action: 'ping' }).body);
  assert.equal(ping.ok, true);
  for (const a of ['bootstrap', 'apply', 'status', undefined, 'saveExample']) {
    const r = JSON.parse(h.get({ action: a }).body);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'BAD_REQUEST');
  }
});
