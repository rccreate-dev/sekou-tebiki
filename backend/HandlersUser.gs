/**
 * HandlersUser.gs — 申請・状態・bootstrap・利用者管理・承認メール(SPEC §5.1, §5.2, §5.5)。
 */

/* ---------- 申請・状態 ---------- */

function handleApply_(ctx, p) {
  if (ctx.user) return { status: ctx.status || 'pending' }; // 登録済み: 何もせず現在の状態(鍵は認証済み)
  var row = {
    id: ctx.dev, appliedAt: Util.nowMs(), name: p.name, company: p.company || '',
    role: ROLE_TO_JA.viewer, status: STATUS_TO_JA.pending, decidedAt: 0, keyHash: Auth.keyHash(ctx.key), lastUsedAt: 0
  };
  Repo.append('users', row);
  Repo.bumpRev(); // 管理者の利用者一覧が変わるため(§3.7の拡張解釈。報告参照)
  AFTER_LOCK_.push(function () { notifyApplication_(row); });
  return { status: 'pending' };
}

function handleStatus_(ctx) {
  if (!ctx.user) return { status: 'none' };
  var d = { status: ctx.status, name: ctx.user.name };
  if (ctx.status === 'approved' && ctx.role) d.role = ctx.role;
  return d;
}

/* ---------- bootstrap ---------- */

function exampleJson_(r) {
  return {
    id: r.id, itemId: r.itemId, kind: r.kind, title: r.title, reason: r.reason, severity: r.severity,
    timing: r.timing, criteria: r.criteria, refNo: r.refNo, media: parseMedia_(r.media),
    by: r.by, at: r.at, updatedAt: r.updatedAt, hidden: !!r.hidden, hiddenAt: r.hiddenAt || 0
  };
}

function sortByOrder_(a, b) {
  return a.order !== b.order ? a.order - b.order : (a.id < b.id ? -1 : 1);
}

/** 最終利用の更新(10分に1回まで)。bootstrap を止めないよう、ロックが取れなければ諦める */
function touchLastUsed_(user) {
  var now = Util.nowMs();
  if (user.lastUsedAt && now - user.lastUsedAt < LIMITS.LAST_USED_INTERVAL_MS) return;
  var lock = LockService.getScriptLock();
  var got = false;
  try {
    got = lock.tryLock(1000);
    if (!got) return;
    Repo.reset();
    var fresh = Repo.find('users', user.id);
    if (fresh) Repo.update('users', fresh, { lastUsedAt: now });
  } catch (e) {
    console.error('touchLastUsed failed: ' + (e && e.message));
  } finally {
    if (got) lock.releaseLock();
    Repo.reset();
  }
}

function handleBootstrap_(ctx, p) {
  var rev = Repo.rev(); // データより先に読む(読んだ後に更新されても、クライアントは次回に取り直せる)
  touchLastUsed_(ctx.user);
  if (p.since !== undefined && p.since === rev) return { unchanged: true, rev: rev };
  var isAdmin = ctx.role === 'admin';
  var users = Repo.all('users');
  var nameById = {};
  users.forEach(function (u) { nameById[u.id] = u.name; });
  var examples = Repo.all('examples').filter(function (r) { return isAdmin || !r.hidden; }).map(exampleJson_);
  var names = {};
  names[ctx.dev] = ctx.user.name;
  examples.forEach(function (ex) { if (nameById[ex.by] !== undefined) names[ex.by] = nameById[ex.by]; });
  var data = {
    rev: rev,
    me: { id: ctx.dev, name: ctx.user.name, role: ctx.role },
    groups: Repo.all('groups').map(function (g) { return { id: g.id, name: g.name, order: g.order }; }).sort(sortByOrder_),
    items: Repo.all('items').map(function (i) { return { id: i.id, groupId: i.groupId, name: i.name, order: i.order }; }).sort(sortByOrder_),
    examples: examples,
    names: names
  };
  if (isAdmin) {
    data.users = users.map(function (u) {
      return {
        id: u.id, name: u.name, company: u.company, role: ROLE_FROM_JA[u.role] || '', status: STATUS_FROM_JA[u.status] || '',
        appliedAt: u.appliedAt, lastUsedAt: u.lastUsedAt
      };
    });
  }
  return data;
}

