'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh } = require('./helpers');

test('bootstrap: 全量の形(SPEC §5.2)', () => {
  const h = fresh();
  const p = h.mk('poster', { name: '投稿 花子' });
  const { itemId } = h.structure();
  const ex = h.example({ itemId, title: 'T', reason: 'R', severity: 'A', timing: '型枠建込', criteria: 'C', refNo: 'N-1' });
  assert.equal(p.api('saveExample', ex).ok, true);
  const r = p.api('bootstrap');
  assert.equal(r.ok, true);
  const d = r.data;
  assert.equal(d.rev, h.rev());
  assert.deepEqual(d.me, { id: p.dev, name: '投稿 花子', role: 'poster' });
  assert.equal(d.groups.length, 6);
  assert.deepEqual(Object.keys(d.groups[0]).sort(), ['id', 'name', 'order']);
  assert.deepEqual(Object.keys(d.items[0]).sort(), ['groupId', 'id', 'name', 'order']);
  assert.deepEqual(Object.keys(d.examples[0]).sort(), ['at', 'by', 'criteria', 'hidden', 'hiddenAt', 'id', 'itemId', 'kind', 'media', 'reason', 'refNo', 'severity', 'timing', 'title', 'updatedAt']);
  const e = d.examples[0];
  assert.equal(e.hidden, false);
  assert.equal(typeof e.at, 'number');
  assert.equal(e.by, p.dev);
  assert.equal(e.severity, 'A');
  assert.deepEqual(e.media, []);
  assert.equal(d.names[p.dev], '投稿 花子');
  assert.equal(d.users, undefined, 'admin 以外には users を返さない');
  // 並び順
  assert.deepEqual(d.groups.map((g) => g.order), [10, 20, 30, 40, 50, 60]);
});

test('bootstrap: since 同じなら unchanged、書き込みで rev が上がり全量に戻る', () => {
  const h = fresh();
  const a = h.mk('admin');
  const v = h.mk('viewer');
  const first = v.api('bootstrap').data;
  assert.deepEqual(v.api('bootstrap', { since: first.rev }).data, { unchanged: true, rev: first.rev });
  assert.equal(v.api('bootstrap', { since: first.rev - 1 }).data.unchanged, undefined);
  assert.equal(v.api('bootstrap', { since: first.rev + 5 }).data.unchanged, undefined);
  assert.equal(v.api('bootstrap', { since: 0 }).data.rev, first.rev);
  const g = a.api('saveGroup', { name: '新グループ' });
  assert.equal(g.ok, true);
  const after = v.api('bootstrap', { since: first.rev });
  assert.equal(after.data.unchanged, undefined);
  assert.equal(after.data.rev, first.rev + 1);
  assert.ok(after.data.groups.some((x) => x.name === '新グループ'));
  assert.equal(after.data.groups.find((x) => x.name === '新グループ').order, 70, '最大+10');
});

test('rev: 更新系すべてで +1、失敗した更新では上がらない、冪等な再送でも上がらない', () => {
  const h = fresh();
  const a = h.mk('admin');
  const { groups, itemId } = h.structure();
  const step = (label, fn, expectBump) => {
    const before = h.rev();
    const r = fn();
    if (expectBump) assert.equal(r.ok, true, label + ' ' + JSON.stringify(r));
    assert.equal(h.rev(), before + (expectBump ? 1 : 0), label);
    return r;
  };
  const g = step('saveGroup', () => a.api('saveGroup', { name: 'G' }), true).data.group;
  step('saveGroup update', () => a.api('saveGroup', { id: g.id, name: 'G2', order: 5 }), true);
  const it = step('saveItem', () => a.api('saveItem', { groupId: g.id, name: 'I' }), true).data.item;
  step('reorder', () => a.api('reorder', { kind: 'group', orders: [{ id: g.id, order: 1 }] }), true);
  const ex = h.example({ itemId });
  step('saveExample new', () => a.api('saveExample', ex), true);
  step('saveExample same resend', () => a.api('saveExample', ex), false);
  step('saveExample edit', () => a.api('saveExample', Object.assign({}, ex, { title: '変更' })), true);
  step('deleteExample', () => a.api('deleteExample', { id: ex.id }), true);
  step('deleteExample again (idempotent)', () => a.api('deleteExample', { id: ex.id }), false);
  step('restoreExample', () => a.api('restoreExample', { id: ex.id }), true);
  step('deleteExample 2', () => a.api('deleteExample', { id: ex.id }), true);
  step('purgeExample', () => a.api('purgeExample', { id: ex.id }), true);
  step('deleteItem', () => a.api('deleteItem', { id: it.id }), true);
  step('deleteGroup', () => a.api('deleteGroup', { id: g.id }), true);
  const u = h.mk('viewer');
  const before = h.rev();
  step('setUser role', () => a.api('setUser', { id: u.dev, role: 'poster' }), true);
  step('setUser same value (no-op)', () => a.api('setUser', { id: u.dev, role: 'poster' }), false);
  step('failed deleteGroup', () => a.api('deleteGroup', { id: groups[0].id }), false);
  step('failed saveExample', () => a.api('saveExample', h.example({ itemId: 'i_unknown00000' })), false);
  assert.ok(h.rev() > before);
});

