// Ansicht „Optionen“: Einstellungen (generisch über data-set), Installation, Backup.

import { $, $$, toast, confirmDialog, download, readFile, setSeg, onSeg, renderChips, fileStamp } from './dom.js';
import { state, bus, setSettings, replaceAll, DEFAULT_SETTINGS } from './state.js';
import { runs, clearAll } from './store.js';
import { signal, unlockAudio } from './announce.js';
import { parseNum, fmtNum } from './calc.js';

const SCALES = [1, 1.25, 1.5, 1.75, 2];

function parseSetting(key, raw) {
  if (key === 'penaltyPerSec') { const v = parseNum(raw); return v >= 0 ? v : null; }
  if (key === 'speedPresets') {
    const list = String(raw).split(/[;\s]+/).map(parseNum).filter(v => v > 0 && v < 100);
    return list.length ? [...new Set(list)].sort((a, b) => a - b) : null;
  }
  if (key === 'tileUrl') { const v = raw.trim(); return v === '' || /\{z\}/.test(v) && /\{x\}/.test(v) && /\{y\}/.test(v) ? v : null; }
  return raw;
}

const showSetting = (key, v) => (key === 'speedPresets' ? v.map(x => String(x).replace('.', ',')).join('; ') : key === 'penaltyPerSec' ? String(v).replace('.', ',') : v);

export function initSettings({ version, install }) {
  const view = $('#view-settings');

  for (const el of $$('[data-set]', view)) {
    const key = el.dataset.set;
    if (el.classList.contains('seg')) onSeg(el, v => setSettings({ [key]: v }));
    else if (el.type === 'checkbox') el.addEventListener('change', () => setSettings({ [key]: el.checked }));
    else if (el.type === 'range') el.addEventListener('input', () => setSettings({ [key]: Number(el.value) }));
    else if (el.tagName === 'SELECT') el.addEventListener('change', () => setSettings({ [key]: typeof DEFAULT_SETTINGS[key] === 'number' ? Number(el.value) : el.value }));
    else {
      el.addEventListener('change', () => {
        const v = parseSetting(key, el.value);
        el.classList.toggle('bad', v == null);
        if (v != null) { setSettings({ [key]: v }); el.value = showSetting(key, v); }
      });
    }
  }

  $('#sTest').addEventListener('click', () => {
    unlockAudio();
    signal({ ...state.settings, speech: state.settings.speech }, 'split', 'Kilometer drei. 12 Sekunden Rückstand.');
    if (!state.settings.beep && !state.settings.vibrate && !state.settings.speech) toast('Alle Signale sind aus');
  });

  // Installation
  const btn = $('#sInstall');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  // Ohne beforeinstallprompt (z. B. Brave, Firefox) bleibt nur das Browser-Menü
  const showInstall = () => {
    btn.hidden = !install.prompt;
    $('#sMenuHint').hidden = standalone || ios || !!install.prompt;
  };
  install.onAvailable = showInstall;
  btn.addEventListener('click', async () => {
    if (!install.prompt) return;
    install.prompt.prompt();
    const res = await install.prompt.userChoice.catch(() => null);
    if (res?.outcome === 'accepted') toast('App wird installiert');
    install.prompt = null;
    showInstall();
  });
  window.addEventListener('appinstalled', () => { install.prompt = null; showInstall(); $('#sMenuHint').hidden = true; });
  showInstall();
  $('#sIosHint').hidden = standalone || !ios;

  // Backup
  $('#sExport').addEventListener('click', async () => {
    const data = {
      app: 'horsetime', format: 1, exportedAt: new Date().toISOString(),
      settings: state.settings, phases: state.phases, activeId: state.activeId,
      runs: await runs.all().catch(() => []),
    };
    download(`horsetime-backup_${fileStamp(Date.now())}.json`, JSON.stringify(data), 'application/json');
  });
  $('#sImport').addEventListener('click', async () => {
    const text = await readFile('.json,application/json');
    if (!text) return;
    let data;
    try { data = JSON.parse(text); } catch { toast('Keine gültige Backup-Datei'); return; }
    if (data?.app !== 'horsetime') { toast('Keine HorseTime-Backup-Datei'); return; }
    const n = Array.isArray(data.runs) ? data.runs.length : 0;
    if (!(await confirmDialog(`Einstellungen und Phasen ersetzen und ${n} Fahrt(en) ergänzen?`, { ok: 'Laden' }))) return;
    replaceAll(data);
    for (const r of data.runs || []) if (r?.id && r.win) await runs.put(r).catch(() => {});
    bus.dispatchEvent(new CustomEvent('runs'));
    toast('Backup geladen');
  });

  $('#sReload').addEventListener('click', async () => {
    try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* offline */ }
    location.reload();
  });
  $('#sWipe').addEventListener('click', async () => {
    if (!(await confirmDialog('Wirklich alle Phasen, Einstellungen und Fahrten auf diesem Gerät löschen?', { ok: 'Alles löschen', danger: true }))) return;
    clearAll();
    await runs.clear().catch(() => {});
    location.reload();
  });

  bus.addEventListener('settings', sync);
  sync();
  info(version);
}

function sync() {
  const s = state.settings;
  const view = $('#view-settings');
  for (const el of $$('[data-set]', view)) {
    const key = el.dataset.set;
    if (el.classList.contains('seg')) setSeg(el, s[key]);
    else if (el.type === 'checkbox') el.checked = !!s[key];
    else if (document.activeElement !== el) el.value = showSetting(key, s[key]);
  }
  $('#sScaleOut').textContent = `${Math.round(s.scale * 100)} %`;
  $('#sAccOut').textContent = `${s.maxAcc} m`;
  $('#sTileUrlField').hidden = s.tiles !== 'custom';
  renderChips($('#sScaleChips'), SCALES.map(v => ({ v, label: `${Math.round(v * 100)} %` })), s.scale, v => setSettings({ scale: v }));
}

async function info(version) {
  let usage = '';
  try {
    const est = await navigator.storage?.estimate();
    if (est?.usage != null) usage = ` · Speicher ${fmtNum(est.usage / 1048576, 1)} MB`;
  } catch { /* egal */ }
  $('#sInfo').textContent = `Version ${version}${usage}`;
}
