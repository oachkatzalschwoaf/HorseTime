// Signale: Ton (WebAudio), Vibration, Sprachausgabe. Alles optional und fehlertolerant.

let ctx = null;

/** Muss einmal aus einer Nutzeraktion heraus aufgerufen werden (Browser-Autoplay-Regeln). */
export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* kein Audio */ }
  try {
    if ('speechSynthesis' in window && !unlockAudio.spoken) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
      unlockAudio.spoken = true;
    }
  } catch { /* egal */ }
}

/** tones: [[freqHz, ms], ...] nacheinander mit kurzer Pause. */
export function beep(tones = [[880, 120]], gain = 0.3) {
  if (!ctx) return;
  try {
    let at = ctx.currentTime + 0.01;
    for (const [freq, ms] of tones) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(gain, at + 0.01);
      g.gain.setValueAtTime(gain, at + ms / 1000 - 0.02);
      g.gain.linearRampToValueAtTime(0, at + ms / 1000);
      osc.connect(g).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + ms / 1000 + 0.02);
      at += ms / 1000 + 0.08;
    }
  } catch { /* egal */ }
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* egal */ }
}

let voice = null;
export function speak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  try {
    voice ??= speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('de')) || null;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE';
    if (voice) u.voice = voice;
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* egal */ }
}

/** Signal je nach Einstellungen. kind: tick | go | split | warn | alarm | ok */
export function signal(settings, kind, text) {
  const tones = {
    tick: [[880, 90]],
    go: [[1320, 450]],
    split: [[988, 110], [1319, 160]],
    warn: [[660, 180], [660, 180]],
    alarm: [[520, 300], [520, 300], [520, 300]],
    ok: [[1047, 120]],
  }[kind];
  const vib = { tick: 40, go: 400, split: [80, 60, 80], warn: [200, 100, 200], alarm: [400, 150, 400, 150, 400], ok: 60 }[kind];
  if (settings.beep && tones) beep(tones);
  if (settings.vibrate && vib) vibrate(vib);
  if (settings.speech && text) speak(text);
}
