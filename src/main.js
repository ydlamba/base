// ────────────────────────────────────────────────────────────────
// lamba.sh — Three.js + WebGPURenderer (with automatic WebGL2 fallback).
//
// v2 step 4: convergence wired in. Particles drift on curl noise during
// DRIFT, converge to logogram targets during GATHER, lock during HOLD,
// release outward during DISSOLVE, then back to DRIFT. New logogram per
// cycle. Particle data lives entirely in GPU storage buffers.
// ────────────────────────────────────────────────────────────────

import * as THREE from 'three/webgpu';
import { createParticleSystem, PHASE } from './render/particles.js';
import { generateLogogram } from './scene/logograms.js';
import { buildTargets } from './scene/targets.js';

// ── Phase machine ───────────────────────────────────────────────
// Mirrors the v1 timings from PROGRESS.md but slightly tightened so we
// see a full cycle quickly while iterating.
const PHASES = {
  INITIAL_DRIFT: 6.0,
  GATHER:        8.0,
  HOLD:          4.0,
  DISSOLVE:      4.0,
  DRIFT:        10.0,
};
const CYCLE_LEN = PHASES.GATHER + PHASES.HOLD + PHASES.DISSOLVE + PHASES.DRIFT;

function phaseAt(t) {
  if (t < PHASES.INITIAL_DRIFT) {
    return { idx: PHASE.DRIFT, progress: t / PHASES.INITIAL_DRIFT, cycle: -1 };
  }
  const u  = (t - PHASES.INITIAL_DRIFT) % CYCLE_LEN;
  const ci = Math.floor((t - PHASES.INITIAL_DRIFT) / CYCLE_LEN);
  if (u < PHASES.GATHER)
    return { idx: PHASE.GATHER, progress: u / PHASES.GATHER, cycle: ci };
  if (u < PHASES.GATHER + PHASES.HOLD)
    return { idx: PHASE.HOLD, progress: (u - PHASES.GATHER) / PHASES.HOLD, cycle: ci };
  if (u < PHASES.GATHER + PHASES.HOLD + PHASES.DISSOLVE)
    return { idx: PHASE.DISSOLVE, progress: (u - PHASES.GATHER - PHASES.HOLD) / PHASES.DISSOLVE, cycle: ci };
  return { idx: PHASE.DRIFT, progress: (u - PHASES.GATHER - PHASES.HOLD - PHASES.DISSOLVE) / PHASES.DRIFT, cycle: ci };
}

const PHASE_NAME = ['DRIFT', 'GATHER', 'HOLD', 'DISSOLVE'];

// ── Renderer ────────────────────────────────────────────────────
const canvas = document.getElementById('c');

const renderer = new THREE.WebGPURenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
});

try {
  await renderer.init();
} catch (e) {
  showFatal(`Renderer init failed: ${e.message}`);
  throw e;
}

const isWebGPU = renderer.backend?.isWebGPUBackend ?? false;
console.log(`[lamba.sh] backend: ${isWebGPU ? 'WebGPU' : 'WebGL2'}`);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040810);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 3.1);

// ── Particle system ─────────────────────────────────────────────
const particles = createParticleSystem({ count: 30000 });
scene.add(particles.mesh);
await renderer.computeAsync(particles.initCompute);

// Generate first logogram + targets so they're ready when GATHER begins.
let prevCycle = -2;
function regenerate() {
  const seed = (Math.random() * 1e9) | 0;
  const logogram = generateLogogram(seed);
  const targets = buildTargets(logogram, particles.count);
  particles.uploadTargets(targets);
  return seed;
}
regenerate();

// ── Status overlay ──────────────────────────────────────────────
const statusEl = document.createElement('div');
statusEl.style.cssText =
  'position:fixed;left:50%;top:1.25rem;transform:translateX(-50%);' +
  'color:rgba(232,236,240,.45);font:0.70rem/1 ui-monospace,JetBrains Mono,monospace;' +
  'letter-spacing:0.06em;pointer-events:none;user-select:none;z-index:10;';
document.body.appendChild(statusEl);

// ── Resize ──────────────────────────────────────────────────────
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

// ── Frame loop ──────────────────────────────────────────────────
const startTime = performance.now();
let last = startTime;

renderer.setAnimationLoop(async (now) => {
  const dt      = Math.min((now - last) / 1000, 1 / 20);
  last          = now;
  const elapsed = (now - startTime) / 1000;
  const phase   = phaseAt(elapsed);

  // New GATHER cycle → new glyph + capture each particle's start
  // position so the in-shader convergence has a stable lerp source.
  if (phase.idx === PHASE.GATHER && phase.cycle !== prevCycle && phase.cycle >= 0) {
    regenerate();
    await renderer.computeAsync(particles.captureStartCompute);
    prevCycle = phase.cycle;
  }

  particles.setDt(dt);
  particles.setPhase(phase.idx, phase.progress);

  await renderer.computeAsync(particles.updateCompute);
  renderer.render(scene, camera);

  statusEl.textContent =
    `${isWebGPU ? 'WebGPU' : 'WebGL2'} · ${particles.count.toLocaleString()} · ` +
    `${PHASE_NAME[phase.idx]} ${(phase.progress * 100).toFixed(0)}%`;
});

function showFatal(msg) {
  const el = document.createElement('pre');
  el.textContent = msg;
  el.style.cssText =
    'position:fixed;inset:0;color:#888;background:#040810;padding:2rem;' +
    'font:13px ui-monospace,monospace;white-space:pre-wrap;z-index:9999;';
  document.body.appendChild(el);
}
