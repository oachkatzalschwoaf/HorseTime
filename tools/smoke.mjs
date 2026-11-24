// Browser-Smoke-Test ohne Abhängigkeiten: Dev-Server + Edge/Chrome headless über das DevTools-Protokoll.
// Prüft Konsolenfehler, Manifest/Installierbarkeit, simuliert eine Fahrt, startet offline neu
// und speichert Screenshots.
//   npm run smoke                 → Screenshots nach %TEMP%/horsetime-smoke
//   npm run smoke -- --out <dir>  → anderer Ordner;  BROWSER=<pfad> für einen anderen Browser

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './serve.mjs';

const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : join(tmpdir(), 'horsetime-smoke');
mkdirSync(OUT, { recursive: true });

const exe = CANDIDATES.find(p => existsSync(p));
if (!exe) { console.error('Kein Chrome/Edge gefunden – BROWSER=<pfad> setzen.'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const warnings = [];
const check = (cond, msg) => { if (!cond) errors.push('Prüfung fehlgeschlagen: ' + msg); else console.log('  ✔', msg); };

const server = await startServer({ port: 0, quiet: true });
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), 'ht-profile-'));
const proc = spawn(exe, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let ws;
try {
  const wsUrl = await new Promise((ok, fail) => {
    let buf = '';
    const t = setTimeout(() => fail(new Error('Browser meldet keinen DevTools-Port')), 20000);
    proc.stderr.on('data', d => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); ok(m[1]); }
    });
  });

  ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', fail, { once: true }); });
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(`${msg.error.message}`)); else ok(msg.result);
    } else listeners.forEach(f => f(msg));
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const id = ++seq;
    pending.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  listeners.push(msg => {
    if (msg.sessionId !== sessionId) return;
    const p = msg.params;
    if (msg.method === 'Runtime.exceptionThrown') errors.push('Exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push('console.error: ' + p.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'warning') warnings.push('console.warn: ' + p.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && p.entry.level === 'error') warnings.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url || ''}`);
  });
  await S('Runtime.enable');
  await S('Page.enable');
  await S('Log.enable');

  const evaluate = async expr => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(expr).catch(() => false)) return true;
      await sleep(100);
    }
    throw new Error('Zeitüberschreitung beim Warten auf: ' + expr);
  };
  const shot = async name => {
    const { data } = await S('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, name + '.png');
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('  📷', file);
  };
  const go = async hash => { await evaluate(`location.hash = '${hash}'`); await sleep(400); };
  const phone = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } };
  const landscape = { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } };

  // Strecke: gerade Linie, Richtung 125° (Testkoordinaten)
  const START = [48.2165, 16.3985];
  const along = m => {
    const n = m * Math.cos(125 * Math.PI / 180), e = m * Math.sin(125 * Math.PI / 180);
    return [START[0] + n / 111320, START[1] + e / (111320 * Math.cos(START[0] * Math.PI / 180))];
  };

  await send('Browser.grantPermissions', { origin, permissions: ['geolocation'] });
  await S('Emulation.setGeolocationOverride', { latitude: START[0], longitude: START[1], accuracy: 6 });
  await S('Emulation.setDeviceMetricsOverride', phone);

  console.log('▶ Laden');
  await S('Page.navigate', { url: origin + '/#plan' });
  await waitFor('document.readyState === "complete" && !!window.__ht');
  await sleep(600);

  const manifest = await S('Page.getAppManifest');
  check(manifest.errors.length === 0, `Manifest ohne Fehler ${manifest.errors.map(e => e.message).join('; ')}`);

  console.log('▶ Plan');
  check((await evaluate(`document.querySelector('#planResult').textContent`)).includes('28:00'), 'Plan zeigt erlaubte Zeit 28:00 für 7 km / 15 km/h');
  check(await evaluate(`document.querySelectorAll('#planSplits tbody tr').length === 7`), 'Plan zeigt 7 Zwischenzeiten');
  await shot('01-plan');

  console.log('▶ Rechner');
  await go('#calc');
  check(await evaluate(`document.querySelector('#cTime').value === '28:00'`), 'Rechner: 7000 m bei 15 km/h = 28:00');
  await evaluate(`(() => { const i = document.querySelector('#uKmh'); i.value = '15'; i.dispatchEvent(new Event('input')); })()`);
  check(await evaluate(`document.querySelector('#uMpm').value === '250' && document.querySelector('#uPace').value === '4:00'`), 'Umrechner: 15 km/h = 250 m/min = 4:00 min/km');
  await shot('02-rechner');

  console.log('▶ Fahrt');
  await go('#live');
  await sleep(1500);
  await shot('03-fahrt-bereit');
  await evaluate(`document.querySelector('#btnStart').click()`);
  await sleep(300);
  check(await evaluate(`__ht.debug.tracker.run.state === 'running'`), 'Fahrt läuft nach Start');

  // 10 Minuten Fahrt mit 4 m/s simulieren, Schilder bei km 1 und 2 tippen
  const feed = [];
  for (let i = 0; i <= 120; i++) feed.push([i * 5000, ...along(i * 5 * 4.0)]);
  await evaluate(`(() => {
    const tr = __ht.debug.tracker, r = tr.run, feed = ${JSON.stringify(feed)};
    const t0 = Date.now() - 600000;
    Object.assign(r, { startAt: t0, points: [], anchor: null, gpsDist: 0, offset: 0, markers: [], autoSplits: [], announcedMax: 0 });
    for (const [dt, lat, lon] of feed) {
      tr.onPosition({ coords: { latitude: lat, longitude: lon, accuracy: 6, speed: 4.0, heading: 125 } }, t0 + dt);
      if (dt === 255000 || dt === 505000) tr.addMarker(t0 + dt + 1000);
    }
  })()`);
  const end = along(2400);
  await S('Emulation.setGeolocationOverride', { latitude: end[0], longitude: end[1], accuracy: 6 });
  await sleep(1500);
  const live = await evaluate(`({
    dist: document.querySelector('#tDist').textContent,
    delta: document.querySelector('#liveDelta').textContent,
    markers: __ht.debug.tracker.run.markers.map(m => m.d),
    corr: document.querySelector('#tCorr').textContent,
  })`);
  console.log('   ', JSON.stringify(live));
  check(live.markers.join() === '1000,2000', 'Schilder rasten auf km 1 und 2 ein');
  check(/^2,[34]\d$/.test(live.dist), `Distanz ~2,4 km (${live.dist})`);
  check(/hinter Plan|vor Plan|im Plan/.test(live.delta), `Abweichung angezeigt (${live.delta})`);
  await shot('04-fahrt-laeuft');

  await S('Emulation.setDeviceMetricsOverride', landscape);
  await sleep(1200);
  await shot('05-fahrt-quer');
  await S('Emulation.setDeviceMetricsOverride', phone);

  await evaluate(`__ht.setSettings({ theme: 'dark', scale: 1.5 })`);
  await sleep(1200);
  await shot('06-fahrt-dunkel-gross');
  check(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'Kein horizontales Scrollen bei 150 % Schrift');
  await evaluate(`__ht.setSettings({ theme: 'light', scale: 1 })`);
  await evaluate(`document.querySelector('#liveMap').scrollIntoView()`);
  await sleep(1200);
  await shot('06b-fahrt-hell-karte');
  await evaluate(`window.scrollTo(0, 0)`);
  await evaluate(`__ht.setSettings({ theme: 'sun', scale: 1 })`);
  await sleep(1200);
  await shot('07-fahrt-sonne');
  await evaluate(`__ht.setSettings({ theme: 'auto', scale: 1 })`);

  console.log('▶ Ziel');
  await evaluate(`__ht.debug.finishRun()`);
  await sleep(800);
  check(await evaluate(`!document.querySelector('#liveResult').hidden`), 'Ergebnis wird angezeigt');
  await shot('08-ergebnis');

  console.log('▶ Verlauf');
  await go('#runs');
  await sleep(500);
  check(await evaluate(`document.querySelectorAll('.run-item').length === 1`), 'Fahrt im Verlauf gespeichert');
  await shot('09-verlauf');
  await evaluate(`document.querySelector('.run-item').click()`);
  await sleep(2000);
  await shot('10-fahrt-detail');
  await evaluate(`document.querySelector('#runDlg').close()`);

  console.log('▶ Optionen');
  await go('#settings');
  await shot('11-optionen');

  console.log('▶ Offline');
  await waitFor(`navigator.serviceWorker.ready.then(r => !!r.active)`, 15000);
  await sleep(500);
  const installErr = await S('Page.getInstallabilityErrors').catch(() => null);
  if (installErr) check(installErr.installabilityErrors.length === 0, `Installierbar ${installErr.installabilityErrors.map(e => e.errorId).join(', ')}`);
  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
  await S('Network.enable');
  await S('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await S('Page.reload', { ignoreCache: false });
  await sleep(500);
  await waitFor('document.readyState === "complete" && !!window.__ht', 10000);
  await go('#plan');
  check(await evaluate(`document.querySelector('#planResult').textContent.includes('28:00')`), 'App startet offline (Service Worker)');
  await shot('12-offline');

  console.log('▶ Alte Version (offline)');
  await go('#settings');
  await evaluate(`document.querySelector('#sLegacy').click()`);
  await waitFor(`location.pathname.endsWith('/legacy.html') && document.readyState === 'complete'`);
  await evaluate(`(() => {
    const set = (id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input')); };
    set('etDistance', '7000'); set('etSteps', '1000');
  })()`);
  check(await evaluate(`document.title.includes('TimeTable') && !!document.querySelector('a.back[href="./#settings"]')`), 'Alte Version lädt offline, mit Link zurück');
  await shot('13-alte-version');
  const legacyInstall = await S('Page.getInstallabilityErrors').catch(() => null);
  if (legacyInstall) check(legacyInstall.installabilityErrors.length === 0, `Alte Version: installierbar ${legacyInstall.installabilityErrors.map(e => e.errorId).join(', ')}`);
  await evaluate(`document.querySelector('a.back').click()`);
  await sleep(300);
  check(await evaluate(`document.getElementById('leaveDlg').open && !document.getElementById('leaveHint').hidden && location.pathname.endsWith('/legacy.html')`), 'Zurück zur neuen Version fragt nach (mit Hinweis auf Eingaben)');
  await shot('14-abfrage-zurueck');
  await evaluate(`document.getElementById('leaveOk').click()`);
  await waitFor(`location.hash === '#settings' && !!window.__ht && !document.querySelector('#view-settings').hidden`);
  check(true, 'Nach „Wechseln“ zurück in HorseTime → Optionen');
} catch (e) {
  errors.push('Abbruch: ' + e.message);
} finally {
  try { ws?.close(); } catch { /* egal */ }
  proc.kill();
  server.close?.();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Browser hält evtl. noch Dateien */ }
}

const tileWarn = warnings.filter(w => /tile|opentopomap|openstreetmap/i.test(w)).length;
for (const w of warnings.filter(w => !/tile|opentopomap|openstreetmap/i.test(w))) console.log('  ⚠', w);
if (tileWarn) console.log(`  ⚠ ${tileWarn} Meldungen zu Kartenkacheln (Netz)`);
if (errors.length) {
  console.log('\n✖ Fehler:');
  errors.forEach(e => console.log('  ', e));
  process.exit(1);
}
console.log('\n✔ Smoke-Test bestanden. Screenshots:', OUT);
process.exit(0);
