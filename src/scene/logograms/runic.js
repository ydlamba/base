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
  strokeFromFn, disc, strokeLine, strokeArc, strokePolyline,
} from './primitives.js';
import {
  ring, polygon, wedge, chevron, plus, cross, tally as tallyShape,
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
  const variant = Math.floor(rng() * 4);
  if (variant === 0) {
    // Vertical with diagonals — like ᚱ.
    els.push(strokeLine(-0.15, -0.45, -0.15, 0.45, 0.024));
    els.push(strokeLine(-0.15, 0.45, 0.20, 0.20, 0.022));
    els.push(strokeLine(-0.15, 0.05, 0.18, -0.10, 0.022));
  } else if (variant === 1) {
    // Two diagonals crossing — like ᚷ.
    els.push(strokeLine(-0.30, -0.40, 0.30,  0.40, 0.024));
    els.push(strokeLine(-0.30,  0.40, 0.30, -0.40, 0.024));
  } else if (variant === 2) {
    // Bracket shape — like ᚦ.
    els.push(strokeLine(-0.15, -0.45, -0.15, 0.45, 0.024));
    els.push(strokePolyline([
      { x: -0.15, y:  0.30 },
      { x:  0.18, y:  0.10 },
      { x: -0.15, y: -0.10 },
    ], 0.022));
  } else {
    // Hourglass — like ᛡ.
    els.push(strokePolyline([
      { x: -0.20, y:  0.40 },
      { x:  0.20, y: -0.40 },
    ], 0.024));
    els.push(strokePolyline([
      { x:  0.20, y:  0.40 },
      { x: -0.20, y: -0.40 },
    ], 0.024));
    els.push(strokeLine(-0.20, 0.40, 0.20, 0.40, 0.020));
    els.push(strokeLine(-0.20, -0.40, 0.20, -0.40, 0.020));
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
  const variant = Math.floor(rng() * 3);
  if (variant === 0) return plus(0.30, 0.024);
  if (variant === 1) return cross(0.30, 0.024);
  // Double-barred cross.
  return [
    strokeLine(0, -0.40, 0,  0.40, 0.024),
    strokeLine(-0.20, 0.20, 0.20, 0.20, 0.022),
    strokeLine(-0.30, 0.00, 0.30, 0.00, 0.022),
  ];
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

// ── Concentric rings ───────────────────────────────────────────

export function concentricRings(rng) {
  const els = [];
  const N = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < N; i++) {
    const r = 0.10 + i * (0.32 / (N - 1));
    els.push(ring(r, 0.018 - i * 0.002));
  }
  if (rng() < 0.6) els.push(disc(0, 0, 0.024));
  return els;
}

// ── Triangle stack ─────────────────────────────────────────────

export function triangleGlyph(rng) {
  const els = [];
  const variant = Math.floor(rng() * 3);
  if (variant === 0) {
    // Single triangle with internal accent.
    els.push(polygon(3, 0.36, 0, 0.024));
    if (rng() < 0.6) els.push(disc(0, -0.05, 0.030));
  } else if (variant === 1) {
    // Two triangles forming a hourglass / Star-of-David fragment.
    els.push(polygon(3, 0.30, 0, 0.022));
    els.push(polygon(3, 0.30, Math.PI, 0.022));
  } else {
    // Three nested triangles.
    els.push(polygon(3, 0.40, 0, 0.022));
    els.push(polygon(3, 0.26, 0, 0.018));
    els.push(polygon(3, 0.12, 0, 0.014));
  }
  return els;
}

// ── Hex / square glyph ─────────────────────────────────────────

export function polygonGlyph(rng) {
  const els = [];
  const sides = [4, 5, 6, 8][Math.floor(rng() * 4)];
  const r = 0.28 + rng() * 0.06;
  els.push(polygon(sides, r, rng() * Math.PI / sides, 0.022));
  // Inner echo.
  if (rng() < 0.6) {
    els.push(polygon(sides, r * 0.5, rng() * Math.PI / sides, 0.016));
  }
  // Inner fill or accent.
  if (rng() < 0.4) els.push(disc(0, 0, 0.030));
  return els;
}
