// ────────────────────────────────────────────────────────────────
// Runic / abstract glyphs — wedges, slashes, tally marks, and
// other shapes drawn from human writing systems with the meaning
// stripped out. The goal is alien-but-familiar: forms that read
// as "writing" without spelling anything.
//
// Each function takes a seeded RNG and returns elements in
// glyph-local space, roughly bounded to [-0.55, 0.55].
// ────────────────────────────────────────────────────────────────

import {
  strokeFromFn, disc, strokeLine, strokeArc, strokeQuad, strokePolyline,
} from './primitives.js';
import {
  ring, brokenRing, polygon, wedge, tally as tallyShape,
} from './shapes.js';

// ── Cuneiform — clusters of wedges ─────────────────────────────

export function cuneiform(rng) {
  const els = [];
  const N = 4 + Math.floor(rng() * 5);
  for (let i = 0; i < N; i++) {
    const x = (rng() - 0.5) * 0.60;
    const y = (rng() - 0.5) * 0.60;
    const a = Math.floor(rng() * 4) * Math.PI / 2 + (rng() - 0.5) * 0.4;
    const len = 0.10 + rng() * 0.06;
    const wedgeStroke = wedge(a, len, 0.030);
    wedgeStroke.points = wedgeStroke.points.map(p => ({ x: p.x + x, y: p.y + y }));
    els.push(wedgeStroke);
    // Wedge head — small disc at the base.
    els.push(disc(x, y, 0.018));
  }
  return els;
}

// ── Runic slashes — angular lines and combinations ──────────────

export function runicSlash(rng) {
  const els = [];
  const variant = Math.floor(rng() * 3);
  if (variant === 0) {
    // Vertical with diagonals — like ᚱ.
    els.push(strokeLine(-0.15, -0.45, -0.15, 0.45, 0.024));
    els.push(strokeLine(-0.15, 0.45, 0.20, 0.20, 0.022));
    els.push(strokeLine(-0.15, 0.05, 0.18, -0.10, 0.022));
  } else if (variant === 1) {
    // Bracket shape — like ᚦ.
    els.push(strokeLine(-0.15, -0.45, -0.15, 0.45, 0.024));
    els.push(strokePolyline([
      { x: -0.15, y:  0.30 },
      { x:  0.18, y:  0.10 },
      { x: -0.15, y: -0.10 },
    ], 0.022));
  } else {
    // Split stem with an offset slash.
    els.push(strokeLine(-0.08, -0.44, -0.08, -0.04, 0.022));
    els.push(strokeLine(0.08, 0.04, 0.08, 0.44, 0.022));
    els.push(strokeLine(-0.28, -0.18, 0.26, 0.18, 0.020));
    if (rng() < 0.55) els.push(disc(0.18, -0.30, 0.014));
  }
  return els;
}

// ── Tally marks ────────────────────────────────────────────────

export function tally(rng) {
  const n = 3 + Math.floor(rng() * 4);
  return tallyShape(n, 0.07, 0.42, 0.020);
}

// ── Mayan-style bar-and-dot count ──────────────────────────────

export function mayanCount(rng) {
  const els = [];
  const dots = 1 + Math.floor(rng() * 4);
  const bars = Math.floor(rng() * 3);
  // Dots — top row.
  const dotY = 0.20;
  const startX = -((dots - 1) / 2) * 0.08;
  for (let i = 0; i < dots; i++) {
    els.push(disc(startX + i * 0.08, dotY, 0.025));
  }
  // Bars — horizontal lines stacked below.
  for (let i = 0; i < bars; i++) {
    const y = 0.05 - i * 0.13;
    els.push(strokeLine(-0.20, y, 0.20, y, 0.026));
  }
  return els;
}

// ── Chevron stack ──────────────────────────────────────────────

export function chevronStack(rng) {
  const els = [];
  const N = 3 + Math.floor(rng() * 3);
  const pointDown = rng() < 0.5;
  for (let i = 0; i < N; i++) {
    const y = -0.30 + i * 0.18;
    const w = 0.40 - i * 0.04;
    const sgn = pointDown ? -1 : 1;
    els.push(strokeLine(-w / 2, y, 0, y + 0.10 * sgn, 0.020));
    els.push(strokeLine(0, y + 0.10 * sgn, w / 2, y, 0.020));
  }
  return els;
}

// ── Comb — long line with parallel teeth ───────────────────────

