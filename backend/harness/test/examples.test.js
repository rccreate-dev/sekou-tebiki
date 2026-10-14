'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, mid, eid } = require('./helpers');

const code = (r) => (r.ok ? 'OK' : r.error.code);
function setup() {
  const h = fresh();
  const { itemId, groups, items } = h.structure();
  return { h, itemId, groups, items, p: h.mk('poster'), a: h.mk('admin'), v: h.mk('viewer') };
}

test('saveExample: 新規 → 登録者=自分・登録日時・更新日時、応答の形(§5.6)', () => {
  const { h, itemId, p } = setup();
  const ex = h.example({ itemId, kind: 'bad', title: '悪い例', reason: '理由\n二行目', severity: 'B', timing: '打設前最終確認', criteria: '基準', refNo: 'A-12' });
  const r = p.api('saveExample', ex);
  assert.equal(r.ok, true, JSON.stringify(r));
  const e = r.data.example;
  assert.equal(e.id, ex.id);
  assert.equal(e.by, p.dev);
  assert.equal(e.at, e.updatedAt);
  assert.ok(Math.abs(e.at - h.nowMs()) < 5000);
  assert.equal(e.hidden, false);
  assert.equal(e.reason, '理由\n二行目');
  assert.deepEqual(e.media, []);
  assert.equal(e.timing, '打設前最終確認');
  assert.deepEqual(p.api('bootstrap').data.examples[0], e);
});

test('saveExample: 更新 → 登録者・登録日時は変わらず、更新日時だけ進む', () => {
  const { h, itemId, p, a } = setup();
  const ex = h.example({ itemId });
  const created = p.api('saveExample', ex).data.example;
  h.control('clock', { advanceHours: 1 });
  const edited = p.api('saveExample', Object.assign({}, ex, { title: '新しい題', severity: 'C' })).data.example;
  assert.equal(edited.title, '新しい題');
  assert.equal(edited.by, created.by);
  assert.equal(edited.at, created.at);
  assert.ok(edited.updatedAt >= created.updatedAt + 3600000 - 1000);
  h.control('clock', { advanceHours: 1 });
  const byAdmin = a.api('saveExample', Object.assign({}, ex, { title: '管理者が修正' })).data.example;
  assert.equal(byAdmin.by, p.dev);
  assert.equal(byAdmin.at, created.at);
  assert.equal(h.sheet('examples').length, 2, '行は増えない');
});

test('saveExample: 同じ id・同じ内容の再送は成功で、二重に作らず・更新日時も動かさない', () => {
  const { h, itemId, p } = setup();
  const media = h.putImage(p);
  const ex = h.example({ itemId, media: [media] });
  const first = p.api('saveExample', ex).data.example;
  h.control('clock', { advanceHours: 2 });
  const again = p.api('saveExample', ex);
  assert.equal(again.ok, true);
  assert.deepEqual(again.data.example, first);
  assert.equal(h.sheet('examples').length, 2);
});

test('saveExample: 他人の事例は poster に FORBIDDEN(内容は変わらない)', () => {
  const { h, itemId, p, a } = setup();
  const other = h.mk('poster');
  const ex = h.example({ itemId, title: '元の題' });
  a.api('saveExample', ex);
  const r = other.api('saveExample', Object.assign({}, ex, { title: '乗っ取り' }));
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.equal(p.api('bootstrap').data.examples[0].title, '元の題');
});

test('saveExample: 削除済みの事例は更新できない(NOT_FOUND)', () => {
  const { h, itemId, p, a } = setup();
  const ex = h.example({ itemId });
  p.api('saveExample', ex);
  p.api('deleteExample', { id: ex.id });
  assert.equal(p.api('saveExample', ex).error.code, 'NOT_FOUND');
  assert.equal(a.api('saveExample', ex).error.code, 'NOT_FOUND');
});

