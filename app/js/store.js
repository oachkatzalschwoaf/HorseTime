// Persistenz: kleine Daten in localStorage, abgeschlossene Fahrten (mit Track) in IndexedDB.

const PREFIX = 'horsetime.';

export function load(key, fallback) {
  try {
    const s = localStorage.getItem(PREFIX + key);
    return s == null ? fallback : JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Speichern fehlgeschlagen', key, e);
    return false;
  }
}

export function clearAll() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
  } catch { /* egal */ }
}

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('horsetime', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('runs', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('runs', mode);
    const req = fn(t.objectStore('runs'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const runs = {
  all: async () => ((await tx('readonly', s => s.getAll())) || []).sort((a, b) => b.startAt - a.startAt),
  get: id => tx('readonly', s => s.get(id)),
  put: run => tx('readwrite', s => s.put(run)),
  del: id => tx('readwrite', s => s.delete(id)),
  clear: () => tx('readwrite', s => s.clear()),
};

/** Browser bitten, die Daten nicht automatisch zu löschen (best effort). */
export async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* egal */ }
}
