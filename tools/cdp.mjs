// Edge/Chrome headless starten und über das DevTools-Protokoll (CDP) steuern – ohne Abhängigkeiten.
// Genutzt von tools/smoke.mjs und tools/check-site.mjs. BROWSER=<pfad> wählt einen anderen Browser.

import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

/**
 * Startet den Browser mit frischem Profil und öffnet einen Tab.
 * Ergebnis: { send, S (Befehl an den Tab), evaluate, waitFor, screenshot, errors, warnings, close }.
 * errors/warnings sammeln Konsolenfehler, Exceptions und Log-Meldungen der Seite.
 */
export async function openBrowser() {
  const exe = CANDIDATES.find(p => existsSync(p));
  if (!exe) throw new Error('Kein Chrome/Edge gefunden – BROWSER=<pfad> setzen.');
  const profile = mkdtempSync(join(tmpdir(), 'ht-profile-'));
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const errors = [];
  const warnings = [];
  let ws = null;

  const close = async () => {
    try { ws?.close(); } catch { /* egal */ }
    proc.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Browser hält evtl. noch Dateien */ }
  };

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
  } catch (e) {
    await close();
    throw e;
  }

  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
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
  const text = args => args.map(a => a.value ?? a.description).join(' ');
  listeners.push(msg => {
    if (msg.sessionId !== sessionId) return;
    const p = msg.params;
    if (msg.method === 'Runtime.exceptionThrown') errors.push('Exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push('console.error: ' + text(p.args));
    if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'warning') warnings.push('console.warn: ' + text(p.args));
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
  const screenshot = async file => {
    const { data } = await S('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
  };

  return { send, S, evaluate, waitFor, screenshot, errors, warnings, close };
}
