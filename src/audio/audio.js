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
let onUnlockCb = null;
let holdToneNodes = null;

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
