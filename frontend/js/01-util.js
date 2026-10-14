'use strict';
/* ===== 共通部品 ===== */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 864e5;
const MAX_FILE = 20 * 1024 * 1024;       // 1ファイルの上限(動画の圧縮後)
const COMPRESS_OVER = 10 * 1024 * 1024;  // これを超える動画は端末内で小さくしてから送る
const PART_BYTES = 2 * 1024 * 1024;      // 動画を分けて送る1片の大きさ(サーバー上限は3MB)
const MAX_MEDIA = 6;
const VERSION = 'v3.0 (2026-10-14)';
const CFG = window.TEBIKI_CONFIG || {};
// 確認タイミング: 工程別重点管理ポイント一覧の7工程に合わせる
const TIMINGS = ['墨出し・準備', '型枠建込', '支保工設置', '締付金物・補強', '打設前最終確認', 'コン打設中監視', '養生・脱型'];
const ROLE_LABEL = { viewer: '閲覧', poster: '投稿', admin: '管理' };
const byOrder = (a, b) => ((a.order || 0) - (b.order || 0)) || String(a.name || '').localeCompare(String(b.name || ''), 'ja');
const stamp = e => Math.max(e.at || 0, e.updatedAt || 0);
const isNew = e => Date.now() - stamp(e) < 7 * DAY;
function fmtDate(t) {
  if (!t) return '';
  const d = new Date(t), n = new Date();
  return (d.getFullYear() !== n.getFullYear() ? d.getFullYear() + '/' : '') + (d.getMonth() + 1) + '/' + d.getDate();
}
function rid(prefix) {
  const a = new Uint8Array(8);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return prefix + Array.from(a, b => ('0' + b.toString(16)).slice(-2)).join('');
}
function randKey(n) {
  const cs = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, b => cs[b % cs.length]).join('');
}
function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }

/* 検索: 全角半角・大小・カタカナ/ひらがなをそろえ、空白区切りで全語一致(AND)。略称・表記ゆれは同義語グループで補う */
function norm(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
const ALIAS = [
  ['こんぱね', '合板', 'べにや'],
  ['すみだし', '墨出し', '墨出', '墨'],
  ['たてこみ', '建込', '建て込み', '建込み', '建て込'],
  ['うちつぎ', '打継', '打ち継ぎ', '打継ぎ', '打ち継ぎ部'],
  ['でずみ', '出隅', '出すみ'],
  ['いりずみ', '入隅', '入りすみ'],
  ['せぱ', 'せぱれーたー'],
  ['ぱいぷさぽーと', 'さぽーと', '支保工'],
  ['しききざんぎ', '敷桟木', '桟木', 'さんぎ']
].map(g => g.map(norm));
function makeMatcher(q) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  const alts = terms.map(t => { const g = ALIAS.find(g => g.includes(t)); return g ? g : [t]; });
  return text => { const h = norm(text); return alts.every(a => a.some(x => h.includes(x))); };
}

let toastT = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3600);
  const l = $('#live'); if (l) l.textContent = msg;
}

/* 端末ごとの設定(文字サイズ)。保存できない環境でも動く */
const Prefs = {
  d: { fs: 'm', sort: 'new', hintClosed: false },
  load() { try { const j = localStorage.getItem('tebiki.prefs'); if (j) Object.assign(this.d, JSON.parse(j)); } catch (e) {} },
  save() { try { localStorage.setItem('tebiki.prefs', JSON.stringify(this.d)); } catch (e) {} },
  apply() { document.documentElement.style.setProperty('--scale', ({ s: 1, m: 1, l: 1.15, x: 1.3 })[this.d.fs] || 1); }
};

const ERR = {
  NETWORK: '電波が届いていません。電波のある場所でもう一度お試しください。',
  UNAUTHENTICATED: 'この端末の登録を確認できません。設定から登録し直してください。',
  NOT_APPROVED: 'まだ承認されていません。',
  REJECTED: 'この端末は承認されていません。管理者に連絡してください。',
  FORBIDDEN: 'この操作をする権限がありません。',
  NOT_FOUND: '対象が見つかりません。削除されたか、すでに変更された可能性があります。',
  VALIDATION_FAILED: '入力内容を確認してください。',
  HAS_CHILDREN: '中身が残っているため削除できません。先に中身を移動・削除してください。',
  TOO_LARGE: 'ファイルが大きすぎます。動画は短く撮り直してください。',
  BUSY: '混み合っています。少し待ってからもう一度お試しください。',
  DRIVE_ERROR: '写真・動画の保存に失敗しました。もう一度お試しください。',
  INTERNAL: '保存できませんでした。通信を確認して、もう一度お試しください。',
  video_long: '動画が長すぎます。60秒以内にしてください。',
  decode_failed: 'この写真・動画は読み込めませんでした。別のファイルか、JPEG／MP4形式で試してください。',
  unsupported_type: '対応していない形式です。写真はJPEG・PNG、動画はMP4で選んでください。'
};
function errText(e) {
  const c = e && e.code;
  if (c === 'VALIDATION_FAILED' && e.message) return e.message;
  return ERR[c] || ERR.INTERNAL;
}
