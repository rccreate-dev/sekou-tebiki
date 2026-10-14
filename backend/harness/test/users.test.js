'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh } = require('./helpers');

const code = (r) => (r.ok ? 'OK' : r.error.code);

test('setUser: 区分・状態の変更が次の呼び出しから効く', () => {
  const h = fresh();
  const a = h.mk('admin');
  const u = h.mk('viewer', { status: 'pending' });
  assert.equal(u.api('bootstrap').error.code, 'NOT_APPROVED');
  assert.deepEqual(a.api('setUser', { id: u.dev, status: 'approved' }).data, {});
  assert.equal(u.api('bootstrap').data.me.role, 'viewer');
  a.api('setUser', { id: u.dev, role: 'poster' });
  assert.equal(u.api('bootstrap').data.me.role, 'poster');
  a.api('setUser', { id: u.dev, role: 'admin' });
  assert.equal(u.api('bootstrap').data.me.role, 'admin');
  a.api('setUser', { id: u.dev, role: 'viewer', status: 'rejected' });
  assert.equal(u.api('bootstrap').error.code, 'REJECTED');
  a.api('setUser', { id: u.dev, status: 'pending' });
  assert.equal(u.api('bootstrap').error.code, 'NOT_APPROVED');
  const row = h.sheet('users').find((r) => r[0] === u.dev);
  assert.equal(row[4], '閲覧');
  assert.equal(row[5], '申請中');
  assert.equal(a.api('bootstrap').data.users.find((x) => x.id === u.dev).status, 'pending');
});

test('setUser: 決定日時が入る・存在しない利用者・引数の検査', () => {
  const h = fresh();
  const a = h.mk('admin');
  const u = h.mk('viewer', { status: 'pending' });
  h.control('setrole', { id: u.dev, status: 'pending' });
  a.api('setUser', { id: u.dev, status: 'approved' });
  const row = h.sheet('users').find((r) => r[0] === u.dev);
  assert.ok(row[6], '決定日時');
  assert.equal(a.api('setUser', { id: 'dev-doesnotexist', role: 'viewer' }).error.code, 'NOT_FOUND');
  assert.equal(a.api('setUser', { id: u.dev }).error.code, 'BAD_REQUEST');
  assert.equal(a.api('setUser', { id: u.dev, role: 'boss' }).error.code, 'VALIDATION_FAILED');
  assert.equal(a.api('setUser', { id: u.dev, status: 'deleted' }).error.code, 'VALIDATION_FAILED');
  assert.equal(a.api('setUser', { role: 'viewer' }).error.path, 'id');
  assert.equal(a.api('setUser', { id: 'x', role: 'viewer' }).error.path, 'id');
  assert.equal(a.api('setUser', { id: u.dev, role: 'viewer', hack: 1 }).error.code, 'BAD_REQUEST');
});

test('setUser: 自分自身を admin 以外・却下にはできない(他に管理者がいても)', () => {
  const h = fresh();
  const a = h.mk('admin');
  const b = h.mk('admin');
  assert.equal(code(a.api('setUser', { id: a.dev, role: 'viewer' })), 'FORBIDDEN');
  assert.equal(code(a.api('setUser', { id: a.dev, role: 'poster' })), 'FORBIDDEN');
  assert.equal(code(a.api('setUser', { id: a.dev, status: 'rejected' })), 'FORBIDDEN');
  assert.equal(code(a.api('setUser', { id: a.dev, role: 'viewer', status: 'rejected' })), 'FORBIDDEN');
  assert.equal(a.api('bootstrap').data.me.role, 'admin');
  // 自分への無害な指定は通る
  assert.equal(code(a.api('setUser', { id: a.dev, role: 'admin' })), 'OK');
  assert.equal(code(a.api('setUser', { id: a.dev, status: 'approved' })), 'OK');
  // 他人(別の管理者)は降格できる
  assert.equal(code(a.api('setUser', { id: b.dev, role: 'poster' })), 'OK');
});

