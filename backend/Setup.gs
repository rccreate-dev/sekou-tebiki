/**
 * Setup.gs — 運用関数(GASエディタから実行)。SPEC §8。
 *   setupSheets / setupSecrets / setupTriggers / seedStructure / makeAdmin(name) / dailyMaintenance(Media.gs)
 * どれも何度実行しても壊れない(冪等)。秘密の値はログに出さない。
 */

/** PEPPER(鍵のハッシュ用)と SECRET(メール署名用)を、無ければ作る。あるものは絶対に変えない */
function setupSecrets() {
  var props = PropertiesService.getScriptProperties();
  ['PEPPER', 'SECRET'].forEach(function (k) {
    if (!props.getProperty(k)) props.setProperty(k, Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  });
  Logger.log('setupSecrets: PEPPER / SECRET を確認しました(値は表示しません)');
}

function setupSheets() {
  setupSecrets();
  var props = PropertiesService.getScriptProperties();

  // スプレッドシート: 既存ID → コンテナバインド → 新規作成
  var ss = null;
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) ss = SpreadsheetApp.create('施工手引き データ');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  // 先に全シートの列名を検査する(食い違いがあれば何も変えずに止まる)
  Object.keys(SHEET_DEFS).forEach(function (key) {
    var def = SHEET_DEFS[key];
    var sh = ss.getSheetByName(def.name);
    if (!sh || sh.getLastRow() === 0) return;
    var width = Math.max(def.cols.length, sh.getLastColumn());
    var head = sh.getRange(1, 1, 1, width).getValues()[0];
    for (var i = 0; i < width; i++) {
      var want = i < def.cols.length ? def.cols[i].h : '';
      if (String(head[i]) !== want) {
        throw new Error('シート「' + def.name + '」の' + (i + 1) + '列目が仕様と違います(期待: 「' + want + '」/ 実際: 「' + head[i] + '」)。直してから再実行してください。');
      }
    }
  });

  Object.keys(SHEET_DEFS).forEach(function (key) {
    var def = SHEET_DEFS[key];
    var sh = ss.getSheetByName(def.name);
    if (!sh) sh = ss.insertSheet(def.name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols.map(function (c) { return c.h; })]);
      sh.getRange(1, 1, 1, def.cols.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    def.cols.forEach(function (c, i) {
      if (c.t === 'str') sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@'); // 文字列のまま保持(日付や数値に勝手に変換させない)
      if (c.t === 'date') sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
    });
  });

  // 利用者シートの入力規則(区分・状態)
  var us = ss.getSheetByName(SHEET_DEFS.users.name);
  var rows = Math.max(us.getMaxRows() - 1, 1);
  us.getRange(2, 5, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([ROLE_TO_JA.viewer, ROLE_TO_JA.poster, ROLE_TO_JA.admin], true).setAllowInvalid(false).build());
  us.getRange(2, 6, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([STATUS_TO_JA.pending, STATUS_TO_JA.approved, STATUS_TO_JA.rejected], true).setAllowInvalid(false).build());

  // 余計な初期シートを消す(空で、仕様のシートでないもの)
  ss.getSheets().forEach(function (s) {
    var known = Object.keys(SHEET_DEFS).some(function (k) { return SHEET_DEFS[k].name === s.getName(); });
    if (!known && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  Repo.reset();
  if (!props.getProperty('REV')) props.setProperty('REV', '1');

  // Drive: ルート「RCCREATE 施工手引き」と media/
  var rootId = Repo.getSetting('mediaRootFolderId', '');
  var root = null;
  if (rootId) {
    try {
      root = DriveApp.getFolderById(rootId);
      if (root.isTrashed && root.isTrashed()) root = null;
    } catch (e) { root = null; }
  }
  if (!root) root = DriveApp.createFolder(ROOT_FOLDER_NAME);
  Repo.setSetting('mediaRootFolderId', root.getId());
  var it = root.getFoldersByName(MEDIA_FOLDER_NAME);
  var media = it.hasNext() ? it.next() : root.createFolder(MEDIA_FOLDER_NAME);
  props.setProperty('MEDIA_FOLDER_ID', media.getId());

  if (Repo.getSetting('mailEnabled', '') === '') Repo.setSetting('mailEnabled', 'TRUE');
  if (Repo.getSetting('notifyEmail', '') === '') Repo.setSetting('notifyEmail', '');
  if (Repo.getSetting('appBaseUrl', '') === '') Repo.setSetting('appBaseUrl', DEFAULT_APP_BASE_URL);
  Repo.reset();
  Logger.log('setupSheets: 完了(シート ' + Object.keys(SHEET_DEFS).length + ' 枚・Driveフォルダ確認済み)');
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyMaintenance') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(3).inTimezone('Asia/Tokyo').create();
  Logger.log('setupTriggers: 毎日3時に dailyMaintenance を実行します');
}

/** 初期データ(SPEC §7)。同名があれば作らない */
function seedStructure() {
  return withLock_(function () {
    var created = { groups: 0, items: 0 };
    SEED_STRUCTURE.forEach(function (sg, gi) {
      var g = Repo.all('groups').filter(function (x) { return x.name === sg.name; })[0];
      if (!g) {
        g = { id: Util.newId('g_', function (x) { return !!Repo.find('groups', x); }), name: sg.name, order: (gi + 1) * 10 };
        Repo.append('groups', g);
        created.groups++;
      }
      sg.items.forEach(function (name, ii) {
        var exists = Repo.all('items').some(function (x) { return x.groupId === g.id && x.name === name; });
        if (exists) return;
        Repo.append('items', { id: Util.newId('i_', function (x) { return !!Repo.find('items', x); }), groupId: g.id, name: name, order: (ii + 1) * 10 });
        created.items++;
      });
    });
    if (created.groups || created.items) Repo.bumpRev();
    Logger.log('seedStructure: グループ' + created.groups + '・項目' + created.items + ' を追加しました');
    return created;
  });
}

/** 承認済みで氏名が一致する1人を「管理」にする。0人・2人以上なら何もしない */
function makeAdmin(name) {
  return withLock_(function () {
    var want = cleanText_(name == null ? '' : name, false);
    var hits = Repo.all('users').filter(function (u) {
      return u.status === STATUS_TO_JA.approved && cleanText_(u.name, false) === want;
    });
    if (hits.length !== 1) {
      Logger.log('makeAdmin: 何もしませんでした。承認済みで氏名「' + want + '」の人が ' + hits.length + ' 人います(1人だけのときに実行されます)');
      return false;
    }
    if (hits[0].role !== ROLE_TO_JA.admin) {
      Repo.update('users', hits[0], { role: ROLE_TO_JA.admin });
      Repo.bumpRev();
    }
    Logger.log('makeAdmin: 「' + want + '」を管理にしました');
    return true;
  });
}
