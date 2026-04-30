// ────────────────────────────────────────────────────────────────
// Pictographs — recognisable glyphs covering the emotional
// spectrum: light, dark, familiar, mystical, alive.
//
// Each function takes a seeded RNG and returns an array of
// elements in glyph-local space, roughly bounded to [-0.55, 0.55].
// The grammar layer scales/translates them for composition.
// ────────────────────────────────────────────────────────────────

import {
  strokeFromFn, disc, strokeLine, strokeArc, strokeQuad, strokeCubic, strokePolyline,
} from './primitives.js';
import {
  ring, brokenRing, polygon, rectangle, crescent as crescentShape,
  spiral as spiralShape, sineWave, chevron, plus, star as starShape, ellipse,
} from './shapes.js';

// ── Light & joyful ──────────────────────────────────────────────

export function sun(rng) {
  const els = [];
  const r = 0.22 + rng() * 0.04;
  els.push(disc(0, 0, r * 0.55));
  els.push(ring(r, 0.022));
  const N = 8 + Math.floor(rng() * 5);
  const rIn  = r * 1.35;
  const rOut = r * 1.95 + rng() * 0.05;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rng() * 0.04;
    els.push(strokeLine(
      Math.cos(a) * rIn,  Math.sin(a) * rIn,
      Math.cos(a) * rOut, Math.sin(a) * rOut,
      0.020,
    ));
    if (rng() < 0.35) {
      els.push(disc(Math.cos(a) * (rOut + 0.025), Math.sin(a) * (rOut + 0.025), 0.012));
    }
  }
  return els;
}

export function smiley(rng) {
  const els = [];
  const r = 0.42;
  els.push(ring(r, 0.026));
  els.push(disc(-r * 0.36, r * 0.18, 0.038));
  els.push(disc( r * 0.36, r * 0.18, 0.038));
  els.push(strokeArc(0, -r * 0.05, r * 0.55, Math.PI * 1.15, Math.PI * 1.85, 0.024));
  return els;
}

export function flower(rng) {
  const els = [];
  els.push(disc(0, 0, 0.07 + rng() * 0.02));
  const N = 5 + Math.floor(rng() * 3);
  const rPetal = 0.30;
  for (let i = 0; i < N; i++) {
    const a  = (i / N) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a) * rPetal * 0.65;
    const cy = Math.sin(a) * rPetal * 0.65;
    els.push(...crescentShape(0.12, 0.018, 0.45).map(stroke => ({
      type: 'stroke',
      points: stroke.points.map(p => {
        const x0 = p.x - 0.05, y0 = p.y;
        const cs = Math.cos(a + Math.PI / 2), sn = Math.sin(a + Math.PI / 2);
        return { x: x0 * cs - y0 * sn + cx, y: x0 * sn + y0 * cs + cy };
      }),
      thickness: stroke.thickness.slice(),
    })));
  }
  return els;
}

export function butterfly(rng) {
  const els = [];
  els.push(strokeLine(0, -0.28, 0, 0.28, 0.020));
  els.push(strokeQuad(0, 0.28, -0.10, 0.38, -0.16, 0.48, 0.013));
  els.push(strokeQuad(0, 0.28,  0.10, 0.38,  0.16, 0.48, 0.013));
  els.push(strokeArc(-0.26, 0.10, 0.22, -Math.PI * 0.6, Math.PI * 0.6, 0.016));
  els.push(strokeArc(-0.18, -0.18, 0.16, -Math.PI * 0.6, Math.PI * 0.6, 0.016));
  els.push(strokeArc( 0.26, 0.10, 0.22, Math.PI * 0.4, Math.PI * 1.6, 0.016));
  els.push(strokeArc( 0.18, -0.18, 0.16, Math.PI * 0.4, Math.PI * 1.6, 0.016));
  els.push(disc(-0.30, 0.10, 0.012));
  els.push(disc( 0.30, 0.10, 0.012));
  return els;
}

export function musicNote(rng) {
  const els = [];
  const headX = -0.05, headY = -0.30;
  els.push(disc(headX, headY, 0.080));
  els.push(strokeLine(headX + 0.07, headY + 0.02, headX + 0.07, 0.40, 0.020));
  els.push(strokeQuad(
    headX + 0.07, 0.40,
    headX + 0.18, 0.32,
    headX + 0.20, 0.20,
    0.018,
  ));
  return els;
}

