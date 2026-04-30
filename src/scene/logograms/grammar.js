// ────────────────────────────────────────────────────────────────
// Grammar — mood, vocabulary, composition.
//
// A logogram is a single seeded utterance: one mood, one
// composition pattern, one or more glyphs from the vocabulary.
// Mood biases which glyphs are likely (mournful pulls toward
// skull/anchor/tearDrop; playful toward sun/smiley/butterfly) and
// scales stroke thickness so the same glyph reads quiet, bold,
// shouting, or fragile depending on its emotional register.
// ────────────────────────────────────────────────────────────────

import { transformElements, strokeLine } from './primitives.js';
import { ring, ellipse } from './shapes.js';
import * as pic from './pictographs.js';
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

const VOCAB = [
  // Light / joyful
  { fn: pic.sun,        weight: 8, tone: 'light' },
  { fn: pic.heart,      weight: 7, tone: 'light' },
  { fn: pic.flower,     weight: 5, tone: 'light' },
  { fn: pic.butterfly,  weight: 4, tone: 'light' },
  { fn: pic.smiley,     weight: 2, tone: 'light' },
  { fn: pic.musicNote,  weight: 3, tone: 'light' },

  // Familiar / common
  { fn: pic.eye,        weight: 9, tone: 'familiar' },
  { fn: pic.tree,       weight: 6, tone: 'familiar' },
  { fn: pic.mountain,   weight: 6, tone: 'familiar' },
  { fn: pic.water,      weight: 5, tone: 'familiar' },
  { fn: pic.hand,       weight: 6, tone: 'familiar' },
  { fn: pic.house,      weight: 5, tone: 'familiar' },
  { fn: pic.fish,       weight: 5, tone: 'familiar' },
  { fn: pic.bird,       weight: 6, tone: 'familiar' },
  { fn: pic.key,        weight: 5, tone: 'familiar' },
  { fn: pic.arrow,      weight: 5, tone: 'sharp' },
  { fn: pic.feather,    weight: 4, tone: 'familiar' },
  { fn: pic.footprint,  weight: 4, tone: 'familiar' },

  // Dark / heavy
  { fn: pic.lightning,  weight: 5, tone: 'sharp' },
  { fn: pic.skull,      weight: 4, tone: 'dark' },
  { fn: pic.anchor,     weight: 4, tone: 'dark' },
  { fn: pic.tearDrop,   weight: 4, tone: 'dark' },
  { fn: pic.flame,      weight: 5, tone: 'dark' },

  // Mystical / cosmic
  { fn: pic.star,       weight: 7, tone: 'mystical' },
  { fn: pic.crescent,   weight: 5, tone: 'mystical' },
  { fn: pic.ankh,       weight: 4, tone: 'mystical' },
  { fn: pic.spiral,     weight: 5, tone: 'mystical' },
  { fn: pic.infinity,   weight: 4, tone: 'mystical' },
  { fn: pic.compass,    weight: 4, tone: 'mystical' },

  // Runic / abstract
  { fn: run.cuneiform,       weight: 6, tone: 'mystical' },
  { fn: run.runicSlash,      weight: 6, tone: 'sharp' },
  { fn: run.tally,           weight: 4, tone: 'familiar' },
  { fn: run.mayanCount,      weight: 4, tone: 'mystical' },
  { fn: run.chevronStack,    weight: 4, tone: 'sharp' },
  { fn: run.comb,            weight: 4, tone: 'familiar' },
  { fn: run.crossMark,       weight: 4, tone: 'dark' },
  { fn: run.dottedLine,      weight: 3, tone: 'familiar' },
  { fn: run.concentricRings, weight: 4, tone: 'mystical' },
  { fn: run.triangleGlyph,   weight: 4, tone: 'sharp' },
  { fn: run.polygonGlyph,    weight: 5, tone: 'mystical' },

  // Animals & nature
  { fn: pic.snake,       weight: 5, tone: 'familiar' },
  { fn: pic.leaf,        weight: 5, tone: 'light' },
  { fn: pic.mushroom,    weight: 4, tone: 'light' },
  { fn: pic.owl,         weight: 4, tone: 'mystical' },
  { fn: pic.cloud,       weight: 5, tone: 'familiar' },
  { fn: pic.wave,        weight: 5, tone: 'familiar' },
  { fn: pic.lotus,       weight: 4, tone: 'light' },

  // Time, balance, structure
  { fn: pic.hourglass,   weight: 4, tone: 'mystical' },
  { fn: pic.scales,      weight: 4, tone: 'familiar' },
  { fn: pic.ladder,      weight: 4, tone: 'familiar' },

  // Mystical extensions
  { fn: pic.yinyang,     weight: 4, tone: 'mystical' },
  { fn: pic.mandala,     weight: 4, tone: 'mystical' },
  { fn: pic.eyeOfHorus,  weight: 4, tone: 'mystical' },
  { fn: pic.peace,       weight: 2, tone: 'light' },
  { fn: pic.atom,        weight: 3, tone: 'mystical' },

  // Sharp & broken
  { fn: pic.dagger,      weight: 4, tone: 'sharp' },
  { fn: pic.brokenForm,  weight: 4, tone: 'dark' },
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
  single:        32,
  compound:      18,
  stack:         12,
  triplet:        7,
  orbited:        7,
  framed:         9,
  constellation:  6,
  cartouche:      5,
  mirror:         4,
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
    return { pattern, elements: transformElements(single(), 0, 0, 1.10) };
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
    out.push(ring(0.62, 0.022, 0.008));
    if (rng() < 0.45) out.push(ring(0.70, 0.012));
    out.push(...transformElements(single(), 0, 0, 0.78));
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
    // lines into a star map. Reads as "writing across the sky".
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
    out.push(ellipse(0.58, 0.40, 0.022));
    out.push(strokeLine(-0.58, -0.10, -0.58, 0.10, 0.022));
    out.push(strokeLine( 0.58, -0.10,  0.58, 0.10, 0.022));
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
