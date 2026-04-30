// ────────────────────────────────────────────────────────────────
// Grammar — mood, vocabulary, composition.
//
// A logogram is a single seeded utterance: one mood, one
// composition pattern, one or more glyphs from the vocabulary.
// Mood biases which structures are likely and scales stroke thickness
// so the same mark can read quiet, dense, sharp, or unstable.
// ────────────────────────────────────────────────────────────────

import { transformElements, strokeLine } from './primitives.js';
import { ring, ellipse } from './shapes.js';
import * as run from './runic.js';

// ── Moods ──────────────────────────────────────────────────────
// `thickScale`  multiplies all stroke thicknesses
// `dressing`    intensity of the post-pass decoration (0..1.5)
// `bias`        per-tone weight multiplier — null tones default to 1
// `compMix`     bias on composition patterns (single / compound / etc)

export const MOODS = {
  calm: {
    thickScale: 0.85, dressing: 0.40,
    bias: { light: 1.2, familiar: 1.4, mystical: 1.0, dark: 0.4, sharp: 0.5 },
    compMix: { single: 1.4, compound: 1.0, stack: 1.0, triplet: 0.7, orbited: 0.6, framed: 1.0, constellation: 0.8, cartouche: 1.0, mirror: 1.0 },
  },
  bold: {
    thickScale: 1.25, dressing: 0.75,
    bias: { light: 1.0, familiar: 1.0, mystical: 1.0, dark: 1.0, sharp: 1.2 },
    compMix: { single: 1.0, compound: 1.2, stack: 1.0, triplet: 0.8, orbited: 0.8, framed: 1.4, constellation: 0.8, cartouche: 1.4, mirror: 1.0 },
  },
  shouting: {
    thickScale: 1.60, dressing: 1.20,
    bias: { light: 0.8, familiar: 0.8, mystical: 1.0, dark: 1.4, sharp: 1.8 },
    compMix: { single: 1.0, compound: 1.4, stack: 0.8, triplet: 1.2, orbited: 1.0, framed: 1.2, constellation: 1.0, cartouche: 0.8, mirror: 1.2 },
  },
  whispering: {
    thickScale: 0.55, dressing: 0.20,
    bias: { light: 1.4, familiar: 1.0, mystical: 1.2, dark: 0.6, sharp: 0.4 },
    compMix: { single: 1.6, compound: 0.8, stack: 1.0, triplet: 0.5, orbited: 1.0, framed: 0.6, constellation: 1.4, cartouche: 0.8, mirror: 0.8 },
  },
  sharp: {
    thickScale: 1.05, dressing: 0.55,
    bias: { light: 0.7, familiar: 0.9, mystical: 1.0, dark: 1.4, sharp: 2.0 },
    compMix: { single: 1.0, compound: 1.0, stack: 1.0, triplet: 1.0, orbited: 0.6, framed: 0.8, constellation: 0.8, cartouche: 0.6, mirror: 1.4 },
  },
  playful: {
    thickScale: 1.10, dressing: 1.30,
    bias: { light: 2.5, familiar: 1.2, mystical: 0.8, dark: 0.3, sharp: 0.5 },
    compMix: { single: 1.0, compound: 1.5, stack: 1.0, triplet: 1.4, orbited: 1.6, framed: 1.0, constellation: 1.2, cartouche: 0.8, mirror: 1.2 },
  },
  mournful: {
    thickScale: 0.70, dressing: 0.30,
    bias: { light: 0.4, familiar: 0.8, mystical: 1.4, dark: 2.5, sharp: 0.8 },
    compMix: { single: 1.6, compound: 0.8, stack: 1.0, triplet: 0.5, orbited: 0.6, framed: 1.2, constellation: 1.0, cartouche: 1.0, mirror: 0.6 },
  },
  fierce: {
    thickScale: 1.45, dressing: 0.85,
    bias: { light: 0.6, familiar: 0.8, mystical: 0.9, dark: 1.6, sharp: 2.2 },
    compMix: { single: 1.0, compound: 1.0, stack: 1.0, triplet: 1.0, orbited: 0.5, framed: 1.0, constellation: 0.7, cartouche: 0.6, mirror: 1.4 },
  },
};