// ── Familiar / common ──────────────────────────────────────────

export function eye(rng) {
  const els = [];
  const w = 0.45, h = 0.14;
  els.push(strokeQuad(-w, 0, 0,  h, w, 0, 0.020));
  els.push(strokeQuad(-w, 0, 0, -h, w, 0, 0.020));
  els.push(disc(0, 0, 0.060));
  els.push(ring(0.115, 0.014));
  if (rng() < 0.55) {
    for (let i = -1; i <= 1; i++) {
      const x = i * 0.17;
      els.push(strokeLine(x, h * 0.95, x + 0.04, h + 0.07, 0.012));
    }
  }
  return els;
}

export function tree(rng) {
  const els = [];
  els.push(strokeLine(0, -0.45, 0, 0.05, 0.028));
  const branchN = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < branchN; i++) {
    const t = (i + 1) / (branchN + 1);
    const y   = -0.45 + t * 0.55;
    const dir = (i % 2) ? 1 : -1;
    const len = 0.18 - t * 0.06;
    els.push(strokeQuad(0, y, dir * len * 0.5, y + 0.04, dir * len, y + 0.10, 0.014));
  }
  els.push(disc(0, 0.30, 0.10));
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.08 + rng() * 0.10;
    els.push(disc(Math.cos(a) * r, 0.30 + Math.sin(a) * r, 0.018 + rng() * 0.012));
  }
  return els;
}

export function mountain(rng) {
  const N = 2 + Math.floor(rng() * 2);
  const W = 0.95;
  const peakH = 0.42;
  const baseY = -0.28;
  const pts = [{ x: -W / 2, y: baseY }];
  for (let i = 0; i < N; i++) {
    const peakX   = -W / 2 + (i + 0.5) * (W / N);
    const valleyX = -W / 2 + (i + 1)  * (W / N);
    pts.push({ x: peakX, y: baseY + peakH * (0.7 + rng() * 0.3) });
    if (i < N - 1) pts.push({ x: valleyX, y: baseY + peakH * (0.25 + rng() * 0.15) });
  }
  pts.push({ x: W / 2, y: baseY });
  const out = [strokePolyline(pts, 0.022)];
  if (rng() < 0.5) out.push(disc(0, 0.30, 0.024));
  return out;
}

export function water(rng) {
  const els = [];
  const ys = [-0.20, 0, 0.20];
  for (const y of ys) {
    const wave = sineWave(0.06, 0.30, 0.85, 0.018, rng() * Math.PI * 2);
    wave.points = wave.points.map(p => ({ x: p.x, y: p.y + y }));
    els.push(wave);
  }
  return els;
}

export function hand(rng) {
  const els = [];
  els.push(disc(0, -0.08, 0.16));
  // 5 fingers fanning upward (thumb on left).
  const angles = [Math.PI * 1.05, Math.PI * 0.85, Math.PI * 0.55, Math.PI * 0.30, Math.PI * 0.05];
  for (let i = 0; i < 5; i++) {
    const a   = angles[i] + Math.PI / 2;
    const len = (i === 0 || i === 4) ? 0.18 : 0.26;
    const bx = Math.cos(a) * 0.14, by = Math.sin(a) * 0.14 - 0.05;
    const tx = Math.cos(a) * (0.14 + len), ty = Math.sin(a) * (0.14 + len) - 0.05;
    els.push(strokeLine(bx, by, tx, ty, 0.020));
    els.push(disc(tx, ty, 0.014));
  }
  return els;
}

export function heart(rng) {
  return [
    strokeCubic(
      0, -0.42,
      -0.50, -0.18,
      -0.50,  0.30,
      0,  0.10,
      0.024,
    ),
    strokeCubic(
      0, -0.42,
      0.50, -0.18,
      0.50,  0.30,
      0,  0.10,
      0.024,
    ),
  ];
}

