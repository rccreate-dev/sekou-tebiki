'use strict';
/* オフライン対応。画面の部品だけを端末に保存する。通信(API)・写真は扱わない */
const SW_VERSION = 'tebiki-3.1.4';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/01-util.js', 'js/02-store.js', 'js/03-api.js', 'js/04-media.js', 'js/05-state.js', 'js/06-views.js', 'js/07-sheet.js', 'js/07b-annotate.js', 'js/08-actions.js', 'js/09-main.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SW_VERSION).then(c => Promise.all(SHELL.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => { if (!r.ok) throw new Error(u); return c.put(u, r); })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SW_VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;     // API は素通し
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(hit => hit || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SW_VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});
