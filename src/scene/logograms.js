// ────────────────────────────────────────────────────────────────
// Procedural logogram generator.
//
// Design philosophy: these are communication symbols, not abstract art.
// Every element has a reason to be where it is. The main ring is the
// frame; interior elements attach to it or echo its geometry. Anchor
// angles create rhythm; terminals (dots, hooks) mark stroke endings.
//
// Structure:
//   1. Shape primitives — small leaf functions that build a single
//      stroke or disc element (ring, arc, polygon, hook, splat, ...)
//   2. Inner-element picker — randomly chooses ring / polygon /
//      rectangle wherever an interior support is needed
//   3. Archetypes — coherent grammars that compose primitives into a
//      single visual idea (eye, vessel, compass, beacon, ...). Each
//      glyph commits to one archetype so its parts speak to each other.
//   4. Main generator — picks an archetype, runs it, then layers a
//      "dressing" pass of small accents and ticks so no glyph reads
//      as bare. Mood (thickness scale) varies the overall weight.
//
// Returns `{ seed, elements }` where each element is:
//   { type: 'stroke', points: [{x,y}], thickness: [number] }
//   { type: 'disc',   center: {x,y}, radius: number }
// ────────────────────────────────────────────────────────────────

import { makeRng } from '../core/util.js';

const RING_R0 = 0.62;

// ── Helpers ─────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

function strokeFromFn(N, fn, thickFn) {
  const points = [], thickness = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    points.push(fn(t));
    thickness.push(thickFn(t));
  }
  return { type: 'stroke', points, thickness };
}