export function house(rng) {
  const out = [];
  // walls + floor
  out.push(strokePolyline([
    { x: -0.30, y: -0.40 },
    { x:  0.30, y: -0.40 },
    { x:  0.30, y:  0.10 },
    { x: -0.30, y:  0.10 },
    { x: -0.30, y: -0.40 },
  ], 0.022));
  // roof
  out.push(strokePolyline([
    { x: -0.36, y:  0.10 },
    { x:  0.00, y:  0.45 },
    { x:  0.36, y:  0.10 },
  ], 0.022));
  // door
  out.push(strokePolyline([
    { x: -0.07, y: -0.40 },
    { x: -0.07, y: -0.15 },
    { x:  0.07, y: -0.15 },
    { x:  0.07, y: -0.40 },
  ], 0.018));
  // round window
  if (rng() < 0.55) {
    out.push(strokeFromFn(40,
      (t) => {
        const a = t * Math.PI * 2;
        return { x: 0.15 + Math.cos(a) * 0.06, y: -0.10 + Math.sin(a) * 0.06 };
      },
      () => 0.012,
    ));
  }
  // smoke from chimney
  if (rng() < 0.30) {
    const sx = -0.20;
    out.push(strokePolyline([{ x: sx, y: 0.30 }, { x: sx, y: 0.42 }], 0.014));
    out.push(disc(sx + 0.04, 0.50, 0.020));
    out.push(disc(sx + 0.10, 0.55, 0.018));
  }
  return out;
}

export function fish(rng) {
  const els = [];
  els.push(strokeQuad(-0.32, 0,  0, -0.16, 0.20, 0, 0.022));
  els.push(strokeQuad(-0.32, 0,  0,  0.16, 0.20, 0, 0.022));
  els.push(strokePolyline([
    { x:  0.20, y:  0    },
    { x:  0.42, y:  0.16 },
    { x:  0.36, y:  0    },
    { x:  0.42, y: -0.16 },
    { x:  0.20, y:  0    },
  ], 0.020));
  els.push(disc(-0.18, 0.04, 0.016));
  if (rng() < 0.5) els.push(disc(-0.05, 0, 0.012));
  return els;
}

export function bird(rng) {
  const els = [];
  // Seagull silhouette: two M-curves like \_/\_/.
  els.push(strokeQuad(-0.45, 0.05,  -0.25, 0.30, -0.05, 0.05, 0.020));
  els.push(strokeQuad(-0.05, 0.05,   0.15, 0.30,  0.35, 0.05, 0.020));
  // Optional second bird, smaller, off to the side.
  if (rng() < 0.55) {
    const x = (rng() < 0.5 ? -1 : 1) * 0.30;
    const y = -0.30 + rng() * 0.10;
    const s = 0.40;
    els.push(strokeQuad(x - 0.20 * s, y + 0.02 * s, x - 0.10 * s, y + 0.12 * s, x, y + 0.02 * s, 0.014));
    els.push(strokeQuad(x, y + 0.02 * s, x + 0.10 * s, y + 0.12 * s, x + 0.20 * s, y + 0.02 * s, 0.014));
  }
  return els;
}

export function key(rng) {
  const els = [];
  els.push(strokeFromFn(80,
    (t) => {
      const a = t * Math.PI * 2;
      return { x: -0.30 + Math.cos(a) * 0.14, y: Math.sin(a) * 0.14 };
    },
    () => 0.022,
  ));
  els.push(disc(-0.30, 0, 0.05));
  els.push(strokeLine(-0.16, 0, 0.40, 0, 0.020));
  els.push(strokeLine(0.30, 0, 0.30, -0.10, 0.020));
  els.push(strokeLine(0.40, 0, 0.40, -0.14, 0.020));
  return els;
}

export function arrow(rng) {
  const els = [];
  els.push(strokeLine(-0.40, 0, 0.30, 0, 0.022));
  els.push(strokeLine(0.30, 0, 0.18,  0.10, 0.022));
  els.push(strokeLine(0.30, 0, 0.18, -0.10, 0.022));
  // Optional fletching at the tail.
  if (rng() < 0.55) {
    els.push(strokeLine(-0.40, 0, -0.50,  0.07, 0.018));
    els.push(strokeLine(-0.40, 0, -0.50, -0.07, 0.018));
  }
  return els;
}

// ── Dark & heavy ───────────────────────────────────────────────

export function lightning(rng) {
  const pts = [
    { x: -0.10, y:  0.45 },
    { x: -0.18, y:  0.10 },
    { x:  0.02, y:  0.05 },
    { x: -0.08, y: -0.20 },
    { x:  0.08, y: -0.25 },
    { x: -0.04, y: -0.50 },
  ];
  return [strokePolyline(pts, 0.024)];
}

