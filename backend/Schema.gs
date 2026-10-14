/**
 * Schema.gs — シート定義(SPEC §3)・固定リスト(§6)・初期データ(§7)。
 * 列は { f: 内部名, h: 1行目の列名, t: 型 }。型: str / num / bool / date(ms)。
 * cellWise: true のシートは、アプリが変更した列だけをセル単位で書く(人が手で編集するシートのため)。
 */

var ROOT_FOLDER_NAME = 'RCCREATE 施工手引き';
var MEDIA_FOLDER_NAME = 'media';
var DEFAULT_APP_BASE_URL = 'https://tebiki.rccreate.net';

var SHEET_DEFS = {
  users: {
    name: '利用者', cellWise: true,
    cols: [
      { f: 'id', h: 'ID', t: 'str' },
      { f: 'appliedAt', h: '申請日時', t: 'date' },
      { f: 'name', h: '氏名', t: 'str' },
      { f: 'company', h: '会社名', t: 'str' },
      { f: 'role', h: '区分', t: 'str' },
      { f: 'status', h: '状態', t: 'str' },
      { f: 'decidedAt', h: '決定日時', t: 'date' },
      { f: 'keyHash', h: '鍵ハッシュ', t: 'str' },
      { f: 'lastUsedAt', h: '最終利用', t: 'date' }
    ]
  },
  groups: {
    name: 'グループ',
    cols: [
      { f: 'id', h: 'ID', t: 'str' },
      { f: 'name', h: '名前', t: 'str' },
      { f: 'order', h: '順', t: 'num' }
    ]
  },
  items: {
    name: '項目',
    cols: [
      { f: 'id', h: 'ID', t: 'str' },
      { f: 'groupId', h: 'グループID', t: 'str' },
      { f: 'name', h: '名前', t: 'str' },
      { f: 'order', h: '順', t: 'num' }
    ]
  },
  examples: {
    name: '事例',
    cols: [
      { f: 'id', h: 'ID', t: 'str' },
      { f: 'itemId', h: '項目ID', t: 'str' },
      { f: 'kind', h: '種類', t: 'str' },
      { f: 'title', h: 'タイトル', t: 'str' },
      { f: 'reason', h: '理由', t: 'str' },
      { f: 'severity', h: '重要度', t: 'str' },
      { f: 'timing', h: '確認時期', t: 'str' },
      { f: 'criteria', h: '確認基準', t: 'str' },
      { f: 'refNo', h: '管理番号', t: 'str' },
      { f: 'media', h: 'メディア', t: 'str' },
      { f: 'by', h: '登録者', t: 'str' },
      { f: 'at', h: '登録日時', t: 'num' },
      { f: 'updatedAt', h: '更新日時', t: 'num' },
      { f: 'hidden', h: '削除', t: 'bool' },
      { f: 'hiddenAt', h: '削除日時', t: 'num' }
    ]
  },
  settings: {
    name: '設定',
    cols: [
      { f: 'key', h: 'キー', t: 'str' },
      { f: 'value', h: '値', t: 'str' }
    ]
  }
};

var ROLE_TO_JA = { viewer: '閲覧', poster: '投稿', admin: '管理' };
var STATUS_TO_JA = { pending: '申請中', approved: '承認', rejected: '却下' };
var ROLE_FROM_JA = { '閲覧': 'viewer', '投稿': 'poster', '管理': 'admin' };
var STATUS_FROM_JA = { '申請中': 'pending', '承認': 'approved', '却下': 'rejected' };
var ROLE_RANK = { viewer: 1, poster: 2, admin: 3 };

var TIMING_LIST = ['墨出し・準備', '型枠建込', '支保工設置', '締付金物・補強', '打設前最終確認', 'コン打設中監視', '養生・脱型'];
var SEVERITY_LIST = ['A', 'B', 'C'];

var ID_RE = {
  group: /^g_[a-z0-9]{8,32}$/,
  item: /^i_[a-z0-9]{8,32}$/,
  example: /^e_[a-z0-9]{8,32}$/,
  media: /^m_[a-z0-9]{8,32}$/
};

var LIMITS = {
  IMAGE_MAX: 1.5 * 1024 * 1024,        // 画像本体(生バイト)
  THUMB_MAX: 80 * 1024,                // サムネ(生バイト)
  VIDEO_PART_MAX: 3 * 1024 * 1024,     // 動画の1片(生バイト)
  VIDEO_PART_B64_MAX: 4200000,         // 動画の1片(base64文字数)
  VIDEO_TOTAL_MAX: 20 * 1024 * 1024,   // 動画全体(生バイト)
  VIDEO_PARTS_MAX: 8,
  MEDIA_PER_EXAMPLE: 6,
  MAX_BODY_CHARS: 4700000,             // 要求本文の上限(動画1片のbase64 + サムネ + 余白)
  ORPHAN_AGE_MS: 24 * 3600 * 1000,
  LAST_USED_INTERVAL_MS: 10 * 60 * 1000,
  MAIL_WINDOW_MS: 6 * 3600 * 1000,
  MAIL_MAX: 20
};

/** 初期データ(SPEC §7)。順は10刻み(グループは全体で、項目はグループ内で 10,20,30…) */
var SEED_STRUCTURE = [
  { name: '準備', items: ['材料・資機材の確認', '安全・KY', '資材の積み方（運搬）', '加工場の材料の置き方'] },
  { name: '墨出', items: ['通り芯・逃げ墨', '高さ（レベル）墨', 'スリット位置の墨出し'] },
  { name: '建込', items: ['壁の建込', 'スラブ段取り', '敷桟木（下端）'] },
  { name: '固め', items: ['締付け（セパ・フォームタイ）', '端太・控え・振れ止め'] },
  { name: '片付け', items: ['作業後の片付け・清掃'] },
  { name: '仕上がり確認', items: ['打継・出隅の精度'] }
];
