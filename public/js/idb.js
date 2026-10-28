// Kleiner Schlüssel-Wert-Speicher im Browser (IndexedDB) für den Unterwegs-Modus:
// letzter Datenstand vom Server, Warteschlange offline gemachter Änderungen und Konflikte.
const DB = 'reisli';
const STORE = 'kv';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => (dbp = null));
  }
  return dbp;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const kvGet = (key) => tx('readonly', (s) => s.get(key)).catch(() => undefined);
export const kvSet = (key, value) => tx('readwrite', (s) => s.put(value, key)).catch(() => undefined);
export const kvDel = (key) => tx('readwrite', (s) => s.delete(key)).catch(() => undefined);
