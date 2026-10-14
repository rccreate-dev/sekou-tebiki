'use strict';
/* ===== 端末内の保存(IndexedDB。使えない環境ではメモリだけで動く) ===== */
const Store = (() => {
  let dbp = null;
  const mem = { kv: new Map(), media: new Map() };
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(resolve => {
      try {
        const rq = indexedDB.open('tebiki', 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); rq.result.createObjectStore('media'); };
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(null);
        rq.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(db => new Promise(resolve => {
      if (!db) return resolve(undefined);
      try {
        const t = db.transaction(store, mode), os = t.objectStore(store), rq = fn(os);
        t.oncomplete = () => resolve(rq && rq.result);
        t.onerror = t.onabort = () => resolve(undefined);
      } catch (e) { resolve(undefined); }
    }));
  }
  return {
    async kvGet(k) { const v = await tx('kv', 'readonly', os => os.get(k)); return v !== undefined ? v : mem.kv.get(k); },
    async kvSet(k, v) { mem.kv.set(k, v); await tx('kv', 'readwrite', os => os.put(v, k)); },
    async kvDel(k) { mem.kv.delete(k); await tx('kv', 'readwrite', os => os.delete(k)); },
    async mediaGet(k) { const v = await tx('media', 'readonly', os => os.get(k)); return v !== undefined ? v : mem.media.get(k); },
    async mediaPut(k, blob) { mem.media.set(k, blob); await tx('media', 'readwrite', os => os.put(blob, k)); },
    async clearData() { mem.media.clear(); mem.kv.delete('boot'); await tx('media', 'readwrite', os => os.clear()); await tx('kv', 'readwrite', os => os.delete('boot')); },
    async clearAll() { mem.kv.clear(); mem.media.clear(); await tx('kv', 'readwrite', os => os.clear()); await tx('media', 'readwrite', os => os.clear()); }
  };
})();
