'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, mid, jpeg } = require('./helpers');

const maint = (h, hours) => h.control('maintenance', { offsetHours: hours }).data;

test('dailyMaintenance: 24時間たっていない孤児は残す', () => {
  const h = fresh();
  const p = h.mk('poster');
  h.putImage(p);
  assert.equal(maint(h, 23).trashed, 0);
  assert.equal(h.driveNames().length, 2);
  assert.equal(maint(h, 0).trashed, 0);
});

test('dailyMaintenance: 参照されていて24時間以上たったファイルは残し、参照されない孤児だけゴミ箱へ', () => {
  const h = fresh();
  const { itemId } = h.structure();
  const p = h.mk('poster');
  const used = h.putImage(p), orphan = h.putImage(p), usedVideo = h.putVideo(p, 3, 100), orphanVideo = h.putVideo(p, 2, 100);
  p.api('saveExample', h.example({ itemId, media: [used, usedVideo] }));
  assert.equal(h.driveNames().length, 2 + 2 + 4 + 3);
  const r = maint(h, 25);
  assert.equal(r.trashed, 2 + 3);
  const left = h.driveNames();
  assert.deepEqual(left, [used.id + '.jpg', used.id + '_t.jpg', ...[0, 1, 2].map((i) => usedVideo.id + '_p' + i), usedVideo.id + '_t.jpg'].sort());
  const trashed = h.control('drive').data.trashed.sort();
  assert.deepEqual(trashed, [orphan.id + '.jpg', orphan.id + '_t.jpg', orphanVideo.id + '_p0', orphanVideo.id + '_p1', orphanVideo.id + '_t.jpg'].sort());
  // 2回目は何もしない
  assert.equal(maint(h, 25).trashed, 0);
});

test('dailyMaintenance: 削除済み(ごみ箱)の事例が参照するファイルは残す', () => {
  const h = fresh();
  const { itemId } = h.structure();
  const p = h.mk('poster');
  const m = h.putImage(p);
  const ex = h.example({ itemId, media: [m] });
  p.api('saveExample', ex);
  p.api('deleteExample', { id: ex.id });
  assert.equal(maint(h, 48).trashed, 0);
  assert.equal(h.driveNames().length, 2);
  // 完全削除のあとは、purge がゴミ箱へ入れ済み
  h.mk('admin').api('purgeExample', { id: ex.id });
  assert.equal(h.driveNames().length, 0);
});

test('dailyMaintenance: 事例から外れたメディアは24時間後に掃除される', () => {
  const h = fresh();
  const { itemId } = h.structure();
  const p = h.mk('poster');
  const m1 = h.putImage(p), m2 = h.putImage(p);
  const ex = h.example({ itemId, media: [m1, m2] });
  p.api('saveExample', ex);
  p.api('saveExample', Object.assign({}, ex, { media: [m1] }));
  assert.equal(maint(h, 25).trashed, 2);
  assert.deepEqual(h.driveNames(), [m1.id + '.jpg', m1.id + '_t.jpg'].sort());
});

test('dailyMaintenance: このアプリのものでないファイルには触らない・ロック中は何もしない', () => {
  const h = fresh();
  const p = h.mk('poster');
  h.putImage(p);
  const folder = h.ctx.DriveApp.getFolderById(h.ctx.PropertiesService.getScriptProperties().getProperty('MEDIA_FOLDER_ID'));
  folder.createFile('memo.txt', 'hello', 'text/plain');
  folder.createFile(mid() + '_x', 'hello', 'text/plain');
  assert.equal(maint(h, 30).trashed, 2);
  assert.ok(h.driveNames().includes('memo.txt'));
  h.state.lockHeld = true;
  const r = maint(h, 30);
  h.state.lockHeld = false;
  assert.equal(r.skipped, true);
});

test('setupTriggers: 毎日3時の dailyMaintenance を1つだけ作る(何度実行しても増えない)', () => {
  const h = fresh();
  h.control('call', { fn: 'setupTriggers' });
  h.control('call', { fn: 'setupTriggers' });
  assert.deepEqual(h.control('state').data.triggers, ['dailyMaintenance']);
});

test('setupSheets: 何度実行しても壊れない・設定とフォルダ・列名の食い違いで止まる', () => {
  const h = fresh();
  const p = h.mk('poster');
  const m = h.putImage(p);
  const props = h.ctx.PropertiesService.getScriptProperties();
  const pepper = props.getProperty('PEPPER'), secret = props.getProperty('SECRET'), folder = props.getProperty('MEDIA_FOLDER_ID');
  h.control('call', { fn: 'setupSheets' });
  h.control('call', { fn: 'setupSheets' });
  assert.equal(props.getProperty('PEPPER'), pepper, 'PEPPER は変えない(変えると全端末の鍵が無効になる)');
  assert.equal(props.getProperty('SECRET'), secret);
  assert.equal(props.getProperty('MEDIA_FOLDER_ID'), folder);
  assert.equal(p.api('bootstrap').ok, true);
  assert.ok(h.driveNames().includes(m.id + '.jpg'));
  const settings = Object.fromEntries(h.sheet('settings').slice(1));
  assert.equal(settings.mailEnabled, 'TRUE');
  assert.equal(settings.appBaseUrl, 'https://tebiki.rccreate.net');
  assert.ok(settings.mediaRootFolderId);
  assert.deepEqual(h.sheet('users')[0], ['ID', '申請日時', '氏名', '会社名', '区分', '状態', '決定日時', '鍵ハッシュ', '最終利用']);
  assert.deepEqual(h.sheet('examples')[0], ['ID', '項目ID', '種類', 'タイトル', '理由', '重要度', '確認時期', '確認基準', '管理番号', 'メディア', '登録者', '登録日時', '更新日時', '削除', '削除日時']);
  assert.deepEqual(h.sheet('groups')[0], ['ID', '名前', '順']);
  assert.deepEqual(h.sheet('items')[0], ['ID', 'グループID', '名前', '順']);
  assert.deepEqual(h.sheet('settings')[0], ['キー', '値']);
  // 列名が違えば止まる
  h.ctx.Repo.sheet('items').getRange(1, 3).setValue('なまえ');
  const out = h.control('call', { fn: 'setupSheets' });
  assert.equal(out.ok, false);
  assert.match(out.error.message, /項目/);
});

test('setupSheets: 利用者シートに区分・状態の入力規則が付く', () => {
  const h = fresh();
  const v = JSON.parse(JSON.stringify(h.ctx.Repo.sheet('users').validations.map((x) => x.rule.list)));
  assert.deepEqual(v, [['閲覧', '投稿', '管理'], ['申請中', '承認', '却下']]);
});
