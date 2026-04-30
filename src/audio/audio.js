// ────────────────────────────────────────────────────────────────
// Audio engine — drone bed, brush whisper, bell, hold tone, stroke
// ticks. All synthesized via Web Audio API, no external samples.
//
// Mood- and pattern-aware: bell harmonics, hold chord, brush
// frequency, and stroke-tick scale all shift with the message's
// emotional register so the audio reads as part of the language.
//
// Browsers block audio autoplay until a user gesture. The
// `attachUnlockListeners` helper sets up explicit-gesture listeners
// (click/keydown/touch — *not* mousemove, since a stray cursor
// sweep would silently unlock and dismiss our hint UI).
// ────────────────────────────────────────────────────────────────

let actx = null;
let masterGain = null;
let audioStarted = false;
let droneBooted = false;
let unlockNotified = false;
let onUnlockCb = null;
let holdToneNodes = null;
let chargeOscs = null;
let chargeGain = null;

// ── Mood-aware sound profiles ──────────────────────────────────

// Bell partials per mood — { decay seconds, [harmonicMult, baseGain] }.
// Non-integer harmonics give each mood a distinct timbre: tritone-laced
// fierce, minor-third clustered mournful, slight-inharmonic sharp.
const MOOD_BELL = {
  calm:       { decay: 6.0, harm: [[1, 0.080], [2, 0.038], [3, 0.020], [4, 0.010]] },
  bold:       { decay: 5.0, harm: [[1, 0.092], [2, 0.048], [3, 0.030], [4, 0.018], [5, 0.010]] },
  shouting:   { decay: 3.8, harm: [[1, 0.110], [2.04, 0.060], [3.0, 0.040], [4.1, 0.022], [5.0, 0.014]] },
  whispering: { decay: 8.0, harm: [[1, 0.046], [2, 0.022], [3, 0.010]] },
  sharp:      { decay: 4.0, harm: [[1, 0.080], [2.05, 0.044], [3.1, 0.028], [4.2, 0.014]] },
  playful:    { decay: 5.0, harm: [[1, 0.076], [2, 0.044], [2.51, 0.026], [3, 0.022], [4, 0.014]] },
  mournful:   { decay: 8.5, harm: [[1, 0.062], [1.20, 0.036], [1.50, 0.022], [3, 0.012]] },
  fierce:     { decay: 4.0, harm: [[1, 0.115], [1.414, 0.058], [2, 0.038], [3, 0.022]] },
};

// Hold-tone chord per mood — multipliers on the root frequency.
const MOOD_CHORD = {
  calm:       [1.0, 1.5, 2.0],                  // P1-P5-P8 (open)
  bold:       [1.0, 1.5, 2.0, 3.0],             // adds the 12th
  shouting:   [1.0, 1.5, 1.778, 2.0],           // dom7
  whispering: [1.0, 2.0, 3.0],                  // octaves only
  sharp:      [1.0, 1.5, 2.125],                // m9 tension
  playful:    [1.0, 1.25, 1.5, 1.667],          // major add6
  mournful:   [1.0, 1.20, 1.5],                 // minor triad
  fierce:     [1.0, 1.414, 2.0],                // tritone + octave
};

// Scale degrees per mood — used to pick stroke-tick pitches so the
// taps feel idiomatic to the message's emotional register.
const MOOD_SCALE = {
  calm:       [1.0, 1.125, 1.25, 1.5, 1.667],
  bold:       [1.0, 1.125, 1.25, 1.5, 1.667, 2.0],
  shouting:   [1.0, 1.20, 1.333, 1.5, 1.778],
  whispering: [1.0, 1.5, 2.0],
  sharp:      [1.0, 1.067, 1.25, 1.5, 1.875],
  playful:    [1.0, 1.125, 1.25, 1.5, 1.667, 2.0],
  mournful:   [1.0, 1.067, 1.20, 1.333, 1.5, 1.60, 1.80],
  fierce:     [1.0, 1.067, 1.25, 1.414, 1.5, 1.60],
};

// Brush frequency offset per mood — mournful sweeps low, sharp/fierce
// higher, whispering pulled toward speech range.
const MOOD_BRUSH = {
  calm: 1.00, bold: 1.10, shouting: 1.30, whispering: 0.75,
  sharp: 1.40, playful: 1.05, mournful: 0.70, fierce: 1.20,
};