const MOOD_WEIGHTS = {
  calm:       18,
  bold:       14,
  shouting:    8,
  whispering: 14,
  sharp:      12,
  playful:    14,
  mournful:   10,
  fierce:     10,
};

export function pickMood(rng) {
  const entries = Object.entries(MOOD_WEIGHTS);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const r = rng() * total;
  let acc = 0;
  for (const [name, w] of entries) {
    acc += w;
    if (r < acc) return { name, ...MOODS[name] };
  }
  return { name: entries[0][0], ...MOODS[entries[0][0]] };
}

// ── Vocabulary ─────────────────────────────────────────────────
// `tone` controls mood bias; `weight` is the base picking weight.
// Keep this vocabulary abstract. Literal icons make the system
// read as icons; these should read as script fragments.

const VOCAB = [
  { fn: run.scriptColumn,     weight: 14, tone: 'familiar' },
  { fn: run.reedScript,       weight: 12, tone: 'familiar' },
  { fn: run.axialScript,      weight: 11, tone: 'familiar' },
  { fn: run.brokenCartouche,  weight: 8,  tone: 'mystical' },
  { fn: run.latticeSeal,      weight: 8,  tone: 'mystical' },
  { fn: run.pressureKnots,    weight: 7,  tone: 'dark' },
  { fn: run.splitTablet,      weight: 7,  tone: 'sharp' },
  { fn: run.interlock,        weight: 7,  tone: 'familiar' },
  { fn: run.cuneiform,        weight: 7,  tone: 'mystical' },
  { fn: run.runicSlash,       weight: 7,  tone: 'sharp' },
  { fn: run.comb,             weight: 5,  tone: 'familiar' },
  { fn: run.tally,            weight: 4,  tone: 'familiar' },
  { fn: run.mayanCount,       weight: 4,  tone: 'mystical' },
  { fn: run.crossMark,        weight: 4,  tone: 'dark' },
  { fn: run.dottedLine,       weight: 4,  tone: 'light' },
  { fn: run.chevronStack,     weight: 1,  tone: 'sharp' },
];

function pickGlyph(rng, mood) {
  const weights = VOCAB.map(v => v.weight * (mood.bias[v.tone] || 1));
  const total = weights.reduce((s, w) => s + w, 0);
  const r = rng() * total;
  let acc = 0;
  for (let i = 0; i < VOCAB.length; i++) {
    acc += weights[i];
    if (r < acc) return VOCAB[i].fn;
  }
  return VOCAB[0].fn;
}

// ── Composition patterns ───────────────────────────────────────

const COMP_BASE = {
  single:        20,
  compound:      22,
  stack:         16,
  triplet:        9,
  orbited:        4,
  framed:         9,
  constellation:  6,
  cartouche:      8,
  mirror:         2,
};

function pickComposition(rng, mood) {
  const entries = Object.entries(COMP_BASE);
  const weights = entries.map(([k, w]) => w * (mood.compMix[k] || 1));
  const total = weights.reduce((s, w) => s + w, 0);
  const r = rng() * total;
  let acc = 0;
  for (let i = 0; i < entries.length; i++) {
    acc += weights[i];
    if (r < acc) return entries[i][0];
  }
  return entries[0][0];
}