test('bootstrap: 削除済みの事例は admin だけに見える', () => {
  const h = fresh();
  const { itemId } = h.structure();
  const p = h.mk('poster');
  const a = h.mk('admin');
  const v = h.mk('viewer');
  const live = h.example({ itemId, title: '生きている' });
  const dead = h.example({ itemId, title: '消した' });
  p.api('saveExample', live);
  p.api('saveExample', dead);
  p.api('deleteExample', { id: dead.id });
  for (const u of [p, v]) {
    const ids = u.api('bootstrap').data.examples.map((e) => e.id);
    assert.deepEqual(ids, [live.id]);
  }
  const adminView = a.api('bootstrap').data.examples;
  assert.equal(adminView.length, 2);
  const d = adminView.find((e) => e.id === dead.id);
  assert.equal(d.hidden, true);
  assert.ok(d.hiddenAt > 0);
  assert.equal(adminView.find((e) => e.id === live.id).hiddenAt, 0);
});

test('bootstrap: admin だけ users を受け取る / names は表示に要る人だけ', () => {
  const h = fresh();
  const a = h.mk('admin', { name: '社長' });
  const p = h.mk('poster', { name: '投稿者' });
  h.mk('viewer', { name: '閲覧だけの人' });
  const { itemId } = h.structure();
  p.api('saveExample', h.example({ itemId }));
  const d = a.api('bootstrap').data;
  assert.ok(Array.isArray(d.users));
  const u = d.users.find((x) => x.id === p.dev);
  assert.deepEqual(Object.keys(u).sort(), ['appliedAt', 'company', 'id', 'lastUsedAt', 'name', 'role', 'status']);
  assert.equal(u.role, 'poster');
  assert.equal(u.status, 'approved');
  assert.ok(!JSON.stringify(d).includes('keyHash'));
  assert.ok(!JSON.stringify(d.users).match(/[0-9a-f]{64}/), '鍵ハッシュを返さない');
  const v = h.mk('viewer');
  const names = v.api('bootstrap').data.names;
  assert.equal(names[p.dev], '投稿者');
  assert.ok(!Object.values(names).includes('閲覧だけの人'));
});

test('bootstrap: 最終利用は10分に1回まで更新する', () => {
  const h = fresh();
  const a = h.mk('admin');
  const lu = () => a.api('bootstrap').data.users.find((x) => x.id === a.dev).lastUsedAt;
  const t1 = lu();
  assert.ok(t1 > 0, '初回に記録される');
  h.control('clock', { advanceHours: 0.05 }); // 3分
  assert.equal(lu(), t1, '10分以内は更新しない');
  h.control('clock', { advanceHours: 0.2 }); // 計15分
  const t2 = lu();
  assert.ok(t2 > t1);
  assert.equal(h.control('state').data.lockHeld, false);
});

test('bootstrap: ロックが取れなくても閲覧は止まらない', () => {
  const h = fresh();
  const v = h.mk('viewer');
  h.state.lockHeld = true; // 他の誰かが書き込み中
  const r = v.api('bootstrap');
  h.state.lockHeld = false;
  assert.equal(r.ok, true);
});

test('更新系は書き込み中なら BUSY', () => {
  const h = fresh();
  const a = h.mk('admin');
  h.state.lockHeld = true;
  const r = a.api('saveGroup', { name: 'x' });
  h.state.lockHeld = false;
  assert.equal(r.error.code, 'BUSY');
  assert.equal(a.api('saveGroup', { name: 'x' }).ok, true);
});
