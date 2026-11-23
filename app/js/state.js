// Gemeinsamer App-Zustand: Einstellungen und Phasen. Änderungen werden über `bus` gemeldet.

import { load, save } from './store.js';

export const DEFAULT_SETTINGS = {
  theme: 'auto',        // auto | light | dark | sun
  scale: 1,             // Schriftgröße (Zoom für alte Augen)
  tiles: 'osm',         // osm | topo | none | custom
  tileUrl: '',          // eigene Vorlage {z}/{x}/{y}
  bigLabels: false,     // Karte eine Stufe gröber laden → größere Schrift
  liveMap: true,        // Karte im Live-Modus
  useGps: true,
  maxAcc: 30,           // GPS-Punkte mit schlechterer Genauigkeit (m) ignorieren
  markerStepM: 1000,    // Abstand der Kilometer-Schilder
  wakeLock: true,
  beep: true,
  vibrate: true,
  speech: false,
  autoSplits: true,     // Ansage, wenn GPS-Distanz einen Kilometer erreicht
  timeAlerts: true,     // Ansage bei Mindestzeit / 1 min vor erlaubter Zeit / erlaubte Zeit
  penaltyPerSec: 0.25,
  speedPresets: [7, 12, 13, 14, 15],
};

let seq = 0;
export const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

export function newPhase(name = 'Phase A') {
  return {
    id: uid(), name,
    distM: 7000, mode: 'speed', speedKmh: 15, tMaxSec: 1680,
    minRule: 'auto', tMinSec: 1560, bufferSec: 20, stepM: 1000,
    route: null, // [[lat, lon], ...] aus GPX oder früherer Fahrt
  };
}

export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export const state = {
  settings: { ...DEFAULT_SETTINGS, ...load('settings', {}) },
  phases: load('phases', null) || [newPhase()],
  activeId: load('activeId', null),
};
if (!state.phases.length) state.phases.push(newPhase());
if (!state.phases.some(p => p.id === state.activeId)) state.activeId = state.phases[0].id;

export function setSettings(patch) {
  Object.assign(state.settings, patch);
  save('settings', state.settings);
  emit('settings', patch);
}

export const activePhase = () => state.phases.find(p => p.id === state.activeId) || state.phases[0];

export function setActive(id) {
  state.activeId = id;
  save('activeId', id);
  emit('phases');
}

export function updatePhase(id, patch) {
  const p = state.phases.find(x => x.id === id);
  if (!p) return;
  Object.assign(p, patch);
  savePhases();
}

export function savePhases() {
  save('phases', state.phases);
  save('activeId', state.activeId);
  emit('phases');
}

export function addPhase(copyFrom) {
  const p = copyFrom ? { ...structuredClone(copyFrom), id: uid(), name: `${copyFrom.name} (Kopie)` } : newPhase(`Phase ${state.phases.length + 1}`);
  state.phases.push(p);
  state.activeId = p.id;
  savePhases();
  return p;
}

export function removePhase(id) {
  state.phases = state.phases.filter(p => p.id !== id);
  if (!state.phases.length) state.phases.push(newPhase());
  if (state.activeId === id) state.activeId = state.phases[0].id;
  savePhases();
}

/** Ersetzt alles (Backup-Import). */
export function replaceAll({ settings, phases, activeId }) {
  if (settings) state.settings = { ...DEFAULT_SETTINGS, ...settings };
  if (Array.isArray(phases) && phases.length) state.phases = phases;
  state.activeId = phases?.some(p => p.id === activeId) ? activeId : state.phases[0].id;
  save('settings', state.settings);
  savePhases();
  emit('settings', state.settings);
}