// Compose a whole logogram. Returns elements in world space (the
// composed glyph is centred at origin and bounded to roughly
// [-0.7, 0.7]).
export function composeLogogram(rng, mood) {
  const pattern = pickComposition(rng, mood);
  const single = () => pickGlyph(rng, mood)(rng);

  if (pattern === 'single') {
    const out = transformElements(single(), 0, 0, 0.88);
    if (rng() < 0.70) out.push(...transformElements(single(), (rng() < 0.5 ? -1 : 1) * (0.34 + rng() * 0.10), (rng() - 0.5) * 0.30, 0.22));
    if (rng() < 0.45) out.push(...transformElements(single(), (rng() - 0.5) * 0.36, (rng() < 0.5 ? -1 : 1) * (0.34 + rng() * 0.08), 0.18));
    return { pattern, elements: out };
  }

  if (pattern === 'compound') {
    const a = transformElements(single(), -0.42, 0, 0.52);
    const b = transformElements(single(),  0.42, 0, 0.52);
    const out = [...a, ...b];
    if (rng() < 0.40) out.push(strokeLine(0, -0.30, 0, 0.30, 0.012));
    return { pattern, elements: out };
  }

  if (pattern === 'stack') {
    const a = transformElements(single(), 0,  0.40, 0.46);
    const b = transformElements(single(), 0, -0.40, 0.46);
    return { pattern, elements: [...a, ...b] };
  }

  if (pattern === 'triplet') {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const x = -0.50 + i * 0.50;
      out.push(...transformElements(single(), x, 0, 0.36));
    }
    return { pattern, elements: out };
  }

  if (pattern === 'orbited') {
    const main = transformElements(single(), 0, 0, 0.78);
    const out = [...main];
    const N = 3 + Math.floor(rng() * 3);
    const r = 0.62;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rng() * 0.25;
      out.push(...transformElements(single(), Math.cos(a) * r, Math.sin(a) * r, 0.18));
    }
    return { pattern, elements: out };
  }

  if (pattern === 'framed') {
    const out = [];
    out.push(ring(0.58, 0.016, 0.008));
    if (rng() < 0.45) out.push(ring(0.68, 0.010));
    out.push(...transformElements(single(), 0, 0, 0.70));
    // 2-4 marks around the frame edge.
    const N = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < N; i++) {
      const a  = rng() * Math.PI * 2;
      const x1 = Math.cos(a) * 0.60, y1 = Math.sin(a) * 0.60;
      const x2 = Math.cos(a) * 0.74, y2 = Math.sin(a) * 0.74;
      out.push(strokeLine(x1, y1, x2, y2, 0.018));
    }
    return { pattern, elements: out };
  }

  if (pattern === 'constellation') {
    // 4-7 small glyphs scattered in a wider field, connected by thin
    // lines into a signal map.
    const out = [];
    const N = 4 + Math.floor(rng() * 4);
    const positions = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rng() * 0.45;
      const r = 0.32 + rng() * 0.32;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      positions.push({ x, y });
      out.push(...transformElements(single(), x, y, 0.16));
    }
    // Connecting lines — adjacent in the cycle plus an occasional chord.
    for (let i = 0; i < N; i++) {
      const p1 = positions[i];
      const p2 = positions[(i + 1) % N];
      out.push(strokeLine(p1.x, p1.y, p2.x, p2.y, 0.008));
    }
    if (N >= 5 && rng() < 0.5) {
      const a = positions[0], b = positions[2];
      out.push(strokeLine(a.x, a.y, b.x, b.y, 0.006));
    }
    return { pattern, elements: out };
  }

  if (pattern === 'cartouche') {
    // Glyph in an Egyptian-style oval frame with end bars.
    const out = [];
    out.push(ellipse(0.56, 0.38, 0.016));
    out.push(strokeLine(-0.58, -0.10, -0.58, 0.10, 0.016));
    out.push(strokeLine( 0.58, -0.10,  0.58, 0.10, 0.016));
    // 2-3 stacked glyphs inside.
    const stackedN = (rng() < 0.45) ? 2 : 1;
    if (stackedN === 1) {
      out.push(...transformElements(single(), 0, 0, 0.55));
    } else {
      out.push(...transformElements(single(), -0.22, 0, 0.40));
      out.push(...transformElements(single(),  0.22, 0, 0.40));
    }
    return { pattern, elements: out };
  }

  if (pattern === 'mirror') {
    // Glyph + its left/right mirror image.
    const els = single();
    const a  = transformElements(els, -0.32, 0, 0.50);
    const mirrored = els.map(el => {
      if (el.type === 'disc') {
        return { type: 'disc', center: { x: -el.center.x, y: el.center.y }, radius: el.radius };
      }
      return {
        type: 'stroke',
        points: el.points.map(p => ({ x: -p.x, y: p.y })),
        thickness: el.thickness.slice(),
      };
    });
    const b = transformElements(mirrored, 0.32, 0, 0.50);
    return { pattern, elements: [...a, ...b] };
  }

  // Fallback.
  return { pattern: 'single', elements: transformElements(single(), 0, 0, 1.0) };
}
