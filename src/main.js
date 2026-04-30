// ────────────────────────────────────────────────────────────────
// lamba.sh entry — bootstraps the WebGPU renderer (with automatic
// WebGL2 fallback), particle system, audio, post-process pipeline,
// and the cycle dispatcher that drives everything from the phase clock.
//
// Cycle: INITIAL_DRIFT → GATHER → HOLD → DISSOLVE → DRIFT → repeat.
// Each new GATHER picks a fresh logogram seed and dissolve mode; the
// bell is pre-scheduled in audio time at the moment HOLD will begin
// (sample-accurate). Particle state lives entirely on the GPU.
// ────────────────────────────────────────────────────────────────

import * as THREE from 'three/webgpu';
import { pass, uniform, vec2, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import * as Audio from './audio/audio.js';
import { createParticleSystem, PHASE } from './render/particles.js';
import { generateLogogram } from './scene/logograms/index.js';
import { buildTargets } from './scene/targets.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Phase machine ───────────────────────────────────────────────
// Phase durations (seconds). Slightly tightened from v1 for faster cycles
// while iterating. Single source of truth for both compute (particles.js)
// and audio (scheduling), so they stay in sync.
const PHASES = {
  INITIAL_DRIFT: 6.0,
  GATHER:        8.0,
  HOLD:          4.0,
  DISSOLVE:      4.0,
  DRIFT:        10.0,
};
const CYCLE_LEN = PHASES.GATHER + PHASES.HOLD + PHASES.DISSOLVE + PHASES.DRIFT;

// ── Landing event — coordinated audiovisual moment at GATHER 100% ───
// The bell, brightness pulse, color punch, and CA spike all converge on
// this single instant. The convergence motion is naturally smooth; the
// audiovisual event creates the *perceived* moment of completion — the
// "now" the user feels, regardless of mid-flight micro-state.
const LANDING = {
  PULSE_DECAY: 8.0,    // brightness flash exp-decay rate (higher = sharper)
};

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

// ACES tone mapping maps HDR bloom output back to display range with a
// pleasing roll-off. Exposure slightly above 1.0 lifts the cathode-archive
// background so phosphor particles read brighter against the void.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const isWebGPU = renderer.backend?.isWebGPUBackend ?? false;
console.log(`[lamba.sh] backend: ${isWebGPU ? 'WebGPU' : 'WebGL2'}`);

const scene = new THREE.Scene();
// Brighter than the v1 #040810 to compensate for ACES tone mapping
// crushing the blue toward black. Reads as cathode-archive deep blue.
scene.background = new THREE.Color(0x0A1828);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 2.2);

// ── Particle system ─────────────────────────────────────────────
const particles = createParticleSystem({ count: 18000 });
scene.add(particles.mesh);
scene.add(particles.cursorMesh);
await renderer.computeAsync(particles.initCompute);
await renderer.computeAsync(particles.cursorInitCompute);

// ── Post-process pipeline ───────────────────────────────────────
// scenePass → CA (subtle baseline + HOLD modulation) → + bloom → tone map
//
// Bloom: mip-chain dual-blur. (sourceTexture, strength, radius, threshold)
// CA:    sample R/G/B at slightly offset UVs. Strength modulated each frame
//        from JS so HOLD reads as "transmission coming through old gear".
const scenePass  = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
const bloomPass  = bloom(sceneColor, 0.40, 0.80, 0.0);

const caStrength = uniform(0.30);                // updated per-frame in JS
const aberrated  = chromaticAberration(sceneColor, caStrength, vec2(0.5), float(1.0));

const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputNode = aberrated.add(bloomPass);

