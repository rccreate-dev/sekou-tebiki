/**
 * HandlersExample.gs — 事例の登録・編集・削除・復元・完全削除(SPEC §5.3)と、メディアの取得(§5.2)。
 */

/* ---------- メディアの取得 ---------- */

function handleGetThumbs_(ctx, p) {
  var items = {};
  var seen = {};
  p.ids.forEach(function (id) {
    if (typeof id !== 'string') fail_('BAD_REQUEST', 'ids は文字列の配列です。');
    if (!ID_RE.media.test(id)) fail_('VALIDATION_FAILED', 'メディアIDの形式が正しくありません。', 'ids');
    if (seen[id]) return;
    seen[id] = true;
    var b64 = Media.readBase64(Media.thumbName(id));
    if (b64 !== null) items[id] = { data: b64, mime: 'image/jpeg' };
  });
  return { items: items };
}

function handleGetPart_(ctx, p) {
  // 画像は <id>.jpg(index 0 のみ)、動画は <id>_p<index>
  var b64 = null, mime = 'application/octet-stream';
  if (p.index === 0) {
    b64 = Media.readBase64(Media.mainName(p.id));
    if (b64 !== null) mime = 'image/jpeg';
  }
  if (b64 === null) b64 = Media.readBase64(Media.partName(p.id, p.index));
  if (b64 === null) fail_('NOT_FOUND', '写真・動画が見つかりません。');
  return { data: b64, mime: mime };
}

/* ---------- アップロード(ロックなし。認証と権限は dispatcher が毎回確認) ---------- */

function handleUploadPart_(ctx, p) {
  var isImage = p.kind === 'image';
  if (isImage ? p.mime !== 'image/jpeg' : (p.mime !== 'video/mp4' && p.mime !== 'video/webm')) {
    fail_('VALIDATION_FAILED', isImage ? '画像は image/jpeg だけです。' : '動画は video/mp4 か video/webm だけです。', 'mime');
  }
  if (isImage && p.total !== 1) fail_('VALIDATION_FAILED', '画像の total は 1 です。', 'total');
  if (p.index >= p.total) fail_('VALIDATION_FAILED', 'index は total 未満にしてください。', 'index');
  if (p.index === 0 && !p.thumb) fail_('VALIDATION_FAILED', '最初の片にはサムネイルが必要です。', 'thumb');

  var maxRaw = isImage ? LIMITS.IMAGE_MAX : LIMITS.VIDEO_PART_MAX;
  var maxB64 = isImage ? Math.ceil(LIMITS.IMAGE_MAX / 3) * 4 : LIMITS.VIDEO_PART_B64_MAX;
  if (p.data.length > maxB64) fail_('TOO_LARGE', isImage ? '写真が大きすぎます(2.8MBまで)。' : '動画の1片が大きすぎます(3MBまで)。');
  if (!Util.isB64(p.data) || p.data.length === 0) fail_('VALIDATION_FAILED', 'data がbase64として正しくありません。', 'data');
  var raw = Util.b64RawLen(p.data);
  if (raw > maxRaw) fail_('TOO_LARGE', isImage ? '写真が大きすぎます(2.8MBまで)。' : '動画の1片が大きすぎます(3MBまで)。');
  if (raw === 0) fail_('VALIDATION_FAILED', 'data が空です。', 'data');
  if (p.bytes !== raw) fail_('VALIDATION_FAILED', 'bytes がデータの大きさと合いません。', 'bytes');
  if (isImage && !isJpegB64_(p.data)) fail_('VALIDATION_FAILED', 'JPEG画像ではありません。', 'data');

  var thumbBytes = null;
  if (p.index === 0) {
    if (p.thumb.length > Math.ceil(LIMITS.THUMB_MAX / 3) * 4) fail_('TOO_LARGE', 'サムネイルが大きすぎます(220KBまで)。');
    if (!Util.isB64(p.thumb) || p.thumb.length === 0) fail_('VALIDATION_FAILED', 'thumb がbase64として正しくありません。', 'thumb');
    if (Util.b64RawLen(p.thumb) > LIMITS.THUMB_MAX) fail_('TOO_LARGE', 'サムネイルが大きすぎます(220KBまで)。');
    if (!isJpegB64_(p.thumb)) fail_('VALIDATION_FAILED', 'サムネイルがJPEGではありません。', 'thumb');
    thumbBytes = p.thumb;
  }

  var bodyName = isImage ? Media.mainName(p.mediaId) : Media.partName(p.mediaId, p.index);

  // 動画全体の上限(20MB): 超えうるときだけ、ほかの片の大きさを実際に足して確かめる
  if (!isImage && raw + (p.total - 1) * LIMITS.VIDEO_PART_MAX > LIMITS.VIDEO_TOTAL_MAX) {
    var sum = raw;
    for (var i = 0; i < p.total; i++) {
      if (i === p.index) continue;
      var s = Media.size(Media.partName(p.mediaId, i));
      if (s > 0) sum += s;
    }
    if (sum > LIMITS.VIDEO_TOTAL_MAX) fail_('TOO_LARGE', '動画が大きすぎます(全体で20MBまで)。');
  }

  // 冪等: すでにあれば作り直さず成功(内容比較はしない)
  if (!Media.exists(bodyName)) Media.put(bodyName, Utilities.base64Decode(p.data), isImage ? 'image/jpeg' : 'application/octet-stream');
  if (thumbBytes !== null && !Media.exists(Media.thumbName(p.mediaId))) {
    Media.put(Media.thumbName(p.mediaId), Utilities.base64Decode(thumbBytes), 'image/jpeg');
  }
  return { stored: true };
}