test('saveExample: メディアのファイルがそろっていなければ VALIDATION_FAILED(path=media)', () => {
  const { h, itemId, p } = setup();
  const ghost = { id: mid(), type: 'image', mime: 'image/jpeg', parts: 1, bytes: 10 };
  const r = p.api('saveExample', h.example({ itemId, media: [ghost] }));
  assert.equal(r.error.code, 'VALIDATION_FAILED');
  assert.equal(r.error.path, 'media');
  // 動画: 片が足りない
  const v = h.putVideo(p, 2, 100);
  const short = p.api('saveExample', h.example({ itemId, media: [Object.assign({}, v, { parts: 3 })] }));
  assert.equal(short.error.path, 'media');
  assert.equal(p.api('saveExample', h.example({ itemId, media: [v] })).ok, true);
  // サムネが無い(本体だけ)
  const id = mid();
  h.state.driveFail = { createFile: 2 };
  p.api('uploadPart', { mediaId: id, kind: 'image', mime: 'image/jpeg', index: 0, total: 1, data: Buffer.from([0xff, 0xd8, 1, 2, 3]).toString('base64'), thumb: Buffer.from([0xff, 0xd8, 9]).toString('base64'), bytes: 5 });
  const nothumb = p.api('saveExample', h.example({ itemId, media: [{ id, type: 'image', mime: 'image/jpeg', parts: 1, bytes: 5 }] }));
  assert.equal(nothumb.error.path, 'media');
  assert.equal(h.sheet('examples').length, 2, '失敗した保存は何も書かない');
});

test('saveExample: メディア件数(最大6)・重複・形式', () => {
  const { h, itemId, p } = setup();
  const ms = Array.from({ length: 7 }, () => h.putImage(p));
  assert.equal(p.api('saveExample', h.example({ itemId, media: ms.slice(0, 6) })).ok, true);
  const over = p.api('saveExample', h.example({ itemId, media: ms }));
  assert.equal(over.error.code, 'VALIDATION_FAILED');
  assert.equal(over.error.path, 'media');
  assert.equal(p.api('saveExample', h.example({ itemId, media: [ms[0], ms[0]] })).error.path, 'media');
  assert.equal(p.api('saveExample', h.example({ itemId, media: [Object.assign({}, ms[0], { type: 'audio' })] })).error.path, 'media');
  assert.equal(p.api('saveExample', h.example({ itemId, media: [Object.assign({}, ms[0], { parts: 2 })] })).error.path, 'media');
  assert.equal(p.api('saveExample', h.example({ itemId, media: [Object.assign({}, ms[0], { mime: 'image/png' })] })).error.path, 'media');
  assert.equal(p.api('saveExample', h.example({ itemId, media: [Object.assign({}, ms[0], { extra: 1 })] })).error.path, 'media');
  assert.equal(p.api('saveExample', h.example({ itemId, media: ['m_x'] })).error.path, 'media');
  assert.equal(p.api('saveExample', h.example({ itemId, media: 'x' })).error.code, 'BAD_REQUEST');
});

test('saveExample: 存在しない項目は VALIDATION_FAILED(itemId)', () => {
  const { h, p } = setup();
  const r = p.api('saveExample', h.example({ itemId: 'i_doesnotexist1' }));
  assert.equal(r.error.code, 'VALIDATION_FAILED');
  assert.equal(r.error.path, 'itemId');
});

test('saveExample: 文字数上限(タイトル60・理由600・基準300・管理番号30)と固定リスト', () => {
  const { h, itemId, p } = setup();
  const t = (over) => p.api('saveExample', h.example(Object.assign({ itemId }, over)));
  assert.equal(code(t({ title: 'あ'.repeat(60) })), 'OK');
  assert.equal(t({ title: 'あ'.repeat(61) }).error.path, 'title');
  assert.equal(code(t({ reason: 'あ'.repeat(600) })), 'OK');
  assert.equal(t({ reason: 'あ'.repeat(601) }).error.path, 'reason');
  assert.equal(code(t({ criteria: 'あ'.repeat(300) })), 'OK');
  assert.equal(t({ criteria: 'あ'.repeat(301) }).error.path, 'criteria');
  assert.equal(code(t({ refNo: 'A'.repeat(30) })), 'OK');
  assert.equal(t({ refNo: 'A'.repeat(31) }).error.path, 'refNo');
  assert.equal(t({ title: '' }).error.path, 'title');
  assert.equal(t({ title: '   ' }).error.path, 'title');
  assert.equal(t({ title: undefined }).error.path, 'title');
  assert.equal(t({ kind: 'neutral' }).error.path, 'kind');
  assert.equal(t({ kind: undefined }).error.path, 'kind');
  assert.equal(t({ severity: 'D' }).error.path, 'severity');
  assert.equal(code(t({ severity: '' })), 'OK');
  assert.equal(t({ timing: '適当な時期' }).error.path, 'timing');
  for (const x of ['墨出し・準備', '型枠建込', '支保工設置', '締付金物・補強', '打設前最終確認', 'コン打設中監視', '養生・脱型', '']) assert.equal(code(t({ timing: x })), 'OK', x);
  assert.equal(t({ id: 'bad' }).error.path, 'id');
  assert.equal(t({ id: undefined }).error.path, 'id');
  assert.equal(t({ unknownKey: 1 }).error.code, 'BAD_REQUEST');
  assert.equal(t({ title: 5 }).error.code, 'BAD_REQUEST');
  assert.equal(t({ itemId: undefined }).error.path, 'itemId');
});

