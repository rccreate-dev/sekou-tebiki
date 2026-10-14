'use strict';
/**
 * server.js — GAS互換ハーネス(Node)。backend/*.gs を vm で読み込み、shims を注入して
 *   POST /api(SPEC §1の封筒)・GET /api?action=decide|commit|ping・/__mock/* を提供する。
 * 使い方: node backend/harness/server.js        (既定 port 8790。環境変数 HARNESS_PORT / MOCK_LATENCY_MS)
 * doPost は同期実行なので、LockService shim と合わせて更新系は直列になる。
 *
 * テスト制御(/__mock/*。GETでもPOSTでも可。POSTはJSON本文):
 *   POST reset {variant?:'empty'|'seeded'}   新しいスプレッドシート+Drive+Script Properties で作り直す(setupSheets 実行)
 *   GET  mails                                 送信された(取り込まれた)メール
 *   POST user {id?,key?,name?,company?,role?,status?}  承認フロー無しで利用者行を作り {dev,key} を返す
 *   POST setrole {id,role?,rawRole?,status?,bump?}      利用者の区分・状態をシートへ直接書く(rev は bump:true のときだけ上げる)
 *   GET  drive                                 {files:[{name,size,createdAt}], trashed:[name]}
 *   POST maintenance {offsetHours?}            時計を offsetHours 進めて dailyMaintenance を実行(終わったら戻す)
 *   POST clock {advanceHours?|advanceMs?|reset?} 時計を進める(戻すのは reset:true)
 *   POST sheet {key}                           シートの生の値(行配列)
 *   GET  state                                 {rev, lockHeld, userLockHeld, lockWaits, driveLog}
 *   POST setting {key,value}                   設定シートの値を直接書く
 *   POST call {fn,args?}                       setupSheets / seedStructure / makeAdmin / setupTriggers / setupSecrets を実行
 *   POST driveFail {createFile:n}              n回目の createFile を Drive 例外にする
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { createShims } = require('./shims');

const BACKEND_DIR = path.join(__dirname, '..');
const LOAD_ORDER = ['Util', 'Schema', 'Repo', 'Auth', 'Media', 'Code', 'HandlersUser', 'HandlersExample', 'HandlersStructure', 'Setup'];
const ROOT_FOLDER_NAME = 'RCCREATE 施工手引き';

function loadSources() {
  return LOAD_ORDER.map((n) => ({ name: n + '.gs', src: fs.readFileSync(path.join(BACKEND_DIR, n + '.gs'), 'utf8') }));
}

function buildContext(h) {
  const state = { nowMs: () => h.nowMs(), nowIso: () => new Date(h.nowMs()).toISOString(), baseUrl: h.baseUrl };
  const shims = createShims(state);
  state.rootName = ROOT_FOLDER_NAME;
  const sandbox = Object.assign({}, shims.globals, { __clock: () => h.nowMs() });
  const ctx = vm.createContext(sandbox);
  loadSources().forEach((f) => new vm.Script(f.src, { filename: f.name }).runInContext(ctx));
  vm.runInContext('Util._clock = __clock;', ctx);
  return { ctx, state };
}

function createHarness(opts) {
  opts = opts || {};
  const h = { offsetMs: 0, latency: opts.latency || 0, baseUrl: opts.baseUrl || 'http://127.0.0.1:8790', ctx: null, state: null };
  h.nowMs = () => Date.now() + h.offsetMs;

  h.reset = (o) => {
    o = o || {};
    h.offsetMs = 0;
    const built = buildContext(h);
    h.ctx = built.ctx; h.state = built.state;
    h.ctx.setupSheets();
    h.ctx.Repo.setSetting('notifyEmail', 'owner@example.com');
    if (o.variant === 'seeded') h.ctx.seedStructure();
    h.state.driveLog.length = 0;
    h.state.mails.length = 0;
  };

  /** 本文(文字列)を doPost に渡し、応答本文(JSON文字列)を返す */
  h.post = (bodyText) => h.ctx.doPost({ postData: { contents: bodyText, type: 'text/plain' } }).getContent();
  /** doGet(クエリ: オブジェクト)。{ body, html } */
  h.get = (params) => {
    const out = h.ctx.doGet({ parameter: params || {} });
    return { body: out.getContent(), json: typeof out.getMimeType === 'function' && out.getMimeType() === 'JSON' };
  };
  /** 封筒を組み立てて呼び、応答オブジェクトを返す。user={dev,key} */
  h.call = (action, params, user, extra) => {
    const body = Object.assign({ v: 1, action, params: params || {} }, user ? { dev: user.dev, key: user.key } : {}, extra || {});
    return JSON.parse(h.post(JSON.stringify(body)));
  };
  h.as = (user) => (action, params, extra) => h.call(action, params, user, extra);

  /* ---------- /__mock/* ---------- */
  const mapRole = (r) => h.ctx.ROLE_TO_JA[r];
  const mapStatus = (s) => h.ctx.STATUS_TO_JA[s];
  const plain = (v) => JSON.parse(JSON.stringify(v));

  h.control = (route, body) => {
    body = body || {};
    const c = h.ctx;
    switch (route) {
      case 'reset': h.reset(body); return { ok: true, data: { now: new Date(h.nowMs()).toISOString() } };
      case 'mails': return { ok: true, data: { mails: plain(h.state.mails) } };
      case 'user': {
        c.Repo.reset();
        const dev = body.id || ('dev-' + require('crypto').randomBytes(8).toString('hex'));
        const key = body.key || require('crypto').randomBytes(24).toString('hex');
        c.Repo.append('users', {
          id: dev, appliedAt: h.nowMs(), name: body.name || 'テスト太郎', company: body.company || '', role: mapRole(body.role || 'viewer'),
          status: mapStatus(body.status || 'approved'), decidedAt: h.nowMs(), keyHash: c.Auth.keyHash(key), lastUsedAt: 0,
        });
        c.Repo.reset();
        return { ok: true, data: { dev, key } };
      }
      case 'setrole': {
        c.Repo.reset();
        const u = c.Repo.find('users', body.id);
        if (!u) return { ok: false, error: { code: 'NOT_FOUND', message: '利用者がいません' } };
        const patch = {};
        if (body.rawRole !== undefined) patch.role = body.rawRole;
        else if (body.role) patch.role = mapRole(body.role);
        if (body.status) patch.status = mapStatus(body.status);
        c.Repo.update('users', u, patch);
        if (body.bump) c.Repo.bumpRev();
        c.Repo.reset();
        return { ok: true, data: {} };
      }
      case 'drive': {
        const all = h.state.driveFiles(ROOT_FOLDER_NAME);
        return {
          ok: true, data: {
            files: all.filter((f) => !f.trashed).map((f) => ({ name: f.name, path: f.path, size: f.size, createdAt: f.created, sharing: f.sharing })),
            trashed: all.filter((f) => f.trashed).map((f) => f.name),
          },
        };
      }
      case 'maintenance': {
        const keep = h.offsetMs;
        h.offsetMs += (Number(body.offsetHours) || 0) * 3600000;
        try { return { ok: true, data: plain(c.dailyMaintenance()) }; } finally { h.offsetMs = keep; }
      }
      case 'clock':
        if (body.reset) h.offsetMs = 0;
        h.offsetMs += (Number(body.advanceHours) || 0) * 3600000 + (Number(body.advanceMs) || 0);
        return { ok: true, data: { now: new Date(h.nowMs()).toISOString() } };
      case 'sheet': {
        if (!c.SHEET_DEFS[body.key]) return { ok: false, error: { code: 'BAD_REQUEST', message: '未知のシート' } };
        return { ok: true, data: { rows: plain(c.Repo.sheet(body.key).getDataRange().getValues()) } };
      }
      case 'state':
        return {
          ok: true, data: {
            rev: c.Repo.rev(), lockHeld: h.state.lockHeld, userLockHeld: h.state.userLockHeld, lockWaits: h.state.lockWaits,
            triggers: h.state.triggers.map((t) => t.getHandlerFunction()), driveLog: plain(h.state.driveLog),
            logs: plain(h.state.loggerLines),
          },
        };
      case 'setting': c.Repo.reset(); c.Repo.setSetting(body.key, body.value); c.Repo.reset(); return { ok: true, data: {} };
      case 'driveFail': h.state.driveFail = { createFile: Number(body.createFile) || 0 }; return { ok: true, data: {} };
      case 'call': // 運用関数をテストから直接実行(setupSheets / seedStructure / makeAdmin / setupTriggers)
        if (!['setupSheets', 'setupSecrets', 'seedStructure', 'makeAdmin', 'setupTriggers'].includes(body.fn)) return { ok: false, error: { code: 'BAD_REQUEST', message: '呼べない関数' } };
        try { const r = c[body.fn].apply(null, body.args || []); return { ok: true, data: plain({ result: r === undefined ? null : r }) }; } catch (e) { return { ok: false, error: { code: 'INTERNAL', message: String(e && e.message) } }; }
      default: return { ok: false, error: { code: 'NOT_FOUND', message: '未知の制御パス' } };
    }
  };

  /* ---------- HTTP ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const readBody = (req) => new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  const JSON_HEAD = Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, CORS);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
      if (url.pathname.startsWith('/__mock/')) {
        let body = {};
        if (req.method === 'POST') { const raw = await readBody(req); try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; } }
        else url.searchParams.forEach((v, k) => { body[k] = v; });
        const out = h.control(url.pathname.slice('/__mock/'.length), body);
        res.writeHead(200, JSON_HEAD); res.end(JSON.stringify(out)); return;
      }
      if (url.pathname === '/api') {
        if (h.latency) await sleep(h.latency);
        if (req.method === 'GET') {
          const params = {}; url.searchParams.forEach((v, k) => { params[k] = v; });
          const out = h.get(params);
          res.writeHead(200, out.json ? JSON_HEAD : Object.assign({ 'Content-Type': 'text/html;charset=utf-8' }, CORS));
          res.end(out.body); return;
        }
        if (req.method === 'POST') {
          const bodyText = await readBody(req);
          res.writeHead(200, JSON_HEAD); res.end(h.post(bodyText)); return;
        }
      }
      res.writeHead(404, JSON_HEAD); res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }));
    } catch (e) {
      res.writeHead(500, Object.assign({ 'Content-Type': 'text/plain' }, CORS)); res.end('harness error: ' + (e && e.message));
    }
  }

  h.listen = (port, host) => new Promise((resolve) => {
    h.baseUrl = `http://${host || '127.0.0.1'}:${port}`;
    if (h.state) h.state.baseUrl = h.baseUrl;
    h.server = http.createServer((req, res) => { handle(req, res); });
    h.server.listen(port, host || '127.0.0.1', () => {
      const p = h.server.address().port;
      h.baseUrl = `http://${host || '127.0.0.1'}:${p}`;
      if (h.state) h.state.baseUrl = h.baseUrl;
      resolve(p);
    });
  });
  h.close = () => new Promise((resolve) => { if (h.server) { h.server.closeAllConnections?.(); h.server.close(() => resolve()); } else resolve(); });

  h.reset({});
  return h;
}

module.exports = { createHarness };

if (require.main === module) {
  const port = Number(process.env.HARNESS_PORT || 8790);
  const latency = Number(process.env.MOCK_LATENCY_MS || 0);
  const h = createHarness({ latency, baseUrl: `http://127.0.0.1:${port}` });
  h.listen(port, process.env.HARNESS_HOST || '127.0.0.1').then((p) => console.log(`GAS互換ハーネス: http://127.0.0.1:${p}/api`));
}
