'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { fresh, mid, jpeg } = require('./helpers');

const img = (id, body, thumb, over) => Object.assign({ mediaId: id, kind: 'image', mime: 'image/jpeg', index: 0, total: 1, data: body.toString('base64'), thumb: thumb.toString('base64'), bytes: body.length }, over || {});
const vid = (id, i, total, part, thumb, over) => Object.assign({ mediaId: id, kind: 'video', mime: 'video/mp4', index: i, total, data: part.toString('base64'), bytes: part.length },
  i === 0 ? { thumb: (thumb || jpeg(300)).toString('base64') } : {}, over || {});
const code = (r) => (r.ok ? 'OK' : r.error.code);

test('uploadPart 画像: 保存・ファイル名・ロック外・共有設定に触れない', () => {
  const h = fresh();
  const p = h.mk('poster');
  const id = mid();
  const body = jpeg(5000), thumb = jpeg(800);
  const r = p.api('uploadPart', img(id, body, thumb));
  assert.deepEqual(r.data, { stored: true });
  assert.deepEqual(h.driveNames(), [id + '.jpg', id + '_t.jpg'].sort());
  const files = h.control('drive').data.files;
  assert.equal(files.find((f) => f.name === id + '.jpg').size, 5000);
  assert.equal(files.find((f) => f.name === id + '_t.jpg').size, 800);
  assert.ok(files.every((f) => f.path.startsWith('media/') && f.sharing === null), 'media/ 直下・共有設定なし');
  const log = h.control('state').data.driveLog.filter((l) => l.op === 'create');
  assert.equal(log.length, 2);
  assert.ok(log.every((l) => l.lockHeld === false), 'Drive書込はロックの外');
  assert.equal(h.control('state').data.lockHeld, false);
  // Drive の root と media/
  assert.ok(h.ctx.PropertiesService.getScriptProperties().getProperty('MEDIA_FOLDER_ID'));
});

test('uploadPart 画像: 再送は成功を返し、ファイルを作り直さない', () => {
  const h = fresh();
  const p = h.mk('poster');
  const id = mid();
  const body = jpeg(3000);
  p.api('uploadPart', img(id, body, jpeg(500)));
  const n = h.control('state').data.driveLog.length;
  const again = p.api('uploadPart', img(id, jpeg(3000), jpeg(500)));
  assert.deepEqual(again.data, { stored: true });
  assert.equal(h.control('state').data.driveLog.length, n, '追加の書込も、ゴミ箱への移動もない');
  assert.equal(h.driveNames().length, 2);
  assert.equal(h.control('drive').data.trashed.length, 0);
});

test('uploadPart 画像: 本体だけ先に出来ていた場合は、再送でサムネが補われる', () => {
  const h = fresh();
  const p = h.mk('poster');
  const id = mid();
  h.state.driveFail = { createFile: 2 }; // 2つ目(サムネ)で失敗させる
  const r = p.api('uploadPart', img(id, jpeg(3000), jpeg(500)));
  assert.equal(r.error.code, 'DRIVE_ERROR');
  assert.deepEqual(h.driveNames(), [id + '.jpg']);
  const ok = p.api('uploadPart', img(id, jpeg(3000), jpeg(500)));
  assert.equal(ok.ok, true);
  assert.deepEqual(h.driveNames(), [id + '.jpg', id + '_t.jpg'].sort());
});

