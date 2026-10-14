/**
 * Code.gs — 入口(doGet / doPost)と振り分け。SPEC §1。
 * doPost は例外を投げず、必ず JSON を返す。更新系はスクリプトロックの内側で実行する。
 */

/** ロックを離した後に実行する後始末(メール送信など。失敗しても応答には影響しない) */
var AFTER_LOCK_ = [];

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function okEnvelope_(data) {
  return { ok: true, data: data, meta: { serverTime: Util.nowIso() } };
}
function errEnvelope_(code, message, path) {
  var e = { code: code, message: message };
  if (path) e.path = path;
  return { ok: false, error: e };
}

/* ---------- 引数の検査 ---------- */

/**
 * spec の各キー: { t:'str'|'int'|'b64'|'arr', req, max(文字数/件数), min, enum, re, multi, label, path }
 * 表にないキー・型違いは BAD_REQUEST。必須欠け・長さ超過・値の不正は VALIDATION_FAILED(path付き)。
 */
function validateParams_(spec, params) {
  var out = {};
  var has = Object.prototype.hasOwnProperty;
  Object.keys(params).forEach(function (k) {
    if (!has.call(spec, k)) fail_('BAD_REQUEST', '不明なパラメータです: ' + k);
  });
  Object.keys(spec).forEach(function (k) {
    var s = spec[k];
    var label = s.label || k;
    var v = has.call(params, k) ? params[k] : undefined;
    if (v === undefined || v === null) {
      if (s.req) fail_('VALIDATION_FAILED', label + 'は必須です。', k);
      return;
    }
    if (s.t === 'str') {
      if (typeof v !== 'string') fail_('BAD_REQUEST', label + 'は文字列で指定してください。');
      var t = cleanText_(v, !!s.multi);
      if (s.req && t === '') fail_('VALIDATION_FAILED', label + 'は必須です。', k);
      if (s.max && t.length > s.max) fail_('VALIDATION_FAILED', label + 'は' + s.max + '文字までです。', k);
      if (s.enum && s.enum.indexOf(t) < 0) fail_('VALIDATION_FAILED', label + 'の値が正しくありません。', k);
      if (s.re && !s.re.test(t)) fail_('VALIDATION_FAILED', label + 'の形式が正しくありません。', k);
      out[k] = s.raw ? t : formulaGuard_(t);
    } else if (s.t === 'int') {
      if (!Util.isInt(v)) fail_('BAD_REQUEST', label + 'は整数で指定してください。');
      if (s.min !== undefined && v < s.min) fail_('VALIDATION_FAILED', label + 'は' + s.min + '以上にしてください。', k);
      if (s.max !== undefined && v > s.max) fail_('VALIDATION_FAILED', label + 'は' + s.max + '以下にしてください。', k);
      out[k] = v;
    } else if (s.t === 'b64') {
      if (typeof v !== 'string') fail_('BAD_REQUEST', label + 'はbase64文字列で指定してください。');
      out[k] = v;
    } else if (s.t === 'arr') {
      if (!Array.isArray(v)) fail_('BAD_REQUEST', label + 'は配列で指定してください。');
      if (s.min !== undefined && v.length < s.min) fail_('VALIDATION_FAILED', label + 'は' + s.min + '件以上必要です。', k);
      if (s.max !== undefined && v.length > s.max) fail_('VALIDATION_FAILED', label + 'は' + s.max + '件までです。', k);
      out[k] = v;
    }
  });
  return out;
}

/* ---------- アクション表(実行時に組み立てる: 他ファイルの関数を読み込み順に依存せず参照するため) ---------- */