export function skull(rng) {
  const els = [];
  // Cranium — flat-bottom dome.
  els.push(strokeFromFn(80,
    (t) => {
      const a = Math.PI + t * Math.PI;
      return { x: Math.cos(a) * 0.30, y: Math.sin(a) * 0.32 + 0.05 };
    },
    () => 0.024,
  ));
  // Jaw — flat baseline + temples.
  els.push(strokeLine(-0.30, 0.05, -0.24, -0.20, 0.024));
  els.push(strokeLine( 0.30, 0.05,  0.24, -0.20, 0.024));
  els.push(strokeLine(-0.24, -0.20, 0.24, -0.20, 0.024));
  // Eye sockets.
  els.push(disc(-0.13, 0.10, 0.060));
  els.push(disc( 0.13, 0.10, 0.060));
  // Nose triangle.
  els.push(strokePolyline([
    { x: -0.04, y:  0.00 },
    { x:  0.04, y:  0.00 },
    { x:  0.00, y: -0.10 },
    { x: -0.04, y:  0.00 },
  ], 0.014));
  // Teeth — vertical ticks along the jaw line.
  for (let i = -2; i <= 2; i++) {
    els.push(strokeLine(i * 0.08, -0.20, i * 0.08, -0.10, 0.012));
  }
  return els;
}

export function anchor(rng) {
  const els = [];
  // Top ring.
  els.push(ring(0.06, 0.020));
  // Stem.
  els.push(strokeLine(0, -0.06, 0, -0.36, 0.024));
  // Crossbar.
  els.push(strokeLine(-0.16, -0.10, 0.16, -0.10, 0.020));
  // Hooks at the bottom — two J-curves sweeping outward.
  els.push(strokeQuad(0, -0.36, -0.20, -0.36, -0.26, -0.20, 0.022));
  els.push(strokeQuad(0, -0.36,  0.20, -0.36,  0.26, -0.20, 0.022));
  // Barbs at hook ends.
  els.push(strokeLine(-0.26, -0.20, -0.32, -0.30, 0.018));
  els.push(strokeLine( 0.26, -0.20,  0.32, -0.30, 0.018));
  return els;
}

export function tearDrop(rng) {
  const els = [];
  els.push(strokeCubic(
    0,  0.40,
    -0.22,  0.10,
    -0.18, -0.20,
    0, -0.30,
    0.024,
  ));
  els.push(strokeCubic(
    0,  0.40,
    0.22,  0.10,
    0.18, -0.20,
    0, -0.30,
    0.024,
  ));
  // Ripple beneath.
  els.push(strokeArc(0, -0.42, 0.22, Math.PI * 0.10, Math.PI * 0.90, 0.014));
  if (rng() < 0.5) els.push(strokeArc(0, -0.46, 0.32, Math.PI * 0.18, Math.PI * 0.82, 0.012));
  return els;
}

export function flame(rng) {
  const els = [];
  // Outer teardrop body with a curl at the tip.
  els.push(strokeCubic(
    0, -0.35,
    -0.25, -0.10,
    -0.10,  0.30,
    0.06,  0.45,
    0.024,
  ));
  els.push(strokeCubic(
    0, -0.35,
    0.22, -0.10,
    0.20,  0.20,
    0.06,  0.45,
    0.024,
  ));
  // Inner highlight.
  els.push(strokeCubic(
    -0.02, -0.20,
    -0.12,  0.00,
    -0.04,  0.18,
    0.04,  0.30,
    0.018,
  ));
  // Base — small kindling discs.
  els.push(disc(-0.10, -0.40, 0.022));
  els.push(disc( 0.10, -0.40, 0.022));
  els.push(disc(0,    -0.42, 0.018));
  return els;
}

// ── Mystical / cosmic ──────────────────────────────────────────

export function star(rng) {
  const points = (rng() < 0.6) ? 5 : 6;
  const r = 0.32 + rng() * 0.04;
  return [starShape(points, r, 0.55, rng() * 0.4, 0.022)];
}

export function crescent(rng) {
  const els = crescentShape(0.36, 0.024, 0.55 + rng() * 0.15);
  if (rng() < 0.6) els.push(disc(0.36, 0, 0.030));
  return els;
}