// Given a ring stroke and an angle, find the actual point on the ring.
// The ring is parameterised by t in [0,1] mapping to angle [-PI/2, 3PI/2].
// We compute the parametric t from the desired angle and interpolate.
function ringAt(ring, angle) {
  const norm = ((angle + Math.PI * 0.5) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const t = norm / (Math.PI * 2);
  const pts = ring.points;
  const idx = t * (pts.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, pts.length - 1);
  const f = idx - i0;
  const p0 = pts[i0];
  const p1 = pts[i1];
  return {
    x: p0.x + (p1.x - p0.x) * f,
    y: p0.y + (p1.y - p0.y) * f,
  };
}

// Unit tangent of a stroke at parametric t (for perpendicular offsets)
function ringTangent(ring, angle) {
  const norm = ((angle + Math.PI * 0.5) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const t = norm / (Math.PI * 2);
  const pts = ring.points;
  const idx = t * (pts.length - 1);
  const i0 = Math.max(0, Math.floor(idx) - 1);
  const i1 = Math.min(i0 + 2, pts.length - 1);
  const dx = pts[i1].x - pts[i0].x;
  const dy = pts[i1].y - pts[i0].y;
  const L = Math.hypot(dx, dy) || 1;
  return { x: dx / L, y: dy / L };
}

// ── Main ring — the frame of every glyph ────────────────────────

function makeMainRing(rng, opts = {}) {
  const N = 360;
  const variant = Math.floor(rng() * 4);
  const rPhase = rng() * 6.283;
  const tPhase1 = rng() * 6.283;
  const tPhase2 = rng() * 6.283;
  const dryPhase = rng() * 6.283;
  const aspect = 0.88 + rng() * 0.20;
  const tilt = (rng() - 0.5) * 0.45;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  // Opts: broken=true creates a gap; thickScale modulates emotion (thin/bold).
  const broken = !!opts.broken;
  const gapAt   = opts.gapAt ?? rng();
  const gapSize = opts.gapSize ?? (0.06 + rng() * 0.07);
  const thickScale = opts.thickScale ?? 1.0;

  let wobble1 = 0.045, wobble2 = 0.020, wobble3 = 0.008;
  if (variant === 1) { wobble1 = 0.060; wobble2 = 0.008; }
  if (variant === 2) { wobble1 = 0.025; wobble2 = 0.035; }
  if (variant === 3) { wobble1 = 0.015; wobble2 = 0.012; wobble3 = 0.004; }

  return strokeFromFn(N, (t) => {
    const a = -Math.PI * 0.5 + t * Math.PI * 2.0;
    const r = RING_R0
            + Math.sin(a * 2.0 + rPhase) * wobble1
            + Math.sin(a * 5.0 + rPhase * 1.7) * wobble2
            + Math.sin(a * 9.0 + rPhase * 0.3) * wobble3;
    const x0 = Math.cos(a) * r * aspect;
    const y0 = Math.sin(a) * r;
    return { x: x0 * ct - y0 * st, y: x0 * st + y0 * ct };
  }, (t) => {
    const a = -Math.PI * 0.5 + t * Math.PI * 2.0;
    const tk1 = 0.5 * (Math.sin(a * 1.5 + tPhase1) + 1);
    const tk2 = 0.5 * (Math.sin(a * 3.0 + tPhase2) + 1);
    // Main ring is a FRAME — slim enough to share the particle budget
    // with interior detail, but thick enough to read with confidence.
    let thick = 0.020 + tk1 * tk1 * 0.038 + tk2 * 0.014;
    const dry = Math.sin(a * 4.0 + dryPhase);
    if (dry > 0.55) thick *= 1 - ((dry - 0.55) / 0.45) * 0.82;
    // Gap: collapse thickness to near-zero so particle allocation skips
    // this region — the ring reads as broken/open.
    if (broken) {
      const d = Math.min(Math.abs(t - gapAt), 1 - Math.abs(t - gapAt));
      if (d < gapSize) {
        const fade = d / gapSize;
        thick *= fade * fade;
      }
    }
    return Math.max(0.003, thick * thickScale);
  });
}

// ── Spoke — radial line from interior point to ring ─────────────

function makeSpoke(rng, ring, angle, innerR) {
  const N = 70;
  const start = { x: Math.cos(angle) * innerR, y: Math.sin(angle) * innerR };
  const end = ringAt(ring, angle);
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const perpX = -dy / len, perpY = dx / len;
  const bend = (rng() - 0.5) * 0.06;
  return strokeFromFn(N, (t) => {
    const e = t * t * (3 - 2 * t);
    return {
      x: start.x + dx * e + perpX * bend * Math.sin(t * Math.PI) * len,
      y: start.y + dy * e + perpY * bend * Math.sin(t * Math.PI) * len,
    };
  }, (t) => {
    const taper = Math.sin(t * Math.PI);
    return (0.016 + 0.014 * taper) * (0.35 + 0.65 * taper) + 0.003;
  });
}

// ── Arch — curved bridge between two ring points ────────────────

function makeArch(rng, ring, a1, a2) {
  const N = 120;
  const p1 = ringAt(ring, a1);
  const p2 = ringAt(ring, a2);
  const mx = (p1.x + p2.x) * 0.5;
  const my = (p1.y + p2.y) * 0.5;
  // Bow inward toward center
  const bowDir = Math.atan2(my, mx);
  const bowAmt = 0.12 + rng() * 0.22;
  const cp = {
    x: mx - Math.cos(bowDir) * bowAmt,
    y: my - Math.sin(bowDir) * bowAmt,
  };
  // Second control point for gentle asymmetry
  const asym = (rng() - 0.5) * 0.08;
  const cp2 = { x: cp.x + asym, y: cp.y + asym };
  const tk = 0.014 + rng() * 0.016;

  return strokeFromFn(N, (t) => {
    const u = 1 - t;
    const x = u*u*u*p1.x + 3*u*u*t*cp.x + 3*u*t*t*cp2.x + t*t*t*p2.x;
    const y = u*u*u*p1.y + 3*u*u*t*cp.y + 3*u*t*t*cp2.y + t*t*t*p2.y;
    return { x, y };
  }, (t) => {
    const taper = Math.sin(t * Math.PI);
    return tk * (0.25 + 0.75 * taper) + 0.002;
  });
}

// ── Nested arc — partial arc echoing the ring, stays near ring ──

function makeNestedArc(rng, ring, centerAngle, span) {
  const N = 140;
  const r = RING_R0 * (0.55 + rng() * 0.30);
  const startA = centerAngle - span * 0.5;
  const tilt = (rng() - 0.5) * 0.35;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const tk = 0.012 + rng() * 0.016;
  return strokeFromFn(N, (t) => {
    const a = startA + t * span;
    const rr = r + Math.sin(t * Math.PI * 2) * 0.004;
    const x0 = Math.cos(a) * rr;
    const y0 = Math.sin(a) * rr;
    return { x: x0 * ct - y0 * st, y: x0 * st + y0 * ct };
  }, (t) => {
    const taper = Math.sin(t * Math.PI);
    return tk * (0.30 + 0.70 * taper);
  });
}

// ── Satellite — small loop attached to the ring ─────────────────

function makeSatellite(rng, ring, angle) {
  const N = 110;
  const rp = ringAt(ring, angle);
  const tan = ringTangent(ring, angle);
  const outward = rng() < 0.55;
  const sign = outward ? 1 : -1;
  const loopR = 0.06 + rng() * 0.05;
  // Offset perpendicular to ring tangent
  const nx = -tan.y, ny = tan.x;
  const cx = rp.x + nx * loopR * sign;
  const cy = rp.y + ny * loopR * sign;
  const aspect = 0.80 + rng() * 0.35;
  const lTilt = rng() * Math.PI;
  const ct = Math.cos(lTilt), st = Math.sin(lTilt);
  const tk = 0.018 + rng() * 0.016;
  return strokeFromFn(N, (t) => {
    const a = t * Math.PI * 2;
    const lx = Math.cos(a) * loopR * aspect;
    const ly = Math.sin(a) * loopR;
    return { x: lx * ct - ly * st + cx, y: lx * st + ly * ct + cy };
  }, (t) => {
    const a = t * Math.PI * 2;
    return tk * (0.85 + Math.sin(a * 2) * 0.15);
  });
}

// ── Inner ring — small closed loop inside ───────────────────────

function makeInnerRing(rng) {
  const N = 180;
  const cx = (rng() - 0.5) * 0.16;
  const cy = (rng() - 0.5) * 0.16;
  const r0 = 0.18 + rng() * 0.16;   // larger — more readable
  const aspect = 0.80 + rng() * 0.35;
  const tilt = rng() * Math.PI;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const rPhase = rng() * 6.283;
  const tPhase = rng() * 6.283;
  return strokeFromFn(N, (t) => {
    const a = -Math.PI * 0.5 + t * Math.PI * 2.0;
    const r = r0 + Math.sin(a * 3.0 + rPhase) * 0.014;
    const x0 = Math.cos(a) * r * aspect;
    const y0 = Math.sin(a) * r;
    return { x: x0 * ct - y0 * st + cx, y: x0 * st + y0 * ct + cy };
  }, (t) => {
    const a = -Math.PI * 0.5 + t * Math.PI * 2.0;
    const tk = 0.5 * (Math.sin(a * 2.0 + tPhase) + 1);
    return 0.026 + tk * 0.030;
  });
}

// ── Dart — small directional mark at ring edge ──────────────────

function makeDart(rng, ring, angle, inwardOverride) {
  const N = 40;
  const rp = ringAt(ring, angle);
  const tan = ringTangent(ring, angle);
  const nx = -tan.y, ny = tan.x; // outward normal
  const inward = (inwardOverride === undefined) ? (rng() < 0.65) : inwardOverride;
  const sign = inward ? -1 : 1;
  const len = 0.06 + rng() * 0.06;
  const spread = 0.025 + rng() * 0.020;
  return strokeFromFn(N, (t) => {
    // t=0 at ring edge, t=1 at tip
    const frac = t * t; // bias toward base
    const w = (1 - t) * spread;
    return {
      x: rp.x + nx * frac * len * sign + tan.x * w * (t - 0.5),
      y: rp.y + ny * frac * len * sign + tan.y * w * (t - 0.5),
    };
  }, (t) => {
    return 0.018 * (1 - t) + 0.004;
  });
}

// ── Eyelet (terminal dot) ───────────────────────────────────────

function makeEyelet(rng, x, y) {
  return {
    type: 'disc',
    center: { x, y },
    radius: 0.018 + rng() * 0.024,
  };
}

// ── Drip (solid ink pool) ──────────────────────────────────────

function makeDrip(rng) {
  const a = rng() * Math.PI * 2;
  const r = RING_R0 * 0.30 + rng() * RING_R0 * 0.55;
  return {
    type: 'disc',
    center: { x: Math.cos(a) * r, y: Math.sin(a) * r },
    radius: 0.030 + rng() * 0.040,
  };
}

// ── Tongue — thick-base, fine-tip extension from ring ───────────

function makeTongue(rng, ring, angle) {
  const N = 80;
  const base = ringAt(ring, angle);
  const tan = ringTangent(ring, angle);
  const outX = Math.cos(angle), outY = Math.sin(angle);
  // Blend ring normal with radial direction for more natural extension
  const nx = -tan.y, ny = tan.x;
  const dirX = (outX + nx) * 0.5;
  const dirY = (outY + ny) * 0.5;
  const dirLen = Math.hypot(dirX, dirY) || 1;
  const dx = dirX / dirLen, dy = dirY / dirLen;
  // Perp for curl
  const px = -dy, py = dx;
  const length = 0.16 + rng() * 0.16;
  const curl = (rng() - 0.5) * 0.45;
  const baseThick = 0.048 + rng() * 0.024;
  return strokeFromFn(N, (t) => {
    const e = t * t * (3 - 2 * t);
    const lin = e * length;
    const curlAmp = Math.sin(t * Math.PI) * curl;
    return {
      x: base.x + dx * lin + px * curlAmp,
      y: base.y + dy * lin + py * curlAmp,
    };
  }, (t) => {
    return baseThick * Math.pow(1 - t, 1.6) + 0.004;
  });
}

// ── Chord — curved line connecting two ring points ──────────────

function makeChord(rng, ring, a1, a2) {
  const N = 70;
  const p1 = ringAt(ring, a1);
  const p2 = ringAt(ring, a2);
  const mx = (p1.x + p2.x) * 0.5 + (rng() - 0.5) * 0.20;
  const my = (p1.y + p2.y) * 0.5 + (rng() - 0.5) * 0.20;
  return strokeFromFn(N, (t) => {
    const u = 1 - t;
    const x = u * u * p1.x + 2 * u * t * mx + t * t * p2.x;
    const y = u * u * p1.y + 2 * u * t * my + t * t * p2.y;
    return { x, y };
  }, (t) => {
    return 0.015 + Math.sin(t * Math.PI) * 0.016;
  });
}

// ── Crescent — thick partial ring covering 60-180° at outer radius ──
// Reads as a "moon" or weighted brace beside the main ring.
function makeCrescent(rng, centerAngle, span) {
  const N = 100;
  const r = RING_R0 * (0.95 + rng() * 0.15);
  const startA = centerAngle - span * 0.5;
  const tilt = (rng() - 0.5) * 0.30;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const peakThick = 0.030 + rng() * 0.025;
  return strokeFromFn(N, (t) => {
    const a = startA + t * span;
    const rr = r + Math.sin(t * Math.PI) * 0.018;
    const x0 = Math.cos(a) * rr;
    const y0 = Math.sin(a) * rr;
    return { x: x0 * ct - y0 * st, y: x0 * st + y0 * ct };
  }, (t) => {
    const taper = Math.sin(t * Math.PI);
    return peakThick * (0.30 + 0.70 * taper);
  });
}

// ── Hook — extension from ring that curls back at its tip ──────
// Reads as a fishhook / claw / question mark — directional, tense.
function makeHook(rng, ring, angle) {
  const N = 80;
  const rp = ringAt(ring, angle);
  const tan = ringTangent(ring, angle);
  const outX = Math.cos(angle), outY = Math.sin(angle);
  const dirX = (outX - tan.y) * 0.5, dirY = (outY + tan.x) * 0.5;
  const dirLen = Math.hypot(dirX, dirY) || 1;
  const dx = dirX / dirLen, dy = dirY / dirLen;
  const px = -dy, py = dx; // perpendicular
  const length = 0.10 + rng() * 0.10;
  const hookSize = 0.04 + rng() * 0.04;
  const hookSign = rng() < 0.5 ? 1 : -1;
  return strokeFromFn(N, (t) => {
    if (t < 0.65) {
      // straight extension
      const u = t / 0.65;
      return {
        x: rp.x + dx * u * length,
        y: rp.y + dy * u * length,
      };
    } else {
      // curl back ~180° in a tight half-circle
      const u = (t - 0.65) / 0.35;
      const cx = rp.x + dx * length;
      const cy = rp.y + dy * length;
      const baseA = Math.atan2(dy, dx) + Math.PI; // back toward base
      const curlA = baseA - hookSign * (Math.PI * (1 - u));
      return {
        x: cx + Math.cos(curlA) * hookSize + dx * hookSize * 0.5,
        y: cy + Math.sin(curlA) * hookSize + dy * hookSize * 0.5,
      };
    }
  }, (t) => {
    return 0.020 * Math.pow(1 - t, 1.4) + 0.005;
  });
}

// ── Accent — small comma/teardrop mark ──────────────────────────
function makeAccent(rng, x, y, size, angle) {
  const N = 30;
  const tilt = angle != null ? angle : rng() * Math.PI * 2;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  return strokeFromFn(N, (t) => {
    const a = -Math.PI * 0.4 + t * Math.PI * 1.5;
    const r = size * 0.5 * (1 - t * 0.7);
    const lx = Math.cos(a) * r;
    const ly = Math.sin(a) * r;
    return {
      x: x + lx * ct - ly * st,
      y: y + lx * st + ly * ct,
    };
  }, (t) => size * 0.45 * Math.pow(1 - t, 1.3) + 0.003);
}

// ── Halo — thin ring outside main ring ──────────────────────────
function makeHalo(rng) {
  const N = 240;
  const r0 = RING_R0 * (1.18 + rng() * 0.20);
  const aspect = 0.92 + rng() * 0.16;
  const tilt = (rng() - 0.5) * 0.30;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const wobble = rng() * 6.283;
  return strokeFromFn(N, (t) => {
    const a = -Math.PI * 0.5 + t * Math.PI * 2.0;
    const r = r0 + Math.sin(a * 2 + wobble) * 0.010;
    const x0 = Math.cos(a) * r * aspect;
    const y0 = Math.sin(a) * r;
    return { x: x0 * ct - y0 * st, y: x0 * st + y0 * ct };
  }, () => 0.008 + rng() * 0.004);
}

// ── Tick — a single short stroke (used in clusters for rhythm) ──
function makeTick(rng, x, y, angle, length) {
  const N = 20;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  return strokeFromFn(N, (t) => {
    const u = t - 0.5;
    return { x: x + ca * u * length, y: y + sa * u * length };
  }, (t) => 0.014 * (1 - Math.abs(t - 0.5) * 1.5) + 0.003);
}

// ── Polygon — regular n-sided shape (triangle, pentagon, hex, oct) ──
function makePolygon(rng, sides, cx, cy, radius, rotation = 0) {
  const N = sides * 30;
  const thick = 0.026 + rng() * 0.014;
  return strokeFromFn(N, (t) => {
    const sideIdx = Math.min(Math.floor(t * sides), sides - 1);
    const sideT = (t * sides) - sideIdx;
    const a0 = (sideIdx / sides) * Math.PI * 2 + rotation;
    const a1 = ((sideIdx + 1) / sides) * Math.PI * 2 + rotation;
    const x0 = cx + Math.cos(a0) * radius;
    const y0 = cy + Math.sin(a0) * radius;
    const x1 = cx + Math.cos(a1) * radius;
    const y1 = cy + Math.sin(a1) * radius;
    return { x: x0 + (x1 - x0) * sideT, y: y0 + (y1 - y0) * sideT };
  }, () => thick);
}

// ── Rectangle — four-sided with custom width/height + rotation ──
function makeRectangle(rng, cx, cy, w, h, rotation = 0) {
  const N = 120;
  const thick = 0.024 + rng() * 0.012;
  const ct = Math.cos(rotation), st = Math.sin(rotation);
  const corners = [
    { x: -w * 0.5, y: -h * 0.5 },
    { x:  w * 0.5, y: -h * 0.5 },
    { x:  w * 0.5, y:  h * 0.5 },
    { x: -w * 0.5, y:  h * 0.5 },
  ];
  return strokeFromFn(N, (t) => {
    const sideIdx = Math.min(Math.floor(t * 4), 3);
    const sideT = (t * 4) - sideIdx;
    const a = corners[sideIdx];
    const b = corners[(sideIdx + 1) % 4];
    const lx = a.x + (b.x - a.x) * sideT;
    const ly = a.y + (b.y - a.y) * sideT;
    return { x: cx + lx * ct - ly * st, y: cy + lx * st + ly * ct };
  }, () => thick);
}

// ── Splat — irregular blob (asymmetric disc) ────────────────────
// Like a drip but with varying radii — reads as paint splash.
function makeSplat(rng, x, y, baseR) {
  const N = 80;
  const lobes = 3 + Math.floor(rng() * 3);
  const phase = rng() * 6.283;
  const variance = 0.30 + rng() * 0.30;
  return strokeFromFn(N, (t) => {
    const a = t * Math.PI * 2;
    const r = baseR * (1 - variance + variance * Math.abs(Math.sin(a * lobes + phase)));
    return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
  }, () => 0.012);
}

// ── Inner element picker — sometimes ring, sometimes polygon/rect ─
// Used in archetypes to inject geometric shape variety without
// duplicating the picker logic everywhere.
const POLY_SIDES = [3, 4, 5, 6, 8];
function makeInnerElement(rng) {
  const r = rng();
  if (r < 0.45) {
    return makeInnerRing(rng);
  } else if (r < 0.80) {
    const sides = POLY_SIDES[Math.floor(rng() * POLY_SIDES.length)];
    const radius = 0.22 + rng() * 0.14;
    const rotation = rng() * Math.PI * 2 / sides;
    const cx = (rng() - 0.5) * 0.10;
    const cy = (rng() - 0.5) * 0.10;
    return makePolygon(rng, sides, cx, cy, radius, rotation);
  } else {
    const w = 0.26 + rng() * 0.18;
    const h = 0.18 + rng() * 0.16;
    const cx = (rng() - 0.5) * 0.10;
    const cy = (rng() - 0.5) * 0.10;
    return makeRectangle(rng, cx, cy, w, h, (rng() - 0.5) * 0.6);
  }
}

// ── Archetypes ──────────────────────────────────────────────────
//
// Each archetype is a coherent grammar: a small set of elements chosen to
// harmonize. Random addition produces decoration; archetypes produce
// structure. Every glyph commits to one — the elements inside it speak
// to each other, instead of merely sharing a frame.

// Solid eye — concentric rings + pupil + a chord and satellites.
// Reads as a watching, contained symbol with internal anatomy.
function archSolidEye(rng, mainRing, anchors) {
  const els = [];
  els.push(makeInnerElement(rng));
  els.push(makeEyelet(rng, 0, 0));
  // Second smaller inner ring offset slightly — concentric eye anatomy
  if (rng() < 0.60) {
    const second = makeInnerRing(rng);
    // Shrink + offset — turn it into an iris detail
    for (const p of second.points) { p.x *= 0.55; p.y *= 0.55; }
    for (let i = 0; i < second.thickness.length; i++) second.thickness[i] *= 0.7;
    els.push(second);
  }
  // Always a chord through it for the horizon-line feel
  const a0 = anchors[0];
  const a1 = anchors[Math.floor(anchors.length / 2)];
  els.push(makeChord(rng, mainRing, a0, a1));
  els.push(makeSatellite(rng, mainRing, anchors[1 % anchors.length]));
  return els;
}

// Cradled — interior arch + nested inner ring + hook + chord. Vessel.
function archCradled(rng, mainRing, anchors) {
  const els = [];
  const a1 = anchors[0];
  const a2 = anchors[2 % anchors.length];
  els.push(makeArch(rng, mainRing, a1, a2));
  els.push(makeInnerElement(rng));
  els.push(makeEyelet(rng, 0, 0));
  els.push(makeHook(rng, mainRing, anchors[1 % anchors.length]));
  // Echoing arc on the far side for symmetry
  if (rng() < 0.60) {
    const farA = (a1 + a2) / 2 + Math.PI;
    els.push(makeNestedArc(rng, mainRing, farA, Math.PI * 0.7));
  }
  return els;
}

// Spoke array — radial lines + hub + inner ring + outer tip dots.
function archSpokeArray(rng, mainRing) {
  const els = [];
  const count = 4 + Math.floor(rng() * 3); // 4..6
  const offset = rng() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2;
    els.push(makeSpoke(rng, mainRing, a, 0.03 + rng() * 0.04));
  }
  els.push(makeInnerElement(rng));
  els.push(makeEyelet(rng, 0, 0));
  // Small dots midway along each spoke for rhythm
  if (rng() < 0.70) {
    const midR = 0.30 + rng() * 0.10;
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * Math.PI * 2;
      els.push({ type: 'disc', center: { x: Math.cos(a) * midR, y: Math.sin(a) * midR }, radius: 0.012 });
    }
  }
  return els;
}