/** base64の先頭が JPEG(FF D8)か */
function isJpegB64_(s) {
  var head = Utilities.base64Decode(s.slice(0, 4)); // 先頭3バイト
  return head.length >= 2 && (head[0] & 0xff) === 0xff && (head[1] & 0xff) === 0xd8;
}

/* ---------- 事例の保存 ---------- */

/** media 配列の検査・正規化。ファイルの存在確認はしない */
function normalizeMedia_(list) {
  var out = [];
  var seen = {};
  list.forEach(function (m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) fail_('VALIDATION_FAILED', 'メディアの形式が正しくありません。', 'media');
    Object.keys(m).forEach(function (k) {
      if (['id', 'type', 'mime', 'parts', 'bytes'].indexOf(k) < 0) fail_('VALIDATION_FAILED', 'メディアに不明な項目があります: ' + k, 'media');
    });
    if (typeof m.id !== 'string' || !ID_RE.media.test(m.id)) fail_('VALIDATION_FAILED', 'メディアIDの形式が正しくありません。', 'media');
    if (seen[m.id]) fail_('VALIDATION_FAILED', '同じメディアが重複しています。', 'media');
    seen[m.id] = true;
    if (m.type !== 'image' && m.type !== 'video') fail_('VALIDATION_FAILED', 'メディアの種類が正しくありません。', 'media');
    if (m.type === 'image' && m.mime !== 'image/jpeg') fail_('VALIDATION_FAILED', '画像の mime が正しくありません。', 'media');
    if (m.type === 'video' && m.mime !== 'video/mp4' && m.mime !== 'video/webm') fail_('VALIDATION_FAILED', '動画の mime が正しくありません。', 'media');
    if (!Util.isInt(m.parts) || (m.type === 'image' ? m.parts !== 1 : (m.parts < 1 || m.parts > LIMITS.VIDEO_PARTS_MAX))) {
      fail_('VALIDATION_FAILED', 'メディアの parts が正しくありません。', 'media');
    }
    var maxBytes = m.type === 'image' ? LIMITS.IMAGE_MAX : LIMITS.VIDEO_TOTAL_MAX;
    if (!Util.isInt(m.bytes) || m.bytes < 0 || m.bytes > maxBytes) fail_('VALIDATION_FAILED', 'メディアの bytes が正しくありません。', 'media');
    out.push({ id: m.id, type: m.type, mime: m.mime, parts: m.parts, bytes: m.bytes });
  });
  return out;
}

function handleSaveExample_(ctx, p) {
  var existing = Repo.find('examples', p.id);
  if (existing) {
    if (existing.hidden) fail_('NOT_FOUND', '事例が見つかりません。');
    if (existing.by !== ctx.dev && ctx.role !== 'admin') fail_('FORBIDDEN', '他の人の事例は編集できません。');
  }
  if (!Repo.find('items', p.itemId)) fail_('VALIDATION_FAILED', '項目が見つかりません。', 'itemId');
  var media = normalizeMedia_(p.media || []);
  media.forEach(function (m) {
    if (!Media.complete(m)) {
      fail_('VALIDATION_FAILED', '写真・動画のファイルが見つかりません(アップロードが終わっていません)。', 'media');
    }
  });
  var rec = {
    itemId: p.itemId, kind: p.kind, title: p.title, reason: p.reason || '', severity: p.severity || '', timing: p.timing || '',
    criteria: p.criteria || '', refNo: p.refNo || '', media: JSON.stringify(media)
  };
  var now = Util.nowMs();
  if (!existing) {
    var row = Object.assign({ id: p.id, by: ctx.dev, at: now, updatedAt: now, hidden: false, hiddenAt: 0 }, rec);
    Repo.append('examples', row);
    Repo.bumpRev();
    return { example: exampleJson_(row) };
  }
  var changed = Object.keys(rec).some(function (k) { return existing[k] !== rec[k]; });
  if (!changed) return { example: exampleJson_(existing) }; // 同じ内容の再送: 何もしない
  rec.updatedAt = now;
  Repo.update('examples', existing, rec);
  Repo.bumpRev();
  return { example: exampleJson_(Object.assign({}, existing, rec)) };
}

function handleDeleteExample_(ctx, p) {
  var r = Repo.find('examples', p.id);
  if (!r) fail_('NOT_FOUND', '事例が見つかりません。');
  if (r.by !== ctx.dev && ctx.role !== 'admin') fail_('FORBIDDEN', '他の人の事例は削除できません。');
  if (!r.hidden) {
    Repo.update('examples', r, { hidden: true, hiddenAt: Util.nowMs() });
    Repo.bumpRev();
  }
  return {};
}

function handleRestoreExample_(ctx, p) {
  var r = Repo.find('examples', p.id);
  if (!r) fail_('NOT_FOUND', '事例が見つかりません。');
  if (r.hidden) {
    Repo.update('examples', r, { hidden: false, hiddenAt: 0 });
    Repo.bumpRev();
  }
  return {};
}

function handlePurgeExample_(ctx, p) {
  var r = Repo.find('examples', p.id);
  if (!r) fail_('NOT_FOUND', '事例が見つかりません。');
  if (!r.hidden) fail_('VALIDATION_FAILED', '完全に削除できるのは、ごみ箱に入っている事例だけです。', 'id');
  Repo.remove('examples', r);
  Repo.bumpRev();
  // ほかの事例が使っていないメディアだけ、ファイルをゴミ箱へ
  var used = {};
  Repo.all('examples').forEach(function (e) { parseMedia_(e.media).forEach(function (m) { used[m.id] = true; }); });
  parseMedia_(r.media).forEach(function (m) { if (!used[m.id]) Media.trashMedia(m.id); });
  return {};
}