export function ankh(rng) {
  const els = [];
  // Loop on top.
  els.push(strokeFromFn(70,
    (t) => {
      const a = t * Math.PI * 2;
      return { x: Math.cos(a) * 0.14, y: 0.25 + Math.sin(a) * 0.14 };
    },
    () => 0.022,
  ));
  // Vertical stem.
  els.push(strokeLine(0, 0.11, 0, -0.45, 0.024));
  // Horizontal arms.
  els.push(strokeLine(-0.24, -0.12, 0.24, -0.12, 0.022));
  return els;
}

export function spiral(rng) {
  const turns = 2.0 + rng() * 1.5;
  const els = [spiralShape(turns, 0.45, 0.018)];
  els.push(disc(0, 0, 0.020));
  return els;
}

export function infinity(rng) {
  // Two ellipses side by side, slightly overlapping.
  const els = [];
  const r = 0.18;
  els.push(strokeFromFn(70, (t) => {
    const a = t * Math.PI * 2;
    return { x: -r + Math.cos(a) * r, y: Math.sin(a) * r * 0.7 };
  }, () => 0.020));
  els.push(strokeFromFn(70, (t) => {
    const a = t * Math.PI * 2;
    return { x: r + Math.cos(a) * r, y: Math.sin(a) * r * 0.7 };
  }, () => 0.020));
  return els;
}

export function compass(rng) {
  const els = [];
  els.push(ring(0.34, 0.018));
  // Cardinal ticks.
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    els.push(strokeLine(
      Math.cos(a) * 0.34, Math.sin(a) * 0.34,
      Math.cos(a) * 0.42, Math.sin(a) * 0.42,
      0.020,
    ));
  }
  // Inner ticks.
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    els.push(strokeLine(
      Math.cos(a) * 0.34, Math.sin(a) * 0.34,
      Math.cos(a) * 0.40, Math.sin(a) * 0.40,
      0.014,
    ));
  }
  // Needle — diamond pointing up (or rotated).
  const needleRot = rng() * Math.PI * 2;
  const cs = Math.cos(needleRot), sn = Math.sin(needleRot);
  const tip   = { x: -sn * 0.26, y: cs * 0.26 };
  const tail  = { x:  sn * 0.26, y: -cs * 0.26 };
  const left  = { x: -cs * 0.05, y: -sn * 0.05 };
  const right = { x:  cs * 0.05, y:  sn * 0.05 };
  els.push(strokePolyline([tip, left, tail, right, tip], 0.018));
  els.push(disc(0, 0, 0.024));
  return els;
}

// ── Body / life ────────────────────────────────────────────────

export function footprint(rng) {
  const els = [];
  els.push(strokeFromFn(70,
    (t) => {
      const a = t * Math.PI * 2;
      return { x: Math.cos(a) * 0.18, y: -0.05 + Math.sin(a) * 0.28 };
    },
    () => 0.022,
  ));
  // Toes — five dots above.
  const toeXs = [-0.16, -0.08, 0, 0.08, 0.16];
  const toeYs = [ 0.20,  0.30, 0.34, 0.30, 0.20];
  for (let i = 0; i < 5; i++) {
    els.push(disc(toeXs[i], toeYs[i], 0.030 - i * 0.002 + (i > 2 ? (i - 2) * 0.002 : 0)));
  }
  return els;
}

export function feather(rng) {
  const els = [];
  els.push(strokeQuad(0, -0.40, 0.04, 0, -0.04, 0.40, 0.020));
  // Barbs — small angled lines on each side.
  const N = 7;
  for (let i = 0; i < N; i++) {
    const t  = (i + 1) / (N + 1);
    const y  = -0.38 + t * 0.76;
    const dx = (1 - Math.abs(t - 0.5) * 1.6) * 0.20;
    els.push(strokeLine(0, y, -dx, y - 0.04, 0.014));
    els.push(strokeLine(0, y,  dx, y - 0.04, 0.014));
  }
  return els;
}

// ── Animals & nature ───────────────────────────────────────────

export function snake(rng) {
  const els = [];
  // Sinuous body — sine wave along x.
  els.push(sineWave(0.18, 0.40, 0.78, 0.022, 0));
  // Head bulb at the right end.
  els.push(disc(0.40, 0, 0.040));
  // Eye dot.
  els.push(disc(0.43, 0.015, 0.012));
  // Forked tongue.
  els.push(strokeLine(0.43, 0, 0.52, 0.04, 0.012));
  els.push(strokeLine(0.43, 0, 0.52, -0.04, 0.012));
  return els;
}

