'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh } = require('./helpers');

const boot = (u) => u.api('bootstrap').data;

test('seedStructure: SPEC §7 の表と完全に一致・順は10刻み・何度実行しても増えない', () => {
  const h = fresh('empty');
  const a = h.mk('admin');
  assert.equal(boot(a).groups.length, 0);
  const r1 = h.control('call', { fn: 'seedStructure' });
  assert.equal(r1.ok, true);
  const d = boot(a);
  const expected = [
    ['準備', ['材料・資機材の確認', '安全・KY', '資材の積み方（運搬）', '加工場の材料の置き方']],
    ['墨出', ['通り芯・逃げ墨', '高さ（レベル）墨', 'スリット位置の墨出し']],
    ['建込', ['壁の建込', 'スラブ段取り', '敷桟木（下端）']],
    ['固め', ['締付け（セパ・フォームタイ）', '端太・控え・振れ止め']],
    ['片付け', ['作業後の片付け・清掃']],
    ['仕上がり確認', ['打継・出隅の精度']],
  ];
  assert.equal(d.groups.length, 6);
  assert.deepEqual(d.groups.map((g) => g.name), expected.map((e) => e[0]));
  assert.deepEqual(d.groups.map((g) => g.order), [10, 20, 30, 40, 50, 60]);
  expected.forEach(([gname, names], gi) => {
    const g = d.groups[gi];
    const its = d.items.filter((i) => i.groupId === g.id);
    assert.deepEqual(its.map((i) => i.name), names, gname);
    assert.deepEqual(its.map((i) => i.order), names.map((_, i) => (i + 1) * 10), gname + ' の順');
  });
  // SPEC の表は項目14個(本文の「13」と食い違う → 報告)。表どおりに入れる
  assert.equal(d.items.length, expected.reduce((n, e) => n + e[1].length, 0));
  assert.equal(d.items.length, 14);
  assert.deepEqual(d.examples, [], '事例は入れない');
  for (const g of d.groups) assert.match(g.id, /^g_[a-z0-9]{8,32}$/);
  for (const i of d.items) assert.match(i.id, /^i_[a-z0-9]{8,32}$/);
  const rev = h.rev();
  h.control('call', { fn: 'seedStructure' });
  h.control('call', { fn: 'seedStructure' });
  const d2 = boot(a);
  assert.deepEqual(d2.groups, d.groups);
  assert.deepEqual(d2.items, d.items);
  assert.equal(h.rev(), rev, '何も作らなければ rev も上げない');
});

test('seedStructure: 同名があれば作らない(手で作った同名グループ・項目を尊重)', () => {
  const h = fresh('empty');
  const a = h.mk('admin');
  const g = a.api('saveGroup', { name: '準備', order: 5 }).data.group;
  a.api('saveItem', { groupId: g.id, name: '安全・KY' });
  h.control('call', { fn: 'seedStructure' });
  const d = boot(a);
  assert.equal(d.groups.filter((x) => x.name === '準備').length, 1);
  assert.equal(d.groups.find((x) => x.name === '準備').order, 5, '既存の順は触らない');
  assert.equal(d.items.filter((x) => x.name === '安全・KY').length, 1);
  assert.equal(d.groups.length, 6);
});

test('reset の variant=seeded は seedStructure 済み / empty は空', () => {
  assert.equal(boot(fresh('seeded').mk('viewer')).groups.length, 6);
  assert.equal(boot(fresh('empty').mk('viewer')).groups.length, 0);
});

test('saveGroup: 新規は最大+10・更新・存在しないid・名前30字・必須', () => {
  const h = fresh('empty');
  const a = h.mk('admin');
  const g1 = a.api('saveGroup', { name: 'A' }).data.group;
  assert.deepEqual({ name: g1.name, order: g1.order }, { name: 'A', order: 10 });
  assert.match(g1.id, /^g_[a-z0-9]{8,32}$/);
  const g2 = a.api('saveGroup', { name: 'B' }).data.group;
  assert.equal(g2.order, 20);
  const g3 = a.api('saveGroup', { name: 'C', order: 7 }).data.group;
  assert.equal(g3.order, 7);
  assert.equal(a.api('saveGroup', { name: 'D' }).data.group.order, 30);
  const up = a.api('saveGroup', { id: g1.id, name: 'A改' }).data.group;
  assert.deepEqual(up, { id: g1.id, name: 'A改', order: 10 }, '順を省けば変えない');
  assert.equal(a.api('saveGroup', { id: g1.id, name: 'A改', order: 99 }).data.group.order, 99);
  assert.equal(a.api('saveGroup', { id: 'g_nonexistent1', name: 'x' }).error.code, 'NOT_FOUND');
  assert.equal(a.api('saveGroup', { id: 'zzz', name: 'x' }).error.code, 'VALIDATION_FAILED');
  assert.equal(a.api('saveGroup', { name: 'あ'.repeat(30) }).ok, true);
  assert.equal(a.api('saveGroup', { name: 'あ'.repeat(31) }).error.path, 'name');
  assert.equal(a.api('saveGroup', {}).error.path, 'name');
  assert.equal(a.api('saveGroup', { name: ' ' }).error.path, 'name');
  assert.equal(a.api('saveGroup', { name: 'x', order: 1.5 }).error.code, 'BAD_REQUEST');
  assert.equal(a.api('saveGroup', { name: 'x', order: '1' }).error.code, 'BAD_REQUEST');
  assert.equal(a.api('saveGroup', { name: '=cmd' }).data.group.name, ' =cmd');
});

