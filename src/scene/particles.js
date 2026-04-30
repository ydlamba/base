// ────────────────────────────────────────────────────────────────
// Particle systems — main symbol particles, cursor cluster, dust layer.
//
// Three layers in one shared `particleData` buffer (uploaded as a single VBO):
//   - Main (N_MAIN):    advect on curl noise, converge to logogram targets,
//                        attracted to cursor during DRIFT only.
//   - Cursor (N_CURSOR): tight ink dot orbiting the mouse, always visible.
//   - Dust (N_DUST):     atmospheric micro-particles in a wider volume.
//
// Vertex layout (STRIDE = 7 floats / 28 bytes per particle):
//   x, y, z, alpha, r, g, b
//
// Phase machine + convergence math also live here since the particle
// behaviour is gated entirely by the current phase.
// ────────────────────────────────────────────────────────────────

import {
  lerp, clamp01, smooth, easeOut, flowField,
} from '../core/util.js';
import { generateLogogram } from './logograms.js';
import { buildTargets } from './targets.js';

// ── Particle counts + buffer layout ─────────────────────────────
export const N_MAIN   = 14000;
export const N_CURSOR = 28;
export const N_DUST   = 320;
export const N_TOTAL  = N_MAIN + N_CURSOR + N_DUST;
export const STRIDE   = 7;
export const particleData = new Float32Array(N_TOTAL * STRIDE);

// ── Per-particle colors (set once at init) ──────────────────────
// Cathode archive theme: phosphor cyan-white symbols, sodium-orange cursor.
const MAIN_R = 0.659, MAIN_G = 0.863, MAIN_B = 1.000;     // #A8DCFF
const CURS_R = 1.000, CURS_G = 0.482, CURS_B = 0.110;     // #FF7B1C
const DUST_R = MAIN_R * 0.78, DUST_G = MAIN_G * 0.84, DUST_B = MAIN_B * 0.94;

// ── Phase machine ───────────────────────────────────────────────
export const PHASES = {
  INITIAL_DRIFT: 9.0,
  GATHER:       12.0,
  HOLD:          5.5,
  DISSOLVE:      6.0,
  DRIFT:        16.0,
};
export function phaseAt(t) {
  if (t < PHASES.INITIAL_DRIFT) {
    return { name: 'DRIFT', progress: t / PHASES.INITIAL_DRIFT, cycle: -1 };
  }
  let cs = PHASES.INITIAL_DRIFT, ci = 0;
  const cycleLen = PHASES.GATHER + PHASES.HOLD + PHASES.DISSOLVE + PHASES.DRIFT;
  while (true) {
    const ce = cs + cycleLen;
    if (t < ce) {
      const u = t - cs;
      if (u < PHASES.GATHER)
        return { name: 'GATHER',   progress: u / PHASES.GATHER, cycle: ci };
      if (u < PHASES.GATHER + PHASES.HOLD)
        return { name: 'HOLD',     progress: (u - PHASES.GATHER) / PHASES.HOLD, cycle: ci };
      if (u < PHASES.GATHER + PHASES.HOLD + PHASES.DISSOLVE)
        return { name: 'DISSOLVE', progress: (u - PHASES.GATHER - PHASES.HOLD) / PHASES.DISSOLVE, cycle: ci };
      return { name: 'DRIFT', progress: (u - PHASES.GATHER - PHASES.HOLD - PHASES.DISSOLVE) / PHASES.DRIFT, cycle: ci };
    }
    cs = ce; ci++;
  }
}

// Per-particle convergence: globalT=g particle starts at phase = g*(1-CONV_DUR),
// finishes at g*(1-CONV_DUR)+CONV_DUR. Last particle (g=1) completes EXACTLY
// at phase=1.0 → no snap into HOLD.
const CONV_DUR = 0.20;
function convergenceFor(phaseProgress, globalT) {
  const startT = globalT * (1 - CONV_DUR);
  return clamp01((phaseProgress - startT) / CONV_DUR);
}

// Force exerted on main particles by the cursor — only active during DRIFT.
function attractionWeight(phase) {
  if (phase.name === 'DRIFT')    return 1;
  if (phase.name === 'GATHER')   return 1 - clamp01(phase.progress / 0.25);
  if (phase.name === 'DISSOLVE') return clamp01((phase.progress - 0.75) / 0.25);
  return 0;
}