export function leaf(rng) {
  const els = [];
  // Almond outline (drawn upright; the glyph rotates the whole thing).
  els.push(strokeQuad(-0.40, 0, 0,  0.16, 0.40, 0, 0.020));
  els.push(strokeQuad(-0.40, 0, 0, -0.16, 0.40, 0, 0.020));
  // Central spine.
  els.push(strokeLine(-0.36, 0, 0.36, 0, 0.014));
  // Side veins.
  for (let i = 0; i < 3; i++) {
    const x = -0.20 + i * 0.20;
    els.push(strokeLine(x, 0, x + 0.08,  0.10, 0.012));
    els.push(strokeLine(x, 0, x + 0.08, -0.10, 0.012));
  }
  // Rotate the whole leaf so it doesn't always lay flat.
  const tilt = -0.4 + rng() * 0.4;
  const cs = Math.cos(tilt), sn = Math.sin(tilt);
  for (const el of els) {
    if (el.type === 'disc') {
      const p = el.center;
      el.center = { x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs };
    } else {
      el.points = el.points.map(p => ({ x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs }));
    }
  }
  return els;
}

export function mushroom(rng) {
  const els = [];
  // Cap dome.
  els.push(strokeArc(0, 0.10, 0.30, 0, Math.PI, 0.024));
  els.push(strokeLine(-0.30, 0.10, 0.30, 0.10, 0.022));
  // Stem.
  els.push(strokePolyline([
    { x: -0.09, y:  0.08 },
    { x:  0.09, y:  0.08 },
    { x:  0.09, y: -0.30 },
    { x: -0.09, y: -0.30 },
    { x: -0.09, y:  0.08 },
  ], 0.020));
  // Spots on the cap.
  const N = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < N; i++) {
    const a = Math.PI * 0.20 + (i / (N - 1 || 1)) * Math.PI * 0.60;
    const r = 0.10 + rng() * 0.12;
    els.push(disc(Math.cos(a) * r, 0.10 + Math.sin(a) * r, 0.018));
  }
  return els;
}

export function owl(rng) {
  const els = [];
  els.push(ring(0.32, 0.022));
  // Ear tufts.
  els.push(strokePolyline([
    { x: -0.20, y: 0.28 },
    { x: -0.16, y: 0.42 },
    { x: -0.10, y: 0.30 },
  ], 0.018));
  els.push(strokePolyline([
    { x:  0.20, y: 0.28 },
    { x:  0.16, y: 0.42 },
    { x:  0.10, y: 0.30 },
  ], 0.018));
  // Eye rings + pupils.
  els.push(strokeFromFn(40,
    (t) => {
      const a = t * Math.PI * 2;
      return { x: -0.12 + Math.cos(a) * 0.08, y: 0.05 + Math.sin(a) * 0.08 };
    },
    () => 0.018,
  ));
  els.push(strokeFromFn(40,
    (t) => {
      const a = t * Math.PI * 2;
      return { x: 0.12 + Math.cos(a) * 0.08, y: 0.05 + Math.sin(a) * 0.08 };
    },
    () => 0.018,
  ));
  els.push(disc(-0.12, 0.05, 0.026));
  els.push(disc( 0.12, 0.05, 0.026));
  // Beak triangle.
  els.push(strokePolyline([
    { x: -0.04, y: -0.05 },
    { x:  0.04, y: -0.05 },
    { x:  0.00, y: -0.14 },
    { x: -0.04, y: -0.05 },
  ], 0.014));
  return els;
}

export function cloud(rng) {
  const els = [];
  // Three overlapping arcs forming the cloud top.
  els.push(strokeArc(-0.18, 0.05, 0.16, Math.PI * 0.40, Math.PI * 1.60, 0.022));
  els.push(strokeArc( 0.00, 0.15, 0.20, Math.PI * 0.00, Math.PI * 1.00, 0.022));
  els.push(strokeArc( 0.20, 0.05, 0.18, Math.PI * 0.50, Math.PI * 2.00, 0.022));
  // Underside.
  els.push(strokeQuad(-0.30, -0.05, 0, -0.10, 0.36, -0.05, 0.022));
  // Optional rain.
  if (rng() < 0.5) {
    for (let i = 0; i < 4; i++) {
      const x = -0.18 + i * 0.12;
      els.push(strokeLine(x, -0.18, x - 0.04, -0.32, 0.012));
    }
  }
  return els;
}

