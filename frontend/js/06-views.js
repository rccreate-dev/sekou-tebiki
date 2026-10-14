'use strict';
/* ===== 画面の描画 ===== */
const itemById = id => D('items').find(i => i.id === id);
const groupOf = it => D('groups').find(g => g.id === it.groupId);
const nameOf = id => (id && S.names[id]) || '';
const exportText = ex => [ex.title, ex.reason, ex.criteria, ex.refNo].join(' ');
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

function render() {
  const app = $('#app');
  if (!app) return;
  const keepY = window.scrollY;
  const r = S.route, m = mode();
  let html = '', title = '施工手引き', sub = '型枠工事　この場合はこう施工する', back = false, add = false, search = false, gear = true;
  if (S.gate !== 'ok' || !S.hasData) {
    gear = false;
    html = gateView();
  } else if (r.n === 'item') {
    const it = itemById(r.id);
    if (!it) { html = '<div class="empty"><b>この項目は見つかりません</b>削除されたか、移動した可能性があります。</div>'; back = true; }
    else { title = it.name; sub = (groupOf(it) || {}).name || ''; back = true; add = canPost(); html = banner(m) + itemView(it); }
  } else if (r.n === 'settings') { title = '設定'; sub = VERSION; back = true; html = settingsView(); }
  else if (r.n === 'trash') { title = 'ごみ箱'; sub = '削除した事例'; back = true; html = trashView(); }
  else if (r.n === 'users') { title = '利用者の管理'; sub = '承認・区分の変更'; back = true; html = usersView(); }
  else if (r.n === 'diag') { title = '動作診断'; sub = 'うまく動かないときに使います'; back = true; html = diagView(); }
  else { search = true; html = banner(m) + (S.q.trim() ? searchView() : homeView()); }

  app.innerHTML = html;
  $('#title').textContent = title;
  $('#sub').textContent = sub;
  $('#back').hidden = !back;
  $('#gear').hidden = !gear;
  $('#searchrow').hidden = !search;
  $('#addbar').hidden = !add;
  const role = $('#role');
  const showRole = gear && (m === 'cached' || !canPost());
  role.hidden = !showRole;
  role.textContent = m === 'cached' ? 'オフライン' : '閲覧のみ';
  document.title = title === '施工手引き' ? title : title + ' - 施工手引き';
  Media.hydrate(app);
  if (window.scrollY !== keepY) window.scrollTo(0, keepY);
}

function banner(m) {
  if (m !== 'cached') return '';
  return '<p class="hint warn">電波が届いていないため、保存してある内容を表示しています。' + (S.lastSync ? '（最終更新 ' + fmtDate(S.lastSync) + '）' : '') + '電波が戻ると自動で最新になります。</p>';
}

/* ---------- 使い始め(申請・承認待ち) ---------- */
function gateView() {
  const g = S.gate;
  if (g === 'boot') return '<div class="empty">読み込み中…</div>';
  if (g === 'offline') return '<div class="gate"><h1>つながりません</h1><p>電波が届いていません。電波のある場所で、もう一度開いてください。</p><button class="btn primary" type="button" data-act="retry">もう一度つなぐ</button></div>';
  if (g === 'apply') return '<div class="gate"><h1>利用の申請</h1><p>RCCREATE 社内の方だけが使えるアプリです。氏名と会社名を入れて申請してください。管理者が承認すると、この端末で使えるようになります。</p>' +
    '<label class="fl" for="ap-name">氏名（必須）</label><input class="field" id="ap-name" maxlength="40" autocomplete="name" placeholder="例：細野 功介">' +
    '<label class="fl" for="ap-co">会社名</label><input class="field" id="ap-co" maxlength="60" value="株式会社RCCREATE" autocomplete="organization">' +
    '<p class="msg" id="ap-msg" role="status">' + esc(S.gateMsg) + '</p><button class="btn primary" type="button" data-act="apply">申請する</button></div>';
  if (g === 'pending') return '<div class="gate"><h1>承認を待っています</h1><p>申請を受け付けました。管理者が承認すると、自動でアプリが開きます。このまま画面を開いておくか、あとでもう一度開いてください。</p><button class="btn" type="button" data-act="check">承認されたか確認する</button></div>';
  if (g === 'rejected') return '<div class="gate"><h1>承認されていません</h1><p>この端末は利用を承認されていません。心当たりがある場合は、管理者に連絡してください。</p><button class="btn" type="button" data-act="check">もう一度確認する</button></div>';
  if (g === 'unauth') return '<div class="gate"><h1>端末の登録を確認できません</h1><p>この端末の登録情報が確認できませんでした。登録し直して、もう一度申請してください。</p><button class="btn primary" type="button" data-act="reregister">登録し直す</button></div>';
  return '<div class="empty">読み込み中…</div>';
}