// Cluster visibility — stays > 0 even during HOLD so the cursor never
// disappears on the user. Decoupled from `attractionWeight` so the symbol
// still commands attention from main particles during its phases.
function cursorVisibility(phase) {
  if (phase.name === 'DRIFT')    return 1.00;
  if (phase.name === 'GATHER')   return 1.00 - clamp01(phase.progress / 0.30) * 0.55;
  if (phase.name === 'HOLD')     return 0.45;
  if (phase.name === 'DISSOLVE') return 0.45 + clamp01((phase.progress - 0.70) / 0.30) * 0.55;
  return 1.00;
}

// ── Main particle state ─────────────────────────────────────────
const px = new Float32Array(N_MAIN);
const py = new Float32Array(N_MAIN);
const pz = new Float32Array(N_MAIN);
const startX = new Float32Array(N_MAIN);  // memorised position when convergence began
const startY = new Float32Array(N_MAIN);
const startZ = new Float32Array(N_MAIN);
const startTaken = new Uint8Array(N_MAIN);
const plife    = new Float32Array(N_MAIN);
const pmaxlife = new Float32Array(N_MAIN);

function respawn(i) {
  let x, y, z;
  do {
    x = Math.random() * 3.2 - 1.6;
    y = Math.random() * 3.2 - 1.6;
    z = Math.random() * 3.2 - 1.6;
  } while (x * x + y * y + z * z > 2.56);
  px[i] = x; py[i] = y; pz[i] = z;
  pmaxlife[i] = 4 + Math.random() * 4;
  plife[i] = pmaxlife[i];
}
export function initParticles() {
  for (let i = 0; i < N_MAIN; i++) {
    respawn(i);
    plife[i] = Math.random() * pmaxlife[i];
    const off = i * STRIDE;
    particleData[off + 4] = MAIN_R;
    particleData[off + 5] = MAIN_G;
    particleData[off + 6] = MAIN_B;
  }
}

// ── Cursor cluster state ────────────────────────────────────────
const cpx = new Float32Array(N_CURSOR);
const cpy = new Float32Array(N_CURSOR);
const cpz = new Float32Array(N_CURSOR);
const cox = new Float32Array(N_CURSOR);
const coy = new Float32Array(N_CURSOR);
const coz = new Float32Array(N_CURSOR);
const cph = new Float32Array(N_CURSOR);
export function initCursor(initialMouseX = 0, initialMouseY = 0) {
  for (let i = 0; i < N_CURSOR; i++) {
    const u = Math.pow(Math.random(), 0.55);
    const r = u * 0.018;
    const a = Math.random() * Math.PI * 2;
    cox[i] = Math.cos(a) * r;
    coy[i] = Math.sin(a) * r;
    coz[i] = (Math.random() - 0.5) * 0.012;
    cph[i] = Math.random() * Math.PI * 2;
    cpx[i] = initialMouseX + cox[i];
    cpy[i] = initialMouseY + coy[i];
    cpz[i] = coz[i];
    const off = (N_MAIN + i) * STRIDE;
    particleData[off + 4] = CURS_R;
    particleData[off + 5] = CURS_G;
    particleData[off + 6] = CURS_B;
  }
}

// ── Dust layer state ────────────────────────────────────────────
const dpx = new Float32Array(N_DUST);
const dpy = new Float32Array(N_DUST);
const dpz = new Float32Array(N_DUST);
const dphz = new Float32Array(N_DUST);
export function initDust() {
  for (let i = 0; i < N_DUST; i++) {
    dpx[i] = (Math.random() - 0.5) * 5.4;
    dpy[i] = (Math.random() - 0.5) * 4.0;
    dpz[i] = (Math.random() - 0.5) * 4.5;
    dphz[i] = Math.random() * Math.PI * 2;
    const off = (N_MAIN + N_CURSOR + i) * STRIDE;
    particleData[off + 4] = DUST_R;
    particleData[off + 5] = DUST_G;
    particleData[off + 6] = DUST_B;
  }
}