export function wave(rng) {
  const els = [];
  // Single breaking wave — rising arc with a curl.
  els.push(strokeQuad(-0.45, -0.10, -0.20,  0.30,  0.10, 0.20, 0.024));
  els.push(strokeQuad( 0.10,  0.20,  0.30,  0.10,  0.40, -0.10, 0.024));
  // Foam dots on the crest.
  for (let i = 0; i < 3; i++) {
    const x = -0.10 + i * 0.13;
    els.push(disc(x, 0.20 + Math.sin(i * 1.7) * 0.04, 0.018));
  }
  // Water surface.
  els.push(strokeLine(-0.45, -0.32, 0.45, -0.32, 0.014));
  return els;
}

export function lotus(rng) {
  const els = [];
  const N = 7;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const tipX = Math.cos(a) * 0.42, tipY = Math.sin(a) * 0.42;
    // Petal — two curves meeting at tip.
    els.push(strokeQuad(0, 0, Math.cos(a - 0.18) * 0.30, Math.sin(a - 0.18) * 0.30, tipX, tipY, 0.018));
    els.push(strokeQuad(0, 0, Math.cos(a + 0.18) * 0.30, Math.sin(a + 0.18) * 0.30, tipX, tipY, 0.018));
  }
  els.push(disc(0, 0, 0.05));
  return els;
}

// ── Time, balance, structure ───────────────────────────────────

export function hourglass(rng) {
  const els = [];
  // Two triangles tip-to-tip.
  els.push(strokePolyline([
    { x: -0.22, y: 0.40 },
    { x:  0.22, y: 0.40 },
    { x:  0,    y: 0    },
    { x: -0.22, y: 0.40 },
  ], 0.022));
  els.push(strokePolyline([
    { x: -0.22, y: -0.40 },
    { x:  0.22, y: -0.40 },
    { x:  0,    y:  0    },
    { x: -0.22, y: -0.40 },
  ], 0.022));
  // Top and bottom rims.
  els.push(strokeLine(-0.30,  0.42, 0.30,  0.42, 0.020));
  els.push(strokeLine(-0.30, -0.42, 0.30, -0.42, 0.020));
  // Sand falling through the neck.
  els.push(disc(0, -0.10, 0.030));
  els.push(disc(0, -0.20, 0.024));
  els.push(disc(0, -0.30, 0.020));
  return els;
}

export function scales(rng) {
  const els = [];
  // Central pillar.
  els.push(strokeLine(0, -0.40, 0, 0.30, 0.022));
  // Crossbeam.
  els.push(strokeLine(-0.30, 0.30, 0.30, 0.30, 0.020));
  // Hanging strings.
  els.push(strokeLine(-0.30, 0.30, -0.30, 0.10, 0.014));
  els.push(strokeLine( 0.30, 0.30,  0.30, 0.10, 0.014));
  // Plates — half discs.
  els.push(strokeArc(-0.30, 0.10, 0.10, Math.PI, Math.PI * 2, 0.020));
  els.push(strokeArc( 0.30, 0.10, 0.10, Math.PI, Math.PI * 2, 0.020));
  // Base.
  els.push(strokeLine(-0.10, -0.40, 0.10, -0.40, 0.022));
  return els;
}

export function ladder(rng) {
  const els = [];
  // Rails.
  els.push(strokeLine(-0.15, -0.45, -0.15, 0.45, 0.020));
  els.push(strokeLine( 0.15, -0.45,  0.15, 0.45, 0.020));
  // Rungs.
  const N = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const y = -0.40 + t * 0.80;
    els.push(strokeLine(-0.15, y, 0.15, y, 0.018));
  }
  return els;
}

// ── Mystical extensions ────────────────────────────────────────

export function yinyang(rng) {
  const els = [];
  const r = 0.32;
  els.push(ring(r, 0.022));
  // S-curve: top bulges right, bottom bulges left.
  els.push(strokeArc(0,  r / 2, r / 2,  Math.PI / 2, -Math.PI / 2, 0.022));
  els.push(strokeArc(0, -r / 2, r / 2,  Math.PI / 2,  Math.PI * 1.5, 0.022));
  // Two small dots — one in each fish.
  els.push(disc(0,  r / 2, 0.024));
  els.push(disc(0, -r / 2, 0.024));
  return els;
}

