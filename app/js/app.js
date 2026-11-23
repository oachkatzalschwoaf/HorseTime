// Einstieg: Design anwenden, Ansichten initialisieren, Navigation, Service Worker, Installation.

import { $, $$, toast } from './dom.js';
import { state, bus, setSettings } from './state.js';
import { load, save } from './store.js';
import { initPlan, refreshPlan } from './ui-plan.js';
import { initLive, showLive, getTracker, _debug } from './ui-live.js';
import { initCalc } from './ui-calc.js';
import { initRuns, refreshRuns } from './ui-runs.js';
import { initSettings } from './ui-settings.js';

export const VERSION = '1.0.0';
const VIEWS = ['plan', 'live', 'calc', 'runs', 'settings'];
const install = { prompt: null, onAvailable: null };

function applyTheme() {
  const s = state.settings;
  const root = document.documentElement;
  if (s.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = s.theme;
  root.style.setProperty('--scale', s.scale);
  const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').content = s.theme === 'sun' ? '#ffffff' : dark ? '#151f1d' : '#00695c';
}

function defaultView() {
  const st = getTracker()?.run?.state;
  if (st === 'running' || st === 'armed') return 'live';
  const last = load('tab', 'plan');
  return VIEWS.includes(last) ? last : 'plan';
}

let current = null;
function route() {
  let v = location.hash.slice(1);
  if (!VIEWS.includes(v)) v = defaultView();
  if (v === current) return;
  current = v;
  $$('.view').forEach(s => { s.hidden = s.dataset.view !== v; });
  $$('.tabs a').forEach(a => {
    if (a.dataset.tab === v) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  showLive(v === 'live');
  if (v === 'plan') refreshPlan();
  if (v === 'runs') refreshRuns();
  save('tab', v);
  window.scrollTo(0, 0);
}

function registerSw() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Neue Version verfügbar', { action: 'Aktualisieren', ms: 20000, onAction: () => nw.postMessage('skipWaiting') });
        }
      });
    });
  }).catch(e => console.warn('Service Worker nicht registriert', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

function init() {
  applyTheme();
  bus.addEventListener('settings', applyTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  initLive();
  initPlan();
  initCalc();
  initRuns();
  initSettings({ version: VERSION, install });

  window.addEventListener('hashchange', route);
  route();

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    install.prompt = e;
    install.onAvailable?.();
  });
  window.addEventListener('offline', () => toast('Offline – die App läuft weiter, Karte nur aus dem Speicher'));
  window.addEventListener('online', () => toast('Wieder online'));
  registerSw();

  // Für den Smoke-Test (tools/smoke.mjs)
  window.__ht = { state, setSettings, debug: _debug, version: VERSION };
}

init();