export function comb(rng) {
  const els = [];
  const horizontal = rng() < 0.5;
  if (horizontal) {
    els.push(strokeLine(-0.45, 0, 0.45, 0, 0.026));
    const N = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < N; i++) {
      const x = -0.40 + i * (0.80 / (N - 1));
      els.push(strokeLine(x, 0, x, -0.30 - rng() * 0.08, 0.018));
    }
  } else {
    els.push(strokeLine(0, -0.45, 0, 0.45, 0.026));
    const N = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < N; i++) {
      const y = -0.40 + i * (0.80 / (N - 1));
      els.push(strokeLine(0, y, 0.30 + rng() * 0.08, y, 0.018));
    }
  }
  return els;
}

// ── Cross variants ─────────────────────────────────────────────

export function crossMark(rng) {
  // Small notation cluster.
  const els = [
    strokeLine(0, -0.40, 0,  0.40, 0.024),
    strokeLine(-0.20, 0.20, 0.20, 0.20, 0.022),
    strokeLine(-0.30, 0.00, 0.30, 0.00, 0.022),
  ];
  if (rng() < 0.5) els.push(strokeLine(-0.16, -0.22, 0.12, -0.30, 0.014));
  return els;
}

// ── Dotted line ────────────────────────────────────────────────

export function dottedLine(rng) {
  const els = [];
  const horizontal = rng() < 0.5;
  const N = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const u = -0.40 + t * 0.80;
    if (horizontal) els.push(disc(u, 0, 0.020 + (i % 3 === 0 ? 0.008 : 0)));
    else            els.push(disc(0, u, 0.020 + (i % 3 === 0 ? 0.008 : 0)));
  }
  return els;
}

// ── Script column — dense asemic writing around one spine ───────

export function scriptColumn(rng) {
  const els = [];
  const stemX = (rng() - 0.5) * 0.10;
  els.push(strokeLine(stemX, -0.48, stemX + (rng() - 0.5) * 0.08, 0.48, 0.018));
  const N = 6 + Math.floor(rng() * 5);
  for (let i = 0; i < N; i++) {
    const y = -0.40 + i * (0.80 / Math.max(1, N - 1));
    const side = rng() < 0.55 ? -1 : 1;
    const len = 0.10 + rng() * 0.22;
    const mode = Math.floor(rng() * 4);
    if (mode === 0) {
      els.push(strokeLine(stemX, y, stemX + side * len, y + (rng() - 0.5) * 0.08, 0.012));
    } else if (mode === 1) {
      els.push(strokeQuad(stemX, y, stemX + side * len * 0.5, y + 0.08, stemX + side * len, y + 0.02, 0.012));
    } else if (mode === 2) {
      els.push(strokeArc(stemX + side * len * 0.55, y, len * 0.45, side > 0 ? Math.PI * 0.55 : -Math.PI * 0.45, side > 0 ? Math.PI * 1.35 : Math.PI * 0.35, 0.011));
    } else {
      els.push(disc(stemX + side * len, y + (rng() - 0.5) * 0.06, 0.010 + rng() * 0.008));
    }
  }
  return els;
}

// ── Reed script — parallel stems with attached vowel-like marks ──

export function reedScript(rng) {
  const els = [];
  const stems = 2 + Math.floor(rng() * 3);
  const spacing = 0.12 + rng() * 0.04;
  const startX = -((stems - 1) / 2) * spacing;
  for (let s = 0; s < stems; s++) {
    const x = startX + s * spacing + (rng() - 0.5) * 0.035;
    const y0 = -0.42 + rng() * 0.08;
    const y1 = 0.38 - rng() * 0.08;
    els.push(strokeLine(x, y0, x + (rng() - 0.5) * 0.04, y1, 0.015));
    const marks = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < marks; i++) {
      const y = y0 + (i + 0.5) * ((y1 - y0) / marks);
      const side = rng() < 0.5 ? -1 : 1;
      if (rng() < 0.55) els.push(strokeLine(x, y, x + side * (0.08 + rng() * 0.10), y + (rng() - 0.5) * 0.06, 0.010));
      else els.push(disc(x + side * (0.08 + rng() * 0.08), y, 0.008 + rng() * 0.006));
    }
  }
  return els;
}

// ── Axial script — a central stem with asymmetric ligatures ─────

export function axialScript(rng) {
  const els = [];
  const lean = (rng() - 0.5) * 0.14;
  els.push(strokeLine(lean, -0.46, -lean, 0.46, 0.022));
  const N = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < N; i++) {
    const y = -0.34 + i * (0.68 / Math.max(1, N - 1));
    const side = rng() < 0.5 ? -1 : 1;
    const len = 0.16 + rng() * 0.16;
    const hook = rng() < 0.45;
    if (hook) {
      els.push(strokeQuad(0, y, side * len * 0.6, y + 0.05, side * len, y - 0.04, 0.017));
    } else {
      els.push(strokeLine(0, y, side * len, y + (rng() - 0.5) * 0.16, 0.018));
    }
    if (rng() < 0.35) els.push(disc(side * (len + 0.03), y, 0.012));
  }
  return els;
}