test('saveItem: 新規は所属グループ内の最大+10・移動・名前40字', () => {
  const h = fresh('empty');
  const a = h.mk('admin');
  const g1 = a.api('saveGroup', { name: 'G1' }).data.group, g2 = a.api('saveGroup', { name: 'G2' }).data.group;
  const i1 = a.api('saveItem', { groupId: g1.id, name: 'I1' }).data.item;
  const i2 = a.api('saveItem', { groupId: g1.id, name: 'I2' }).data.item;
  const j1 = a.api('saveItem', { groupId: g2.id, name: 'J1' }).data.item;
  assert.deepEqual([i1.order, i2.order, j1.order], [10, 20, 10]);
  assert.match(i1.id, /^i_[a-z0-9]{8,32}$/);
  // 同じグループで名前だけ変更: 順はそのまま
  assert.deepEqual(a.api('saveItem', { id: i1.id, groupId: g1.id, name: 'I1改' }).data.item, { id: i1.id, groupId: g1.id, name: 'I1改', order: 10 });
  // 別グループへ移動: order なし → 移動先の最大+10
  const moved = a.api('saveItem', { id: i1.id, groupId: g2.id, name: 'I1改' }).data.item;
  assert.deepEqual(moved, { id: i1.id, groupId: g2.id, name: 'I1改', order: 20 });
  // 移動して order も指定
  const moved2 = a.api('saveItem', { id: i2.id, groupId: g2.id, name: 'I2', order: 5 }).data.item;
  assert.equal(moved2.order, 5);
  const d = boot(a);
  assert.deepEqual(d.items.filter((x) => x.groupId === g1.id), []);
  assert.deepEqual(d.items.filter((x) => x.groupId === g2.id).map((x) => x.name), ['I2', 'J1', 'I1改']);
  // エラー
  assert.equal(a.api('saveItem', { id: 'i_nonexistent1', groupId: g1.id, name: 'x' }).error.code, 'NOT_FOUND');
  assert.equal(a.api('saveItem', { groupId: 'g_nonexistent1', name: 'x' }).error.path, 'groupId');
  assert.equal(a.api('saveItem', { name: 'x' }).error.path, 'groupId');
  assert.equal(a.api('saveItem', { groupId: g1.id }).error.path, 'name');
  assert.equal(a.api('saveItem', { groupId: g1.id, name: 'あ'.repeat(40) }).ok, true);
  assert.equal(a.api('saveItem', { groupId: g1.id, name: 'あ'.repeat(41) }).error.path, 'name');
});

test('移動した項目の事例はそのまま残り、新しいグループの下に見える', () => {
  const h = fresh('seeded');
  const a = h.mk('admin'), p = h.mk('poster');
  const d = boot(a);
  const it = d.items[0], target = d.groups[5];
  const ex = h.example({ itemId: it.id });
  p.api('saveExample', ex);
  a.api('saveItem', { id: it.id, groupId: target.id, name: it.name });
  const d2 = boot(a);
  assert.equal(d2.items.find((x) => x.id === it.id).groupId, target.id);
  assert.equal(d2.examples[0].itemId, it.id);
});

test('reorder: 一括更新・順序の反映', () => {
  const h = fresh('seeded');
  const a = h.mk('admin');
  const d = boot(a);
  const ids = d.groups.map((g) => g.id);
  const orders = ids.map((id, i) => ({ id, order: (ids.length - i) * 10 })); // 逆順
  assert.deepEqual(a.api('reorder', { kind: 'group', orders }).data, {});
  assert.deepEqual(boot(a).groups.map((g) => g.id), ids.slice().reverse());
  const sub = d.items.slice(0, 3).map((i, k) => ({ id: i.id, order: 100 - k }));
  assert.equal(a.api('reorder', { kind: 'item', orders: sub }).ok, true);
  const after = boot(a).items;
  sub.forEach((o) => assert.equal(after.find((i) => i.id === o.id).order, o.order));
  // 部分指定では他の行は変わらない
  assert.equal(after.find((i) => i.id === d.items[5].id).order, d.items[5].order);
});

