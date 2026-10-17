# SPEC — 施工手引き(RCCREATE) API契約・データ構造

この文書が、バックエンド(backend/ = Google Apps Script)とフロント(frontend/ = PWA)の**唯一の契約**。食い違いを見つけたら直さず報告する。
最終更新: 2026-10-17

## 0. 全体像

| 役目 | 使うもの |
|---|---|
| 画面 | GitHub Pages(`frontend/`、PWA。公開URL `https://tebiki.rccreate.net`) |
| データ | Googleスプレッドシート1ファイル(`setupSheets` がシートを作る) |
| 写真・動画 | Googleドライブ。ルートフォルダ「RCCREATE 施工手引き」の下の `media/` |
| API | Apps Script Webアプリ(実行=デプロイした人、アクセス=全員)。認証は端末の登録+社長の承認 |

- 画面のコードは公開。**データは公開しない**: すべてのAPI(`apply`/`status` を除く)は承認済みの端末だけが呼べる。
- 外部CDN・外部フォント・外部ライブラリを使わない(現場は電波が弱い)。ビルド工程なし。

## 1. 通信

- `POST <API_URL>`、`Content-Type: text/plain;charset=utf-8`(CORSプリフライト回避)、`redirect: follow`。
- 要求: `{"v":1,"action":"…","dev":"<端末ID>","key":"<端末の秘密>","params":{…}}`
- 応答: `{"ok":true,"data":{…},"meta":{"serverTime":"ISO8601+09:00"}}` または `{"ok":false,"error":{"code":"…","message":"日本語の説明"}}`
- 例外は投げず、必ずJSONで返す。未知の action は `BAD_REQUEST`。
- `dev`: 端末ID。`/^[A-Za-z0-9-]{8,64}$/`。端末が最初に作る(UUID)。
- `key`: 端末の秘密。`/^[A-Za-z0-9]{32,64}$/`。端末が最初に作る(乱数)。サーバーは `SHA-256(key + PEPPER)` の16進だけを保存する(平文禁止)。`PEPPER` はスクリプトプロパティ(`setupSecrets` が自動生成)。
- 認証の段階:
  - `apply`: dev/key があればよい(未登録なら登録、登録済みなら鍵一致を確認)
  - `status`: 同上。未登録は `{status:"none"}`
  - それ以外: 状態が「承認」で鍵が一致していること。不一致は `UNAUTHENTICATED`、承認前は `NOT_APPROVED`、却下は `REJECTED`。
- 更新系はスクリプトロック(最大10秒待ち)の内側で実行。取れなければ `BUSY`。
- 冪等: `saveExample` / `uploadPart` は同じ id・同じ内容の再送を成功として扱い、二重に作らない(オフライン再送のため)。

