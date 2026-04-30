// ────────────────────────────────────────────────────────────────
// Audio engine — drone bed, brush whisper, bell, hold tone.
// All synthesized via Web Audio API, no external samples.
//
// Browsers block audio autoplay until a user gesture. The `attachUnlockListeners`
// helper sets up explicit-gesture listeners (click/keydown/touch — *not* mousemove,
// since a stray cursor sweep would silently unlock and dismiss our hint UI).
// ────────────────────────────────────────────────────────────────

let actx = null;
let masterGain = null;
let audioStarted = false;
let onUnlockCb = null;
let holdToneNodes = null;

export function isStarted() { return audioStarted; }
export function getContext() { return actx; }
export function getTime()    { return actx ? actx.currentTime : 0; }

export function setOnUnlock(cb) { onUnlockCb = cb; }

export function tryStart() {
  if (audioStarted) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!actx) { try { actx = new AC(); } catch (e) { return; } }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  if (actx.state === 'running') {
    _bootDrone();
    audioStarted = true;
    if (onUnlockCb) onUnlockCb();
  }
}

// Attach persistent listeners to explicit gestures only.
export function attachUnlockListeners() {
  ['pointerdown','mousedown','click','keydown','touchstart','touchend'].forEach(ev =>
    window.addEventListener(ev, tryStart, { passive: true, capture: true }));
}

// ── Internal: drone bed (called once on first unlock) ───────────
function _bootDrone() {
  masterGain = actx.createGain();
  masterGain.gain.value = 0.55;
  masterGain.connect(actx.destination);
  const t0 = actx.currentTime;

  // Warmer drone — paired notes with subtle beating, dropped harsh top.
  // Higher-frequency layers ensure audibility on laptop speakers (which roll off below ~150 Hz).
  const layers = [
    { f: 110.0, vol: 0.060 },
    { f: 110.5, vol: 0.034 },   // ~0.5 Hz beating with 110, gives chorus warmth
    { f: 165.0, vol: 0.046 },
    { f: 165.4, vol: 0.022 },
    { f: 220.0, vol: 0.038 },
    { f: 220.6, vol: 0.020 },
  ];
  layers.forEach(({ f, vol }, i) => {
    const o   = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const lfo = actx.createOscillator(); lfo.frequency.value = 0.06 + i * 0.011;
    const lfoG = actx.createGain(); lfoG.gain.value = f * 0.0035;
    lfo.connect(lfoG).connect(o.frequency);
    const g = actx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 6.0);
    o.connect(g).connect(masterGain);
    o.start(); lfo.start();
  });
}

// ── Brush whisper — filtered pink noise that sweeps freq over `dur`s ────
export function brushSound(atTime, dur, freqStart, freqEnd, peakGain) {
  if (!actx || !masterGain) return;
  const len = Math.max(1, Math.floor(actx.sampleRate * (dur + 0.1)));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = 0.965 * last + 0.035 * w;
    d[i] = last * 4.5;
  }
  const src = actx.createBufferSource(); src.buffer = buf;
  const bp = actx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(freqStart, atTime);
  bp.frequency.linearRampToValueAtTime(freqEnd, atTime + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(0, atTime);
  g.gain.linearRampToValueAtTime(peakGain, atTime + dur * 0.5);
  g.gain.linearRampToValueAtTime(0.0, atTime + dur);
  src.connect(bp).connect(g).connect(masterGain);
  src.start(atTime); src.stop(atTime + dur + 0.2);
}

// ── Bell — integer harmonics, gentle attack, long decay ─────────
export function bell(atTime, freq) {
  if (!actx || !masterGain) return;
  [[1, 0.080], [2, 0.038], [3, 0.020], [4, 0.010]].forEach(([h, gain]) => {
    const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * h;
    const g = actx.createGain();
    g.gain.setValueAtTime(0, atTime);
    g.gain.linearRampToValueAtTime(gain, atTime + 0.060);
    g.gain.exponentialRampToValueAtTime(0.0002, atTime + 6.0);
    o.connect(g).connect(masterGain);
    o.start(atTime); o.stop(atTime + 6.1);
  });
}

// ── Sustained hold tone — root + 5th + octave, fades in/out ─────
export function startHoldTone(rootFreq) {
  if (!actx || !masterGain) return;
  const t = actx.currentTime;
  const oscs = [];
  [1.0, 1.5, 2.0].forEach((mult, i) => {
    const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = rootFreq * mult;
    const g = actx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.034 - i * 0.009, t + 1.2);
    o.connect(g).connect(masterGain);
    o.start();
    oscs.push({ o, g });
  });
  holdToneNodes = oscs;
}
export function stopHoldTone() {
  if (!holdToneNodes || !actx) return;
  const t = actx.currentTime;
  holdToneNodes.forEach(({ o, g }) => {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + 1.6);
    o.stop(t + 1.8);
  });
  holdToneNodes = null;
}