test('uploadPart 画像: 制限(本体1.5MB・サムネ80KB・JPEG先頭・mime・total・bytes・thumb必須)', () => {
  const h = fresh();
  const p = h.mk('poster');
  const MB15 = 1.5 * 1024 * 1024;
  assert.equal(code(p.api('uploadPart', img(mid(), jpeg(MB15), jpeg(500)))), 'OK', '1.5MBちょうどは通る');
  assert.equal(code(p.api('uploadPart', img(mid(), jpeg(MB15 + 1), jpeg(500)))), 'TOO_LARGE');
  assert.equal(code(p.api('uploadPart', img(mid(), jpeg(1000), jpeg(80 * 1024)))), 'OK', 'サムネ80KBちょうどは通る');
  assert.equal(code(p.api('uploadPart', img(mid(), jpeg(1000), jpeg(80 * 1024 + 1)))), 'TOO_LARGE');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), crypto.randomBytes(100)]);
  const e1 = p.api('uploadPart', img(mid(), png, jpeg(500)));
  assert.equal(e1.error.code, 'VALIDATION_FAILED');
  assert.equal(e1.error.path, 'data');
  const e2 = p.api('uploadPart', img(mid(), jpeg(500), png));
  assert.equal(e2.error.code, 'VALIDATION_FAILED');
  assert.equal(e2.error.path, 'thumb');
  assert.equal(p.api('uploadPart', img(mid(), jpeg(500), jpeg(300), { mime: 'image/png' })).error.path, 'mime');
  assert.equal(p.api('uploadPart', img(mid(), jpeg(500), jpeg(300), { mime: 'video/mp4' })).error.path, 'mime');
  assert.equal(p.api('uploadPart', img(mid(), jpeg(500), jpeg(300), { total: 2 })).error.path, 'total');
  assert.equal(p.api('uploadPart', img(mid(), jpeg(500), jpeg(300), { bytes: 499 })).error.path, 'bytes');
  const noThumb = img(mid(), jpeg(500), jpeg(300));
  delete noThumb.thumb;
  assert.equal(p.api('uploadPart', noThumb).error.path, 'thumb');
  assert.equal(p.api('uploadPart', img(mid(), jpeg(500), jpeg(300), { data: '!!!notbase64' })).error.path, 'data');
  assert.equal(p.api('uploadPart', img('bad-id', jpeg(500), jpeg(300))).error.code, 'VALIDATION_FAILED');
  assert.equal(p.api('uploadPart', img(mid(), jpeg(500), jpeg(300), { kind: 'audio' })).error.code, 'VALIDATION_FAILED');
  assert.equal(p.api('uploadPart', img(mid(), jpeg(500), jpeg(300), { index: 1 })).error.path, 'index');
  assert.equal(p.api('uploadPart', img(mid(), jpeg(500), jpeg(300), { extra: 1 })).error.code, 'BAD_REQUEST');
});

test('uploadPart 動画: 複数片・名前・サムネは index 0 のみ・再送・順不同', () => {
  const h = fresh();
  const p = h.mk('poster');
  const id = mid();
  const parts = [crypto.randomBytes(2000), crypto.randomBytes(2000), crypto.randomBytes(777)];
  // 順不同(2, 0, 1)で送る。サムネは index 0 で付く
  assert.equal(p.api('uploadPart', vid(id, 2, 3, parts[2])).ok, true);
  assert.deepEqual(h.driveNames(), [id + '_p2']);
  assert.equal(p.api('uploadPart', vid(id, 0, 3, parts[0])).ok, true);
  assert.equal(p.api('uploadPart', vid(id, 1, 3, parts[1])).ok, true);
  assert.deepEqual(h.driveNames(), [id + '_p0', id + '_p1', id + '_p2', id + '_t.jpg']);
  const n = h.control('state').data.driveLog.length;
  assert.equal(p.api('uploadPart', vid(id, 1, 3, parts[1])).ok, true, '片の再送');
  assert.equal(p.api('uploadPart', vid(id, 0, 3, parts[0])).ok, true, '最初の片の再送');
  assert.equal(h.control('state').data.driveLog.length, n);
  // 取得できる
  parts.forEach((b, i) => {
    const r = p.api('getPart', { id, index: i });
    assert.equal(r.data.mime, 'application/octet-stream');
    assert.ok(Buffer.from(r.data.data, 'base64').equals(b));
  });
  assert.equal(p.api('getPart', { id, index: 3 }).error.code, 'NOT_FOUND');
});

test('uploadPart 動画: 制限(1片3MB・全体20MB・total1〜8・mime・thumb必須)', () => {
  const h = fresh();
  const p = h.mk('poster');
  const MB3 = 3 * 1024 * 1024;
  const big = crypto.randomBytes(MB3);
  const okId = mid();
  const ok = p.api('uploadPart', vid(okId, 0, 1, big));
  assert.equal(ok.ok, true, '3MBちょうど(base64 4,194,304字)は通る: ' + JSON.stringify(ok.error));
  assert.equal(code(p.api('uploadPart', vid(mid(), 0, 1, crypto.randomBytes(MB3 + 1)))), 'TOO_LARGE');
  assert.equal(p.api('uploadPart', vid(mid(), 0, 1, crypto.randomBytes(10), null, { mime: 'video/quicktime' })).error.path, 'mime');
  assert.equal(p.api('uploadPart', vid(mid(), 0, 1, crypto.randomBytes(10), null, { mime: 'image/jpeg' })).error.path, 'mime');
  assert.equal(code(p.api('uploadPart', vid(mid(), 0, 1, crypto.randomBytes(10), null, { mime: 'video/webm' }))), 'OK');
  assert.equal(p.api('uploadPart', vid(mid(), 0, 9, crypto.randomBytes(10))).error.code, 'VALIDATION_FAILED', 'total>8');
  assert.equal(p.api('uploadPart', vid(mid(), 0, 0, crypto.randomBytes(10))).error.code, 'VALIDATION_FAILED', 'total=0');
  assert.equal(p.api('uploadPart', vid(mid(), 8, 8, crypto.randomBytes(10))).error.code, 'VALIDATION_FAILED', 'index>7');
  const nothumb = vid(mid(), 0, 2, crypto.randomBytes(10));
  delete nothumb.thumb;
  assert.equal(p.api('uploadPart', nothumb).error.path, 'thumb', 'index=0 は thumb 必須');
  const t = vid(mid(), 0, 1, crypto.randomBytes(10), Buffer.from('not a jpeg at all'));
  assert.equal(p.api('uploadPart', t).error.path, 'thumb');
  // 全体20MB: 3MB×7片 = 21MB は、7片目で止まる
  const id = mid();
  let last;
  for (let i = 0; i < 7; i++) {
    last = p.api('uploadPart', vid(id, i, 7, crypto.randomBytes(MB3)));
    if (!last.ok) break;
  }
  assert.equal(last.error.code, 'TOO_LARGE');
  // 20MB以内(3MB×6 + 2MB = 20MB)なら通る
  const id2 = mid();
  for (let i = 0; i < 6; i++) assert.equal(p.api('uploadPart', vid(id2, i, 7, crypto.randomBytes(MB3))).ok, true);
  assert.equal(p.api('uploadPart', vid(id2, 6, 7, crypto.randomBytes(2 * 1024 * 1024))).ok, true);
});

