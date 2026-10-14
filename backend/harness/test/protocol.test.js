'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, jpeg } = require('./helpers');

const raw = (h, text) => JSON.parse(h.post(text));

test('壊れたJSON・空本文・配列・null は BAD_REQUEST のJSON(例外を投げない)', () => {
  const h = fresh();
  for (const body of ['{oops', '', '[]', 'null', '"x"', '123', '{"v":1}', '{"v":2,"action":"ping"}', '{"v":1,"action":5}', '{"v":1,"action":"ping","params":[]}', '{"v":1,"action":"ping","params":"x"}']) {
    const r = raw(h, body);
    assert.equal(r.ok, false, body);
    assert.equal(r.error.code, 'BAD_REQUEST', body);
    assert.ok(r.error.message.length > 0);
  }
  assert.equal(JSON.parse(h.ctx.doPost({}).getContent()).error.code, 'BAD_REQUEST');
  assert.equal(JSON.parse(h.ctx.doPost(undefined).getContent()).error.code, 'BAD_REQUEST');
  assert.equal(JSON.parse(h.ctx.doPost({ postData: {} }).getContent()).error.code, 'BAD_REQUEST');
});

test('未知の action(__proto__ / constructor を含む)は BAD_REQUEST', () => {
  const h = fresh();
  const u = h.mk('admin');
  for (const a of ['nope', 'Bootstrap', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '']) {
    const r = h.call(a, {}, u);
    assert.equal(r.ok, false, a);
    assert.equal(r.error.code, 'BAD_REQUEST', a);
  }
});

test('params 省略は {} として扱う / 表にないキーは BAD_REQUEST', () => {
  const h = fresh();
  const u = h.mk('viewer');
  const r = raw(h, JSON.stringify({ v: 1, action: 'bootstrap', dev: u.dev, key: u.key }));
  assert.equal(r.ok, true);
  assert.equal(h.call('bootstrap', { foo: 1 }, u).error.code, 'BAD_REQUEST');
  assert.equal(h.call('bootstrap', { since: 'x' }, u).error.code, 'BAD_REQUEST');
  assert.equal(h.call('bootstrap', { since: 1.5 }, u).error.code, 'BAD_REQUEST');
  assert.equal(h.call('bootstrap', { since: -1 }, u).error.code, 'VALIDATION_FAILED');
  assert.equal(h.call('ping', { x: 1 }).error.code, 'BAD_REQUEST');
  assert.equal(h.call('bootstrap', { __proto__: 1, constructor: 1 }, u).error.code, 'BAD_REQUEST');
});

test('大きすぎる本文は TOO_LARGE のJSON', () => {
  const h = fresh();
  const u = h.mk('poster');
  const big = JSON.stringify({ v: 1, action: 'uploadPart', dev: u.dev, key: u.key, params: { data: 'A'.repeat(4800000) } });
  const r = raw(h, big);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'TOO_LARGE');
  assert.equal(h.control('state').data.lockHeld, false);
});

test('応答の封筒: 成功は {ok,data,meta.serverTime}、失敗は {ok:false,error:{code,message}} で日本語', () => {
  const h = fresh();
  const ok = h.call('ping');
  assert.deepEqual(Object.keys(ok).sort(), ['data', 'meta', 'ok']);
  const ng = h.call('bootstrap', {}, undefined);
  assert.deepEqual(Object.keys(ng).sort(), ['error', 'ok']);
  assert.match(ng.error.message, /[ぁ-んァ-ン一-龥]/);
  const codes = new Set(h.ctx.ERROR_CODES);
  assert.equal(codes.size, 12);
  assert.ok(codes.has(ng.error.code));
});

test('内部エラーは INTERNAL(内容は漏らさず、ログに鍵を残さない)', () => {
  const h = fresh();
  const u = h.mk('viewer');
  const orig = h.ctx.handleBootstrap_;
  // 想定外の例外を起こす: アクション表を作り直して差し替える
  h.ctx.ACTIONS_CACHE_ = null;
  h.ctx.handleBootstrap_ = () => { throw new Error('boom ' + u.key); };
  const r = h.call('bootstrap', {}, u);
  h.ctx.handleBootstrap_ = orig;
  h.ctx.ACTIONS_CACHE_ = null;
  assert.equal(r.error.code, 'INTERNAL');
  assert.ok(!r.error.message.includes('boom'));
  // ロックは必ず解放される
  assert.equal(h.control('state').data.lockHeld, false);
});