// ── Logogram state — regenerated each cycle ─────────────────────
let currentTargets  = null;
let currentBellFreq = 392;
const PENTATONIC = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];

export function regenerateLogogram() {
  const seed = (Math.random() * 1e9) | 0;
  const lg = generateLogogram(seed);
  currentTargets  = buildTargets(lg, N_MAIN);
  currentBellFreq = PENTATONIC[(Math.random() * PENTATONIC.length) | 0];
}
export function getBellFreq() { return currentBellFreq; }

// ────────────────────────────────────────────────────────────────
// Updates — called once per frame. Mutate particleData in-place.
// `mouse` = { worldX, worldY } for attraction force.
// ────────────────────────────────────────────────────────────────

export function updateMain(t, dt, phase, loadFade, mouse) {
  const dts = Math.min(dt, 1 / 30);
  const aw  = attractionWeight(phase);
  const mx = mouse.worldX, my = mouse.worldY;

  if (phase.name === 'DRIFT') {
    for (let i = 0; i < N_MAIN; i++) {
      const f = flowField(px[i], py[i], pz[i], t);
      let vx = f.vx, vy = f.vy, vz = f.vz;
      if (aw > 0.001) {
        const dx = mx - px[i];
        const dy = my - py[i];
        const dz = -pz[i];
        const r  = Math.hypot(dx, dy, dz) + 0.001;
        const force = aw * 0.45 * Math.max(0, 1 - r * 0.32);
        vx += (dx / r) * force;
        vy += (dy / r) * force;
        vz += (dz / r) * force * 0.6;
      }
      px[i] += vx * dts;
      py[i] += vy * dts;
      pz[i] += vz * dts;
      plife[i] -= dts;
      const r2 = px[i]*px[i] + py[i]*py[i] + pz[i]*pz[i];
      if (plife[i] <= 0 || r2 > 9.0) respawn(i);
      const lr = plife[i] / pmaxlife[i];
      let a;
      if (lr > 0.85)      a = (1 - lr) / 0.15;
      else if (lr < 0.15) a = lr / 0.15;
      else                a = 1.0;
      a *= 0.40 * loadFade;
      const off = i * STRIDE;
      particleData[off]     = px[i];
      particleData[off + 1] = py[i];
      particleData[off + 2] = pz[i];
      particleData[off + 3] = a;
    }
    return;
  }

  const targets = currentTargets;
  if (!targets) return;

  if (phase.name === 'GATHER') {
    const head = phase.progress;
    for (let i = 0; i < N_MAIN; i++) {
      const tg = targets[i];
      const c  = convergenceFor(head, tg.globalT);

      if (c <= 0.001) {
        const f = flowField(px[i], py[i], pz[i], t);
        let vx = f.vx * 0.55, vy = f.vy * 0.55, vz = f.vz * 0.55;
        if (aw > 0.001) {
          const dx = mx - px[i];
          const dy = my - py[i];
          const r  = Math.hypot(dx, dy) + 0.001;
          const force = aw * 0.30 * Math.max(0, 1 - r * 0.35);
          vx += (dx / r) * force;
          vy += (dy / r) * force;
        }
        px[i] += vx * dts;
        py[i] += vy * dts;
        pz[i] += vz * dts;
        startTaken[i] = 0;
        const off = i * STRIDE;
        particleData[off]     = px[i];
        particleData[off + 1] = py[i];
        particleData[off + 2] = pz[i];
        particleData[off + 3] = 0.16 * loadFade;
        continue;
      }

      if (!startTaken[i]) {
        startX[i] = px[i]; startY[i] = py[i]; startZ[i] = pz[i];
        startTaken[i] = 1;
      }

      const e = easeOut(c);
      px[i] = lerp(startX[i], tg.x, e);
      py[i] = lerp(startY[i], tg.y, e);
      pz[i] = lerp(startZ[i], tg.z, e);

      const off = i * STRIDE;
      particleData[off]     = px[i];
      particleData[off + 1] = py[i];
      particleData[off + 2] = pz[i];
      particleData[off + 3] = (0.20 + c * 1.10) * loadFade;
    }
    return;
  }

  if (phase.name === 'HOLD') {
    const breathe = Math.sin(t * 1.5) * 0.0006;
    for (let i = 0; i < N_MAIN; i++) {
      const tg = targets[i];
      px[i] = tg.x + breathe * tg.x;
      py[i] = tg.y + breathe * tg.y;
      pz[i] = tg.z;
      const off = i * STRIDE;
      particleData[off]     = px[i];
      particleData[off + 1] = py[i];
      particleData[off + 2] = pz[i];
      particleData[off + 3] = 1.30 * loadFade;
    }
    return;
  }

  if (phase.name === 'DISSOLVE') {
    const fadeOut = 1 - smooth(phase.progress);
    for (let i = 0; i < N_MAIN; i++) {
      const f = flowField(px[i], py[i], pz[i], t);
      let vx = f.vx, vy = f.vy, vz = f.vz;
      if (aw > 0.001) {
        const dx = mx - px[i];
        const dy = my - py[i];
        const r  = Math.hypot(dx, dy) + 0.001;
        const force = aw * 0.35 * Math.max(0, 1 - r * 0.32);
        vx += (dx / r) * force;
        vy += (dy / r) * force;
      }
      px[i] += vx * dts;
      py[i] += vy * dts;
      pz[i] += vz * dts;
      startTaken[i] = 0;
      const off = i * STRIDE;
      particleData[off]     = px[i];
      particleData[off + 1] = py[i];
      particleData[off + 2] = pz[i];
      particleData[off + 3] = (0.20 + fadeOut * 1.05) * loadFade;
    }
    return;
  }
}