// Bell cascade per composition pattern — series of bells offset in
// time and pitch so the strike at HOLD start tells you what kind of
// glyph just landed (a single note for a lone glyph, an arpeggio for
// a triplet, a full pentatonic cascade for a constellation).
const PATTERN_CASCADE = {
  single:        [{ off: 0,    fm: 1.000, gm: 1.00 }],
  compound:      [{ off: 0,    fm: 1.000, gm: 1.00 }, { off: 0.10, fm: 1.500, gm: 0.70 }],
  stack:         [{ off: 0,    fm: 1.000, gm: 1.00 }, { off: 0.08, fm: 2.000, gm: 0.60 }],
  triplet:       [{ off: 0,    fm: 1.000, gm: 1.00 }, { off: 0.09, fm: 1.250, gm: 0.70 }, { off: 0.18, fm: 1.500, gm: 0.60 }],
  orbited:       [{ off: 0,    fm: 1.000, gm: 1.00 }, { off: 0.06, fm: 2.000, gm: 0.50 }],
  framed:        [{ off: 0,    fm: 1.000, gm: 1.20 }],
  constellation: [
    { off: 0,    fm: 1.000, gm: 0.70 },
    { off: 0.08, fm: 1.250, gm: 0.60 },
    { off: 0.18, fm: 1.500, gm: 0.55 },
    { off: 0.30, fm: 1.667, gm: 0.50 },
    { off: 0.45, fm: 2.000, gm: 0.45 },
  ],
  cartouche:     [{ off: 0,    fm: 1.000, gm: 1.00 }, { off: 0.18, fm: 0.500, gm: 0.55 }],
  mirror:        [{ off: 0,    fm: 1.000, gm: 1.00 }, { off: 0.04, fm: 1.000, gm: 0.70 }],
};

export function isStarted() { return audioStarted; }
export function getContext() { return actx; }
export function getTime()    { return actx ? actx.currentTime : 0; }

export function setOnUnlock(cb) { onUnlockCb = cb; }

function ensureMasterGraph() {
  if (!actx || masterGain) return;
  masterGain = actx.createGain();
  masterGain.gain.value = 0.55;
  masterGain.connect(actx.destination);
}

function markStarted() {
  audioStarted = true;
  if (!unlockNotified && onUnlockCb) onUnlockCb();
  unlockNotified = true;
}

// Unlock the audio context. Does NOT start the drone — the entry
// gesture (button-hold) calls this on press to ready the context for
// the charge tone, then bootDrone() fires later on burst.
export function tryStart() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC && !actx) return false;
  if (!actx) { try { actx = new AC(); } catch (e) { return false; } }
  ensureMasterGraph();

  if (actx.state === 'closed') return false;

  if (actx.state === 'running') {
    markStarted();
    return true;
  }

  if (typeof actx.resume === 'function') {
    // Treat the graph as unlocked immediately after a real gesture so
    // sounds can be scheduled in this call stack. resume() resolves a
    // tick later on several browsers, and contexts may become suspended
    // again after tab visibility changes.
    markStarted();
    const resumeResult = actx.resume();
    if (resumeResult && typeof resumeResult.then === 'function') {
      resumeResult.then(markStarted).catch(() => {});
    }
    return true;
  }

  markStarted();
  return true;
}

// Attach persistent listeners to explicit gestures only. Kept for
// callers that don't have their own unlock trigger.
export function attachUnlockListeners() {
  ['pointerdown','mousedown','click','keydown','touchstart','touchend'].forEach(ev =>
    window.addEventListener(ev, tryStart, { passive: true, capture: true }));
}

// Start the continuous drone bed. Called from the entry sequence at
// burst time (separated from unlock so the charge tone can occupy the
// hold phase without competing with the drone).
export function bootDrone() {
  if (!audioStarted || !actx || !masterGain || droneBooted) return;
  droneBooted = true;
  _bootDrone();
}