test('更新系の内部エラーでもロックは解放される', () => {
  const h = fresh();
  const a = h.mk('admin');
  h.ctx.ACTIONS_CACHE_ = null;
  const orig = h.ctx.handleSaveGroup_;
  h.ctx.handleSaveGroup_ = () => { throw new Error('boom'); };
  assert.equal(a.api('saveGroup', { name: 'x' }).error.code, 'INTERNAL');
  assert.equal(h.control('state').data.lockHeld, false);
  h.ctx.handleSaveGroup_ = orig;
  h.ctx.ACTIONS_CACHE_ = null;
  assert.equal(a.api('saveGroup', { name: 'x' }).ok, true);
});

test('更新系はすべてスクリプトロックの内側で書く(uploadPart のDrive書込を除く)', () => {
  const h = fresh();
  const writes = [];
  const sheetProto = h.ctx.Repo.sheet('groups');
  // 書込メソッドを監視してロック状態を記録する
  const sheets = h.ctx.Repo.spreadsheet().getSheets();
  for (const sh of sheets) {
    for (const name of ['appendRow', 'deleteRow']) {
      const orig = sh[name].bind(sh);
      sh[name] = (...a) => { writes.push({ op: name, locked: h.state.lockHeld }); return orig(...a); };
    }
  }
  const origRange = sheets[0].constructor.prototype;
  const a = h.mk('admin');
  writes.length = 0;
  const g = a.api('saveGroup', { name: 'G' }).data.group;
  const it = a.api('saveItem', { groupId: g.id, name: 'I' }).data.item;
  a.api('deleteItem', { id: it.id });
  a.api('deleteGroup', { id: g.id });
  assert.ok(writes.length >= 4);
  assert.ok(writes.every((w) => w.locked), JSON.stringify(writes));
  assert.ok(sheetProto && origRange);
});

test('ハーネス: 同じ id の saveExample を2連続で送っても1行', () => {
  const h = fresh();
  const { itemId } = h.structure();
  const p = h.mk('poster');
  const ex = h.example({ itemId });
  const rs = [p.api('saveExample', ex), p.api('saveExample', ex), p.api('saveExample', ex)];
  assert.ok(rs.every((r) => r.ok));
  assert.equal(h.sheet('examples').length, 2);
});

test('/__mock/reset: 空と seeded を作り直せる(状態は持ち越さない)', () => {
  const h = fresh();
  h.mk('admin');
  h.control('reset', { variant: 'empty' });
  assert.equal(h.mk('admin').api('bootstrap').data.groups.length, 0);
  assert.equal(h.control('mails').data.mails.length, 0);
  assert.deepEqual(h.driveNames(), []);
  h.control('reset', { variant: 'seeded' });
  const d = h.mk('admin').api('bootstrap').data;
  assert.equal(d.groups.length, 6);
  assert.equal(d.users.length, 1);
});

test('画像1枚の最大サイズのリクエスト(base64約2MB)が本文上限に収まる', () => {
  const h = fresh();
  const p = h.mk('poster');
  const body = jpeg(1.5 * 1024 * 1024);
  const r = p.api('uploadPart', { mediaId: 'm_' + 'a'.repeat(12), kind: 'image', mime: 'image/jpeg', index: 0, total: 1, data: body.toString('base64'), thumb: jpeg(80 * 1024).toString('base64'), bytes: body.length });
  assert.equal(r.ok, true);
});

test('動画1片の最大サイズのリクエスト(3MB + サムネ80KB)が本文上限に収まる', () => {
  const h = fresh();
  const p = h.mk('poster');
  const part = require('crypto').randomBytes(3 * 1024 * 1024);
  const r = p.api('uploadPart', { mediaId: 'm_' + 'b'.repeat(12), kind: 'video', mime: 'video/webm', index: 0, total: 1, data: part.toString('base64'), thumb: jpeg(80 * 1024).toString('base64'), bytes: part.length });
  assert.equal(r.ok, true, JSON.stringify(r.error));
});