// Messenger — interior anchor + tongue with terminal + a dart and crescent.
// Reads as a sealed message with full address marks.
function archMessenger(rng, mainRing, anchors) {
  const els = [];
  els.push(makeInnerElement(rng));
  els.push(makeEyelet(rng, 0, 0));
  const tongueA = anchors[1 % anchors.length] + (rng() - 0.5) * 0.20;
  const tongue = makeTongue(rng, mainRing, tongueA);
  els.push(tongue);
  // Always punctuate the tongue tip
  const tip = tongue.points[tongue.points.length - 1];
  els.push(makeEyelet(rng, tip.x, tip.y));
  // Side dart for asymmetric address feel
  els.push(makeDart(rng, mainRing, anchors[3 % anchors.length], false));
  if (rng() < 0.55) {
    els.push(makeCrescent(rng, anchors[2 % anchors.length], Math.PI * 0.35));
  }
  return els;
}

// Pulse — rhythmic outward darts + center hub + ring of inner accent dots.
function archPulse(rng, mainRing) {
  const els = [];
  const count = 5 + Math.floor(rng() * 3); // 5..7
  const offset = rng() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2;
    els.push(makeDart(rng, mainRing, a, false));
  }
  els.push(makeEyelet(rng, 0, 0));
  // Always include an inner ring of accent dots — fills the interior
  const innerR = 0.25 + rng() * 0.10;
  const dotCount = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < dotCount; i++) {
    const a = offset + (i / dotCount) * Math.PI * 2 + Math.PI / dotCount;
    els.push({ type: 'disc', center: { x: Math.cos(a) * innerR, y: Math.sin(a) * innerR }, radius: 0.011 + rng() * 0.007 });
  }
  return els;
}