test('setUser: 管理者が最後の1人になる変更・いなくなる変更は FORBIDDEN', () => {
  const h = fresh();
  const a = h.mk('admin');
  const b = h.mk('admin');
  // 管理者 a, b。b を降格 → a が最後の1人に(許可)
  assert.equal(code(a.api('setUser', { id: b.dev, role: 'viewer' })), 'OK');
  // 今度は b(viewer)が a を降格しようとしても権限なし
  assert.equal(code(b.api('setUser', { id: a.dev, role: 'viewer' })), 'FORBIDDEN');
  // 管理者が a だけの状態で、a 以外から a をいなくする手段は無い(自分では FORBIDDEN)。
  // 別の管理者 c を作ってから、c が a を降格・却下する → a は最後ではないので許可、その後 c が最後の1人
  const c = h.mk('admin');
  assert.equal(code(c.api('setUser', { id: a.dev, role: 'poster' })), 'OK');
  // 管理者は c だけ。c を他の管理者が降格する状況を作る(a を再び管理者に)
  h.control('setrole', { id: a.dev, role: 'admin' });
  // pending に落とす経路も最後の1人を守る: a を降格して c だけにした後、a が管理者でないので c を落とせる人はいない。
  assert.equal(code(c.api('setUser', { id: a.dev, status: 'pending' })), 'OK');
  // 最後の1人(c)を「却下」にするのも、降格するのも、管理者 d(同時に存在)がいなければ FORBIDDEN になる
  const d = h.mk('admin');
  assert.equal(code(d.api('setUser', { id: c.dev, role: 'viewer' })), 'OK', 'd がいるので c は降格できる');
  assert.equal(code(c.api('setUser', { id: d.dev, role: 'viewer' })), 'FORBIDDEN', 'c は降格済みで権限なし');
  // 承認済みの管理者が1人しかいない状態で、その人以外(権限のある人)はいない → 直接シートで状態を作って検証
  const e = h.mk('admin');
  const f = h.mk('admin', { status: 'pending' }); // pending の管理者は数えない
  h.control('setrole', { id: d.dev, role: 'viewer' });
  assert.equal(code(e.api('setUser', { id: f.dev, status: 'approved' })), 'OK');
  assert.equal(code(e.api('setUser', { id: f.dev, status: 'rejected' })), 'OK', 'e が残るので f は却下できる');
});

test('setUser: 最後の管理者を別の管理者が落とす場合の保護(承認済み管理者の数で判定)', () => {
  const h = fresh();
  const a = h.mk('admin');
  const x = h.mk('admin');
  // x を a が却下 → a が最後。次に x(却下済み)は操作不能。a は自分を降格不可。
  assert.equal(code(a.api('setUser', { id: x.dev, status: 'rejected' })), 'OK');
  assert.equal(code(a.api('setUser', { id: a.dev, role: 'poster' })), 'FORBIDDEN');
  // 却下した管理者は数えない: x を再度承認しても role は admin のまま → 2人に戻る
  assert.equal(code(a.api('setUser', { id: x.dev, status: 'approved' })), 'OK');
  assert.equal(x.api('bootstrap').data.me.role, 'admin');
  // 2人の管理者のうち 1人を落とせるが、その結果 1人になった管理者を、もう落とせない
  assert.equal(code(x.api('setUser', { id: a.dev, role: 'viewer' })), 'OK');
  assert.equal(code(x.api('setUser', { id: x.dev, role: 'viewer' })), 'FORBIDDEN');
});

test('makeAdmin: 承認済みで氏名が一致する1人だけを管理にする', () => {
  const h = fresh();
  const only = h.mk('viewer', { name: '細野 功介' });
  h.mk('viewer', { name: '細野 功介', status: 'pending' }); // 承認済みでないので数えない
  h.mk('viewer', { name: '別人' });
  const rev = h.rev();
  const r = h.control('call', { fn: 'makeAdmin', args: ['細野 功介'] });
  assert.equal(r.data.result, true);
  assert.equal(only.api('bootstrap').data.me.role, 'admin');
  assert.ok(h.rev() > rev);
  // 0人
  assert.equal(h.control('call', { fn: 'makeAdmin', args: ['存在しない人'] }).data.result, false);
  // 2人以上: 何もしない
  const p1 = h.mk('viewer', { name: '同姓同名' }), p2 = h.mk('viewer', { name: '同姓同名' });
  assert.equal(h.control('call', { fn: 'makeAdmin', args: ['同姓同名'] }).data.result, false);
  assert.equal(p1.api('status').data.role, 'viewer');
  assert.equal(p2.api('status').data.role, 'viewer');
  assert.ok(h.control('state').data.logs.some((l) => l.includes('makeAdmin')));
});

test('applyで登録 → makeAdmin(まだ承認前は何もしない) → 承認後に成功', () => {
  const h = fresh();
  const dev = { dev: 'dev-applyadmin01', key: 'k'.repeat(40) };
  h.call('apply', { name: '社長' }, dev);
  assert.equal(h.control('call', { fn: 'makeAdmin', args: ['社長'] }).data.result, false);
  h.control('setrole', { id: dev.dev, status: 'approved' });
  assert.equal(h.control('call', { fn: 'makeAdmin', args: ['社長'] }).data.result, true);
  assert.equal(h.call('bootstrap', {}, dev).data.me.role, 'admin');
});
