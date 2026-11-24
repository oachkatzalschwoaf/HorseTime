// Prüft eine ausgelieferte HorseTime-Seite: HTTPS + Umleitung, alle Offline-Dateien samt MIME-Typ,
// ausgelieferte Version, Manifest, Service Worker und Installierbarkeit (Chromes eigene Prüfung).
//   npm run check -- https://horse.cwinkler.org/

import { readFileSync } from 'node:fs';
import { openBrowser, sleep } from './cdp.mjs';

let base = process.argv[2];
if (!base) { console.error('Aufruf: npm run check -- https://<adresse>/'); process.exit(2); }
if (!/^https?:\/\//.test(base)) base = 'https://' + base;
if (!base.endsWith('/')) base += '/';

const problems = [];
const check = (cond, msg) => {
  console.log(cond ? '  ✔' : '  ✖', msg);
  if (!cond) problems.push(msg);
};

const swLocal = readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');
const assets = [...swLocal.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
const localVersion = swLocal.match(/VERSION = '([^']+)'/)?.[1];

console.log(`▶ ${base}`);
check(base.startsWith('https://'), 'HTTPS (Pflicht für Installation, Offline-Betrieb und GPS)');
try {
  const http = new URL(base);
  http.protocol = 'http:';
  const r = await fetch(http, { redirect: 'manual' });
  const loc = r.headers.get('location') || '';
  check(r.status >= 300 && r.status < 400 && loc.startsWith('https://'), `http:// leitet auf https:// um (Status ${r.status}${loc ? ` → ${loc}` : ''})`);
} catch (e) {
  check(false, `http:// nicht prüfbar: ${e.message}`);
}

console.log('▶ Dateien');
const TYPES = {
  '.js': /javascript/, '.css': /text\/css/, '.html': /text\/html/, '.png': /image\/png/,
  '.svg': /image\/svg\+xml/, '.webmanifest': /application\/(manifest\+)?json/,
};
let fileProblems = 0;
for (const a of assets) {
  try {
    const r = await fetch(new URL(a, base));
    const ct = r.headers.get('content-type') || '';
    const ext = a.match(/\.[a-z]+$/)?.[0];
    if (r.status !== 200 || (TYPES[ext] && !TYPES[ext].test(ct))) {
      check(false, `${a}: ${r.status} ${ct}`);
      fileProblems++;
    }
  } catch (e) {
    check(false, `${a}: ${e.message}`);
    fileProblems++;
  }
}
if (!fileProblems) check(true, `${assets.length} Dateien erreichbar, MIME-Typen passen`);
try {
  const remote = (await (await fetch(new URL('sw.js', base))).text()).match(/VERSION = '([^']+)'/)?.[1];
  check(remote === localVersion, `Ausgelieferte Version ${remote ?? '?'} = lokale Version ${localVersion}`);
} catch { /* oben schon gemeldet */ }

console.log('▶ Browser (Chrome-Prüfungen)');
let b;
try {
  b = await openBrowser();
  await b.S('Page.navigate', { url: base });
  await b.waitFor('document.readyState === "complete"', 20000);
  const man = await b.S('Page.getAppManifest');
  check(!!man.url && man.errors.length === 0, `Manifest geladen${man.errors.length ? ': ' + man.errors.map(e => e.message).join('; ') : ''}`);
  const sw = await b.evaluate(`navigator.serviceWorker
    ? Promise.race([navigator.serviceWorker.ready.then(r => !!r.active), new Promise(r => setTimeout(() => r(false), 15000))])
    : false`);
  check(sw, 'Service Worker aktiv (App-Dateien offline verfügbar)');
  await sleep(500);
  const inst = await b.S('Page.getInstallabilityErrors').catch(() => null);
  if (inst) check(inst.installabilityErrors.length === 0, `Installierbar${inst.installabilityErrors.length ? ': ' + inst.installabilityErrors.map(e => e.errorId).join(', ') : ''}`);
  for (const e of b.errors) check(false, e);
} catch (e) {
  check(false, 'Browser-Prüfung abgebrochen: ' + e.message);
} finally {
  await b?.close();
}

console.log(problems.length ? `\n✖ ${problems.length} Problem(e)` : '\n✔ Alles in Ordnung');
process.exit(problems.length ? 1 : 0);