// Echo — multiple nested arcs + crescent on opposite side + accent dots.
function archEcho(rng, mainRing, anchors) {
  const els = [];
  const centerA = anchors[0];
  const count = 3 + Math.floor(rng() * 2); // 3..4
  for (let i = 0; i < count; i++) {
    const span = Math.PI * (0.45 + 0.18 * i);
    els.push(makeNestedArc(rng, mainRing, centerA, span));
  }
  els.push(makeCrescent(rng, centerA + Math.PI, Math.PI * 0.5));
  els.push(makeDart(rng, mainRing, centerA + Math.PI, false));
  // Pair of accent dots at the focus
  const focusR = 0.20;
  els.push({ type: 'disc', center: { x: Math.cos(centerA) * focusR, y: Math.sin(centerA) * focusR }, radius: 0.020 });
  return els;
}

// Constellation — sparse dots scattered inside + one connecting arc.
// Reads as a star-map with a path drawn through it.
function archConstellation(rng, mainRing, anchors) {
  const els = [];
  const count = 4 + Math.floor(rng() * 4); // 4..7
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.10 + rng() * 0.40;
    const size = 0.012 + rng() * 0.025;
    els.push({ type: 'disc', center: { x: Math.cos(a) * r, y: Math.sin(a) * r }, radius: size });
  }
  if (rng() < 0.60) {
    els.push(makeNestedArc(rng, mainRing, anchors[0], Math.PI * (0.7 + rng() * 0.5)));
  }
  return els;
}