export function updateCursor(t, dt, phase, loadFade, mouse) {
  const visible = cursorVisibility(phase) * loadFade;
  // Snappy mouse tracking — most of the lag was here. Was 8.5; raised to 22
  // so fast moves don't leave the cluster trailing far behind the real cursor.
  mouse.worldX += (mouse.worldXt - mouse.worldX) * Math.min(dt * 22, 1);
  mouse.worldY += (mouse.worldYt - mouse.worldY) * Math.min(dt * 22, 1);
  const sc = 1.0 + Math.sin(t * 2.0) * 0.10;
  for (let i = 0; i < N_CURSOR; i++) {
    const ph = cph[i] + t * 0.2;
    const tx = mouse.worldX + cox[i] * sc + Math.sin(ph) * 0.0018;
    const ty = mouse.worldY + coy[i] * sc + Math.cos(ph) * 0.0018;
    const tz = coz[i];
    // Per-particle catch-up — tight enough to read as one cluster, loose
    // enough that orbital/breathing motion still feels alive.
    cpx[i] += (tx - cpx[i]) * Math.min(dt * 18, 1);
    cpy[i] += (ty - cpy[i]) * Math.min(dt * 18, 1);
    cpz[i] += (tz - cpz[i]) * Math.min(dt * 18, 1);
    const off = (N_MAIN + i) * STRIDE;
    particleData[off]     = cpx[i];
    particleData[off + 1] = cpy[i];
    particleData[off + 2] = cpz[i];
    particleData[off + 3] = 1.6 * visible;
  }
}

export function updateDust(t, dt, breathe) {
  const dts = Math.min(dt, 1 / 30);
  const slow = 0.35;
  for (let i = 0; i < N_DUST; i++) {
    const f = flowField(dpx[i], dpy[i], dpz[i], t * 0.4);
    dpx[i] += f.vx * dts * slow;
    dpy[i] += f.vy * dts * slow;
    dpz[i] += f.vz * dts * slow;
    if (Math.abs(dpx[i]) > 3.0) dpx[i] *= -0.96;
    if (Math.abs(dpy[i]) > 2.4) dpy[i] *= -0.96;
    if (Math.abs(dpz[i]) > 2.6) dpz[i] *= -0.96;
    const off = (N_MAIN + N_CURSOR + i) * STRIDE;
    particleData[off]     = dpx[i];
    particleData[off + 1] = dpy[i];
    particleData[off + 2] = dpz[i];
    const indiv = 0.85 + 0.15 * Math.sin(dphz[i] + t * 0.5);
    particleData[off + 3] = (0.10 + breathe * 0.04) * indiv;
  }
}