var ACTIONS_CACHE_ = null;
function getActions_() {
  if (ACTIONS_CACHE_) return ACTIONS_CACHE_;
  ACTIONS_CACHE_ = {
    ping: { auth: 'none', params: {}, run: function () { return { version: APP_VERSION }; } },
    apply: {
      auth: 'register', write: true, run: handleApply_,
      params: { name: { t: 'str', req: true, max: 40, label: '氏名' }, company: { t: 'str', max: 60, label: '会社名' } }
    },
    status: { auth: 'register', params: {}, run: handleStatus_ },
    bootstrap: { auth: 'approved', role: 'viewer', params: { since: { t: 'int', min: 0, label: 'since' } }, run: handleBootstrap_ },
    getThumbs: {
      auth: 'approved', role: 'viewer', run: handleGetThumbs_,
      params: { ids: { t: 'arr', req: true, min: 1, max: 20, label: 'ids' } }
    },
    getPart: {
      auth: 'approved', role: 'viewer', run: handleGetPart_,
      params: {
        id: { t: 'str', req: true, re: ID_RE.media, raw: true, label: 'メディアID' },
        index: { t: 'int', req: true, min: 0, max: LIMITS.VIDEO_PARTS_MAX - 1, label: 'index' }
      }
    },
    uploadPart: {
      auth: 'approved', role: 'poster', run: handleUploadPart_, // Drive書込はロック外(SPEC §5.3)
      params: {
        mediaId: { t: 'str', req: true, re: ID_RE.media, raw: true, label: 'mediaId' },
        kind: { t: 'str', req: true, enum: ['image', 'video'], raw: true, label: 'kind' },
        mime: { t: 'str', req: true, raw: true, label: 'mime' },
        index: { t: 'int', req: true, min: 0, max: LIMITS.VIDEO_PARTS_MAX - 1, label: 'index' },
        total: { t: 'int', req: true, min: 1, max: LIMITS.VIDEO_PARTS_MAX, label: 'total' },
        data: { t: 'b64', req: true, label: 'data' },
        thumb: { t: 'b64', label: 'thumb' },
        bytes: { t: 'int', req: true, min: 0, label: 'bytes' }
      }
    },
    saveExample: {
      auth: 'approved', role: 'poster', write: true, run: handleSaveExample_,
      params: {
        id: { t: 'str', req: true, re: ID_RE.example, raw: true, label: '事例ID' },
        itemId: { t: 'str', req: true, max: 40, raw: true, label: '項目ID' },
        kind: { t: 'str', req: true, enum: ['good', 'bad'], raw: true, label: '種類' },
        title: { t: 'str', req: true, max: 60, label: 'タイトル' },
        reason: { t: 'str', max: 600, multi: true, label: '理由' },
        severity: { t: 'str', enum: [''].concat(SEVERITY_LIST), raw: true, label: '重要度' },
        timing: { t: 'str', enum: [''].concat(TIMING_LIST), raw: true, label: '確認時期' },
        criteria: { t: 'str', max: 300, multi: true, label: '確認基準' },
        refNo: { t: 'str', max: 30, label: '管理番号' },
        media: { t: 'arr', max: LIMITS.MEDIA_PER_EXAMPLE, label: 'メディア' }
      }
    },
    deleteExample: {
      auth: 'approved', role: 'poster', write: true, run: handleDeleteExample_,
      params: { id: { t: 'str', req: true, re: ID_RE.example, raw: true, label: '事例ID' } }
    },
    restoreExample: {
      auth: 'approved', role: 'admin', write: true, run: handleRestoreExample_,
      params: { id: { t: 'str', req: true, re: ID_RE.example, raw: true, label: '事例ID' } }
    },
    purgeExample: {
      auth: 'approved', role: 'admin', write: true, run: handlePurgeExample_,
      params: { id: { t: 'str', req: true, re: ID_RE.example, raw: true, label: '事例ID' } }
    },
    saveGroup: {
      auth: 'approved', role: 'admin', write: true, run: handleSaveGroup_,
      params: {
        id: { t: 'str', re: ID_RE.group, raw: true, label: 'グループID' },
        name: { t: 'str', req: true, max: 30, label: '名前' },
        order: { t: 'int', min: -1000000, max: 1000000, label: '順' }
      }
    },
    saveItem: {
      auth: 'approved', role: 'admin', write: true, run: handleSaveItem_,
      params: {
        id: { t: 'str', re: ID_RE.item, raw: true, label: '項目ID' },
        groupId: { t: 'str', req: true, max: 40, raw: true, label: 'グループID' },
        name: { t: 'str', req: true, max: 40, label: '名前' },
        order: { t: 'int', min: -1000000, max: 1000000, label: '順' }
      }
    },
    reorder: {
      auth: 'approved', role: 'admin', write: true, run: handleReorder_,
      params: {
        kind: { t: 'str', req: true, enum: ['group', 'item'], raw: true, label: 'kind' },
        orders: { t: 'arr', req: true, min: 1, max: 200, label: 'orders' }
      }
    },
    deleteGroup: {
      auth: 'approved', role: 'admin', write: true, run: handleDeleteGroup_,
      params: { id: { t: 'str', req: true, re: ID_RE.group, raw: true, label: 'グループID' } }
    },
    deleteItem: {
      auth: 'approved', role: 'admin', write: true, run: handleDeleteItem_,
      params: { id: { t: 'str', req: true, re: ID_RE.item, raw: true, label: '項目ID' } }
    },
    setUser: {
      auth: 'approved', role: 'admin', write: true, run: handleSetUser_,
      params: {
        id: { t: 'str', req: true, re: Auth.DEV_RE, raw: true, label: '利用者ID' },
        role: { t: 'str', enum: ['viewer', 'poster', 'admin'], raw: true, label: '区分' },
        status: { t: 'str', enum: ['approved', 'rejected', 'pending'], raw: true, label: '状態' }
      }
    }
  };
  return ACTIONS_CACHE_;
}