/* ---------- 利用者の管理(admin) ---------- */

function isApprovedAdmin_(roleJa, statusJa) {
  return roleJa === ROLE_TO_JA.admin && statusJa === STATUS_TO_JA.approved;
}

function handleSetUser_(ctx, p) {
  if (p.role === undefined && p.status === undefined) fail_('BAD_REQUEST', 'role か status を指定してください。');
  var target = Repo.find('users', p.id);
  if (!target) fail_('NOT_FOUND', '利用者が見つかりません。');
  if (p.id === ctx.dev) {
    if (p.role !== undefined && p.role !== 'admin') fail_('FORBIDDEN', '自分自身の管理権限は外せません。');
    if (p.status === 'rejected') fail_('FORBIDDEN', '自分自身を却下することはできません。');
  }
  var newRole = p.role !== undefined ? ROLE_TO_JA[p.role] : target.role;
  var newStatus = p.status !== undefined ? STATUS_TO_JA[p.status] : target.status;
  if (isApprovedAdmin_(target.role, target.status) && !isApprovedAdmin_(newRole, newStatus)) {
    var others = Repo.all('users').filter(function (u) { return u.id !== target.id && isApprovedAdmin_(u.role, u.status); });
    if (!others.length) fail_('FORBIDDEN', '管理者がいなくなるため、この変更はできません。');
  }
  var patch = {};
  if (newRole !== target.role) patch.role = newRole;
  if (newStatus !== target.status) {
    patch.status = newStatus;
    patch.decidedAt = p.status === 'pending' ? 0 : Util.nowMs();
  }
  if (Object.keys(patch).length) {
    Repo.update('users', target, patch);
    Repo.bumpRev();
  }
  return {};
}

/* ---------- 承認メール(decide は確認ページだけ。commit で初めて決定) ---------- */

function mailEnabled_() {
  var v = String(Repo.getSetting('mailEnabled', 'TRUE')).toUpperCase();
  return v !== 'FALSE' && v !== '0' && v !== 'NO';
}

/** 6時間に20通まで(固定の窓)。窓の状態は CacheService に置く(消えたら数え直し) */
function mailBudgetOk_() {
  var cache = CacheService.getScriptCache();
  var now = Util.nowMs();
  var st = { s: now, n: 0 };
  try {
    var raw = cache.get('mailWin');
    if (raw) {
      var o = JSON.parse(raw);
      if (o && typeof o.s === 'number' && now - o.s < LIMITS.MAIL_WINDOW_MS) st = o;
    }
  } catch (e) { /* 数え直し */ }
  if (st.n >= LIMITS.MAIL_MAX) return false;
  st.n++;
  try { cache.put('mailWin', JSON.stringify(st), 21600); } catch (e2) { /* 無視 */ }
  return true;
}

function decideUrl_(action, d, id) {
  return ScriptApp.getService().getUrl() + '?action=' + action + '&d=' + d + '&id=' + encodeURIComponent(id) + '&sig=' + Auth.sign(id, d);
}