test('reorder: 1件でも存在しないidがあれば何も変えず NOT_FOUND(原子性)', () => {
  const h = fresh('seeded');
  const a = h.mk('admin');
  const before = boot(a);
  const rev = h.rev();
  const orders = [
    { id: before.groups[0].id, order: 999 },
    { id: before.groups[1].id, order: 998 },
    { id: 'g_nonexistent1', order: 1 },
  ];
  const r = a.api('reorder', { kind: 'group', orders });
  assert.equal(r.error.code, 'NOT_FOUND');
  assert.deepEqual(boot(a).groups, before.groups);
  assert.equal(h.rev(), rev);
  // 項目のidをグループとして渡しても NOT_FOUND
  const r2 = a.api('reorder', { kind: 'group', orders: [{ id: before.items[0].id, order: 1 }] });
  assert.equal(r2.error.code, 'NOT_FOUND');
});

test('reorder: 件数(1〜200)・形式・重複', () => {
  const h = fresh('seeded');
  const a = h.mk('admin');
  const g = boot(a).groups[0];
  assert.equal(a.api('reorder', { kind: 'group', orders: [] }).error.code, 'VALIDATION_FAILED');
  assert.equal(a.api('reorder', { kind: 'group', orders: Array.from({ length: 201 }, (_, i) => ({ id: 'g_x' + i, order: i })) }).error.code, 'VALIDATION_FAILED');
  assert.equal(a.api('reorder', { kind: 'group', orders: Array.from({ length: 200 }, (_, i) => ({ id: 'g_x' + i, order: i })) }).error.code, 'NOT_FOUND');
  assert.equal(a.api('reorder', { kind: 'planet', orders: [{ id: g.id, order: 1 }] }).error.code, 'VALIDATION_FAILED');
  assert.equal(a.api('reorder', { kind: 'group', orders: [{ id: g.id, order: 1 }, { id: g.id, order: 2 }] }).error.code, 'VALIDATION_FAILED');
  assert.equal(a.api('reorder', { kind: 'group', orders: [{ id: g.id }] }).error.code, 'VALIDATION_FAILED');
  assert.equal(a.api('reorder', { kind: 'group', orders: [5] }).error.code, 'BAD_REQUEST');
  assert.equal(a.api('reorder', { kind: 'group', orders: 'x' }).error.code, 'BAD_REQUEST');
  assert.equal(a.api('reorder', { kind: 'group' }).error.code, 'VALIDATION_FAILED');
});

test('deleteGroup: 項目があれば HAS_CHILDREN、空なら削除', () => {
  const h = fresh('seeded');
  const a = h.mk('admin');
  const d = boot(a);
  const r = a.api('deleteGroup', { id: d.groups[0].id });
  assert.equal(r.error.code, 'HAS_CHILDREN');
  assert.match(r.error.message, /4/);
  const empty = a.api('saveGroup', { name: '空' }).data.group;
  assert.deepEqual(a.api('deleteGroup', { id: empty.id }).data, {});
  assert.equal(boot(a).groups.some((g) => g.id === empty.id), false);
  assert.equal(a.api('deleteGroup', { id: empty.id }).error.code, 'NOT_FOUND');
  assert.equal(a.api('deleteGroup', {}).error.code, 'VALIDATION_FAILED');
  // 項目を全部消したら消せる
  const g = d.groups[5];
  const only = d.items.filter((i) => i.groupId === g.id);
  only.forEach((i) => assert.equal(a.api('deleteItem', { id: i.id }).ok, true));
  assert.equal(a.api('deleteGroup', { id: g.id }).ok, true);
});

test('deleteItem: 事例(削除済み含む)があれば HAS_CHILDREN、無ければ削除', () => {
  const h = fresh('seeded');
  const a = h.mk('admin'), p = h.mk('poster');
  const d = boot(a);
  const used = d.items[0], free = d.items[1];
  const ex = h.example({ itemId: used.id });
  p.api('saveExample', ex);
  p.api('deleteExample', { id: ex.id }); // 削除済みでも数える
  const r = a.api('deleteItem', { id: used.id });
  assert.equal(r.error.code, 'HAS_CHILDREN');
  assert.deepEqual(a.api('deleteItem', { id: free.id }).data, {});
  assert.equal(a.api('deleteItem', { id: free.id }).error.code, 'NOT_FOUND');
  assert.equal(boot(a).items.length, 13);
});

test('グループ・項目の変更は他の利用者の bootstrap にすぐ反映される', () => {
  const h = fresh('seeded');
  const a = h.mk('admin'), v = h.mk('viewer');
  const rev = v.api('bootstrap').data.rev;
  const g = a.api('saveGroup', { name: '追加' }).data.group;
  const d = v.api('bootstrap', { since: rev }).data;
  assert.ok(d.groups.some((x) => x.id === g.id));
});
