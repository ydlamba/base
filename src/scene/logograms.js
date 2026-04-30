// ────────────────────────────────────────────────────────────────
// Procedural logogram generator — Heptapod-style symbols composed of:
//   - 1 main ring (variable-thickness brush body)
//   - 0..1 inner sub-ring (60% chance)
//   - 1..3 concentric arcs
//   - 0..2 tangent loops
//   - 1..2 tongues (thick-base, fine-tip extensions)
//   - 0..1 chord (35% chance)
//   - 3..5 drips (solid ink pools)
//
// Returns a `{ seed, elements }` object. Each element is either:
//   { type: 'stroke', points: [{x,y}], thickness: [number] }
//   { type: 'disc', center: {x,y}, radius: number }
// ────────────────────────────────────────────────────────────────

import { makeRng } from '../core/util.js';

const RING_R0 = 0.62;

function makeMainRing(rng) {
  const N = 320;
  const points = [];
  const thickness = [];
  const rPhase = rng() * 6.283;
  const tPhase1 = rng() * 6.283;
  const tPhase2 = rng() * 6.283;
  const dryPhase = rng() * 6.283;
  const aspect = 0.92 + rng() * 0.18;
  const tilt = (rng() - 0.5) * 0.4;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = -Math.PI * 0.5 + t * Math.PI * 2.0;
    const r = RING_R0
            + Math.sin(a * 2.0 + rPhase) * 0.045
            + Math.sin(a * 5.0 + rPhase * 1.7) * 0.020
            + Math.sin(a * 9.0 + rPhase * 0.3) * 0.008;
    const x0 = Math.cos(a) * r * aspect;
    const y0 = Math.sin(a) * r;
    points.push({ x: x0 * ct - y0 * st, y: x0 * st + y0 * ct });
    const tk1 = 0.5 * (Math.sin(a * 1.5 + tPhase1) + 1);
    const tk2 = 0.5 * (Math.sin(a * 3.0 + tPhase2) + 1);
    let thick = 0.030 + tk1 * tk1 * 0.080 + tk2 * 0.020;
    const dry = Math.sin(a * 4.0 + dryPhase);
    if (dry > 0.55) thick *= 1 - ((dry - 0.55) / 0.45) * 0.85;
    thickness.push(Math.max(0.005, thick));
  }
  return { type: 'stroke', points, thickness };
}

function makeInnerRing(rng) {
  const N = 200;
  const points = [];
  const thickness = [];
  const cx = (rng() - 0.5) * 0.30;
  const cy = (rng() - 0.5) * 0.30;
  const r0 = 0.16 + rng() * 0.16;
  const aspect = 0.78 + rng() * 0.40;
  const tilt = rng() * Math.PI;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const rPhase = rng() * 6.283;
  const tPhase = rng() * 6.283;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = -Math.PI * 0.5 + t * Math.PI * 2.0;
    const r = r0 + Math.sin(a * 3.0 + rPhase) * 0.018;
    const x0 = Math.cos(a) * r * aspect;
    const y0 = Math.sin(a) * r;
    points.push({ x: x0 * ct - y0 * st + cx, y: x0 * st + y0 * ct + cy });
    const tk = 0.5 * (Math.sin(a * 2.0 + tPhase) + 1);
    thickness.push(0.018 + tk * 0.030);
  }
  return { type: 'stroke', points, thickness };
}

// Concentric arc — partial arc at a different radius, sharing the center
function makeConcentricArc(rng) {
  const N = 160;
  const points = [];
  const thickness = [];
  const r = 0.42 + rng() * 0.32;
  const startA = rng() * Math.PI * 2;
  const arcLen = Math.PI * (0.5 + rng() * 1.2);
  const tilt   = (rng() - 0.5) * 0.30;
  const tk     = 0.022 + rng() * 0.030;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = startA + t * arcLen;
    const rr = r + Math.sin(t * Math.PI * 3) * 0.005;
    const x0 = Math.cos(a) * rr;
    const y0 = Math.sin(a) * rr;
    points.push({ x: x0 * ct - y0 * st, y: x0 * st + y0 * ct });
    const taper = Math.sin(t * Math.PI);
    thickness.push(tk * (0.30 + 0.70 * taper));
  }
  return { type: 'stroke', points, thickness };
}

