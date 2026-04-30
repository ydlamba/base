// ────────────────────────────────────────────────────────────────
// Parametric shapes — closed/open curves and polygons that the
// glyph vocabulary composes into runic and asemic forms.
// All shapes are centred at the origin in glyph-local space; use
// transformElement(s) from primitives.js to position them.
// ────────────────────────────────────────────────────────────────

import {
  strokeFromFn, disc, strokeLine, strokeArc, strokePolyline,
} from './primitives.js';

// Closed circular ring centred at origin. `jitter` adds a soft
// per-angle wobble so the ring reads as drawn rather than printed.
export function ring(r, thick = 0.022, jitter = 0) {
  const N = Math.max(80, Math.floor(r * 280));
  return strokeFromFn(N,
    (t) => {
      const a = t * Math.PI * 2;
      const rr = r + (jitter ? Math.sin(a * 5 + 1.7) * jitter : 0);
      return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
    },
    () => thick,
  );
}

// Ring with an opening — `gapAt` in 0..1 is fraction around the
// circumference; `gap` is the angular size of the gap in radians.
export function brokenRing(r, thick = 0.022, gapAt = 0, gap = 0.6) {
  const a0 = gapAt * Math.PI * 2 + gap / 2;
  const a1 = a0 + (Math.PI * 2 - gap);
  return strokeArc(0, 0, r, a0, a1, thick);
}

// Regular polygon, n sides, circumradius r, rotated by `rot`.
export function polygon(n, r, rot = 0, thick = 0.022) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = rot + (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return strokePolyline(pts, thick);
}

// Axis-aligned rectangle of width w, height h.
export function rectangle(w, h, thick = 0.022) {
  const hw = w / 2, hh = h / 2;
  return strokePolyline([
    { x: -hw, y: -hh }, { x:  hw, y: -hh },
    { x:  hw, y:  hh }, { x: -hw, y:  hh },
    { x: -hw, y: -hh },
  ], thick);
}

// Crescent moon — outer arc + inner arc, returned as two strokes.
// `opening` in 0..1 controls how thick the crescent is.
export function crescent(r, thick = 0.022, opening = 0.6) {
  const outer = strokeArc(0, 0, r, Math.PI * 0.55, Math.PI * 1.45, thick);
  const innerR = r * (1 - opening * 0.45);
  const offset = r * opening * 0.55;
  const inner = strokeArc(offset, 0, innerR, Math.PI * 0.55, Math.PI * 1.45, thick);
  return [outer, inner];
}

// Linear spiral. Particles distribute uniformly along arc length.
export function spiral(turns = 2.5, rEnd = 0.5, thick = 0.014) {
  const N = Math.max(120, Math.floor(turns * 80));
  return strokeFromFn(N,
    (t) => {
      const a = t * turns * Math.PI * 2;
      const r = rEnd * t;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    },
    () => thick,
  );
}

// Sine wave segment along x-axis, centred at origin.
export function sineWave(amp, period, lengthX, thick = 0.018, phase = 0) {
  const N = Math.max(60, Math.floor(lengthX * 80));
  return strokeFromFn(N,
    (t) => {
      const x = -lengthX / 2 + t * lengthX;
      const y = Math.sin(x / period * Math.PI * 2 + phase) * amp;
      return { x, y };
    },
    () => thick,
  );
}

// Cuneiform-style wedge — tapers from base (thick) to tip.
export function wedge(angle, length = 0.10, thick = 0.030) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  return strokeFromFn(20,
    (t) => ({ x: dx * length * t, y: dy * length * t }),
    (t) => thick * (1 - t * 0.85),
  );
}

// V/^ chevron — `pointDown=true` makes a V; false makes a peak.
export function chevron(width = 0.30, depth = 0.18, thick = 0.020, pointDown = true) {
  const sgn = pointDown ? -1 : 1;
  return [
    strokeLine(-width / 2, 0, 0, depth * sgn, thick),
    strokeLine(0, depth * sgn, width / 2, 0, thick),
  ];
}

export function plus(size = 0.20, thick = 0.022) {
  return [
    strokeLine(-size, 0, size, 0, thick),
    strokeLine(0, -size, 0, size, thick),
  ];
}

export function cross(size = 0.20, thick = 0.022) {
  return [
    strokeLine(-size, -size, size, size, thick),
    strokeLine(-size, size, size, -size, thick),
  ];
}

// Tally marks — n vertical strokes; the fifth crosses through diagonally.
export function tally(n, spacing = 0.06, height = 0.20, thick = 0.022) {
  const out = [];
  const isFive = n === 5;
  const verticalCount = isFive ? 4 : n;
  const startX = -((verticalCount - 1) / 2) * spacing;
  for (let i = 0; i < verticalCount; i++) {
    const x = startX + i * spacing;
    out.push(strokeLine(x, -height / 2, x, height / 2, thick));
  }
  if (isFive) {
    const x0 = startX - spacing * 0.5;
    const x1 = startX + (verticalCount - 1) * spacing + spacing * 0.5;
    out.push(strokeLine(x0, height / 2, x1, -height / 2, thick * 0.9));
  }
  return out;
}

// Triangle (3-gon) convenience; rot=0 means apex pointing up.
export function triangle(r, rot = 0, thick = 0.022) {
  return polygon(3, r, rot, thick);
}

// Ellipse, semi-axes a and b.
export function ellipse(a, b, thick = 0.022, rot = 0) {
  const N = Math.max(80, Math.floor((a + b) * 200));
  const cs = Math.cos(rot), sn = Math.sin(rot);
  return strokeFromFn(N,
    (t) => {
      const ang = t * Math.PI * 2;
      const x0 = Math.cos(ang) * a;
      const y0 = Math.sin(ang) * b;
      return { x: x0 * cs - y0 * sn, y: x0 * sn + y0 * cs };
    },
    () => thick,
  );
}