// Generate first logogram + targets so they're ready when GATHER begins.
// Each cycle picks a bell pitch from a pentatonic so successive HOLDs feel
// melodic across cycles instead of repeating the same note.
const PENTATONIC = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];
let prevCycle = -2;
let bellFreq = PENTATONIC[0];
// The current cycle's audio context — captured at GATHER start so the
// brush/hold/dissolve calls fired from the frame loop on phase change
// can voice the right mood without re-reading the logogram.
let cycleMood = 'calm';
let cyclePattern = 'single';
function regenerate(cycle = 0) {
  const seed = (Math.random() * 1e9) | 0;
  const logogram = generateLogogram(seed);
  const targets = buildTargets(logogram, particles.count);
  particles.uploadTargets(targets);
  bellFreq = PENTATONIC[((cycle % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length];

  cycleMood = logogram.mood;
  cyclePattern = logogram.pattern;
  const elementCount = logogram.elements.length;
  // Density scales the bell volume — sparse messages whisper, rich
  // ones speak with more weight. Element count is a good proxy.
  const density = Math.min(1.2, 0.55 + elementCount / 60);

  // Random dissolve mode for this cycle — shockwave / implode-explode /
  // tear / swarm-helical. Each cycle's release looks different so the
  // loop never feels repetitive.
  particles.setDissolveMode(Math.floor(Math.random() * 4), Math.random() * 1000);

  // Bell rings exactly at GATHER end (= HOLD start). Convergence math is
  // variable-duration so all particles land at phaseProgress=1.0 — the
  // cascade coincides with the visual completion, sample-accurate.
  // Pattern picks the cascade shape (single / triplet / constellation /
  // cartouche / mirror); mood picks the bell's harmonic colour.
  // Stroke ticks fire one quiet pen-tap per glyph element across GATHER,
  // so the message has a writing rhythm as it forms.
  if (Audio.isStarted() && !reducedMotion) {
    const startAudio = Audio.getTime();
    Audio.bellCascade(startAudio + PHASES.GATHER, bellFreq, cyclePattern, cycleMood, density);
    Audio.strokeTicks(startAudio + 0.10, PHASES.GATHER, elementCount, bellFreq, cycleMood);
  }
  return seed;
}
regenerate(0);

// ── Audio unlock + hint flow ────────────────────────────────────
const audioHintEl = document.getElementById('audio-hint');
if (!reducedMotion) {
  Audio.setOnUnlock(() => {
    if (!audioHintEl) return;
    audioHintEl.classList.remove('show');
    audioHintEl.classList.add('hide');
    setTimeout(() => audioHintEl.parentNode && audioHintEl.parentNode.removeChild(audioHintEl), 1100);
  });
  Audio.attachUnlockListeners();
  Audio.tryStart(); // most browsers defer until first gesture
  setTimeout(() => {
    if (!Audio.isStarted() && audioHintEl) audioHintEl.classList.add('show');
  }, 2000);
} else if (audioHintEl && audioHintEl.parentNode) {
  audioHintEl.parentNode.removeChild(audioHintEl);
}

// Suspend the audio graph when the tab is hidden — setAnimationLoop already
// pauses rendering, but Web Audio keeps generating samples otherwise.
document.addEventListener('visibilitychange', () => {
  const ctx = Audio.getContext();
  if (!ctx) return;
  if (document.hidden && ctx.state === 'running') ctx.suspend().catch(() => {});
  else if (!document.hidden && ctx.state === 'suspended' && Audio.isStarted()) ctx.resume().catch(() => {});
});

// ── Debug status overlay (phase + progress) ─────────────────────
const statusEl = document.createElement('div');
statusEl.style.cssText =
  'position:fixed;left:50%;top:1.25rem;transform:translateX(-50%);' +
  'color:rgba(232,236,240,.45);font:0.70rem/1 ui-monospace,JetBrains Mono,monospace;' +
  'letter-spacing:0.06em;pointer-events:none;user-select:none;z-index:10;';
document.body.appendChild(statusEl);

// ── Hint UI + mouse tracking ────────────────────────────────────
const idleHintEl = document.getElementById('idle-hint');
const ghEl       = document.getElementById('gh');

const MOVE_THRESHOLD_PX = 8;
const IDLE_THRESHOLD_MS = 10000;
let firstMouseX = null, firstMouseY = null;
let mouseScreenX = window.innerWidth / 2;
let mouseScreenY = window.innerHeight / 2;
let mouseInPage = false;
let lastMoveTime = performance.now();
let idleHintShowing = false;

function setIdleHint(visible) {
  if (!idleHintEl) return;
  idleHintEl.classList.toggle('show', visible);
  idleHintEl.classList.toggle('hide', !visible);
  idleHintShowing = visible;
}

function noteMouseMove(x, y) {
  mouseScreenX = x; mouseScreenY = y;
  mouseInPage = true;
  if (firstMouseX === null) { firstMouseX = x; firstMouseY = y; return; }
  // 8px threshold — synthetic mousemove on page load shouldn't dismiss hints.
  if (Math.hypot(x - firstMouseX, y - firstMouseY) > MOVE_THRESHOLD_PX) {
    lastMoveTime = performance.now();
    firstMouseX = x; firstMouseY = y;
    if (idleHintShowing) setIdleHint(false);
  }
}
window.addEventListener('mousemove', e => noteMouseMove(e.clientX, e.clientY));
window.addEventListener('touchmove', e => {
  if (e.touches.length) noteMouseMove(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

// Continuous idle detector — only surface "move your cursor" during DRIFT.
setInterval(() => {
  const elapsed = (performance.now() - startTime) / 1000;
  const phase   = phaseAt(elapsed);
  const idleFor = performance.now() - lastMoveTime;
  if (phase.idx === PHASE.DRIFT && !reducedMotion) {
    if (!idleHintShowing && idleFor > IDLE_THRESHOLD_MS) setIdleHint(true);
  } else if (idleHintShowing) {
    setIdleHint(false);
  }
}, 500);

// GitHub link — click animation before opening, so the navigation isn't
// abrupt and the "I'm leaving" feels deliberate rather than reactive.
if (ghEl) {
  ghEl.addEventListener('click', (e) => {
    e.preventDefault();
    ghEl.classList.add('clicking');
    setTimeout(() => {
      window.open(ghEl.href, '_blank', 'noopener,noreferrer');
      setTimeout(() => ghEl.classList.remove('clicking'), 250);
    }, 320);
  });
}

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
let prevPhaseIdx = -1;
// Marker for the most recent GATHER → HOLD landing event. The brightness
// pulse decays from this moment — combined with the simultaneously-
// scheduled bell, it creates the perceived "now" of message arrival.
let lastLandingTime = -1000;

renderer.setAnimationLoop(async (now) => {
  const dt      = Math.min((now - last) / 1000, 1 / 20);
  last          = now;
  const elapsed = (now - startTime) / 1000;
  const phase   = phaseAt(elapsed);

  // New GATHER cycle → fresh glyph. The compute kernel handles smooth
  // drift→target blending entirely from current state, no start capture
  // pass needed.
  if (phase.idx === PHASE.GATHER && phase.cycle !== prevCycle && phase.cycle >= 0) {
    regenerate(phase.cycle);
    prevCycle = phase.cycle;
  }

  // Phase-transition events. The bell is pre-scheduled in regenerate()
  // for sample-accurate timing; here we trigger the brush sweeps, hold
  // tone, and the visual landing pulse that synchronizes with the bell
  // at GATHER → HOLD.
  if (phase.idx !== prevPhaseIdx) {
    if (phase.idx === PHASE.HOLD && prevPhaseIdx !== PHASE.HOLD) {
      // Visual landing event — coincides with the pre-scheduled bell.
      lastLandingTime = elapsed;
    }
    if (Audio.isStarted() && !reducedMotion) {
      const at = Audio.getTime();
      if (phase.idx === PHASE.GATHER && prevPhaseIdx !== PHASE.GATHER) {
        Audio.brushSound(at + 0.02, PHASES.GATHER, 600, 1800, 0.062, cycleMood);
      } else if (phase.idx === PHASE.HOLD && prevPhaseIdx !== PHASE.HOLD) {
        Audio.startHoldTone(bellFreq * 0.5, cycleMood);
      } else if (phase.idx === PHASE.DISSOLVE && prevPhaseIdx !== PHASE.DISSOLVE) {
        Audio.brushSound(at + 0.02, PHASES.DISSOLVE, 1500, 450, 0.052, cycleMood);
        Audio.stopHoldTone();
      }
    }
    prevPhaseIdx = phase.idx;
  }

  // Project mouse from screen pixels onto the z=0 plane in world space.
  // Off-screen / not-yet-tracked → cursor parks at origin.
  if (mouseInPage) {
    const ndcX = (mouseScreenX / window.innerWidth) * 2 - 1;
    const ndcY = -((mouseScreenY / window.innerHeight) * 2 - 1);
    const halfH = Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z;
    const halfW = halfH * camera.aspect;
    particles.setMouseWorld(ndcX * halfW, ndcY * halfH, 0);
  } else {
    particles.setMouseWorld(0, 0, 0);
  }

  particles.setDt(dt);
  particles.setPhase(phase.idx, phase.progress);

  // ── Landing-coordinated visual events ─────────────────────────
  // holdGlow ramps from 0→1 across the entire GATHER (so particle
  // colors emerge progressively as the glyph forms), holds at 1
  // through HOLD, fades over DISSOLVE. CA strength + landing pulse
  // hook off it for a coherent audiovisual moment at HOLD start.
  let holdGlow = 0;
  if (phase.idx === PHASE.GATHER) {
    holdGlow = phase.progress;
  } else if (phase.idx === PHASE.HOLD) {
    holdGlow = 1;
  } else if (phase.idx === PHASE.DISSOLVE) {
    holdGlow = 1 - phase.progress;
  }

  // Subtle brightness flash at the landing moment — accent, not flash.
  const landingPulse = Math.max(0, Math.exp(-(elapsed - lastLandingTime) * LANDING.PULSE_DECAY));

  caStrength.value = 0.30 + holdGlow * 0.40 + landingPulse * 0.15;
  particles.setLandingPulse(landingPulse);

  await renderer.computeAsync(particles.cursorUpdateCompute);
  await renderer.computeAsync(particles.updateCompute);
  await pipeline.renderAsync();

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
