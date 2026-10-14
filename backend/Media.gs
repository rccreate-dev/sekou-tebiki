/**
 * Media.gs — Drive の写真・動画ファイル(SPEC §4)。
 * ファイル名: 画像 <id>.jpg + <id>_t.jpg / 動画 <id>_p0.._p7 + <id>_t.jpg。共有設定は触らない。
 * Drive の例外はすべて DRIVE_ERROR にする。
 */

var Media = (function () {
  var folderHandle = null;

  function guard(fn) {
    try {
      return fn();
    } catch (e) {
      if (e && e.isApiError) throw e;
      console.error('Drive error: ' + (e && e.message));
      fail_('DRIVE_ERROR', '写真・動画の保存先(Drive)でエラーが起きました。しばらくしてからもう一度お試しください。');
    }
  }

  function folder() {
    if (folderHandle) return folderHandle;
    var id = PropertiesService.getScriptProperties().getProperty('MEDIA_FOLDER_ID');
    if (!id) fail_('INTERNAL', '保存先フォルダが未設定です。setupSheets を実行してください。');
    folderHandle = guard(function () { return DriveApp.getFolderById(id); });
    return folderHandle;
  }

  /** 名前が一致する、ゴミ箱に入っていない最初のファイル。無ければ null */
  function find(name) {
    return guard(function () {
      var it = folder().getFilesByName(name);
      while (it.hasNext()) {
        var f = it.next();
        if (!f.isTrashed()) return f;
      }
      return null;
    });
  }

  function exists(name) {
    return !!find(name);
  }

  /** 作成。同名が同時に2つできてしまった場合は、IDの小さい方だけを残す(両者が同じ結論になる) */
  function put(name, bytes, mime) {
    guard(function () {
      var f = folder().createFile(Utilities.newBlob(bytes, mime, name));
      var all = [];
      var it = folder().getFilesByName(name);
      while (it.hasNext()) { var g = it.next(); if (!g.isTrashed()) all.push(g); }
      if (all.length > 1) {
        all.sort(function (a, b) { return a.getId() < b.getId() ? -1 : 1; });
        for (var i = 1; i < all.length; i++) all[i].setTrashed(true);
      }
      return f;
    });
  }

  function size(name) {
    var f = find(name);
    return f ? f.getSize() : -1;
  }

  function readBase64(name) {
    var f = find(name);
    if (!f) return null;
    return guard(function () { return Utilities.base64Encode(f.getBlob().getBytes()); });
  }

  function partName(id, i) { return id + '_p' + i; }
  function mainName(id) { return id + '.jpg'; }
  function thumbName(id) { return id + '_t.jpg'; }

  /** そのメディアに属しうる全ファイル名 */
  function allNames(id) {
    var names = [mainName(id), thumbName(id)];
    for (var i = 0; i < LIMITS.VIDEO_PARTS_MAX; i++) names.push(partName(id, i));
    return names;
  }

  /** そのメディアのファイルを(あるだけ)ゴミ箱へ。失敗しても続ける(残りは日次の掃除が拾う) */
  function trashMedia(id) {
    var n = 0;
    allNames(id).forEach(function (name) {
      try {
        var f = find(name);
        while (f) { f.setTrashed(true); n++; f = find(name); }
      } catch (e) {
        console.error('trash failed: ' + name + ' ' + (e && e.message));
      }
    });
    return n;
  }

  /** メディア定義 {id,type,parts} のファイルがそろっているか */
  function complete(m) {
    if (!exists(thumbName(m.id))) return false;
    if (m.type === 'image') return exists(mainName(m.id));
    for (var i = 0; i < m.parts; i++) if (!exists(partName(m.id, i))) return false;
    return true;
  }

  /** フォルダ内の(ゴミ箱でない)全ファイル [{file, name, created}] */
  function listAll() {
    return guard(function () {
      var out = [];
      var it = folder().getFiles();
      while (it.hasNext()) {
        var f = it.next();
        out.push({ file: f, name: f.getName(), created: f.getDateCreated().getTime() });
      }
      return out;
    });
  }

  return {
    guard: guard, find: find, exists: exists, put: put, size: size, readBase64: readBase64,
    partName: partName, mainName: mainName, thumbName: thumbName, allNames: allNames,
    trashMedia: trashMedia, complete: complete, listAll: listAll
  };
})();

/** ファイル名 → メディアID(このアプリのファイルでなければ null) */
function mediaIdOfFileName_(name) {
  var m = /^(m_[a-z0-9]{8,32})(\.jpg|_t\.jpg|_p[0-7])$/.exec(name);
  return m ? m[1] : null;
}

/** 日次の掃除(SPEC §4)。どの事例からも参照されず、作成から24時間以上たったファイルをゴミ箱へ */
function dailyMaintenance() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    Logger.log('dailyMaintenance: ロックを取れませんでした(次回に回します)');
    return { trashed: 0, skipped: true };
  }
  try {
    Repo.reset();
    var referenced = {};
    Repo.all('examples').forEach(function (ex) {
      parseMedia_(ex.media).forEach(function (m) { referenced[m.id] = true; });
    });
    var now = Util.nowMs();
    var trashed = 0;
    Media.listAll().forEach(function (e) {
      var id = mediaIdOfFileName_(e.name);
      if (!id || referenced[id]) return;
      if (now - e.created < LIMITS.ORPHAN_AGE_MS) return;
      try {
        e.file.setTrashed(true);
        trashed++;
      } catch (err) {
        console.error('trash failed: ' + e.name);
      }
    });
    Logger.log('dailyMaintenance: ' + trashed + ' 件をゴミ箱へ移しました');
    return { trashed: trashed };
  } finally {
    lock.releaseLock();
    Repo.reset();
  }
}

/** 事例の「メディア」列(JSON文字列) → 配列。壊れていれば空 */
function parseMedia_(s) {
  try {
    var v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}
