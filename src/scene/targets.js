// ────────────────────────────────────────────────────────────────
// Particle target precomputation.
// Given a logogram (composite of stroke/disc elements) and a particle count,
// produce one target per particle. Each target carries:
//   - x, y, z         — world position
//   - globalT         — drawing-head time (0..1) at which this particle "locks in"
// Allocation is area-weighted so thick brush sections get more particles than
// thin ornaments. Drips have a higher minimum allocation for solid ink-pool feel.
// ────────────────────────────────────────────────────────────────

import { clamp, sharpJitter } from '../core/util.js';

function sampleStroke(stroke, t) {
  const idx = t * (stroke.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, stroke.length - 1);
  const f  = idx - i0;
  return {
    x: stroke[i0].x + (stroke[i1].x - stroke[i0].x) * f,
    y: stroke[i0].y + (stroke[i1].y - stroke[i0].y) * f,
  };
}
function tangentStroke(stroke, t) {
  const idx = clamp(Math.floor(t * (stroke.length - 1)), 0, stroke.length - 2);
  const dx = stroke[idx + 1].x - stroke[idx].x;
  const dy = stroke[idx + 1].y - stroke[idx].y;
  const L  = Math.hypot(dx, dy) || 1;
  return { x: dx / L, y: dy / L };
}
function sampleThickness(thicknessArr, t) {
  const idx = t * (thicknessArr.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, thicknessArr.length - 1);
  const f  = idx - i0;
  return thicknessArr[i0] + (thicknessArr[i1] - thicknessArr[i0]) * f;
}
function strokeArea(el) {
  let A = 0;
  for (let i = 1; i < el.points.length; i++) {
    const dx = el.points[i].x - el.points[i-1].x;
    const dy = el.points[i].y - el.points[i-1].y;
    const segLen = Math.hypot(dx, dy);
    const avg = (el.thickness[i-1] + el.thickness[i]) * 0.5;
    A += segLen * avg;
  }
  return A;
}
function elementArea(el) {
  if (el.type === 'stroke') return strokeArea(el);
  if (el.type === 'disc')   return Math.PI * el.radius * el.radius;
  return 0;
}

export function buildTargets(character, total) {
  const els  = character.elements;
  const A    = els.map(elementArea);
  const sumA = A.reduce((a, b) => a + b, 0);
  // Drips need solid ink pool density → higher minimum allocation.
  const perEl = A.map((a, i) => {
    const minPer = els[i].type === 'disc' ? 200 : 100;
    return Math.max(minPer, Math.floor(total * a / sumA));
  });
  let sum = perEl.reduce((a, b) => a + b, 0);
  while (sum > total) {
    let bestIdx = -1, bestLeft = 0;
    for (let i = 0; i < perEl.length; i++) {
      const mp = els[i].type === 'disc' ? 200 : 100;
      const left = perEl[i] - mp;
      if (left > bestLeft) { bestLeft = left; bestIdx = i; }
    }
    if (bestIdx === -1) break;
    perEl[bestIdx]--; sum--;
  }
  if (sum < total) perEl[0] += (total - sum);

  // 2.5% pause between elements so the drawing head dwells at element boundaries.
  const pause = 0.025;
  const drawTotal = Math.max(0.01, 1 - pause * (els.length - 1));
  const fracs = A.map(a => (a / sumA) * drawTotal);
  const startT = [];
  let acc = 0;
  for (let i = 0; i < els.length; i++) {
    startT.push(acc);
    acc += fracs[i] + (i < els.length - 1 ? pause : 0);
  }

  const targets = new Array(total);
  let pi = 0;

  for (let e = 0; e < els.length; e++) {
    const el = els[e];
    const n  = perEl[e];
    const sT = startT[e];
    const fT = fracs[e];

    if (el.type === 'stroke') {
      for (let k = 0; k < n; k++) {
        const tStroke = (n === 1) ? 0 : k / (n - 1);
        const point = sampleStroke(el.points, tStroke);
        const tan   = tangentStroke(el.points, tStroke);
        const nx = -tan.y, ny = tan.x;
        const thick = sampleThickness(el.thickness, tStroke);
        // SHARP centerline: sign-preserved square jitter, tight scaling.
        const j = sharpJitter() * thick * 0.42;
        const z = (Math.random() - 0.5) * 0.05;
        const globalT = sT + tStroke * fT;
        targets[pi++] = { x: point.x + nx * j, y: point.y + ny * j, z, globalT };
      }
    } else if (el.type === 'disc') {
      // Sample uniformly in the disc, then sort by distance from center so the
      // drip blooms outward during the GATHER reveal.
      const samples = [];
      for (let k = 0; k < n; k++) {
        const u1 = Math.random();
        const u2 = Math.random();
        const r = Math.pow(u1, 0.45) * el.radius;   // bias slightly toward center
        const a = u2 * Math.PI * 2;
        samples.push({
          x: el.center.x + Math.cos(a) * r,
          y: el.center.y + Math.sin(a) * r,
          dist: r,
        });
      }
      samples.sort((a, b) => a.dist - b.dist);
      for (let k = 0; k < n; k++) {
        const s = samples[k];
        const tDisc = (n === 1) ? 0 : k / (n - 1);
        const z = (Math.random() - 0.5) * 0.04;
        const globalT = sT + tDisc * fT;
        targets[pi++] = { x: s.x, y: s.y, z, globalT };
      }
    }
  }

  // Shuffle so adjacent particle indices don't share regions (avoids visible
  // bands during gather, since particles are processed in index order).
  for (let i = total - 1; i > 0; i--) {
    const r = Math.floor(Math.random() * (i + 1));
    const t = targets[i]; targets[i] = targets[r]; targets[r] = t;
  }
  return targets;
}
