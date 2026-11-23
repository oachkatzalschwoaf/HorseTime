// Kleine DOM-Helfer: Abfragen, Toast, Bestätigungsdialog, Download, Wake Lock.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

export const icon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** Segment-Schalter: gedrückten Knopf markieren bzw. Klicks melden. */
export function setSeg(el, value) {
  $$('button[data-v]', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(value))));
}
export function onSeg(el, fn) {
  el.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) fn(b.dataset.v); });
}

/** Chip-Leiste. items: [{ v, label }]; aktiver Wert wird markiert. */
export function renderChips(el, items, current, onPick) {
  el.replaceChildren(...items.map(it => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = it.label;
    b.setAttribute('aria-pressed', String(Number(it.v) === Number(current)));
    b.addEventListener('click', () => onPick(it.v));
    return b;
  }));
}

let toastTimer = 0;
/** Kurze Meldung; optional mit Aktionsknopf (z. B. „Rückgängig“). */
export function toast(msg, { action, onAction, ms = 3500 } = {}) {
  const el = $('#toast');
  el.replaceChildren();
  const span = document.createElement('span');
  span.textContent = msg;
  el.append(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action;
    b.addEventListener('click', () => { el.classList.remove('show'); onAction?.(); });
    el.append(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Bestätigung per <dialog>. Ergebnis: true/false. */
export function confirmDialog(text, { ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) {
  return new Promise(resolve => {
    const dlg = $('#confirm');
    $('#confirmText', dlg).textContent = text;
    const okBtn = $('#confirmOk', dlg);
    okBtn.textContent = ok;
    okBtn.classList.toggle('danger', danger);
    $('#confirmCancel', dlg).textContent = cancel;
    const done = v => { dlg.close(); resolve(v); };
    okBtn.onclick = () => done(true);
    $('#confirmCancel', dlg).onclick = () => done(false);
    dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}

export function download(filename, text, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function readFile(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = async () => resolve(inp.files[0] ? await inp.files[0].text() : null);
    inp.click();
  });
}

export const fileStamp = ms => {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

export const safeName = s => String(s || 'fahrt').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40);

// ---------- Bildschirm anlassen ----------
let lock = null;
let wantLock = false;
export async function keepAwake(on) {
  wantLock = on;
  try {
    if (on && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => { if (wantLock && document.visibilityState === 'visible') keepAwake(true); });

/** Langes Drücken (z. B. Stopp). Tastatur/Screenreader: Klick → Rückfrage. */
export function holdButton(btn, ms, onDone, confirmText) {
  let timer = 0;
  const cancel = () => { clearTimeout(timer); btn.classList.remove('holding'); };
  btn.style.setProperty('--hold', ms + 'ms');
  btn.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    btn.classList.add('holding');
    timer = setTimeout(() => { btn.classList.remove('holding'); btn.dataset.fired = '1'; onDone(); }, ms);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, cancel));
  btn.addEventListener('click', async e => {
    if (btn.dataset.fired) { delete btn.dataset.fired; return; }
    if (e.detail === 0 && await confirmDialog(confirmText, { ok: 'Ja' })) onDone();
    else if (e.detail > 0) toast('Gedrückt halten');
  });
  btn.addEventListener('contextmenu', e => e.preventDefault());
}
