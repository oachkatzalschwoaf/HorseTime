// Service Worker: App-Dateien offline vorhalten, angesehene Kartenkacheln zwischenspeichern.
// Bei JEDER Änderung an App-Dateien VERSION erhöhen – sonst bekommen Nutzer die alte Fassung aus dem Cache.

const VERSION = '1.0.2';
const SHELL = `ht-shell-${VERSION}`;
const TILES = 'ht-tiles-v1';
const TILE_MAX_AGE = 7 * 24 * 3600 * 1000; // danach neu laden (offline: alte Kachel weiter nutzen)
const TILE_MAX = 4000;

const ASSETS = [
  './',
  './index.html',
  './legacy.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/announce.js',
  './js/app.js',
  './js/calc.js',
  './js/dom.js',
  './js/geo.js',
  './js/gpx.js',
  './js/map.js',
  './js/state.js',
  './js/store.js',
  './js/timeline.js',
  './js/tracker.js',
  './js/ui-calc.js',
  './js/ui-live.js',
  './js/ui-plan.js',
  './js/ui-runs.js',
  './js/ui-settings.js',
  './img/apple-touch-icon.png',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/icon-maskable-512.png',
  './img/icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('ht-shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) event.respondWith(shell(req));
  else if (req.destination === 'image') event.respondWith(tile(req));
});

async function shell(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    return await fetch(req);
  } catch (err) {
    if (req.mode === 'navigate') {
      const index = await cache.match('./index.html');
      if (index) return index;
    }
    throw err;
  }
}

let puts = 0;
async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit && Date.now() - Number(hit.headers.get('x-ht-time') || 0) < TILE_MAX_AGE) return hit;
  try {
    const res = await fetch(req);
    // Nur lesbare (CORS-)Antworten speichern; undurchsichtige Antworten belegen sonst viel Speicherkontingent
    if (res.ok && (res.type === 'cors' || res.type === 'basic')) {
      const headers = new Headers(res.headers);
      headers.set('x-ht-time', String(Date.now()));
      const body = await res.clone().arrayBuffer();
      await cache.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }));
      if (++puts % 100 === 0) trim(cache);
    }
    return res;
  } catch {
    return hit || Response.error();
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - TILE_MAX;
  if (excess > 0) for (const k of keys.slice(0, excess + TILE_MAX / 10)) await cache.delete(k);
}