test('getThumbs: まとめ取得・存在しないidは入れない・件数と形式の検査', () => {
  const h = fresh();
  const p = h.mk('poster');
  const v = h.mk('viewer');
  const a = h.putImage(p, 3000), b = h.putVideo(p, 2, 500);
  const ghost = mid();
  const r = v.api('getThumbs', { ids: [a.id, b.id, ghost, a.id] });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.data.items).sort(), [a.id, b.id].sort());
  assert.equal(r.data.items[a.id].mime, 'image/jpeg');
  assert.equal(Buffer.from(r.data.items[a.id].data, 'base64').length, 500);
  assert.deepEqual(v.api('getThumbs', { ids: [ghost] }).data, { items: {} });
  assert.equal(v.api('getThumbs', { ids: [] }).error.code, 'VALIDATION_FAILED');
  assert.equal(v.api('getThumbs', { ids: Array.from({ length: 21 }, mid) }).error.code, 'VALIDATION_FAILED');
  assert.equal(v.api('getThumbs', { ids: Array.from({ length: 20 }, mid) }).ok, true);
  assert.equal(v.api('getThumbs', { ids: ['nope'] }).error.code, 'VALIDATION_FAILED');
  assert.equal(v.api('getThumbs', { ids: [5] }).error.code, 'BAD_REQUEST');
  assert.equal(v.api('getThumbs', {}).error.code, 'VALIDATION_FAILED');
  assert.equal(v.api('getThumbs', { ids: 'x' }).error.code, 'BAD_REQUEST');
  // 参照されていないメディアでも承認済みなら取れる(SPEC §5.2)
  assert.ok(r.data.items[a.id]);
});

test('getPart: 画像本体・動画片・存在しない・範囲外', () => {
  const h = fresh();
  const p = h.mk('poster');
  const v = h.mk('viewer');
  const id = mid();
  const body = jpeg(4321);
  p.api('uploadPart', img(id, body, jpeg(300)));
  const r = v.api('getPart', { id, index: 0 });
  assert.equal(r.data.mime, 'image/jpeg');
  assert.ok(Buffer.from(r.data.data, 'base64').equals(body));
  assert.equal(v.api('getPart', { id, index: 1 }).error.code, 'NOT_FOUND');
  assert.equal(v.api('getPart', { id: mid(), index: 0 }).error.code, 'NOT_FOUND');
  assert.equal(v.api('getPart', { id, index: -1 }).error.code, 'VALIDATION_FAILED');
  assert.equal(v.api('getPart', { id, index: 8 }).error.code, 'VALIDATION_FAILED');
  assert.equal(v.api('getPart', { id: 'x', index: 0 }).error.code, 'VALIDATION_FAILED');
  assert.equal(v.api('getPart', { id }).error.code, 'VALIDATION_FAILED');
  assert.equal(v.api('getPart', { id, index: '0' }).error.code, 'BAD_REQUEST');
  // 動画の片 0 はサムネ(.jpg)ではなく _p0
  const m = h.putVideo(p, 1, 321);
  const pr = v.api('getPart', { id: m.id, index: 0 });
  assert.equal(pr.data.mime, 'application/octet-stream');
  assert.equal(Buffer.from(pr.data.data, 'base64').length, 321);
});

test('Drive の失敗は DRIVE_ERROR(INTERNAL にしない)', () => {
  const h = fresh();
  const p = h.mk('poster');
  h.state.driveFail = { createFile: 1 };
  assert.equal(p.api('uploadPart', img(mid(), jpeg(500), jpeg(300))).error.code, 'DRIVE_ERROR');
});
