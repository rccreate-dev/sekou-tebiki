# 公開手順(細野さんがやること + Claudeがやること)

## 1. Googleの準備(Apps Script)
1. Googleドライブで新しいスプレッドシートを作る(名前は自由)。メニュー「拡張機能 → Apps Script」を開く。
2. `backend/` の `.gs` ファイルをすべて貼り付ける(`appsscript.json` も「プロジェクトの設定 → マニフェストを表示」で置き換える)。
3. 関数 `setupSecrets` → `setupSheets` → `setupTriggers` → `seedStructure` の順に1回ずつ実行(初回は権限の承認が出る)。
4. 「デプロイ → 新しいデプロイ → ウェブアプリ」。実行ユーザー=自分、アクセス=全員。表示されたURL(`…/exec`)を控える。
5. 設定シートの `appBaseUrl` にそのURLを入れる(メールの承認リンク用)。

## 2. アプリ側
1. `frontend/config.js` の `API_URL` に、上の `…/exec` のURLを入れる。
2. `frontend/sw.js` の `SW_VERSION` を上げる(変更を端末に反映させるため)。
3. main に push すると GitHub Actions が `frontend/` だけを公開する(Settings → Pages → Source を「GitHub Actions」にしておく)。

## 3. 自社ドメイン tebiki.rccreate.net
- GoDaddy の DNS に CNAME を追加: ホスト `tebiki` → 値 `rccreate-dev.github.io`
- GitHub の Settings → Pages → Custom domain に `tebiki.rccreate.net`、「Enforce HTTPS」にチェック。(`frontend/CNAME` は用意済み)

## 4. 最初の管理者
1. 自分のスマホで tebiki.rccreate.net を開き、氏名を入れて申請する。
2. 届いたメールの「承認する」→ 確認ページのボタンで承認。
3. Apps Script で `makeAdmin('細野')` を実行(または利用者シートの「区分」を `管理` に)。以後はアプリ内の「設定 → 利用者の管理」で承認・区分変更ができる。

## 5. 社員への案内
- QRコードか URL を配る。開いて氏名を申請 → 管理者が承認。投稿してもらう人は区分を「投稿」にする。
- iPhone: Safari の共有ボタン →「ホーム画面に追加」。Android: メニュー →「ホーム画面に追加」。追加しておくと登録が消えにくい。

## 未確認(本番で最初に確認)
リクエストサイズ上限、doPost のリダイレクト、Drive の速度、iPhoneのホーム画面アプリでの登録保持。
アプリの「設定 → 動作診断」で確認できる。
