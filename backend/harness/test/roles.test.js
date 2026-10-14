'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, eid } = require('./helpers');

/** SPEC §2 の表。各操作を viewer / poster / admin で呼び、許可されるかを確かめる */
function setup() {
  const h = fresh();
  const { itemId, groups } = h.structure();
  const users = { viewer: h.mk('viewer'), poster: h.mk('poster'), admin: h.mk('admin') };
  return { h, itemId, groups, users };
}
const code = (r) => (r.ok ? 'OK' : r.error.code);

test('SPEC §2: 見る系は全員○', () => {
  const { h, users } = setup();
  const media = h.putImage(users.poster);
  for (const role of ['viewer', 'poster', 'admin']) {
    assert.equal(code(users[role].api('bootstrap')), 'OK', role + ' bootstrap');
    assert.equal(code(users[role].api('getThumbs', { ids: [media.id] })), 'OK', role + ' getThumbs');
    assert.equal(code(users[role].api('getPart', { id: media.id, index: 0 })), 'OK', role + ' getPart');
  }
});

test('SPEC §2: 事例を追加・写真登録は poster / admin のみ', () => {
  const { h, itemId, users } = setup();
  const up = (u) => u.api('uploadPart', { mediaId: 'm_' + Math.random().toString(36).slice(2, 12).padEnd(8, 'a'), kind: 'image', mime: 'image/jpeg', index: 0, total: 1,
    data: Buffer.from([0xff, 0xd8, 1, 2]).toString('base64'), thumb: Buffer.from([0xff, 0xd8, 1, 2]).toString('base64'), bytes: 4 });
  assert.equal(code(up(users.viewer)), 'FORBIDDEN');
  assert.equal(code(up(users.poster)), 'OK');
  assert.equal(code(up(users.admin)), 'OK');
  const save = (u) => u.api('saveExample', h.example({ itemId }));
  assert.equal(code(save(users.viewer)), 'FORBIDDEN');
  assert.equal(code(save(users.poster)), 'OK');
  assert.equal(code(save(users.admin)), 'OK');
  assert.equal(h.sheet('examples').length, 3, 'viewer の分は書かれない(ヘッダ+2件)');
});

test('SPEC §2: 自分の事例の編集・削除は poster / admin、他人の事例は admin のみ', () => {
  const { h, itemId, users } = setup();
  const other = h.mk('poster', { name: '別の投稿者' });
  for (const role of ['viewer', 'poster', 'admin']) {
    const owner = role === 'viewer' ? users.admin : users[role]; // viewer は自分の事例を持てない
    const own = h.example({ itemId });
    assert.equal(code(owner.api('saveExample', own)), 'OK');
    if (role !== 'viewer') {
      assert.equal(code(users[role].api('saveExample', Object.assign({}, own, { title: '直した' }))), 'OK', role + ' 自分の編集');
      assert.equal(code(users[role].api('deleteExample', { id: own.id })), 'OK', role + ' 自分の削除');
    } else {
      assert.equal(code(users.viewer.api('saveExample', Object.assign({}, own, { title: '直した' }))), 'FORBIDDEN');
      assert.equal(code(users.viewer.api('deleteExample', { id: own.id })), 'FORBIDDEN');
    }
  }
  // 他人の事例
  const theirs = h.example({ itemId });
  assert.equal(code(other.api('saveExample', theirs)), 'OK');
  assert.equal(code(users.viewer.api('saveExample', Object.assign({}, theirs, { title: 'x' }))), 'FORBIDDEN');
  assert.equal(code(users.poster.api('saveExample', Object.assign({}, theirs, { title: 'x' }))), 'FORBIDDEN');
  assert.equal(code(users.poster.api('deleteExample', { id: theirs.id })), 'FORBIDDEN');
  assert.equal(code(users.viewer.api('deleteExample', { id: theirs.id })), 'FORBIDDEN');
  assert.equal(code(users.admin.api('saveExample', Object.assign({}, theirs, { title: '管理者が直した' }))), 'OK');
  const ex = h.mk('admin').api('bootstrap').data.examples.find((e) => e.id === theirs.id);
  assert.equal(ex.title, '管理者が直した');
  assert.equal(ex.by, other.dev, '更新しても登録者は変わらない');
  assert.equal(code(users.admin.api('deleteExample', { id: theirs.id })), 'OK');
});

test('SPEC §2: ごみ箱の復元・完全削除は admin のみ', () => {
  const { h, itemId, users } = setup();
  const mk = () => {
    const e = h.example({ itemId });
    users.poster.api('saveExample', e);
    users.poster.api('deleteExample', { id: e.id });
    return e.id;
  };
  for (const act of ['restoreExample', 'purgeExample']) {
    const id = mk();
    assert.equal(code(users.viewer.api(act, { id })), 'FORBIDDEN', act + ' viewer');
    assert.equal(code(users.poster.api(act, { id })), 'FORBIDDEN', act + ' poster');
    assert.equal(code(users.admin.api(act, { id })), 'OK', act + ' admin');
  }
});

