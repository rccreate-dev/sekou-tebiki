/**
 * HandlersStructure.gs — グループ・項目の管理(SPEC §5.4)。
 */

function nextOrder_(rows) {
  var max = 0;
  rows.forEach(function (r) { if (r.order > max) max = r.order; });
  return max + 10;
}

function handleSaveGroup_(ctx, p) {
  if (p.id) {
    var g = Repo.find('groups', p.id);
    if (!g) fail_('NOT_FOUND', 'グループが見つかりません。');
    var patch = { name: p.name };
    if (p.order !== undefined) patch.order = p.order;
    Repo.update('groups', g, patch);
    Repo.bumpRev();
    return { group: { id: g.id, name: p.name, order: p.order !== undefined ? p.order : g.order } };
  }
  var id = Util.newId('g_', function (x) { return !!Repo.find('groups', x); });
  var order = p.order !== undefined ? p.order : nextOrder_(Repo.all('groups'));
  Repo.append('groups', { id: id, name: p.name, order: order });
  Repo.bumpRev();
  return { group: { id: id, name: p.name, order: order } };
}

function handleSaveItem_(ctx, p) {
  if (!Repo.find('groups', p.groupId)) fail_('VALIDATION_FAILED', 'グループが見つかりません。', 'groupId');
  if (p.id) {
    var it = Repo.find('items', p.id);
    if (!it) fail_('NOT_FOUND', '項目が見つかりません。');
    var order = it.order;
    if (p.order !== undefined) order = p.order;
    else if (it.groupId !== p.groupId) order = nextOrder_(Repo.all('items').filter(function (x) { return x.groupId === p.groupId; }));
    Repo.update('items', it, { groupId: p.groupId, name: p.name, order: order });
    Repo.bumpRev();
    return { item: { id: it.id, groupId: p.groupId, name: p.name, order: order } };
  }
  var id = Util.newId('i_', function (x) { return !!Repo.find('items', x); });
  var ord = p.order !== undefined ? p.order : nextOrder_(Repo.all('items').filter(function (x) { return x.groupId === p.groupId; }));
  Repo.append('items', { id: id, groupId: p.groupId, name: p.name, order: ord });
  Repo.bumpRev();
  return { item: { id: id, groupId: p.groupId, name: p.name, order: ord } };
}

function handleReorder_(ctx, p) {
  var key = p.kind === 'group' ? 'groups' : 'items';
  var map = {};
  var count = 0;
  p.orders.forEach(function (o) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.id !== 'string') fail_('BAD_REQUEST', 'orders の形式が正しくありません。');
    if (!Util.isInt(o.order) || o.order < -1000000 || o.order > 1000000) fail_('VALIDATION_FAILED', '順が正しくありません。', 'orders');
    if (Object.prototype.hasOwnProperty.call(map, o.id)) fail_('VALIDATION_FAILED', '同じIDが重複しています。', 'orders');
    map[o.id] = o.order;
    count++;
  });
  // 先にすべての存在を確かめる(1件でも無ければ何も変えない)
  var existing = {};
  Repo.all(key).forEach(function (r) { existing[r.id] = true; });
  Object.keys(map).forEach(function (id) {
    if (!existing[id]) fail_('NOT_FOUND', '見つからないIDが含まれています。');
  });
  Repo.setColumn(key, 'order', map); // 1回の書き込み
  Repo.bumpRev();
  return {};
}

function handleDeleteGroup_(ctx, p) {
  var g = Repo.find('groups', p.id);
  if (!g) fail_('NOT_FOUND', 'グループが見つかりません。');
  var n = Repo.all('items').filter(function (i) { return i.groupId === p.id; }).length;
  if (n > 0) fail_('HAS_CHILDREN', 'このグループには項目が' + n + '個あります。先に項目を移すか削除してください。');
  Repo.remove('groups', g);
  Repo.bumpRev();
  return {};
}

function handleDeleteItem_(ctx, p) {
  var it = Repo.find('items', p.id);
  if (!it) fail_('NOT_FOUND', '項目が見つかりません。');
  var n = Repo.all('examples').filter(function (e) { return e.itemId === p.id; }).length; // 削除済みも数える
  if (n > 0) fail_('HAS_CHILDREN', 'この項目には事例が' + n + '件あります(ごみ箱の事例を含む)。');
  Repo.remove('items', it);
  Repo.bumpRev();
  return {};
}