// Halo — outer thin ring + main + inner ring. Concentric layers.
function archHalo(rng, mainRing) {
  const els = [];
  els.push(makeHalo(rng));
  if (rng() < 0.75) els.push(makeInnerRing(rng));
  if (rng() < 0.55) els.push(makeEyelet(rng, 0, 0));
  if (rng() < 0.40) {
    // Decorative dots between halos
    const ringCount = 4 + Math.floor(rng() * 3);
    const offset = rng() * Math.PI * 2;
    const r = RING_R0 * 1.06;
    for (let i = 0; i < ringCount; i++) {
      const a = offset + (i / ringCount) * Math.PI * 2;
      els.push({ type: 'disc', center: { x: Math.cos(a) * r, y: Math.sin(a) * r }, radius: 0.014 + rng() * 0.01 });
    }
  }
  return els;
}

// Hooks — two or three outward hooks at varied angles + small inner mark.
// Asymmetric, agitated — reads as the message has hands grasping outward.
function archHooks(rng, mainRing, anchors) {
  const els = [];
  const count = 2 + Math.floor(rng() * 2); // 2..3
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let idx = Math.floor(rng() * anchors.length);
    while (used.has(idx)) idx = (idx + 1) % anchors.length;
    used.add(idx);
    els.push(makeHook(rng, mainRing, anchors[idx]));
  }
  if (rng() < 0.65) els.push(makeInnerRing(rng));
  if (rng() < 0.45) {
    const tip = els[0].points[els[0].points.length - 1];
    els.push(makeEyelet(rng, tip.x, tip.y));
  }
  return els;
}