test('SPEC §2: グループ・項目の管理は admin のみ', () => {
  const { h, groups, users } = setup();
  const newGroup = h.mk('admin').api('saveGroup', { name: '空のグループ' }).data.group;
  const newItem = h.mk('admin').api('saveItem', { groupId: groups[0].id, name: '空の項目' }).data.item;
  const calls = {
    saveGroup: () => ({ name: '追加' }),
    saveItem: () => ({ groupId: groups[0].id, name: '追加' }),
    reorder: () => ({ kind: 'group', orders: [{ id: groups[0].id, order: 5 }] }),
  };
  for (const [act, mkp] of Object.entries(calls)) {
    assert.equal(code(users.viewer.api(act, mkp())), 'FORBIDDEN', act + ' viewer');
    assert.equal(code(users.poster.api(act, mkp())), 'FORBIDDEN', act + ' poster');
    assert.equal(code(users.admin.api(act, mkp())), 'OK', act + ' admin');
  }
  assert.equal(code(users.viewer.api('deleteGroup', { id: newGroup.id })), 'FORBIDDEN');
  assert.equal(code(users.poster.api('deleteGroup', { id: newGroup.id })), 'FORBIDDEN');
  assert.equal(code(users.admin.api('deleteGroup', { id: newGroup.id })), 'OK');
  assert.equal(code(users.viewer.api('deleteItem', { id: newItem.id })), 'FORBIDDEN');
  assert.equal(code(users.poster.api('deleteItem', { id: newItem.id })), 'FORBIDDEN');
  assert.equal(code(users.admin.api('deleteItem', { id: newItem.id })), 'OK');
});

test('SPEC §2: 利用者の承認・却下・区分変更は admin のみ', () => {
  const { h, users } = setup();
  const target = h.mk('viewer', { status: 'pending' });
  assert.equal(code(users.viewer.api('setUser', { id: target.dev, status: 'approved' })), 'FORBIDDEN');
  assert.equal(code(users.poster.api('setUser', { id: target.dev, status: 'approved' })), 'FORBIDDEN');
  assert.equal(code(users.admin.api('setUser', { id: target.dev, status: 'approved', role: 'poster' })), 'OK');
  assert.equal(target.api('status').data.role, 'poster');
});

test('SPEC §2: 状態が承認でない / 区分が空・未知の行は拒否(NOT_APPROVED)、却下は REJECTED、鍵違いは UNAUTHENTICATED', () => {
  const { h, itemId } = setup();
  const actions = [['bootstrap', {}], ['getThumbs', { ids: ['m_aaaaaaaa'] }], ['saveExample', h.example({ itemId })], ['setUser', { id: 'dev-12345678', role: 'viewer' }]];
  const pending = h.mk('admin', { status: 'pending' });
  const rejected = h.mk('admin', { status: 'rejected' });
  const blank = h.mk('admin');
  h.control('setrole', { id: blank.dev, rawRole: '' });
  const unknown = h.mk('admin');
  h.control('setrole', { id: unknown.dev, rawRole: 'スーパー' });
  const badKey = Object.assign({}, h.mk('admin'), {});
  const wrong = h.as({ dev: badKey.dev, key: 'z'.repeat(32) });
  for (const [a, p] of actions) {
    assert.equal(code(pending.api(a, p)), 'NOT_APPROVED', 'pending ' + a);
    assert.equal(code(rejected.api(a, p)), 'REJECTED', 'rejected ' + a);
    assert.equal(code(blank.api(a, p)), 'NOT_APPROVED', 'blank role ' + a);
    assert.equal(code(unknown.api(a, p)), 'NOT_APPROVED', 'unknown role ' + a);
    assert.equal(code(wrong(a, p)), 'UNAUTHENTICATED', 'wrong key ' + a);
  }
  assert.equal(code(blank.api('status')), 'OK');
  assert.equal(blank.api('status').data.role, undefined);
});

test('却下された直後から、同じ端末の次の操作が止まる', () => {
  const { h, itemId } = setup();
  const p = h.mk('poster');
  assert.equal(code(p.api('saveExample', h.example({ itemId }))), 'OK');
  h.mk('admin').api('setUser', { id: p.dev, status: 'rejected' });
  assert.equal(code(p.api('saveExample', h.example({ itemId }))), 'REJECTED');
  assert.equal(code(p.api('bootstrap')), 'REJECTED');
});

test('権限の確認は引数検査より先(viewer の不正な引数は FORBIDDEN)', () => {
  const { users } = setup();
  assert.equal(code(users.viewer.api('saveExample', { id: eid() })), 'FORBIDDEN');
  assert.equal(code(users.poster.api('saveGroup', {})), 'FORBIDDEN');
});