// ── Broken cartouche — language inside a damaged enclosure ─────

export function brokenCartouche(rng) {
  const els = [];
  els.push(brokenRing(0.46, 0.020, rng(), 0.55 + rng() * 0.45));
  els.push(brokenRing(0.32, 0.014, rng(), 0.85 + rng() * 0.45));
  const bars = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < bars; i++) {
    const y = -0.20 + i * (0.40 / Math.max(1, bars - 1));
    const x0 = -0.22 + rng() * 0.08;
    const x1 = 0.18 + rng() * 0.10;
    els.push(strokeLine(x0, y, x1, y + (rng() - 0.5) * 0.08, 0.015));
  }
  if (rng() < 0.6) {
    els.push(strokeLine(-0.52, -0.12, -0.42, 0.12, 0.018));
    els.push(strokeLine(0.42, -0.12, 0.52, 0.12, 0.018));
  }
  return els;
}

// ── Lattice seal — polygonal boundary with internal grammar ─────

export function latticeSeal(rng) {
  const els = [];
  const sides = rng() < 0.5 ? 6 : 8;
  const rot = rng() * Math.PI / sides;
  els.push(polygon(sides, 0.43, rot, 0.020));
  if (rng() < 0.65) els.push(polygon(sides, 0.24, rot + Math.PI / sides, 0.014));
  const chords = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < chords; i++) {
    const a = rot + rng() * Math.PI * 2;
    const b = a + Math.PI * (0.35 + rng() * 0.55);
    const r1 = 0.12 + rng() * 0.25;
    const r2 = 0.12 + rng() * 0.25;
    els.push(strokeLine(Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(b) * r2, Math.sin(b) * r2, 0.012));
  }
  if (rng() < 0.45) els.push(disc(0, 0, 0.020));
  return els;
}

// ── Pressure knots — nested arcs and compression marks ─────────

export function pressureKnots(rng) {
  const els = [];
  const N = 3 + Math.floor(rng() * 3);
  const base = rng() * Math.PI * 2;
  for (let i = 0; i < N; i++) {
    const r = 0.18 + i * 0.09;
    const start = base + i * 0.35;
    const span = Math.PI * (0.65 + rng() * 0.55);
    els.push(strokeArc(0, 0, r, start, start + span, 0.018 - i * 0.0015));
  }
  const marks = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < marks; i++) {
    const a = base + i * (Math.PI * 2 / marks) + rng() * 0.12;
    const r = 0.34 + rng() * 0.08;
    els.push(strokeLine(Math.cos(a) * (r - 0.05), Math.sin(a) * (r - 0.05), Math.cos(a) * r, Math.sin(a) * r, 0.012));
  }
  return els;
}

// ── Split tablet — stacked bars with a fault line ───────────────

export function splitTablet(rng) {
  const els = [];
  const rows = 4 + Math.floor(rng() * 4);
  const fault = (rng() - 0.5) * 0.18;
  for (let i = 0; i < rows; i++) {
    const y = -0.34 + i * (0.68 / Math.max(1, rows - 1));
    const gap = 0.035 + rng() * 0.045;
    const left = -0.34 + rng() * 0.08;
    const right = 0.30 - rng() * 0.08;
    els.push(strokeLine(left, y, fault - gap, y + (rng() - 0.5) * 0.05, 0.016));
    els.push(strokeLine(fault + gap, y + (rng() - 0.5) * 0.05, right, y, 0.016));
  }
  els.push(strokeLine(fault, -0.44, fault + (rng() - 0.5) * 0.14, 0.44, 0.010));
  return els;
}

// ── Interlock — two incompatible writing systems interleaved ────

export function interlock(rng) {
  const els = [];
  const leftN = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < leftN; i++) {
    const y = -0.30 + i * (0.60 / Math.max(1, leftN - 1));
    els.push(strokeQuad(-0.34, y, -0.10, y + 0.12 * (rng() < 0.5 ? -1 : 1), 0.08, y, 0.016));
  }
  const rightN = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < rightN; i++) {
    const y = -0.32 + i * (0.64 / Math.max(1, rightN - 1));
    els.push(strokeLine(0.16, y, 0.42, y + (rng() - 0.5) * 0.14, 0.015));
    if (rng() < 0.5) els.push(disc(0.46, y, 0.010));
  }
  els.push(strokeLine(0, -0.40, 0, 0.40, 0.012));
  return els;
}
