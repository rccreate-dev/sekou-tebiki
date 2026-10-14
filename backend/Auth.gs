/**
 * Auth.gs — 端末の認証(dev+key)と役割の判定(SPEC §1, §2)。
 * 鍵の平文は保存しない。保存するのは SHA-256(key + PEPPER) の16進だけ。ログにも出さない。
 */

var Auth = {
  DEV_RE: /^[A-Za-z0-9-]{8,64}$/,
  KEY_RE: /^[A-Za-z0-9]{32,64}$/,

  pepper: function () {
    var p = PropertiesService.getScriptProperties().getProperty('PEPPER');
    if (!p) fail_('INTERNAL', 'サーバーの秘密が未設定です。setupSecrets を実行してください。');
    return p;
  },

  secret: function () {
    var s = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!s) fail_('INTERNAL', 'サーバーの秘密が未設定です。setupSecrets を実行してください。');
    return s;
  },

  keyHash: function (key) {
    return Util.sha256Hex(key + Auth.pepper());
  },

  /** メール用リンクの署名: HMAC-SHA256(id|d, SECRET) */
  sign: function (id, d) {
    return Util.hmacHex(id + '|' + d, Auth.secret());
  },

  /**
   * mode 'register': 未登録でも通す(user=null)。登録済みなら鍵一致を確認する。
   * mode 'approved': 承認済みで鍵が一致し、区分が minRole 以上であること。
   * 戻り値 { dev, key, user, role, status }
   */
  authenticate: function (req, mode, minRole) {
    var dev = req.dev, key = req.key;
    if (typeof dev !== 'string' || !Auth.DEV_RE.test(dev) || typeof key !== 'string' || !Auth.KEY_RE.test(key)) {
      fail_('UNAUTHENTICATED', '端末の認証情報がありません。');
    }
    var user = Repo.find('users', dev);
    if (!user) {
      if (mode === 'register') return { dev: dev, key: key, user: null, role: '', status: 'none' };
      fail_('UNAUTHENTICATED', 'この端末は登録されていません。');
    }
    if (!user.keyHash || !Util.safeEq(user.keyHash, Auth.keyHash(key))) {
      fail_('UNAUTHENTICATED', '端末の認証に失敗しました。');
    }
    var status = STATUS_FROM_JA[user.status] || '';
    var role = ROLE_FROM_JA[user.role] || '';
    if (mode === 'register') return { dev: dev, key: key, user: user, role: role, status: status };
    if (status === 'rejected') fail_('REJECTED', '利用が許可されていません。');
    if (status !== 'approved') fail_('NOT_APPROVED', 'まだ承認されていません。承認をお待ちください。');
    if (!role) fail_('NOT_APPROVED', '利用区分が設定されていません。管理者に連絡してください。');
    if (minRole && ROLE_RANK[role] < ROLE_RANK[minRole]) fail_('FORBIDDEN', 'この操作をする権限がありません。');
    return { dev: dev, key: key, user: user, role: role, status: status };
  }
};