test('saveExample: 数式の先頭文字(= + - @)は先頭に空白を足して保存', () => {
  const { h, itemId, p } = setup();
  const ex = h.example({ itemId, title: '=SUM(A1)', reason: '+1', criteria: '-2', refNo: '@x' });
  const e = p.api('saveExample', ex).data.example;
  assert.equal(e.title, ' =SUM(A1)');
  assert.equal(e.reason, ' +1');
  assert.equal(e.criteria, ' -2');
  assert.equal(e.refNo, ' @x');
  const row = h.sheet('examples')[1];
  assert.equal(row[3], ' =SUM(A1)');
  // 再送しても二重に空白が付かず、冪等のまま
  const again = p.api('saveExample', ex).data.example;
  assert.equal(again.title, ' =SUM(A1)');
  assert.equal(again.updatedAt, e.updatedAt);
  // 普通の文字列の先頭は変えない
  assert.equal(p.api('saveExample', h.example({ itemId, title: '  普通 ' })).data.example.title, '普通');
});

test('deleteExample / restoreExample / purgeExample', () => {
  const { h, itemId, p, a } = setup();
  const m = h.putImage(p);
  const ex = h.example({ itemId, media: [m] });
  p.api('saveExample', ex);
  assert.equal(p.api('deleteExample', { id: 'e_nonexistent1' }).error.code, 'NOT_FOUND');
  assert.equal(a.api('purgeExample', { id: ex.id }).error.code, 'VALIDATION_FAILED', '未削除は完全削除できない');
  assert.equal(a.api('purgeExample', { id: ex.id }).error.path, 'id');
  assert.deepEqual(p.api('deleteExample', { id: ex.id }).data, {});
  const row = h.sheet('examples')[1];
  assert.equal(String(row[13]).toUpperCase(), 'TRUE');
  assert.ok(Number(row[14]) > 0);
  assert.deepEqual(a.api('restoreExample', { id: ex.id }).data, {});
  assert.equal(p.api('bootstrap').data.examples[0].hidden, false);
  assert.equal(a.api('restoreExample', { id: 'e_nonexistent1' }).error.code, 'NOT_FOUND');
  p.api('deleteExample', { id: ex.id });
  const files = h.driveNames();
  assert.equal(files.length, 2);
  assert.deepEqual(a.api('purgeExample', { id: ex.id }).data, {});
  assert.equal(h.sheet('examples').length, 1, '行が消える');
  assert.deepEqual(h.driveNames(), [], 'メディアはゴミ箱へ');
  assert.deepEqual(h.control('drive').data.trashed.sort(), files);
  assert.equal(a.api('purgeExample', { id: ex.id }).error.code, 'NOT_FOUND');
});

test('purgeExample: ほかの事例が使っているメディアはゴミ箱に入れない', () => {
  const { h, itemId, p, a } = setup();
  const shared = h.putImage(p);
  const e1 = h.example({ itemId, media: [shared] }), e2 = h.example({ itemId, media: [shared] });
  p.api('saveExample', e1);
  p.api('saveExample', e2);
  p.api('deleteExample', { id: e1.id });
  a.api('purgeExample', { id: e1.id });
  assert.equal(h.driveNames().length, 2);
});

test('更新で外れたメディアのファイルは、その場では消さない', () => {
  const { h, itemId, p } = setup();
  const m1 = h.putImage(p), m2 = h.putImage(p);
  const ex = h.example({ itemId, media: [m1, m2] });
  p.api('saveExample', ex);
  p.api('saveExample', Object.assign({}, ex, { media: [m2] }));
  assert.equal(h.driveNames().length, 4);
  assert.equal(h.control('drive').data.trashed.length, 0);
});

test('deleteItem: 削除済みの事例が残っていれば HAS_CHILDREN(ごみ箱も数える)', () => {
  const { h, itemId, p, a } = setup();
  const ex = h.example({ itemId });
  p.api('saveExample', ex);
  assert.equal(a.api('deleteItem', { id: itemId }).error.code, 'HAS_CHILDREN');
  p.api('deleteExample', { id: ex.id });
  assert.equal(a.api('deleteItem', { id: itemId }).error.code, 'HAS_CHILDREN');
  a.api('purgeExample', { id: ex.id });
  assert.equal(a.api('deleteItem', { id: itemId }).ok, true);
});