// ── Internal: drone bed ─────────────────────────────────────────
function _bootDrone() {
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
// Mood shifts the sweep band so mournful brushes low, sharp brushes high.
export function brushSound(atTime, dur, freqStart, freqEnd, peakGain, mood = 'calm') {
  if (!actx || !masterGain) return;
  const offset = MOOD_BRUSH[mood] ?? 1.0;
  const fStart = freqStart * offset;
  const fEnd   = freqEnd   * offset;
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
  bp.frequency.setValueAtTime(fStart, atTime);
  bp.frequency.linearRampToValueAtTime(fEnd, atTime + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(0, atTime);
  g.gain.linearRampToValueAtTime(peakGain, atTime + dur * 0.5);
  g.gain.linearRampToValueAtTime(0.0, atTime + dur);
  src.connect(bp).connect(g).connect(masterGain);
  src.start(atTime); src.stop(atTime + dur + 0.2);
}

// ── Bell — mood-aware harmonics, gentle attack, long decay ──────
// `gainScale` lets the cascade attenuate individual bells in a series.
export function bell(atTime, freq, mood = 'calm', gainScale = 1.0) {
  if (!actx || !masterGain) return;
  const profile = MOOD_BELL[mood] || MOOD_BELL.calm;
  const decay = profile.decay;
  for (const [h, gain] of profile.harm) {
    const o = actx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * h;
    const g = actx.createGain();
    g.gain.setValueAtTime(0, atTime);
    g.gain.linearRampToValueAtTime(gain * gainScale, atTime + 0.060);
    g.gain.exponentialRampToValueAtTime(0.0002, atTime + decay);
    o.connect(g).connect(masterGain);
    o.start(atTime);
    o.stop(atTime + decay + 0.1);
  }
}

// ── Bell cascade — pattern-aware multi-bell ─────────────────────
// A single glyph rings one bell. A constellation rings five, offset in
// time and pitch through the pentatonic. The cascade is the audio
// signature of the composition pattern.
export function bellCascade(atTime, baseFreq, pattern = 'single', mood = 'calm', densityScale = 1.0) {
  if (!actx || !masterGain) return;
  const cascade = PATTERN_CASCADE[pattern] || PATTERN_CASCADE.single;
  for (const { off, fm, gm } of cascade) {
    bell(atTime + off, baseFreq * fm, mood, gm * densityScale);
  }
}

// ── Stroke ticks — quiet pen-tap per glyph element during GATHER ─
// One soft tone per glyph element, scattered across GATHER on a random
// walk through the mood's scale. With ~25 elements over 8s, this gives
// the message a "writing" rhythm — a heartbeat of the language taking
// shape, not a drum pattern.
export function strokeTicks(startAt, dur, count, baseFreq, mood = 'calm') {
  if (!actx || !masterGain || count < 1) return;
  const scale = MOOD_SCALE[mood] || MOOD_SCALE.calm;
  let scaleIdx = Math.floor(scale.length / 2);
  for (let i = 0; i < count; i++) {
    // 15% chance to rest — keeps the rhythm from being too uniform.
    if (Math.random() < 0.15) continue;

    const tFrac = i / count;
    const t = startAt + tFrac * dur * 0.88;

    // Random walk through the scale, biased to step by ±1.
    const step = Math.floor(Math.random() * 3) - 1;
    scaleIdx = Math.max(0, Math.min(scale.length - 1, scaleIdx + step));
    const note = scale[scaleIdx];
    // Occasional octave jump for accent.
    const octave = Math.random() < 0.20 ? 8 : 4;
    const freq = baseFreq * octave * note * (1 + (Math.random() - 0.5) * 0.004);

    const o = actx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;

    const g = actx.createGain();
    const peak = 0.012 + Math.random() * 0.006;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14 + Math.random() * 0.06);

    o.connect(g).connect(masterGain);
    o.start(t);
    o.stop(t + 0.24);
  }
}

// ── Sustained hold tone — mood-aware chord, fades in/out ────────
export function startHoldTone(rootFreq, mood = 'calm') {
  if (!actx || !masterGain) return;
  const t = actx.currentTime;
  const chord = MOOD_CHORD[mood] || MOOD_CHORD.calm;
  const oscs = [];
  chord.forEach((mult, i) => {
    const o = actx.createOscillator();
    o.type = 'sine';
    o.frequency.value = rootFreq * mult;
    const g = actx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(Math.max(0.010, 0.034 - i * 0.008), t + 1.2);
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

// ── Charge tone — low rumble that builds while the entry button is
// held. Volume is driven externally via setChargeLevel(0..1).
export function startChargeTone() {
  if (!actx || !masterGain || chargeOscs) return;
  chargeGain = actx.createGain();
  chargeGain.gain.value = 0;
  chargeGain.connect(masterGain);

  // Three layered sines — root, fifth above, octave above with slight
  // detune. Reads as a deep mechanical hum waking up.
  const o1 = actx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
  const o2 = actx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 82.5;
  const o3 = actx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 110; o3.detune.value = -7;

  o1.connect(chargeGain);
  o2.connect(chargeGain);
  o3.connect(chargeGain);
  o1.start(); o2.start(); o3.start();
  chargeOscs = [o1, o2, o3];
}

export function setChargeLevel(level) {
  if (!chargeGain || !actx) return;
  // Squared mapping — quiet at start of hold, swells fast near full.
  const target = Math.max(0, Math.min(1, level));
  const t = actx.currentTime;
  chargeGain.gain.cancelScheduledValues(t);
  chargeGain.gain.setValueAtTime(chargeGain.gain.value, t);
  chargeGain.gain.linearRampToValueAtTime(target * target * 0.20, t + 0.06);
}

export function stopChargeTone() {
  if (!chargeOscs || !actx) return;
  const t = actx.currentTime;
  chargeGain.gain.cancelScheduledValues(t);
  chargeGain.gain.setValueAtTime(chargeGain.gain.value, t);
  chargeGain.gain.linearRampToValueAtTime(0, t + 0.25);
  const oscs = chargeOscs;
  chargeOscs = null;
  setTimeout(() => { oscs.forEach(o => { try { o.stop(); } catch (e) {} }); }, 320);
}

// ── Burst — heavy audiovisual impact when the hold completes.
// Layered sub-bass + mid thump + high transient crack + filtered
// noise shimmer + bell ping. Pairs with the visual button explosion
// at the same instant; carries the weight of the moment.
export function burstSound() {
  if (!actx || !masterGain) return;
  const t0 = actx.currentTime;

  // Sub-bass kick — drops from 130 Hz to 25 Hz fast, thick attack.
  const sub = actx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(130, t0);
  sub.frequency.exponentialRampToValueAtTime(25, t0 + 0.45);
  const subG = actx.createGain();
  subG.gain.setValueAtTime(0, t0);
  subG.gain.linearRampToValueAtTime(0.65, t0 + 0.015);
  subG.gain.exponentialRampToValueAtTime(0.001, t0 + 1.1);
  sub.connect(subG).connect(masterGain);
  sub.start(t0); sub.stop(t0 + 1.2);

  // Mid thump — adds body so the kick reads on small speakers too.
  const mid = actx.createOscillator();
  mid.type = 'triangle';
  mid.frequency.setValueAtTime(180, t0);
  mid.frequency.exponentialRampToValueAtTime(60, t0 + 0.6);
  const midG = actx.createGain();
  midG.gain.setValueAtTime(0, t0);
  midG.gain.linearRampToValueAtTime(0.30, t0 + 0.02);
  midG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
  mid.connect(midG).connect(masterGain);
  mid.start(t0); mid.stop(t0 + 1.0);

  // Initial transient crack — short white-noise burst through a
  // highpass, gives the moment an attack edge.
  const crackLen = Math.floor(actx.sampleRate * 0.18);
  const crackBuf = actx.createBuffer(1, crackLen, actx.sampleRate);
  const cd = crackBuf.getChannelData(0);
  for (let i = 0; i < crackLen; i++) cd[i] = (Math.random() * 2 - 1);
  const crack = actx.createBufferSource();
  crack.buffer = crackBuf;
  const hp = actx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 1800; hp.Q.value = 0.7;
  const crackG = actx.createGain();
  crackG.gain.setValueAtTime(0, t0);
  crackG.gain.linearRampToValueAtTime(0.18, t0 + 0.005);
  crackG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.20);
  crack.connect(hp).connect(crackG).connect(masterGain);
  crack.start(t0); crack.stop(t0 + 0.22);

  // Long shimmer — bandpass-filtered noise sweep.
  const shLen = Math.floor(actx.sampleRate * 1.4);
  const shBuf = actx.createBuffer(1, shLen, actx.sampleRate);
  const sd = shBuf.getChannelData(0);
  for (let i = 0; i < shLen; i++) sd[i] = (Math.random() * 2 - 1) * 0.4;
  const shimmer = actx.createBufferSource();
  shimmer.buffer = shBuf;
  const bp = actx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 3.5;
  bp.frequency.setValueAtTime(2800, t0);
  bp.frequency.exponentialRampToValueAtTime(700, t0 + 1.1);
  const shimmerG = actx.createGain();
  shimmerG.gain.setValueAtTime(0, t0);
  shimmerG.gain.linearRampToValueAtTime(0.13, t0 + 0.04);
  shimmerG.gain.exponentialRampToValueAtTime(0.001, t0 + 1.3);
  shimmer.connect(bp).connect(shimmerG).connect(masterGain);
  shimmer.start(t0); shimmer.stop(t0 + 1.5);

  // Bell ping — sustained chord that hangs after the impact.
  [[1, 0.075], [2, 0.040], [3, 0.020], [4, 0.012]].forEach(([h, gain]) => {
    const oo = actx.createOscillator();
    oo.type = 'sine';
    oo.frequency.value = 220 * h;
    const gg = actx.createGain();
    gg.gain.setValueAtTime(0, t0 + 0.05);
    gg.gain.linearRampToValueAtTime(gain, t0 + 0.10);
    gg.gain.exponentialRampToValueAtTime(0.001, t0 + 1.8);
    oo.connect(gg).connect(masterGain);
    oo.start(t0 + 0.05);
    oo.stop(t0 + 1.9);
  });
}