export function mandala(rng) {
  const els = [];
  const N = 8;
  els.push(ring(0.42, 0.020));
  els.push(ring(0.20, 0.016));
  els.push(disc(0, 0, 0.05));
  // Petals on the inner ring.
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const cx = Math.cos(a) * 0.30, cy = Math.sin(a) * 0.30;
    els.push(strokeFromFn(30,
      (t) => {
        const ang = t * Math.PI * 2;
        const px  = Math.cos(ang) * 0.06;
        const py  = Math.sin(ang) * 0.10;
        const cs  = Math.cos(a + Math.PI / 2), sn = Math.sin(a + Math.PI / 2);
        return { x: cx + px * cs - py * sn, y: cy + px * sn + py * cs };
      },
      () => 0.014,
    ));
  }
  // Spokes between petals out to the outer ring.
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.PI / N;
    els.push(strokeLine(
      Math.cos(a) * 0.20, Math.sin(a) * 0.20,
      Math.cos(a) * 0.42, Math.sin(a) * 0.42,
      0.012,
    ));
  }
  return els;
}

export function eyeOfHorus(rng) {
  const els = [];
  // Eye body.
  els.push(strokeQuad(-0.35, 0, 0,  0.12, 0.30, 0, 0.022));
  els.push(strokeQuad(-0.35, 0, 0, -0.12, 0.30, 0, 0.022));
  els.push(disc(0, 0, 0.060));
  // Tail: horizontal sweep then curl downward.
  els.push(strokeQuad(0.28, 0, 0.40, -0.10, 0.50, -0.20, 0.020));
  els.push(strokeArc(0.45, -0.25, 0.08, 0, Math.PI, 0.020));
  // Cheek mark (drop below eye).
  els.push(strokeQuad(-0.10, -0.04, -0.10, -0.20, -0.05, -0.32, 0.018));
  return els;
}

export function peace(rng) {
  const els = [];
  els.push(ring(0.32, 0.022));
  els.push(strokeLine(0, -0.32, 0, 0.32, 0.022));
  els.push(strokeLine(0, 0, -0.22, -0.22, 0.022));
  els.push(strokeLine(0, 0,  0.22, -0.22, 0.022));
  return els;
}

export function atom(rng) {
  const els = [];
  for (let i = 0; i < 3; i++) {
    els.push(ellipse(0.36, 0.14, 0.018, i * Math.PI / 3));
  }
  els.push(disc(0, 0, 0.05));
  // Three small electron discs along the orbits.
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI / 3;
    const t = rng() * Math.PI * 2;
    const cs = Math.cos(a), sn = Math.sin(a);
    const x0 = Math.cos(t) * 0.36, y0 = Math.sin(t) * 0.14;
    els.push(disc(x0 * cs - y0 * sn, x0 * sn + y0 * cs, 0.022));
  }
  return els;
}

// ── Sharp & broken ─────────────────────────────────────────────

export function dagger(rng) {
  const els = [];
  // Blade.
  els.push(strokePolyline([
    { x:  0.00, y:  0.50 },
    { x:  0.06, y:  0.05 },
    { x: -0.06, y:  0.05 },
    { x:  0.00, y:  0.50 },
  ], 0.020));
  // Crossguard.
  els.push(strokeLine(-0.18, 0.05, 0.18, 0.05, 0.024));
  // Hilt.
  els.push(strokeLine(0, 0.05, 0, -0.20, 0.022));
  // Pommel.
  els.push(disc(0, -0.25, 0.045));
  return els;
}

export function brokenForm(rng) {
  const els = [];
  const r = 0.34;
  const N = 4;
  // Broken arc segments around a circle.
  for (let i = 0; i < N; i++) {
    const a1 = (i / N) * Math.PI * 2;
    const a2 = a1 + (Math.PI * 2 / N) * (0.55 + rng() * 0.25);
    els.push(strokeArc(0, 0, r, a1, a2, 0.022));
  }
  // Cracks radiating from the centre.
  const cracks = 3;
  for (let i = 0; i < cracks; i++) {
    const a = rng() * Math.PI * 2;
    els.push(strokeLine(
      Math.cos(a) * 0.18, Math.sin(a) * 0.18,
      Math.cos(a) * (r + 0.06), Math.sin(a) * (r + 0.06),
      0.014,
    ));
  }
  return els;
}
