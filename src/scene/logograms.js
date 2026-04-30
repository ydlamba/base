// ────────────────────────────────────────────────────────────────
// Procedural logogram generator — structured glyph system.
//
// Design philosophy: these are *communication symbols*, not abstract art.
// Every element has a reason to be where it is. The main ring is a frame;
// interior elements attach to it or echo its geometry. Anchor angles create
// rhythm; terminals (dots, hooks) mark stroke endings. Negative space is
// as intentional as positive space.
//
// Structural rule: interior elements are MUTUALLY EXCLUSIVE per glyph.
// A symbol picks ONE interior strategy (inner ring, arches, spokes, or
// cross-strokes) and commits to it. This prevents the "white soup" effect
// where everything crowds the center.
//
// Returns a `{ seed, elements }` object. Each element is either:
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

function makeMainRing(rng) {
  const N = 360;
  const variant = Math.floor(rng() * 4);
  const rPhase = rng() * 6.283;
  const tPhase1 = rng() * 6.283;
  const tPhase2 = rng() * 6.283;
  const dryPhase = rng() * 6.283;
  const aspect = 0.88 + rng() * 0.20;
  const tilt = (rng() - 0.5) * 0.45;
  const ct = Math.cos(tilt), st = Math.sin(tilt);

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
    let thick = 0.028 + tk1 * tk1 * 0.075 + tk2 * 0.018;
    const dry = Math.sin(a * 4.0 + dryPhase);
    if (dry > 0.55) thick *= 1 - ((dry - 0.55) / 0.45) * 0.82;
    return Math.max(0.005, thick);
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

// ── Cross-stroke — straight or gently curved interior line ──────

function makeCrossStroke(rng, angle) {
  const N = 90;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const len = 0.18 + rng() * 0.18; // capped short — stays interior
  const cx = ca * len * 0.5;
  const cy = sa * len * 0.5;
  const curve = (rng() - 0.5) * 0.10;
  const tk = 0.012 + rng() * 0.014;
  return strokeFromFn(N, (t) => {
    const u = (t - 0.5) * 2; // -1..1
    const x = cx + ca * u * len * 0.5 + sa * curve * (1 - u*u);
    const y = cy + sa * u * len * 0.5 - ca * curve * (1 - u*u);
    return { x, y };
  }, (t) => {
    const taper = 1 - Math.abs(t - 0.5) * 1.6;
    return tk * Math.max(0.2, taper) + 0.003;
  });
}

// ── Inner ring — small closed loop inside ───────────────────────

function makeInnerRing(rng) {
  const N = 180;
  const cx = (rng() - 0.5) * 0.18;
  const cy = (rng() - 0.5) * 0.18;
  const r0 = 0.14 + rng() * 0.12;
  const aspect = 0.80 + rng() * 0.35;
  const tilt = rng() * Math.PI;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const rPhase = rng() * 6.283;
  const tPhase = rng() * 6.283;
  return strokeFromFn(N, (t) => {
    const a = -Math.PI * 0.5 + t * Math.PI * 2.0;
    const r = r0 + Math.sin(a * 3.0 + rPhase) * 0.012;
    const x0 = Math.cos(a) * r * aspect;
    const y0 = Math.sin(a) * r;
    return { x: x0 * ct - y0 * st + cx, y: x0 * st + y0 * ct + cy };
  }, (t) => {
    const a = -Math.PI * 0.5 + t * Math.PI * 2.0;
    const tk = 0.5 * (Math.sin(a * 2.0 + tPhase) + 1);
    return 0.014 + tk * 0.024;
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

// ── Archetypes ──────────────────────────────────────────────────
//
// Each archetype is a coherent grammar: a small set of elements chosen to
// harmonize. Random addition produces decoration; archetypes produce
// structure. Every glyph commits to one — the elements inside it speak
// to each other, instead of merely sharing a frame.

// Solid eye — inner ring sits at center, often with a pupil dot.
// Optional chord acts like a horizon line cutting the eye.
function archSolidEye(rng, mainRing, anchors) {
  const els = [];
  els.push(makeInnerRing(rng));
  if (rng() < 0.55) els.push(makeEyelet(rng, 0, 0));
  if (rng() < 0.25) {
    const a0 = anchors[0];
    const a1 = anchors[Math.floor(anchors.length / 2)];
    els.push(makeChord(rng, mainRing, a0, a1));
  }
  return els;
}

// Cradled — an interior arch holds a small mark. Reads as a vessel.
function archCradled(rng, mainRing, anchors) {
  const els = [];
  const a1 = anchors[0];
  const a2 = anchors[2 % anchors.length]; // skip one — wider span
  els.push(makeArch(rng, mainRing, a1, a2));
  if (rng() < 0.60) els.push(makeInnerRing(rng));
  if (rng() < 0.30) els.push(makeEyelet(rng, 0, 0));
  return els;
}

// Spoke array — 2..4 evenly-spaced radial lines meeting at a hub.
// Reads as compass / axis / measurement.
function archSpokeArray(rng, mainRing /* anchors unused — even spacing */) {
  const els = [];
  const count = 2 + Math.floor(rng() * 3); // 2..4
  const offset = rng() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2;
    els.push(makeSpoke(rng, mainRing, a, 0.03 + rng() * 0.04));
  }
  els.push(makeEyelet(rng, 0, 0));
  return els;
}

// Messenger — interior anchor + outward tongue ending in a terminal.
// Reads as a sealed message with an address.
function archMessenger(rng, mainRing, anchors) {
  const els = [];
  if (rng() < 0.55) {
    els.push(makeInnerRing(rng));
  } else {
    const cx = (rng() - 0.5) * 0.18;
    const cy = (rng() - 0.5) * 0.18;
    els.push(makeEyelet(rng, cx, cy));
  }
  const tongueA = anchors[1 % anchors.length] + (rng() - 0.5) * 0.20;
  const tongue = makeTongue(rng, mainRing, tongueA);
  els.push(tongue);
  if (rng() < 0.65) {
    const tip = tongue.points[tongue.points.length - 1];
    els.push(makeEyelet(rng, tip.x, tip.y));
  }
  return els;
}

// Pulse — rhythmic outward darts evenly spaced. Beacon / emission.
function archPulse(rng, mainRing /* anchors unused — even spacing */) {
  const els = [];
  const count = 3 + Math.floor(rng() * 2); // 3..4
  const offset = rng() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2;
    els.push(makeDart(rng, mainRing, a, false)); // outward
  }
  if (rng() < 0.55) els.push(makeEyelet(rng, 0, 0));
  return els;
}

// Echo — multiple nested arcs same side, ripple outward. Direction.
// Small opposite-side dart breaks symmetry, suggests motion.
function archEcho(rng, mainRing, anchors) {
  const els = [];
  const centerA = anchors[0];
  const count = 2 + Math.floor(rng() * 2); // 2..3
  for (let i = 0; i < count; i++) {
    const span = Math.PI * (0.45 + 0.18 * i);
    els.push(makeNestedArc(rng, mainRing, centerA, span));
  }
  if (rng() < 0.45) els.push(makeDart(rng, mainRing, centerA + Math.PI, false));
  return els;
}

// ── Main generator ──────────────────────────────────────────────

const ARCHETYPES = [
  archSolidEye, archCradled, archSpokeArray,
  archMessenger, archPulse, archEcho,
];

export function generateLogogram(seed) {
  const rng = makeRng(seed);
  const elements = [];

  // Hero — main ring. Always present, always the loudest.
  const mainRing = makeMainRing(rng);
  elements.push(mainRing);

  // Anchor grid — denser than before so archetypes have flexible attachment.
  const numAnchors = 4 + Math.floor(rng() * 2); // 4..5
  const anchorOffset = rng() * Math.PI * 2;
  const anchorStep = Math.PI * 2 / numAnchors;
  const anchors = [];
  for (let i = 0; i < numAnchors; i++) anchors.push(anchorOffset + i * anchorStep);

  // Pick one archetype — the glyph commits to a single grammatical pattern.
  const archetype = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)];
  const supports = archetype(rng, mainRing, anchors);
  for (const el of supports) elements.push(el);

  return { seed, elements };
}