function notifyApplication_(user) {
  if (!mailEnabled_() || !mailBudgetOk_()) return;
  var to = Session.getEffectiveUser().getEmail();
  if (!to) return;
  var ok = decideUrl_('decide', 'approve', user.id);
  var ng = decideUrl_('decide', 'reject', user.id);
  var who = user.name + (user.company ? '(' + user.company + ')' : '');
  var body = '施工手引きの利用申請が届きました。\n\n氏名: ' + user.name + '\n会社名: ' + (user.company || '(未入力)') + '\n\n' +
    '承認する: ' + ok + '\n却下する: ' + ng + '\n\n' +
    'リンクを開くと確認ページが出ます。そこでボタンを押すと決まります。心当たりのない申請は「却下する」を選んでください。\n' +
    'あとからスプレッドシートの「状態」「区分」欄でも変えられます。';
  var html = '<p>施工手引きの利用申請が届きました。</p>' +
    '<p>氏名: <b>' + Util.esc(user.name) + '</b><br>会社名: <b>' + Util.esc(user.company || '(未入力)') + '</b></p>' +
    '<p><a href="' + Util.esc(ok) + '" style="display:inline-block;padding:12px 20px;background:#166534;color:#fff;text-decoration:none;border-radius:8px">承認する</a>　' +
    '<a href="' + Util.esc(ng) + '" style="display:inline-block;padding:12px 20px;background:#b91c1c;color:#fff;text-decoration:none;border-radius:8px">却下する</a></p>' +
    '<p style="color:#666">リンクを開くと確認ページが出ます。そこでボタンを押すと決まります。</p>';
  MailApp.sendEmail({ to: to, subject: '【施工手引き】利用申請: ' + who, body: body, htmlBody: html });
}

function page_(inner) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>施工手引き</title></head><body style="font-family:sans-serif;padding:32px;font-size:18px">' + inner + '</body></html>'
  );
}

/** id / d / sig を検査して { d, id } を返す。不正なら null */
function verifyDecision_(p) {
  var d = p.d === 'approve' ? 'approve' : p.d === 'reject' ? 'reject' : '';
  if (!d || typeof p.id !== 'string' || !Auth.DEV_RE.test(p.id) || typeof p.sig !== 'string') return null;
  if (!Util.safeEq(p.sig, Auth.sign(p.id, d))) return null;
  return { d: d, id: p.id };
}

/** 確認ページを出すだけ。ここでは何も変更しない(メールの自動プレビューで決まらないように) */
function decidePage_(p) {
  var v = verifyDecision_(p);
  if (!v) return page_('このリンクは無効です。');
  Repo.reset();
  var u = Repo.find('users', v.id);
  if (!u) return page_('申請が見つかりません。');
  var label = v.d === 'approve' ? '承認' : '却下';
  var url = decideUrl_('commit', v.d, v.id);
  return page_(
    '<p>' + Util.esc(u.name) + ' さん(' + Util.esc(u.company || '会社名なし') + ')を<b>' + label + '</b>しますか?</p>' +
    '<p><a id="go" target="_top" href="' + Util.esc(url) + '" style="display:inline-block;font-size:20px;padding:14px 28px;border-radius:10px;color:#fff;text-decoration:none;background:' +
    (v.d === 'approve' ? '#166534' : '#b91c1c') + '">' + label + 'する</a></p>'
  );
}

/** 決定。申請中の人にだけ効く(古いリンクで、すでに決めた人の状態が変わらないように) */
function commitPage_(p) {
  var v = verifyDecision_(p);
  if (!v) return page_('このリンクは無効です。');
  var msg = withLock_(function () {
    var u = Repo.find('users', v.id);
    if (!u) return '申請が見つかりません。';
    var cur = STATUS_FROM_JA[u.status] || '';
    var want = v.d === 'approve' ? 'approved' : 'rejected';
    if (cur === want) return Util.esc(u.name) + ' さんは、すでに「' + u.status + '」です。';
    if (cur !== 'pending') return Util.esc(u.name) + ' さんはすでに「' + u.status + '」に決まっています。変更はアプリの管理画面かスプレッドシートで行ってください。';
    Repo.update('users', u, { status: STATUS_TO_JA[want], decidedAt: Util.nowMs() });
    Repo.bumpRev();
    return Util.esc(u.name) + ' さんを「' + STATUS_TO_JA[want] + '」にしました。';
  });
  return page_(msg);
}