function chipCounts(c) {
  c = c || { good: 0, bad: 0 };
  if (!c.good && !c.bad) return '<span class="chip none">事例なし</span>';
  return (c.good ? '<span class="chip good">○ ' + c.good + '</span>' : '') + (c.bad ? '<span class="chip bad">× ' + c.bad + '</span>' : '');
}

function installHint() {
  if (isStandalone() || Prefs.d.hintClosed) return '';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return '<div class="hint"><b>ホーム画面に追加すると、アプリのように使えます。</b><br>' +
    (ios ? 'Safari の共有ボタン（四角に上向き矢印）→「ホーム画面に追加」。追加しないと、しばらく使わないときに登録が消えることがあります。' : 'ブラウザのメニュー（︙）→「ホーム画面に追加」または「アプリをインストール」。') +
    '<div class="line"><button class="btn sm" type="button" data-act="hint-close">閉じる</button></div></div>';
}

/* ---------- ホーム ---------- */
function homeView() {
  const groups = D('groups').slice().sort(byOrder), items = D('items'), cnt = counts(), ed = S.editing && canStruct();
  let h = installHint();
  const pend = isAdmin() && S.users ? S.users.filter(u => u.status === 'pending').length : 0;
  if (pend) h += '<button class="btn" type="button" data-act="goto" data-v="users" style="width:100%;margin-bottom:14px">利用申請が' + pend + '件、承認待ちです</button>';
  if (canStruct()) h += '<div class="sum"><span>' + (ed ? '構成を編集中' : '') + '</span><button class="btn sm" type="button" data-act="edit-toggle" aria-pressed="' + ed + '">' + (ed ? '編集を終える' : '構成を編集') + '</button></div>';
  if (!ed) {
    const rec = visibleExamples().slice().sort((a, b) => stamp(b) - stamp(a)).slice(0, 4);
    if (rec.length) {
      h += '<h2 class="sec-t">最近の更新</h2><div class="grp recent"><ul class="rows">' + rec.map(e => {
        const it = itemById(e.itemId);
        if (!it) return '';
        return '<li><button class="row" type="button" data-act="open" data-id="' + esc(it.id) + '"><span class="row-name">' +
          '<span class="chip ' + (e.kind === 'bad' ? 'bad' : 'good') + '">' + (e.kind === 'bad' ? '× 悪い例' : '○ 良い例') + '</span> ' + esc(e.title) +
          '<span class="row-sub">' + esc(it.name) + '　' + fmtDate(stamp(e)) + '</span></span><span class="chev" aria-hidden="true">›</span></button></li>';
      }).join('') + '</ul></div>';
    } else if (!visibleExamples().length) {
      h += '<div class="empty" style="margin-bottom:16px"><b>まだ事例がありません</b>' + (canPost() ? '項目を開いて、「この項目に例を追加」から写真と理由を登録してください。' : '事例が追加されると、ここに表示されます。') + '</div>';
    }
  }
  if (!groups.length) h += '<div class="empty"><b>まだグループがありません</b>' + (canStruct() ? '「構成を編集」からグループを追加してください。' : '管理者がグループを追加すると、ここに表示されます。') + '</div>';
  groups.forEach(g => {
    const its = items.filter(i => i.groupId === g.id).sort(byOrder);
    const gOpen = S.openRow === 'g:' + g.id;
    h += '<section class="grp" aria-label="' + esc(g.name) + '"><div class="grp-head"><h2>' + esc(g.name) + '</h2><span class="n">' + its.length + '項目</span>';
    if (ed) h += '<button class="btn sm" type="button" data-act="row-toggle" data-key="g:' + esc(g.id) + '" aria-expanded="' + gOpen + '">' + (gOpen ? '閉じる' : '編集') + '</button>';
    h += '</div>';
    if (ed && gOpen) h += structPanel('g', g, groups, null);
    if (!its.length) h += '<p class="empty" style="border:0;margin:0">項目がありません</p>';
    else h += '<ul class="rows">' + its.map(it => {
      const c = cnt[it.id], open = S.openRow === 'i:' + it.id;
      let li = '<li>';
      if (ed) li += '<button class="row" type="button" data-act="row-toggle" data-key="i:' + esc(it.id) + '" aria-expanded="' + open + '"><span class="row-name">' + esc(it.name) + '</span><span class="chips">' + chipCounts(c) + '</span><span class="chev" aria-hidden="true">' + (open ? '▾' : '✎') + '</span></button>';
      else li += '<button class="row" type="button" data-act="open" data-id="' + esc(it.id) + '"><span class="row-name">' + esc(it.name) + '</span><span class="chips">' + chipCounts(c) + '</span><span class="chev" aria-hidden="true">›</span></button>';
      if (ed && open) li += structPanel('i', it, its, groups);
      return li + '</li>';
    }).join('') + '</ul>';
    if (ed) h += '<div class="inline"><input class="field" id="ni-' + esc(g.id) + '" maxlength="40" placeholder="項目を追加（例：壁の建込）" aria-label="' + esc(g.name) + 'に項目を追加"><button class="btn" type="button" data-act="add-item" data-id="' + esc(g.id) + '">追加</button></div>';
    h += '</section>';
  });
  if (ed) h += '<div class="grp"><div class="inline" style="border-top:0"><input class="field" id="ng" maxlength="30" placeholder="グループを追加（例：配筋確認）" aria-label="グループを追加"><button class="btn" type="button" data-act="add-group">追加</button></div></div>';
  return h;
}

