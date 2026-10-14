'use strict';
const crypto = require('crypto');
const { createHarness } = require('../server');

const hex = (n) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const mid = () => 'm_' + hex(12);
const eid = () => 'e_' + hex(12);

/** FFD8 + 乱数 + FFD9 のJPEGもどき */
function jpeg(n) {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), crypto.randomBytes(Math.max(n - 4, 0)), Buffer.from([0xff, 0xd9])]);
}

function fresh(variant) {
  const h = createHarness({});
  h.reset({ variant: variant || 'seeded' });
  /** 承認フロー無しで利用者を作り、{dev,key,api} を返す */
  h.mk = (role, o) => {
    o = o || {};
    const u = h.control('user', Object.assign({ role, status: 'approved' }, o)).data;
    u.api = h.as(u);
    u.name = o.name || 'テスト太郎';
    return u;
  };
  h.rev = () => h.control('state').data.rev;
  h.structure = () => {
    const b = h.mk('admin');
    const d = b.api('bootstrap').data;
    return { groups: d.groups, items: d.items, itemId: d.items[0].id, admin: b };
  };
  h.sheet = (key) => h.control('sheet', { key }).data.rows;
  /** 画像1枚をアップロードして media 定義を返す */
  h.putImage = (user, size) => {
    const id = mid();
    const body = jpeg(size || 2000), thumb = jpeg(500);
    const r = user.api('uploadPart', { mediaId: id, kind: 'image', mime: 'image/jpeg', index: 0, total: 1, data: body.toString('base64'), thumb: thumb.toString('base64'), bytes: body.length });
    if (!r.ok) throw new Error('putImage: ' + JSON.stringify(r));
    return { id, type: 'image', mime: 'image/jpeg', parts: 1, bytes: body.length };
  };
  /** 動画 n 片(各 partSize バイト)をアップロードして media 定義を返す */
  h.putVideo = (user, n, partSize) => {
    const id = mid();
    let bytes = 0;
    for (let i = 0; i < n; i++) {
      const part = crypto.randomBytes(partSize || 1000);
      bytes += part.length;
      const r = user.api('uploadPart', Object.assign({ mediaId: id, kind: 'video', mime: 'video/mp4', index: i, total: n, data: part.toString('base64'), bytes: part.length },
        i === 0 ? { thumb: jpeg(400).toString('base64') } : {}));
      if (!r.ok) throw new Error('putVideo: ' + JSON.stringify(r));
    }
    return { id, type: 'video', mime: 'video/mp4', parts: n, bytes };
  };
  h.example = (over) => Object.assign({ id: eid(), itemId: null, kind: 'good', title: '良い例', reason: '理由' }, over || {});
  h.driveNames = () => h.control('drive').data.files.map((f) => f.name).sort();
  return h;
}

module.exports = { fresh, hex, mid, eid, jpeg };