/** スクリプトロックの内側で fn を実行する。10秒待っても取れなければ BUSY */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    fail_('BUSY', '他の人が書き込み中です。少し待ってからもう一度お試しください。');
  }
  try {
    Repo.reset();
    return fn();
  } finally {
    try { SpreadsheetApp.flush(); } catch (e2) { /* 無視 */ }
    lock.releaseLock();
    Repo.reset();
  }
}

function runAfterLock_() {
  var q = AFTER_LOCK_;
  AFTER_LOCK_ = [];
  q.forEach(function (fn) {
    try { fn(); } catch (e) { console.error('after-lock task failed: ' + (e && e.message)); }
  });
}

function parseRequest_(e) {
  var body = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  if (!body) fail_('BAD_REQUEST', '要求の本文が空です。');
  if (body.length > LIMITS.MAX_BODY_CHARS) fail_('TOO_LARGE', '送信データが大きすぎます。');
  var req;
  try {
    req = JSON.parse(body);
  } catch (err) {
    fail_('BAD_REQUEST', '要求がJSONとして読めません。');
  }
  if (!req || typeof req !== 'object' || Array.isArray(req)) fail_('BAD_REQUEST', '要求の形式が正しくありません。');
  if (req.v !== 1) fail_('BAD_REQUEST', '対応していない版(v)です。');
  if (typeof req.action !== 'string' || !req.action) fail_('BAD_REQUEST', 'action がありません。');
  if (req.params === undefined || req.params === null) req.params = {};
  if (typeof req.params !== 'object' || Array.isArray(req.params)) fail_('BAD_REQUEST', 'params はオブジェクトで指定してください。');
  return req;
}

function dispatch_(e) {
  Repo.reset();
  AFTER_LOCK_ = [];
  var req = parseRequest_(e);
  var actions = getActions_();
  if (!Object.prototype.hasOwnProperty.call(actions, req.action)) fail_('BAD_REQUEST', '未知のactionです: ' + String(req.action).slice(0, 40));
  var def = actions[req.action];
  if (def.auth === 'none') {
    validateParams_(def.params, req.params);
    return def.run({}, {});
  }
  var ctx = Auth.authenticate(req, def.auth === 'register' ? 'register' : 'approved', def.role); // 早めに弾く(ロックを取らない)
  var params = validateParams_(def.params, req.params);
  if (!def.write) return def.run(ctx, params);
  var data = withLock_(function () {
    ctx = Auth.authenticate(req, def.auth === 'register' ? 'register' : 'approved', def.role); // ロック内で最新の区分を再確認
    return def.run(ctx, params);
  });
  runAfterLock_();
  return data;
}

function doPost(e) {
  var out;
  try {
    out = okEnvelope_(dispatch_(e));
  } catch (err) {
    if (err && err.isApiError) {
      out = errEnvelope_(err.code, err.message, err.path);
    } else {
      console.error('INTERNAL: ' + (err && err.message)); // 鍵や本文は出さない
      out = errEnvelope_('INTERNAL', 'サーバーでエラーが起きました。しばらくしてからもう一度お試しください。');
    }
  }
  try {
    return json_(out);
  } catch (err2) {
    return ContentService.createTextOutput('{"ok":false,"error":{"code":"INTERNAL","message":"応答を作れませんでした。"}}');
  }
}

/** doGet は decide / commit / ping だけ(SPEC §5.1) */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'decide') return decidePage_(p);
    if (p.action === 'commit') return commitPage_(p);
    if (p.action === 'ping') return json_(okEnvelope_({ version: APP_VERSION }));
    return json_(errEnvelope_('BAD_REQUEST', 'このURLでは使えない操作です。'));
  } catch (err) {
    if (!(err && err.isApiError)) console.error('doGet error: ' + (err && err.message));
    if (p.action === 'decide' || p.action === 'commit') return page_(err && err.isApiError ? err.message : 'エラーが起きました。しばらくしてからもう一度お試しください。');
    return json_(errEnvelope_(err && err.isApiError ? err.code : 'INTERNAL', err && err.isApiError ? err.message : 'サーバーでエラーが起きました。'));
  }
}