// Geometric — main ring + polygon (triangle/hex/oct/etc) + accents.
// Reads as a schematic / engineering drawing — pure geometric grammar.
function archGeometric(rng, mainRing, anchors) {
  const els = [];
  const sides1 = POLY_SIDES[Math.floor(rng() * POLY_SIDES.length)];
  const r1 = 0.20 + rng() * 0.16;
  const rot1 = rng() * Math.PI * 2 / sides1;
  els.push(makePolygon(rng, sides1, 0, 0, r1, rot1));
  els.push(makeEyelet(rng, 0, 0));
  // Inner concentric polygon (often a different sided shape)
  if (rng() < 0.65) {
    const sides2 = POLY_SIDES[Math.floor(rng() * POLY_SIDES.length)];
    const r2 = r1 * (0.40 + rng() * 0.20);
    els.push(makePolygon(rng, sides2, 0, 0, r2, rot1 + Math.PI / sides2));
  }
  // Off-center rectangle as an "annotation" mark
  if (rng() < 0.55) {
    const a = anchors[1 % anchors.length];
    const dist = 0.30 + rng() * 0.10;
    const w = 0.10 + rng() * 0.08;
    const h = 0.06 + rng() * 0.05;
    els.push(makeRectangle(rng, Math.cos(a) * dist, Math.sin(a) * dist, w, h, rng() * Math.PI));
  }
  // Tick marks at polygon vertices for "measurement" feel
  if (rng() < 0.50) {
    for (let i = 0; i < sides1; i++) {
      const va = (i / sides1) * Math.PI * 2 + rot1;
      const vx = Math.cos(va) * r1;
      const vy = Math.sin(va) * r1;
      els.push({ type: 'disc', center: { x: vx, y: vy }, radius: 0.012 });
    }
  }
  return els;
}

