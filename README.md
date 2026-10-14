# 施工手引き(RCCREATE 社内・社外秘)
型枠工事の「この場合はこう施工する」を、良い例・悪い例の写真/動画と理由でまとめる社内アプリ。
- フロント: `frontend/`(素のJS/HTML、ビルドなし、PWA)→ GitHub Pages(tebiki.rccreate.net)
- バックエンド: `backend/`(Apps Script + スプレッドシート + Drive)
- 契約: `SPEC.md` / 手順: `docs/DEPLOY.md` / **引き継ぎ・やり残し: `docs/HANDOVER.md`**
- テスト: `node --test backend/harness/test` と `NODE_PATH=$(npm root -g) node tests/e2e.js`
- 写真・動画・実データはこのリポジトリに入れない(社外秘)