// Tangent loop — small closed loop touching the main ring
function makeTangentLoop(rng) {
  const N = 130;
  const points = [];
  const thickness = [];
  const angle = rng() * Math.PI * 2;
  const ringX = Math.cos(angle) * RING_R0;
  const ringY = Math.sin(angle) * RING_R0;
  const outward = rng() < 0.6;
  const sign = outward ? 1 : -1;
  const loopR = 0.07 + rng() * 0.060;
  const cx = ringX + Math.cos(angle) * loopR * sign;
  const cy = ringY + Math.sin(angle) * loopR * sign;
  const aspect = 0.85 + rng() * 0.30;
  const lTilt = rng() * Math.PI;
  const ct = Math.cos(lTilt), st = Math.sin(lTilt);
  const tk = 0.024 + rng() * 0.018;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = t * Math.PI * 2;
    const lx = Math.cos(a) * loopR * aspect;
    const ly = Math.sin(a) * loopR;
    points.push({ x: lx * ct - ly * st + cx, y: lx * st + ly * ct + cy });
    thickness.push(tk * (0.85 + Math.sin(a * 2) * 0.15));
  }
  return { type: 'stroke', points, thickness };
}

function makeTongue(rng) {
  const N = 80;
  const points = [];
  const thickness = [];
  const anchorPhase = rng();
  const a0 = -Math.PI * 0.5 + anchorPhase * Math.PI * 2;
  const baseX = Math.cos(a0) * RING_R0;
  const baseY = Math.sin(a0) * RING_R0;
  const outX = Math.cos(a0), outY = Math.sin(a0);
  const tanX = -Math.sin(a0), tanY = Math.cos(a0);
  const direction = rng() < 0.5 ? 1 : -1;
  const length = 0.22 + rng() * 0.20;
  const curl = (rng() - 0.5) * 0.55;
  const baseThick = 0.060 + rng() * 0.030;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const e = t * t * (3 - 2 * t);
    const lin = e * length * direction;
    const curlAmp = Math.sin(t * Math.PI) * curl;
    points.push({
      x: baseX + outX * lin + tanX * curlAmp,
      y: baseY + outY * lin + tanY * curlAmp,
    });
    thickness.push(baseThick * Math.pow(1 - t, 1.6) + 0.004);
  }
  return { type: 'stroke', points, thickness };
}

function makeDrip(rng) {
  let cx, cy;
  const positionType = Math.floor(rng() * 3);
  if (positionType === 0) {
    const a = rng() * Math.PI * 2;
    const r = RING_R0 + (rng() - 0.5) * 0.06;
    cx = Math.cos(a) * r; cy = Math.sin(a) * r;
  } else if (positionType === 1) {
    const a = rng() * Math.PI * 2;
    const r = 0.10 + rng() * 0.36;
    cx = Math.cos(a) * r; cy = Math.sin(a) * r;
  } else {
    const a = rng() * Math.PI * 2;
    const r = RING_R0 + 0.04 + rng() * 0.18;
    cx = Math.cos(a) * r; cy = Math.sin(a) * r;
  }
  return { type: 'disc', center: { x: cx, y: cy }, radius: 0.024 + rng() * 0.045 };
}

function makeChord(rng) {
  const N = 60;
  const points = [];
  const thickness = [];
  const a1 = rng() * Math.PI * 2;
  const a2 = a1 + Math.PI + (rng() - 0.5) * Math.PI * 0.5;
  const r1 = RING_R0 - 0.05 + rng() * 0.10;
  const r2 = RING_R0 - 0.05 + rng() * 0.10;
  const x1 = Math.cos(a1) * r1, y1 = Math.sin(a1) * r1;
  const x2 = Math.cos(a2) * r2, y2 = Math.sin(a2) * r2;
  const mx = (x1 + x2) / 2 + (rng() - 0.5) * 0.25;
  const my = (y1 + y2) / 2 + (rng() - 0.5) * 0.25;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u * u * x1 + 2 * u * t * mx + t * t * x2;
    const y = u * u * y1 + 2 * u * t * my + t * t * y2;
    points.push({ x, y });
    thickness.push(0.020 + Math.sin(t * Math.PI) * 0.022);
  }
  return { type: 'stroke', points, thickness };
}

export function generateLogogram(seed) {
  const rng = makeRng(seed);
  const elements = [];
  elements.push(makeMainRing(rng));
  if (rng() < 0.65) elements.push(makeInnerRing(rng));
  const numArcs = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < numArcs; i++) elements.push(makeConcentricArc(rng));
  const numLoops = Math.floor(rng() * 3);
  for (let i = 0; i < numLoops; i++) elements.push(makeTangentLoop(rng));
  const numTongues = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < numTongues; i++) elements.push(makeTongue(rng));
  if (rng() < 0.35) elements.push(makeChord(rng));
  const numDrips = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < numDrips; i++) elements.push(makeDrip(rng));
  return { seed, elements };
}