// Splatter — central inner ring + a few asymmetric splats around it.
// Visceral, organic — reads as ink dripped onto the page.
function archSplatter(rng, mainRing, anchors) {
  const els = [];
  if (rng() < 0.60) els.push(makeInnerRing(rng));
  const splatCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < splatCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.18 + rng() * 0.28;
    els.push(makeSplat(rng, Math.cos(a) * r, Math.sin(a) * r, 0.04 + rng() * 0.05));
  }
  if (rng() < 0.50) {
    els.push(makeAccent(rng, 0, 0, 0.10 + rng() * 0.06, rng() * Math.PI * 2));
  }
  return els;
}

// ── Main generator ──────────────────────────────────────────────

const ARCHETYPES = [
  archSolidEye, archCradled, archSpokeArray,
  archMessenger, archPulse, archEcho,
  archConstellation, archHalo, archHooks, archSplatter,
  archGeometric,
];

export function generateLogogram(seed) {
  const rng = makeRng(seed);
  const elements = [];

  // Glyph "mood" — a thickness scale that gives some glyphs a quiet/thin
  // feel and others a bold/loud presence. Matches stroke weight to the
  // emotion of the symbol — written by different hands on different days.
  const moodRoll = rng();
  let thickScale = 1.0;
  if (moodRoll < 0.25)      thickScale = 0.65; // quiet / faint
  else if (moodRoll < 0.70) thickScale = 1.0;  // normal
  else if (moodRoll < 0.92) thickScale = 1.35; // bold
  else                      thickScale = 1.7;  // shouting

  // Hero — main ring. ~25% chance of a broken/open ring for variety.
  const broken = rng() < 0.25;
  const mainRing = makeMainRing(rng, { broken, thickScale });
  elements.push(mainRing);

  // ~20% chance of a thin halo outside the main ring (concentric framing)
  if (!broken && rng() < 0.20) {
    elements.push(makeHalo(rng));
  }

  // Anchor grid — denser than before so archetypes have flexible attachment.
  const numAnchors = 5 + Math.floor(rng() * 2); // 5..6
  const anchorOffset = rng() * Math.PI * 2;
  const anchorStep = Math.PI * 2 / numAnchors;
  const anchors = [];
  for (let i = 0; i < numAnchors; i++) anchors.push(anchorOffset + i * anchorStep);

  // Pick one archetype — the glyph commits to a single grammatical pattern.
  const archetype = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)];
  const supports = archetype(rng, mainRing, anchors);
  for (const el of supports) elements.push(el);

  // ── Dressing pass — every glyph gets 2-4 decorative marks regardless
  // of archetype, so no glyph reads as bare. These are small, scattered,
  // and asymmetric — they add visual rhythm without competing with the
  // primary structure.

  // Edge ticks — short marks along the ring at random anchors
  const tickCount = 1 + Math.floor(rng() * 3); // 1..3
  for (let i = 0; i < tickCount; i++) {
    const a = anchors[(i * 2 + 1) % anchors.length] + (rng() - 0.5) * 0.30;
    const rp = ringAt(mainRing, a);
    const tan = ringTangent(mainRing, a);
    elements.push(makeTick(rng, rp.x + tan.x * 0.04, rp.y + tan.y * 0.04, a, 0.05 + rng() * 0.04));
  }

  // Tiny dots scattered between the main ring and centre — like punctuation
  if (rng() < 0.85) {
    const dotCount = 2 + Math.floor(rng() * 4); // 2..5
    for (let i = 0; i < dotCount; i++) {
      const a = rng() * Math.PI * 2;
      const r = 0.30 + rng() * 0.25;
      elements.push({
        type: 'disc',
        center: { x: Math.cos(a) * r, y: Math.sin(a) * r },
        radius: 0.008 + rng() * 0.012,
      });
    }
  }

  // 50% chance of an outer accent (small splat or tick beyond ring)
  if (rng() < 0.50) {
    const a = anchors[Math.floor(rng() * anchors.length)];
    const r = RING_R0 * (1.10 + rng() * 0.15);
    if (rng() < 0.5) {
      elements.push(makeSplat(rng, Math.cos(a) * r, Math.sin(a) * r, 0.025 + rng() * 0.020));
    } else {
      elements.push(makeAccent(rng, Math.cos(a) * r, Math.sin(a) * r, 0.06 + rng() * 0.04, a + Math.PI * 0.5));
    }
  }

  // Apply mood thickness scale across all stroke elements (the ring
  // already had it baked in; supports inherit here).
  for (const el of elements) {
    if (el.type === 'stroke' && el !== mainRing) {
      for (let i = 0; i < el.thickness.length; i++) {
        el.thickness[i] *= thickScale;
      }
    } else if (el.type === 'disc' && el !== mainRing) {
      el.radius *= Math.pow(thickScale, 0.5); // discs scale less aggressively
    }
  }

  return { seed, elements };
}
