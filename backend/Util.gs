/**
 * Util.gs — 共通の小道具(時刻・ハッシュ・ID・文字列の掃除・エラー)。
 * 注意: GAS は全ファイルを同じグローバル空間で順に評価する。トップレベルでは他ファイルの
 * 関数や変数を「呼ばない」こと(読み込み順に依存してしまうため)。
 */

var APP_VERSION = 1;
var ERROR_CODES = ['BAD_REQUEST', 'UNAUTHENTICATED', 'NOT_APPROVED', 'REJECTED', 'FORBIDDEN', 'NOT_FOUND',
  'VALIDATION_FAILED', 'HAS_CHILDREN', 'TOO_LARGE', 'BUSY', 'DRIVE_ERROR', 'INTERNAL'];

/** API が返す(想定内の)エラー。throw して dispatcher が JSON にする */
function ApiError(code, message, path) {
  this.isApiError = true;
  this.code = code;
  this.message = message;
  if (path) this.path = path;
}
function fail_(code, message, path) {
  throw new ApiError(code, message, path);
}

var Util = {
  /** テスト用の時計差し替え口(本番は null のまま)。ハーネスが設定する */
  _clock: null,

  nowMs: function () {
    return Util._clock ? Util._clock() : Date.now();
  },

  /** ms → 'YYYY-MM-DDTHH:mm:ss+09:00' (JST固定) */
  isoJst: function (ms) {
    var t = new Date(ms + 9 * 3600 * 1000);
    return t.toISOString().replace(/\.\d+Z$/, '+09:00');
  },

  nowIso: function () {
    return Util.isoJst(Util.nowMs());
  },

  hex: function (bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] & 0xff;
      s += (b < 16 ? '0' : '') + b.toString(16);
    }
    return s;
  },

  sha256Hex: function (str) {
    return Util.hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8));
  },

  hmacHex: function (str, secret) {
    return Util.hex(Utilities.computeHmacSha256Signature(str, secret));
  },

  /** 英数のランダム文字列(小文字16進)。len は 32 まで */
  randomHex: function (len) {
    var s = '';
    while (s.length < len) s += Utilities.getUuid().replace(/-/g, '');
    return s.slice(0, len);
  },

  /** 'g_' + 12桁 のようなID。exists(id) が真なら作り直す */
  newId: function (prefix, exists) {
    for (var i = 0; i < 10; i++) {
      var id = prefix + Util.randomHex(12);
      if (!exists || !exists(id)) return id;
    }
    fail_('INTERNAL', 'IDを発行できませんでした。もう一度お試しください。');
  },

  /** 長さが同じでも途中で打ち切らない比較(署名・ハッシュ用) */
  safeEq: function (a, b) {
    a = String(a); b = String(b);
    var diff = a.length === b.length ? 0 : 1;
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  },

  isInt: function (v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  },

  esc: function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },

  /** base64文字列の生バイト数(形式が正しい前提) */
  b64RawLen: function (s) {
    var pad = s.endsWith('==') ? 2 : (s.endsWith('=') ? 1 : 0);
    return (s.length / 4) * 3 - pad;
  },

  /** base64の形式チェック(標準アルファベット・4の倍数) */
  isB64: function (s) {
    return typeof s === 'string' && s.length % 4 === 0 && /^[A-Za-z0-9+\/]*={0,2}$/.test(s);
  }
};

/**
 * 文字列の掃除(長さの検査はこの結果で行う)。制御文字を除き、前後の空白を落とす。
 * multiline=false なら改行・タブも空白1つにまとめる。
 */
function cleanText_(s, multiline) {
  var t = String(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '');
  if (!multiline) t = t.replace(/[\n\t]+/g, ' ');
  return t.trim();
}

/** 数式として解釈される先頭文字(= + - @)なら先頭に空白を足す(SPEC §3) */
function formulaGuard_(t) {
  return /^[=+\-@]/.test(t) ? ' ' + t : t;
}

/** 掃除 + 数式ガード。シートに書く文字列は必ずこれを通す */
function clean_(s, multiline) {
  return formulaGuard_(cleanText_(s, multiline));
}