/* グループ・項目の編集パネル: 名前変更、並び替え、(項目のみ)グループ移動、削除 */
function structPanel(kind, o, siblings, groups) {
  const idx = siblings.findIndex(x => x.id === o.id);
  const askDel = S.confirm === 'del-' + kind + ':' + o.id;
  let h = '<div class="epanel"><label for="rn-' + esc(o.id) + '">名前</label><div class="line"><input class="field" id="rn-' + esc(o.id) + '" maxlength="40" value="' + esc(o.name) + '"><button class="btn" type="button" data-act="rename" data-kind="' + kind + '" data-id="' + esc(o.id) + '">名前を変更</button></div>';
  h += '<div class="line"><button class="btn sm" type="button" data-act="mv" data-kind="' + kind + '" data-id="' + esc(o.id) + '" data-dir="-1"' + (idx <= 0 ? ' disabled' : '') + '>↑ 上へ</button><button class="btn sm" type="button" data-act="mv" data-kind="' + kind + '" data-id="' + esc(o.id) + '" data-dir="1"' + (idx >= siblings.length - 1 ? ' disabled' : '') + '>↓ 下へ</button></div>';
  if (kind === 'i' && groups.length > 1) {
    h += '<label for="mg-' + esc(o.id) + '">グループを移動</label><div class="line"><select class="field" id="mg-' + esc(o.id) + '">' + D('groups').slice().sort(byOrder).map(g => '<option value="' + esc(g.id) + '"' + (g.id === o.groupId ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') + '</select><button class="btn" type="button" data-act="mv-group" data-id="' + esc(o.id) + '">移動する</button></div>';
  }
  if (askDel) h += '<div class="discard"><p>「' + esc(o.name) + '」を削除します。' + (kind === 'g' ? '項目が残っているグループは削除できません。' : '事例が残っている項目は削除できません。') + '</p><div class="line"><button class="btn" type="button" data-act="no">やめる</button><button class="btn danger solid" type="button" data-act="del-' + kind + '-yes" data-id="' + esc(o.id) + '">削除する</button></div></div>';
  else h += '<div class="line"><button class="btn danger sm" type="button" data-act="del-' + kind + '-ask" data-id="' + esc(o.id) + '">この' + (kind === 'g' ? 'グループ' : '項目') + 'を削除</button></div>';
  return h + '</div>';
}

/* ---------- 検索 ---------- */
function searchView() {
  const match = makeMatcher(S.q);
  const groups = D('groups'), items = D('items');
  const gname = id => (groups.find(g => g.id === id) || {}).name || '';
  const hitItems = items.filter(i => match(i.name + ' ' + gname(i.groupId))).sort(byOrder);
  const hitEx = visibleExamples().filter(e => { const it = itemById(e.itemId); return it && match(exportText(e) + ' ' + it.name); }).sort((a, b) => stamp(b) - stamp(a));
  if (!hitItems.length && !hitEx.length) return '<div class="empty"><b>見つかりませんでした</b>別の言葉で探すか、項目の一覧から選んでください。</div>';
  let h = '';
  if (hitItems.length) h += '<h2 class="sec-t">項目</h2><div class="grp"><ul class="rows">' + hitItems.map(it => '<li><button class="row" type="button" data-act="open" data-id="' + esc(it.id) + '"><span class="row-name">' + esc(it.name) + '<span class="row-sub">' + esc(gname(it.groupId)) + '</span></span><span class="chips">' + chipCounts(counts()[it.id]) + '</span><span class="chev" aria-hidden="true">›</span></button></li>').join('') + '</ul></div>';
  if (hitEx.length) h += '<h2 class="sec-t">事例</h2><div class="grp"><ul class="rows">' + hitEx.slice(0, 30).map(e => {
    const it = itemById(e.itemId);
    return '<li><button class="row" type="button" data-act="open" data-id="' + esc(it.id) + '"><span class="row-name"><span class="chip ' + (e.kind === 'bad' ? 'bad' : 'good') + '">' + (e.kind === 'bad' ? '× 悪い例' : '○ 良い例') + '</span> ' + esc(e.title) + '<span class="row-sub">' + esc(it.name) + '</span></span><span class="chev" aria-hidden="true">›</span></button></li>';
  }).join('') + '</ul></div>';
  return h;
}

/* ---------- 項目ページ ---------- */
function sortList(list) {
  const l = list.slice(), sev = e => ({ A: 0, B: 1, C: 2 })[e.severity] ?? 3;
  if (S.sort === 'sev') l.sort((a, b) => sev(a) - sev(b) || stamp(b) - stamp(a));
  else if (S.sort === 'bad') l.sort((a, b) => (a.kind === 'bad' ? 0 : 1) - (b.kind === 'bad' ? 0 : 1) || stamp(b) - stamp(a));
  else l.sort((a, b) => stamp(b) - stamp(a));
  return l;
}
function itemView(it) {
  const all = visibleExamples().filter(e => e.itemId === it.id);
  const g = all.filter(e => e.kind !== 'bad').length, b = all.length - g;
  const f = S.filter;
  const list = sortList(all.filter(e => f === 'all' || (f === 'bad' ? e.kind === 'bad' : e.kind !== 'bad')));
  let h = '<div class="seg" role="group" aria-label="絞り込み">' +
    [['all', 'すべて ' + all.length], ['good', '○ 良い例 ' + g], ['bad', '× 悪い例 ' + b]].map(x => '<button class="btn" type="button" data-act="filter" data-v="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + '</button>').join('') + '</div>';
  h += '<div class="tools"><label for="sort">並び順</label><select id="sort" data-chg="sort">' + [['new', '新しい順'], ['sev', '重要度順'], ['bad', '× 悪い例を先に']].map(x => '<option value="' + x[0] + '"' + (S.sort === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select></div>';
  if (!list.length) {
    h += '<div class="empty"><b>' + (all.length ? 'この絞り込みに事例はありません' : 'まだ事例がありません') + '</b>' + (canPost() ? '下の「この項目に例を追加」から、写真と理由を登録してください。' : '事例が追加されると、ここに表示されます。') + '</div>';
  } else h += '<div class="cards">' + list.map(cardHtml).join('') + '</div>';
  return h;
}

function mediaHtml(e) {
  const ms = e.media || [];
  if (!ms.length) return '<div class="nomedia">写真・動画なし</div>';
  const imgs = ms.filter(m => m.type !== 'video');
  return '<div class="strip' + (ms.length > 1 ? ' multi' : '') + '">' + ms.map(m => {
    const src = Media.cachedThumb(m.id), sattr = src ? ' src="' + esc(src) + '"' : '';
    if (m.type === 'video') return '<div class="m vid"><button class="vplay" type="button" data-act="play" data-ex="' + esc(e.id) + '" data-mid="' + esc(m.id) + '" aria-label="動画を再生"><img data-mid="' + esc(m.id) + '"' + sattr + ' alt=""><span class="pbtn">▶ 動画を見る</span></button></div>';
    const k = imgs.findIndex(x => x.id === m.id);
    return '<button class="m" type="button" data-act="zoom" data-ex="' + esc(e.id) + '" data-i="' + k + '" aria-label="写真を拡大（' + (k + 1) + '枚目）"><img data-mid="' + esc(m.id) + '"' + sattr + ' alt="' + esc(e.title) + '"></button>';
  }).join('') + '</div>';
}

function cardHtml(e) {
  const bad = e.kind === 'bad';
  const who = nameOf(e.by);
  const metas = [];
  if (isNew(e)) metas.push('<span class="chip new">NEW</span>');
  if (e.severity === 'A') metas.push('<span class="chip bad">重要 A</span>');
  else if (e.severity === 'B') metas.push('<span class="chip warn">重要 B</span>');
  else if (e.severity === 'C') metas.push('<span class="chip">重要 C</span>');
  if (e.timing) metas.push('<span class="chip">' + esc(e.timing) + '</span>');
  if (e.refNo) metas.push('<span class="chip">' + esc(e.refNo) + '</span>');
  const askDel = S.confirm === 'del:' + e.id;
  let h = '<article class="ex ' + (bad ? 'bad' : 'good') + '"><div class="mwrap"><span class="badge ' + (bad ? 'bad' : 'good') + '">' + (bad ? '× 悪い例' : '○ 良い例') + '</span>' +
    ((e.media || []).length > 1 ? '<span class="cnt">' + e.media.length + '点</span>' : '') + mediaHtml(e) + '</div><div class="exb"><h3>' + esc(e.title) + '</h3>';
  if (metas.length) h += '<div class="meta">' + metas.join('') + '</div>';
  if (e.reason) h += '<p class="why"><b>' + (bad ? '悪い理由' : 'ポイント') + '</b>' + esc(e.reason) + '</p>';
  if (e.criteria) h += '<p class="crit"><b>確認基準</b>' + esc(e.criteria) + '</p>';
  h += '<div class="foot"><span>' + (who ? esc(who) + '　' : '') + fmtDate(e.at) + (e.updatedAt && e.updatedAt - (e.at || 0) > 60000 ? '（更新 ' + fmtDate(e.updatedAt) + '）' : '') + '</span>';
  if (canTouch(e)) h += '<span class="acts"><button class="link" type="button" data-act="edit-ex" data-id="' + esc(e.id) + '">編集</button><button class="link danger" type="button" data-act="del-ask" data-id="' + esc(e.id) + '">削除</button></span>';
  h += '</div>';
  if (askDel) h += '<div class="discard"><p>この事例を削除しますか？（管理者はごみ箱から元に戻せます）</p><div class="line"><button class="btn" type="button" data-act="no">やめる</button><button class="btn danger solid" type="button" data-act="del-yes" data-id="' + esc(e.id) + '">削除する</button></div></div>';
  return h + '</div></article>';
}

/* ---------- 設定 ---------- */
function settingsView() {
  const fs = Prefs.d.fs;
  let h = '<section class="setgrp"><h2>文字の大きさ</h2><div class="seg four" role="group" aria-label="文字の大きさ">' +
    [['s', '小'], ['m', '標準'], ['l', '大'], ['x', '特大']].map(x => '<button class="btn" type="button" data-act="fs" data-v="' + x[0] + '" aria-pressed="' + (fs === x[0]) + '">' + x[1] + '</button>').join('') + '</div><p>この端末だけの設定です。</p></section>';
  const who = S.me && S.me.name ? S.me.name + ' さん：' : '';
  h += '<section class="setgrp"><h2>あなたの権限</h2><p>' + esc(who) + (S.role === 'admin' ? '管理者。事例の追加・編集・削除、グループ・項目の編集、利用者の承認ができます。' : S.role === 'poster' ? '投稿者。事例の追加と、自分の事例の編集・削除ができます。' : '閲覧のみ。事例を見ることができます。投稿が必要な場合は管理者に連絡してください。') + '</p></section>';
  if (isAdmin()) {
    const nTrash = D('examples').filter(e => e.hidden).length, pend = S.users ? S.users.filter(u => u.status === 'pending').length : 0;
    h += '<section class="setgrp"><h2>管理</h2>' +
      '<button class="btn" type="button" data-act="goto" data-v="users">利用者の管理' + (pend ? '<span class="top-pending">' + pend + '</span>' : '') + '</button>' +
      '<button class="btn" type="button" data-act="goto" data-v="trash">ごみ箱を見る（' + nTrash + '件）</button>' +
      '<button class="btn" type="button" data-act="backup">文章データをJSONで保存（写真・動画は含みません）</button></section>';
  }
  h += '<section class="setgrp"><h2>端末のデータ</h2><p>見たことのある写真・動画は、通信を減らすためこの端末に保存されます。表示がおかしいときは、保存を消して読み込み直せます。</p><button class="btn" type="button" data-act="clear-cache">端末の保存を消して読み込み直す</button></section>';
  h += '<section class="setgrp"><h2>動作診断</h2><p>表示や保存がうまくいかないとき、結果を管理者に送ってください。</p><button class="btn" type="button" data-act="goto" data-v="diag">動作診断を開く</button></section>';
  h += '<section class="setgrp"><h2>このアプリについて</h2><p>' + esc(VERSION) + '　社内限定・社外秘の資料です。写真・画面を社外に出さないでください。</p></section>';
  return h;
}

/* ---------- 利用者の管理(管理者) ---------- */
function usersView() {
  if (!isAdmin()) return '<div class="empty"><b>管理者のみ</b>この画面は管理者だけが使えます。</div>';
  const us = (S.users || []).slice().sort((a, b) => ({ pending: 0, approved: 1, rejected: 2 })[a.status] - ({ pending: 0, approved: 1, rejected: 2 })[b.status] || String(a.name).localeCompare(String(b.name), 'ja'));
  if (!us.length) return '<div class="empty"><b>利用者がいません</b></div>';
  const stLabel = { pending: '承認待ち', approved: '承認済み', rejected: '却下' };
  return '<p class="hint">申請は、管理者へのメールの「承認する」からもできます。承認したあと、投稿してもらう人は区分を「投稿」にしてください。</p>' + us.map(u => {
    const self = u.id === S.meId;
    return '<div class="urow"><b>' + esc(u.name) + (self ? '（あなた）' : '') + '</b><span class="crumb">' + esc(u.company || '') + '　' + (stLabel[u.status] || u.status) + '　申請 ' + fmtDate(u.appliedAt) + '</span><div class="line">' +
      '<label class="sr" for="ur-' + esc(u.id) + '">区分</label><select id="ur-' + esc(u.id) + '" data-chg="user-role" data-id="' + esc(u.id) + '"' + (self ? ' disabled' : '') + '>' +
      ['viewer', 'poster', 'admin'].map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>').join('') + '</select>' +
      (u.status !== 'approved' ? '<button class="btn sm" type="button" data-act="user-approve" data-id="' + esc(u.id) + '">承認する</button>' : '') +
      (u.status !== 'rejected' && !self ? '<button class="btn danger sm" type="button" data-act="user-reject" data-id="' + esc(u.id) + '">却下する</button>' : '') +
      '</div></div>';
  }).join('');
}

/* ---------- ごみ箱 ---------- */
function trashView() {
  if (!isAdmin()) return '<div class="empty"><b>管理者のみ</b>ごみ箱は管理者だけが見られます。</div>';
  const list = D('examples').filter(e => e.hidden).sort((a, b) => (b.hiddenAt || 0) - (a.hiddenAt || 0));
  if (!list.length) return '<div class="empty"><b>ごみ箱は空です</b></div>';
  return list.map(e => {
    const it = itemById(e.itemId), ask = S.confirm === 'purge:' + e.id;
    return '<div class="trow"><b>' + esc(e.title) + '</b><span class="crumb">' + esc(it ? it.name : '（項目なし）') + '　' + (e.kind === 'bad' ? '× 悪い例' : '○ 良い例') + '　写真・動画 ' + (e.media || []).length + '点</span>' +
      (ask ? '<div class="discard"><p>完全に削除します。写真・動画も消え、元に戻せません。</p><div class="line"><button class="btn" type="button" data-act="no">やめる</button><button class="btn danger solid" type="button" data-act="purge-yes" data-id="' + esc(e.id) + '">完全に削除</button></div></div>'
        : '<div class="line"><button class="btn" type="button" data-act="restore" data-id="' + esc(e.id) + '">元に戻す</button><button class="btn danger" type="button" data-act="purge-ask" data-id="' + esc(e.id) + '">完全に削除</button></div>') + '</div>';
  }).join('');
}

/* ---------- 動作診断 ---------- */
function diagView() {
  const rows = S.diag || [];
  let h = '<p class="hint">この画面は、お使いの端末で通信・保存・写真・動画が動くかを確かめます。確認用のデータは作りません。</p>' +
    '<div style="display:grid;gap:8px;margin-bottom:12px"><button class="btn primary" type="button" data-act="diag-run"' + (S.diagBusy ? ' disabled' : '') + '>' + (S.diagBusy ? '確認中…' : '診断を実行') + '</button></div>';
  if (rows.length) {
    h += '<ul class="diag">' + rows.map(r => '<li><span class="st ' + r.st + '">' + ({ ok: '○', ng: '×', skip: '－' })[r.st] + '</span><div><b>' + esc(r.label) + '</b><small>' + esc(r.detail || '') + '</small></div></li>').join('') + '</ul>';
    h += '<h2 class="sec-t">動画のテスト（任意）</h2><p class="hint">撮った動画が小さくできるか確認します。短い動画を1つ選んでください（送信はしません）。</p>' +
      '<input class="sr file-in" id="dv" type="file" accept="video/*" data-chg="diag-video"><label for="dv" class="filebtn">動画を選んで確認</label>';
    h += '<h2 class="sec-t">結果をコピー</h2><textarea id="dtxt" readonly rows="8" class="field">' + esc(diagText()) + '</textarea><div style="margin-top:8px"><button class="btn" type="button" data-act="diag-copy">結果をコピー</button></div>';
  }
  return h;
}
function diagText() {
  return VERSION + '\n' + (S.diag || []).map(r => ({ ok: '[OK] ', ng: '[NG] ', skip: '[--] ' })[r.st] + r.label + ': ' + (r.detail || '')).join('\n');
}