### エラーコード
`BAD_REQUEST` `UNAUTHENTICATED` `NOT_APPROVED` `REJECTED` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED` `HAS_CHILDREN` `TOO_LARGE` `BUSY` `DRIVE_ERROR` `INTERNAL`

## 2. 役割

利用者シートの「区分」: `閲覧` / `投稿` / `管理`(内部コード `viewer` / `poster` / `admin`)。既定は `閲覧`。

| 操作 | viewer | poster | admin |
|---|---|---|---|
| 一覧・写真・動画を見る | ○ | ○ | ○ |
| 事例を追加(写真・動画の登録) | × | ○ | ○ |
| 自分の事例の編集・削除 | × | ○ | ○ |
| 他人の事例の編集・削除 | × | × | ○ |
| ごみ箱の閲覧・復元・完全削除 | × | × | ○ |
| グループ・項目の追加・名前変更・並べ替え・移動・削除 | × | × | ○ |
| 利用者の承認・却下・区分変更 | × | × | ○ |

- 「自分の事例」= 事例の `by`(登録した利用者のid=端末ID)が自分のid。
- 状態が「承認」でない行・区分が空や未知の行は `viewer` 扱いではなく**拒否**(`NOT_APPROVED`)。

## 3. データ(スプレッドシート)

1行目は列名(日本語)。`Schema` の定義と一致しなければ `setupSheets` は止まる。**利用者シート以外はアプリ経由で書き換える。** 数式として解釈される先頭文字(`= + - @`)は文字列の先頭に空白を足して保存する(`clean_`)。

### 3.1 シート「利用者」
| 列 | 内容 |
|---|---|
| ID | 端末ID(dev) |
| 申請日時 | Date |
| 氏名 | 40字まで |
| 会社名 | 60字まで(空可) |
| 区分 | `閲覧`/`投稿`/`管理`(入力規則あり) |
| 状態 | `申請中`/`承認`/`却下`(入力規則あり) |
| 決定日時 | Date |
| 鍵ハッシュ | SHA-256(key+PEPPER) 16進。**手で触らない** |
| 最終利用 | Date(`bootstrap` の度に更新。ただし10分に1回まで) |

### 3.2 シート「グループ」: `ID` `名前` `順`(数値)
### 3.3 シート「項目」: `ID` `グループID` `名前` `順`
### 3.4 シート「事例」
`ID` `項目ID` `種類`(good/bad) `タイトル` `理由` `重要度`(A/B/C/空) `確認時期` `確認基準` `管理番号` `メディア`(JSON文字列) `登録者`(利用者ID) `登録日時`(ms) `更新日時`(ms) `削除`(TRUE/FALSE) `削除日時`(ms)

- 文字数上限: タイトル60、理由600、確認基準300、管理番号30、確認時期は固定リスト(§6)のどれか or 空。
- `メディア` = `[{"id":"m_…","type":"image"|"video","mime":"image/jpeg"|"video/mp4"|"video/webm","parts":1,"bytes":123456}]` 最大6件。`image` は `parts:1`。`video` は `parts` 1〜8。
- 項目IDは「項目」シートに存在すること。

### 3.5 シート「設定」: `キー` `値`
`mediaRootFolderId`(自動) / `mailEnabled`(既定TRUE) / `appBaseUrl`(例 https://tebiki.rccreate.net) / `rev`はスクリプトプロパティ(シートに置かない)。

### 3.6 ID
- グループ `g_`、項目 `i_`、事例 `e_`、メディア `m_` + 英小文字数字(8〜32字)。グループ・項目はサーバーが発行。事例・メディアはクライアントが発行(冪等のため)。

### 3.7 版番号 rev
スクリプトプロパティ `REV`(整数文字列)。グループ・項目・事例・利用者区分のいずれかが変わるたびに +1。`bootstrap` が返す。クライアントは `since` を付けて問い合わせ、変化がなければ `{unchanged:true,rev}` だけが返る。

## 4. Drive
- ルート「RCCREATE 施工手引き」(`setupSheets` が作り、IDを設定に記録)/`media/` に全ファイルをフラットに置く。
- 画像: 本体 `<mediaId>.jpg`、サムネ `<mediaId>_t.jpg`。
- 動画: 分割片 `<mediaId>_p0` … `_p<parts-1>`(中身は生のバイト。MIMEは `application/octet-stream`)、サムネ(1コマ目)`<mediaId>_t.jpg`。
- 共有設定は触らない(リンク共有しない。取得は常にAPI経由)。
- 掃除: 毎日3時(`dailyMaintenance`)に、どの事例(削除済みも含む)からも参照されず、作成から24時間以上たったファイルをゴミ箱へ。

## 5. アクション

型: `str(max)`=文字列、`int`、`bool`、`b64`=base64文字列。★=更新系(ロック内)。表にないキーは `BAD_REQUEST`。

### 5.1 公開に近いもの
| action | params | 応答 data |
|---|---|---|
| `ping` | なし(dev/key不要) | `{version:1}` |
| `apply` | `name: str(40) 必須`, `company: str(60)` | `{status}`。未登録なら行を追加して「申請中」+社長へメール。登録済みなら何もせず現在の `status`。鍵が違えば `UNAUTHENTICATED`。連打対策(未登録の新しい申請だけに効く): 「申請中」が50件以上、または新しい申請が全体で1時間に30件を超えると `BUSY`(行もメールも増やさない) |
| `status` | なし | `{status:"none"|"pending"|"approved"|"rejected", role?, name?}` |

メール(`mailEnabled`=TRUE かつ 6時間に20通まで): 宛先は設定シートの `notifyEmail`(未設定なら送らない。`Session.getEffectiveUser` は userinfo.email 権限が要るため使わない)。件名「【施工手引き】利用申請: 氏名(会社名)」。本文に「承認する/却下する」リンク。リンクは `GET <exec>?action=decide&d=approve|reject&id=<dev>&sig=<HMAC>` で**確認ページのみ**表示し、ページのボタンで `action=commit` が決定する(メールの自動プレビューで勝手に決定されないため)。署名は `HMAC-SHA256(id|d, SECRET)`。`doGet` が対応するのは `decide` `commit` `ping` だけ。

### 5.2 参照(承認済み)
| action | params | 応答 data |
|---|---|---|
| `bootstrap` | `since: int`(任意) | `since` と rev が同じなら `{unchanged:true,rev}`。違えば `{rev, me:{id,name,role}, groups:[{id,name,order}], items:[{id,groupId,name,order}], examples:[…§5.6], names:{<利用者ID>:<氏名>}}`。`examples` は、admin 以外には削除済みを含めない。admin の応答にはさらに `users:[{id,name,company,role,status,appliedAt,lastUsedAt}]` |
| `getThumbs` | `ids: [mediaId]`(1〜20件) | `{items:{<mediaId>:{data:b64, mime}}}`。存在しないidは `items` に入れない(エラーにしない)。メディアが参照されているかは見ない(承認済みなら取得可) |
| `getPart` | `id: mediaId`, `index: int`(画像は0=本体。動画は片の番号) | `{data:b64, mime}`。画像は `image/jpeg`、動画片は `application/octet-stream` |

`bootstrap` が使うサーバーのキャッシュ: 読み取りは `CacheService`(60秒)を使ってよいが、書き込み後は必ず無効化し、rev と整合させる。

### 5.3 登録(poster/admin)
| action | params | 応答 |
|---|---|---|
| `uploadPart` ★ | `mediaId: str`(m_…), `kind:"image"|"video"`, `mime: str`, `index: int`, `total: int`, `data: b64`, `thumb: b64`(`index=0` のとき必須), `bytes: int`(この片の生バイト数) | `{stored:true}` |

- 画像: `total=1`。本体JPEG(2.8MB以下)とサムネJPEG(220KB以下)。先頭バイトが `FF D8` であること。
- 動画: `total` 1〜8、片は生バイト3MB以下(base64 4.2M字以下)。全体20MB以下。`index=0` にサムネ(JPEG)を付ける。`mime` は `video/mp4` か `video/webm` のみ。
- 同じ `mediaId`+`index` の再送は、既存ファイルをゴミ箱に入れて作り直さず、**既にあれば成功を返す**(内容比較はしない)。
- Driveに書くのはロックの外でよい(重いため)。ロックは不要。ただし認証と権限は毎回確認する。

| `saveExample` ★ | `id: str`(e_…、必須。新規は端末が発行), `itemId`, `kind`, `title`(必須), `reason`, `severity`, `timing`, `criteria`, `refNo`, `media: [{id,type,mime,parts,bytes}]` | `{example:{§5.6}}` |
|---|---|---|

- 存在しない `id` → 新規(poster/admin)。登録者=自分、登録日時=今。存在する `id` → 更新(自分の事例か admin。他人の事例の poster は `FORBIDDEN`)。更新では登録者・登録日時を変えない。更新日時=今。
- `media` の各 id について、Driveに本体(動画は全パーツ)とサムネが**そろっていること**を確認する。無ければ `VALIDATION_FAILED`(`path:"media"`)。
- 更新で外れたメディアのファイルは、ここでは消さない(掃除は日次)。
- 削除済み(`削除`=TRUE)の事例は更新できない(`NOT_FOUND`)。

| `deleteExample` ★ | `id` | `{}`(論理削除: `削除`=TRUE、削除日時=今)。自分の事例か admin |
|---|---|---|
| `restoreExample` ★ | `id` | admin のみ。`削除`=FALSE |
| `purgeExample` ★ | `id` | admin のみ。行を削除し、そのメディアのファイルをゴミ箱へ。**削除済みの事例にだけ使える**(未削除は `VALIDATION_FAILED`) |

### 5.4 構成(admin)
| action | params | 応答 |
|---|---|---|
| `saveGroup` ★ | `id`(任意), `name: str(30) 必須`, `order: int`(任意) | `{group:{id,name,order}}`。`id` なし=新規(`order` なしなら最大+10)。あり=名前/順を更新。存在しない id は `NOT_FOUND` |
| `saveItem` ★ | `id`(任意), `groupId`(必須), `name: str(40) 必須`, `order: int`(任意) | `{item:{…}}`。`groupId` が違えば項目の移動(`order` なしなら移動先の最大+10) |
| `reorder` ★ | `kind:"group"|"item"`, `orders:[{id,order}]`(1〜200件) | `{}`。すべて存在する id であること(1件でも無ければ何も変えず `NOT_FOUND`) |
| `deleteGroup` ★ | `id` | 項目が1つでもあれば `HAS_CHILDREN` |
| `deleteItem` ★ | `id` | 事例が1つでもあれば(削除済みを含む)`HAS_CHILDREN` |

### 5.5 利用者(admin)
| action | params | 応答 |
|---|---|---|
| `setUser` ★ | `id`, `role?: "viewer"|"poster"|"admin"`, `status?: "approved"|"rejected"|"pending"` | `{}`。自分自身を「admin以外」や「却下」にすることは `FORBIDDEN`(管理者がいなくならないよう)。管理者が最後の1人になる変更も `FORBIDDEN` |

### 5.6 事例のJSON(応答)
`{id, itemId, kind, title, reason, severity, timing, criteria, refNo, media:[{id,type,mime,parts,bytes}], by, at, updatedAt, hidden, hiddenAt}`(日時はms整数、`severity`/`timing`/`criteria`/`refNo` は無ければ空文字、`hidden`は真偽値)。

## 6. 固定リスト
- 確認時期(`timing`): 墨出し・準備 / 型枠建込 / 支保工設置 / 締付金物・補強 / 打設前最終確認 / コン打設中監視 / 養生・脱型
- 重要度: A / B / C

## 7. 初期データ(`seedStructure`)
グループ6・項目14。**事例は入れない**。何度実行しても重複しない(同名があれば作らない)。

| グループ | 項目(この順) |
|---|---|
| 準備 | 材料・資機材の確認 / 安全・KY / 資材の積み方（運搬） / 加工場の材料の置き方 |
| 墨出 | 通り芯・逃げ墨 / 高さ（レベル）墨 / スリット位置の墨出し |
| 建込 | 壁の建込 / スラブ段取り / 敷桟木（下端） |
| 固め | 締付け（セパ・フォームタイ） / 端太・控え・振れ止め |
| 片付け | 作業後の片付け・清掃 |
| 仕上がり確認 | 打継・出隅の精度 |

グループ6・項目14。順は10刻み(10,20,30…)。

## 8. 運用関数(GASエディタから実行)
`setupSheets`(シート・設定・秘密鍵・Driveフォルダ。中で `setupSecrets`)/ `setupTriggers`(毎日3時 `dailyMaintenance`)/ `seedStructure` / `makeAdmin(name)`(承認済みで氏名が一致する1人を「管理」にする。0人・2人以上なら何もせずログに理由)。
