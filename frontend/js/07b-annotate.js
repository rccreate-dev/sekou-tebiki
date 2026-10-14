'use strict';
/* ===== 写真への書き込み(ペン・矢印・囲み・ぼかし・スタンプ)。
   端末の中だけで行う。書き込みは写真に焼き込み、書き込む前の写真は登録しない(顔や名札をぼかした写真が、そのまま登録される)。
   書き込みは「画像の幅に対する割合」で持つので、画面の大きさや書き出しの大きさが変わっても同じ位置・同じ太さになる。 ===== */
const Annotate = (() => {
  const COLORS = [['#e5221f', '赤'], ['#ffd60a', '黄'], ['#1f6fe5', '青'], ['#ffffff', '白']];
  const STAMPS = ['○', '×', 'OK', 'NG', 'ココ', '注意', 'Good', 'Bad', '☞', '☝', '⚠'];
  const TOOLS = [['pen', 'ペン'], ['arrow', '矢印'], ['ellipse', '○囲み'], ['rect', '□囲み'], ['blur', 'ぼかし'], ['stamp', 'スタンプ']];
  const WIDTHS = [['thin', '細', .004], ['thick', '太', .009]];
  const HINTS = {
    pen: '指でなぞると線が書けます。',
    arrow: '矢印の根元から先へ、指でなぞります。',
    ellipse: '囲みたい場所を、斜めになぞります。',
    rect: '囲みたい場所を、斜めになぞります。',
    blur: 'ぼかしたい場所（顔・名札・会社名など）を、斜めになぞります。',
    stamp: '置きたい場所を押します。押したまま動かすと、位置を直せます。'
  };
  const STAMP_SIZE = .085;   // スタンプの文字の大きさ(画像の幅に対する割合)

  const wOf = k => (WIDTHS.find(x => x[0] === k) || WIDTHS[1])[2];

  /* ---- 描画(プレビューも書き出しも同じ関数) ---- */
  function outline(g, lw, fn) {   // どんな背景でも見えるよう、細い影を先に引く
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = lw * 1.9; fn(); g.stroke(); g.restore();
  }
  function line(g, col, lw, fn) {
    outline(g, lw, () => { g.beginPath(); fn(); });
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); fn(); g.stroke(); g.restore();
  }
  function drawOne(g, o, W) {
    const P = p => [p[0] * W, p[1] * W];
    if (o.t === 'pen') {
      const lw = wOf(o.w) * W, pts = o.pts.map(P);
      const path = () => { g.moveTo(pts[0][0], pts[0][1]); if (pts.length === 1) g.lineTo(pts[0][0] + .01, pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); };
      line(g, o.c, lw, path);
    } else if (o.t === 'arrow') {
      const lw = wOf(o.w) * W, a = P(o.a), b = P(o.b);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = Math.max(lw * 5, W * .035), spread = .5;
      const h1 = [b[0] - hl * Math.cos(ang - spread), b[1] - hl * Math.sin(ang - spread)], h2 = [b[0] - hl * Math.cos(ang + spread), b[1] - hl * Math.sin(ang + spread)];
      line(g, o.c, lw, () => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.moveTo(h1[0], h1[1]); g.lineTo(b[0], b[1]); g.lineTo(h2[0], h2[1]); });
    } else if (o.t === 'ellipse' || o.t === 'rect') {
      const lw = wOf(o.w) * W, a = P(o.a), b = P(o.b);
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
      if (o.t === 'rect') line(g, o.c, lw, () => g.rect(x, y, w, h));
      else line(g, o.c, lw, () => g.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2));
    } else if (o.t === 'blur') {
      const a = P(o.a), b = P(o.b);
      const x = Math.max(0, Math.round(Math.min(a[0], b[0]))), y = Math.max(0, Math.round(Math.min(a[1], b[1])));
      const w = Math.min(g.canvas.width - x, Math.round(Math.abs(a[0] - b[0]))), h = Math.min(g.canvas.height - y, Math.round(Math.abs(a[1] - b[1])));
      if (w < 2 || h < 2) return;
      const blk = Math.max(6, W * .02), tw = Math.max(1, Math.round(w / blk)), th = Math.max(1, Math.round(h / blk));
      const t = document.createElement('canvas'); t.width = tw; t.height = th;
      t.getContext('2d').drawImage(g.canvas, x, y, w, h, 0, 0, tw, th);
      g.save(); g.imageSmoothingEnabled = false; g.drawImage(t, 0, 0, tw, th, x, y, w, h); g.restore();
    } else if (o.t === 'stamp') {
      const s = STAMP_SIZE * W, p = P(o.p);
      g.save(); g.font = '900 ' + s + 'px "Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = s * .2; g.strokeStyle = o.c === '#ffffff' ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.95)';
      g.strokeText(o.s, p[0], p[1]); g.fillStyle = o.c; g.fillText(o.s, p[0], p[1]); g.restore();
    }
  }
  function drawAll(g, base, ops, W, H) {
    g.clearRect(0, 0, W, H); g.drawImage(base, 0, 0, W, H);
    ops.forEach(o => drawOne(g, o, W));
  }

  /* 書き出し: 元の写真に書き込みを焼き込み、本体とサムネを作る */
  async function render(blob, ops) {
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch (e) { throw { code: 'decode_failed' }; }
    try {
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      drawAll(c.getContext('2d'), bmp, ops, c.width, c.height);
      const full = await shrinkJpeg(c, FULL_MAX, [.9, .85, .78, .7, .6, .5]);
      const th = await shrinkJpeg(drawScaled(c, c.width, c.height, 960), THUMB_MAX, [.82, .74, .66, .58, .5, .4, .3]);
      if (!full || !th || full.size > FULL_MAX || th.size > THUMB_MAX) throw { code: 'decode_failed' };
      return { full, thumb: th };
    } finally { if (bmp.close) bmp.close(); }
  }

  /* ---- 編集画面 ---- */
  let el = null;

  function open(blob, startOps) {
    return new Promise(async resolve => {
      if (el) { resolve(null); return; }
      let bmp;
      try { bmp = await createImageBitmap(blob); } catch (e) { resolve(null); return; }
      const opener = document.activeElement;
      const st = { tool: 'pen', color: COLORS[0][0], width: 'thick', stamp: STAMPS[0], ops: (startOps || []).map(o => JSON.parse(JSON.stringify(o))), cur: null, armed: '', dirty: false };
      el = document.createElement('div'); el.className = 'ann'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '写真に書き込む');
      el.innerHTML =
        '<div class="ann-top"><button type="button" data-a="cancel">やめる</button><button type="button" data-a="undo">1つ戻す</button><button type="button" data-a="clear">全部消す</button><button type="button" class="pri" data-a="done">完了</button></div>' +
        '<div class="ann-stage"><canvas id="ann-cv" aria-label="書き込む写真"></canvas></div>' +
        '<p class="ann-hint" id="ann-hint" role="status"></p>' +
        '<div class="ann-bar">' +
        '<div class="ann-row" id="ann-tools" role="group" aria-label="道具">' + TOOLS.map(t => '<button type="button" data-tool="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' +
        '<div class="ann-row" id="ann-style" role="group" aria-label="色と太さ">' +
        COLORS.map(c => '<button type="button" class="sw" data-color="' + c[0] + '" aria-label="' + c[1] + '" style="--sw:' + c[0] + '"></button>').join('') +
        WIDTHS.map(w => '<button type="button" data-w="' + w[0] + '">' + w[1] + '</button>').join('') + '</div>' +
        '<div class="ann-row" id="ann-stamps" role="group" aria-label="スタンプ">' + STAMPS.map(s => '<button type="button" data-stamp="' + s + '">' + s + '</button>').join('') + '</div>' +
        '</div>';
      document.body.appendChild(el);
      const cv = el.querySelector('#ann-cv'), g = cv.getContext('2d');

      function layout() {
        const stage = el.querySelector('.ann-stage');
        const cs = getComputedStyle(stage);   // 余白(padding)を除いた、写真を置ける広さ
        const sw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), sh = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const sc = Math.min(sw / bmp.width, sh / bmp.height);
        const cssW = Math.max(40, Math.floor(bmp.width * sc)), cssH = Math.max(40, Math.floor(bmp.height * sc));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
        cv.width = Math.min(bmp.width, Math.round(cssW * dpr)); cv.height = Math.round(cv.width * bmp.height / bmp.width);
        redraw();
      }
      function redraw() {
        drawAll(g, bmp, st.cur ? st.ops.concat([st.cur]) : st.ops, cv.width, cv.height);
        el.querySelector('[data-a=undo]').disabled = !st.ops.length;
        el.querySelector('[data-a=clear]').disabled = !st.ops.length;
      }
      function sync() {
        el.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === st.tool)));
        el.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === st.color)));
        el.querySelectorAll('[data-w]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.w === st.width)));
        el.querySelectorAll('[data-stamp]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stamp === st.stamp)));
        el.querySelector('#ann-stamps').hidden = st.tool !== 'stamp';
        el.querySelector('#ann-style').querySelectorAll('[data-w]').forEach(b => { b.hidden = st.tool === 'blur' || st.tool === 'stamp'; });
        el.querySelector('#ann-style').querySelectorAll('[data-color]').forEach(b => { b.hidden = st.tool === 'blur'; });
        el.querySelector('#ann-hint').textContent = HINTS[st.tool];
        const cl = el.querySelector('[data-a=clear]'), ca = el.querySelector('[data-a=cancel]');
        cl.textContent = st.armed === 'clear' ? 'もう一度押すと全部消す' : '全部消す';
        ca.textContent = st.armed === 'cancel' ? 'もう一度押すと書込みを捨てる' : 'やめる';
      }
      let ro = null;
      function close(result) {
        document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', layout); if (ro) ro.disconnect();
        if (bmp.close) bmp.close();
        el.remove(); el = null;
        if (opener && opener.focus && opener.isConnected) opener.focus();
        resolve(result);
      }
      const pos = e => { const r = cv.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(bmp.height / bmp.width, Math.max(0, (e.clientY - r.top) / r.width))]; };

      cv.addEventListener('pointerdown', e => {
        if (st.cur || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault(); cv.setPointerCapture(e.pointerId); st.armed = ''; sync();
        const p = pos(e), t = st.tool;
        if (t === 'pen') st.cur = { t, c: st.color, w: st.width, pts: [p] };
        else if (t === 'arrow' || t === 'ellipse' || t === 'rect') st.cur = { t, c: st.color, w: st.width, a: p, b: p };
        else if (t === 'blur') st.cur = { t, a: p, b: p };
        else st.cur = { t: 'stamp', c: st.color, s: st.stamp, p };
        redraw();
      });
      cv.addEventListener('pointermove', e => {
        const o = st.cur; if (!o) return; e.preventDefault();
        const p = pos(e);
        if (o.t === 'pen') o.pts.push(p); else if (o.t === 'stamp') o.p = p; else o.b = p;
        redraw();
      });
      const end = e => {
        const o = st.cur; if (!o) return;
        st.cur = null;
        let ok = true;
        if (o.a && o.b) ok = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) > .015;   // 触れただけの図形は捨てる
        if (ok) { st.ops.push(o); st.dirty = true; }
        redraw(); sync();
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', () => { st.cur = null; redraw(); });

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); press('cancel'); return; }
        if (e.key !== 'Tab') return;
        const vis = Array.from(el.querySelectorAll('button:not(:disabled)')).filter(x => x.offsetParent !== null);
        if (!vis.length) return;
        const first = vis[0], last = vis[vis.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      function press(a) {
        if (a === 'undo') { st.ops.pop(); st.armed = ''; redraw(); sync(); }
        else if (a === 'clear') {
          if (st.armed !== 'clear') { st.armed = 'clear'; sync(); return; }
          st.ops = []; st.armed = ''; st.dirty = true; redraw(); sync();
        }
        else if (a === 'cancel') {
          if (st.dirty && st.armed !== 'cancel') { st.armed = 'cancel'; sync(); return; }
          close(null);
        }
        else if (a === 'done') close({ ops: st.ops, changed: st.dirty });
      }
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.a) { press(b.dataset.a); return; }
        st.armed = '';
        if (b.dataset.tool) st.tool = b.dataset.tool;
        else if (b.dataset.color) st.color = b.dataset.color;
        else if (b.dataset.w) st.width = b.dataset.w;
        else if (b.dataset.stamp) st.stamp = b.dataset.stamp;
        sync();
      });
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', layout);
      // 道具の段が増減すると写真の置き場の高さが変わる。そのたびに大きさを合わせ直す
      ro = window.ResizeObserver ? new ResizeObserver(layout) : null;
      if (ro) ro.observe(el.querySelector('.ann-stage'));
      sync(); layout();
      const d = el.querySelector('[data-a=done]'); if (d) d.focus({ preventScroll: true });
    });
  }

  return { open, render };
})();

/* 事例シートの写真(新しく選んだもの)に書き込む */
async function annotateMedia(i) {
  const sh = SH(); if (!sh || sh.busy || sh.pending) return;
  const m = sh.media[i];
  if (!m || m.keep || m.type !== 'image') return;
  const orig = m.orig || m.blob;
  const res = await Annotate.open(orig, m.ops || []);
  if (!res || SH() !== sh || !res.changed) return;
  sh.pending++; $('#sh-save').disabled = true; sheetMsg('書き込みを写真に入れています…');
  try {
    const r = await Annotate.render(orig, res.ops);
    if (SH() !== sh) return;
    if (m.turl) URL.revokeObjectURL(m.turl);
    m.orig = orig; m.ops = res.ops; m.blob = r.full; m.thumb = r.thumb; m.turl = URL.createObjectURL(r.thumb); m.done = {};
    sh.dirty = true; drawPrev(); sheetMsg('');
  } catch (e) { sheetMsg('書き込みを写真に入れられませんでした。もう一度試してください。', true); }
  finally { sh.pending--; if (SH() === sh && !sh.pending && !sh.busy) $('#sh-save').disabled = false; }
}
