/**
 * Repo.gs — スプレッドシートの読み書き(リクエスト内キャッシュ付き)。
 * 書き込みは必ずスクリプトロックの内側から呼ぶこと(呼ぶ側の責任)。
 * 書いたらキャッシュを捨てる(行番号がずれるため)。
 */

var Repo = (function () {
  var ssHandle = null;
  var tables = {};

  function props() {
    return PropertiesService.getScriptProperties();
  }

  function spreadsheet() {
    if (ssHandle) return ssHandle;
    var id = props().getProperty('SPREADSHEET_ID');
    if (!id) fail_('INTERNAL', 'スプレッドシートが未設定です。setupSheets を実行してください。');
    try {
      ssHandle = SpreadsheetApp.openById(id);
    } catch (e) {
      console.error('openById failed: ' + (e && e.message));
      fail_('INTERNAL', 'スプレッドシートを開けませんでした。');
    }
    return ssHandle;
  }

  function sheet(key) {
    var sh = spreadsheet().getSheetByName(SHEET_DEFS[key].name);
    if (!sh) fail_('INTERNAL', 'シート「' + SHEET_DEFS[key].name + '」がありません。setupSheets を実行してください。');
    return sh;
  }

  function toMs(v) {
    if (v === '' || v === null || v === undefined) return 0;
    if (Object.prototype.toString.call(v) === '[object Date]') return v.getTime();
    if (typeof v === 'number') return v;
    var n = Number(v);
    if (!isNaN(n)) return n;
    var d = Date.parse(String(v));
    return isNaN(d) ? 0 : d;
  }

  function fromCell(t, v) {
    switch (t) {
      case 'num': { var n = Number(v); return v === '' || isNaN(n) ? 0 : n; }
      case 'bool': return v === true || String(v).toUpperCase() === 'TRUE';
      case 'date': return toMs(v);
      default: return v === null || v === undefined ? '' : String(v);
    }
  }

  function toCell(t, v) {
    switch (t) {
      case 'num': return typeof v === 'number' ? v : '';
      case 'bool': return !!v;
      case 'date': return v ? new Date(v) : '';
      default: return v === null || v === undefined ? '' : String(v);
    }
  }

  function all(key) {
    if (tables[key]) return tables[key];
    var def = SHEET_DEFS[key];
    var sh = sheet(key);
    var last = sh.getLastRow();
    var rows = [];
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, def.cols.length).getValues();
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0]) === '') continue; // 先頭列が空の行は無視
        var o = { _r: i + 2 };
        for (var j = 0; j < def.cols.length; j++) o[def.cols[j].f] = fromCell(def.cols[j].t, vals[i][j]);
        rows.push(o);
      }
    }
    tables[key] = rows;
    return rows;
  }

  function find(key, id) {
    var rows = all(key);
    var idf = SHEET_DEFS[key].cols[0].f;
    for (var i = 0; i < rows.length; i++) if (rows[i][idf] === id) return rows[i];
    return null;
  }

  function append(key, obj) {
    var def = SHEET_DEFS[key];
    var cells = def.cols.map(function (c) { return toCell(c.t, obj[c.f]); });
    sheet(key).appendRow(cells);
    tables = {};
  }

  /** row(all/find で得た行)の patch の列だけを書く。cellWise でないシートは行ごと書く */
  function update(key, row, patch) {
    var def = SHEET_DEFS[key];
    var sh = sheet(key);
    if (def.cellWise) {
      def.cols.forEach(function (c, idx) {
        if (Object.prototype.hasOwnProperty.call(patch, c.f)) sh.getRange(row._r, idx + 1).setValue(toCell(c.t, patch[c.f]));
      });
    } else {
      var merged = {};
      def.cols.forEach(function (c) { merged[c.f] = Object.prototype.hasOwnProperty.call(patch, c.f) ? patch[c.f] : row[c.f]; });
      sh.getRange(row._r, 1, 1, def.cols.length).setValues([def.cols.map(function (c) { return toCell(c.t, merged[c.f]); })]);
    }
    tables = {};
  }

  function remove(key, row) {
    sheet(key).deleteRow(row._r);
    tables = {};
  }

  /** 列 field を、id→値 の対応で一括更新する(1回の setValues。並べ替えの原子性のため) */
  function setColumn(key, field, valuesById) {
    var def = SHEET_DEFS[key];
    var idx = -1;
    def.cols.forEach(function (c, i) { if (c.f === field) idx = i; });
    var rows = all(key);
    if (!rows.length) return;
    var sh = sheet(key);
    var last = sh.getLastRow();
    var cur = sh.getRange(2, idx + 1, last - 1, 1).getValues();
    rows.forEach(function (r) {
      if (Object.prototype.hasOwnProperty.call(valuesById, r.id)) cur[r._r - 2][0] = toCell(def.cols[idx].t, valuesById[r.id]);
    });
    sh.getRange(2, idx + 1, last - 1, 1).setValues(cur);
    tables = {};
  }

  function getSetting(k, dflt) {
    var r = find('settings', k);
    return r && r.value !== '' ? r.value : dflt;
  }

  function setSetting(k, v) {
    var r = find('settings', k);
    if (r) update('settings', r, { value: String(v) });
    else append('settings', { key: k, value: String(v) });
  }

  function rev() {
    return Number(props().getProperty('REV') || 0) || 0;
  }

  function bumpRev() {
    var n = rev() + 1;
    props().setProperty('REV', String(n));
    return n;
  }

  return {
    reset: function () { tables = {}; },
    spreadsheet: spreadsheet, sheet: sheet, all: all, find: find, append: append, update: update,
    remove: remove, setColumn: setColumn, getSetting: getSetting, setSetting: setSetting,
    rev: rev, bumpRev: bumpRev, props: props, toMs: toMs
  };
})();
