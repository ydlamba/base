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

// ── Boot UI handles — wired at script load ──────────────────────
const bootEl         = document.getElementById('boot');
const progressFillEl = bootEl?.querySelector('.progress-fill');
const buttonEl       = bootEl?.querySelector('.boot-button');
const chargeFillEl   = bootEl?.querySelector('.charge-fill');
const debugMode      = new URLSearchParams(window.location.search).has('debug');

function seedToSlug(seed) {
  return (seed >>> 0).toString(36);
}

function parseSeedSlug(raw) {
  if (!raw) return null;
  const clean = raw.trim().replace(/^#/, '');
  if (!/^[0-9a-z]+$/i.test(clean)) return null;
  const seed = Number.parseInt(clean, 36);
  return Number.isFinite(seed) ? (seed >>> 0) : null;
}

function readSharedSeed() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  return parseSeedSlug(hash.get('s')) ?? parseSeedSlug(query.get('s'));
}

function publishSeed(seed) {
  const slug = seedToSlug(seed);
  const next = `${window.location.pathname}${window.location.search}#s=${slug}`;
  if (window.location.hash !== `#s=${slug}`) window.history.replaceState(null, '', next);
}

function setProgress(pct) {
  if (progressFillEl) progressFillEl.style.width = pct + '%';
}
setProgress(5);

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
setProgress(35);

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
setProgress(50);
await renderer.computeAsync(particles.initCompute);
setProgress(68);
await renderer.computeAsync(particles.cursorInitCompute);
setProgress(78);

// ── Post-process pipeline ───────────────────────────────────────
// scenePass → CA (subtle baseline + HOLD modulation) → + bloom → tone map
//
// Bloom: mip-chain dual-blur. (sourceTexture, strength, radius, threshold)
// CA:    sample R/G/B at slightly offset UVs. Strength modulated each frame
//        from JS so HOLD reads as "transmission coming through old gear".
const scenePass  = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
const bloomPass  = bloom(sceneColor, 0.28, 0.66, 0.0);

const caStrength = uniform(0.30);                // updated per-frame in JS
const aberrated  = chromaticAberration(sceneColor, caStrength, vec2(0.5), float(1.0));

const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputNode = aberrated.add(bloomPass);
setProgress(88);

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
let cycleTransmission = 'unread field';
const firstCycleSeed = readSharedSeed() ?? ((Math.random() * 0xFFFFFFFF) >>> 0);

function regenerate(cycle = 0) {
  const seed = cycle === 0 ? firstCycleSeed : ((Math.random() * 0xFFFFFFFF) >>> 0);
  const logogram = generateLogogram(seed);
  const targets = buildTargets(logogram, particles.count);
  particles.uploadTargets(targets);
  publishSeed(seed);
  bellFreq = PENTATONIC[((cycle % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length];

  cycleMood = logogram.mood;
  cyclePattern = logogram.pattern;
  cycleTransmission = logogram.name;
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
setProgress(95);

// Pre-warm: compile the compute kernels and render pipeline before the
// entry button appears. dt=0 keeps the initial particle cluster intact
// while avoiding first-interaction shader work.
particles.setDt(0);
particles.setPhase(PHASE.DRIFT, 0);
particles.setMouseWorld(0, 0, 0);
particles.setCursorEnergy(0);
particles.setImpulse(0, 0, 0, 0, 0);
particles.setLandingPulse(0);
particles.setEntryBurst(0);
await renderer.computeAsync(particles.cursorUpdateCompute);
await renderer.computeAsync(particles.updateCompute);
await pipeline.renderAsync();
setProgress(100);

// ── Audio hint — kept as a fallback element but the entry button is
// now the audio-unlock gesture, so the timed auto-show is gone.
const audioHintEl = document.getElementById('audio-hint');
if (audioHintEl && audioHintEl.parentNode && reducedMotion) {
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
const statusEl = debugMode ? document.createElement('div') : null;
if (statusEl) {
  statusEl.style.cssText =
    'position:fixed;left:50%;top:1.25rem;transform:translateX(-50%);' +
    'color:rgba(232,236,240,.45);font:0.70rem/1 ui-monospace,JetBrains Mono,monospace;' +
    'letter-spacing:0.06em;pointer-events:none;user-select:none;z-index:10;';
  document.body.appendChild(statusEl);
}

// ── Hint UI + mouse tracking ────────────────────────────────────
const idleHintEl = document.getElementById('idle-hint');
const ghEl       = document.getElementById('gh');
const noteEl     = document.getElementById('note');

const MOVE_THRESHOLD_PX = 8;
const IDLE_THRESHOLD_MS = 10000;
let firstMouseX = null, firstMouseY = null;
let mouseScreenX = window.innerWidth / 2;
let mouseScreenY = window.innerHeight / 2;
let mouseInPage = false;
let lastMoveTime = performance.now();
let idleHintShowing = false;
let prevPointerX = mouseScreenX;
let prevPointerY = mouseScreenY;
let prevPointerT = performance.now();
let cursorEnergy = 0;
let impulseLevel = 0;
let impulseSeed = 0;
const impulseWorld = new THREE.Vector3();

function screenToWorld(x, y) {
  const ndcX = (x / window.innerWidth) * 2 - 1;
  const ndcY = -((y / window.innerHeight) * 2 - 1);
  const halfH = Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z;
  const halfW = halfH * camera.aspect;
  return new THREE.Vector3(ndcX * halfW, ndcY * halfH, 0);
}

function spawnSignalDisturbance(x, y) {
  if (reducedMotion) return;
  const count = 10 + Math.floor(Math.random() * 12);
  const bias = Math.random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'signal-shard';
    el.style.setProperty('--x', x + (Math.random() - 0.5) * 14 + 'px');
    el.style.setProperty('--y', y + (Math.random() - 0.5) * 14 + 'px');
    const angle = bias + (Math.random() - 0.5) * Math.PI * 1.7;
    const dist = 24 + Math.random() * 92;
    el.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
    el.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
    el.style.setProperty('--rot', angle + (Math.random() - 0.5) * 1.2 + 'rad');
    el.style.setProperty('--spin', (Math.random() - 0.5) * 1.6 + 'rad');
    el.style.setProperty('--w', 8 + Math.random() * 38 + 'px');
    el.style.setProperty('--dur', 0.34 + Math.random() * 0.32 + 's');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 720);
  }
}

function fireSignalProbe(x, y, strength = 1) {
  if (startTime < 0 || reducedMotion) return;
  const world = screenToWorld(x, y);
  impulseWorld.copy(world);
  impulseSeed = Math.random() * 1000;
  impulseLevel = Math.max(impulseLevel, strength);
  cursorEnergy = Math.max(cursorEnergy, strength * 0.85);
  spawnSignalDisturbance(x, y);
}

function setIdleHint(visible) {
  if (!idleHintEl) return;
  idleHintEl.classList.toggle('show', visible);
  idleHintEl.classList.toggle('hide', !visible);
  idleHintShowing = visible;
}

function noteMouseMove(x, y) {
  const now = performance.now();
  const dt = Math.max(16, now - prevPointerT);
  const speed = Math.hypot(x - prevPointerX, y - prevPointerY) / dt;
  cursorEnergy = Math.max(cursorEnergy, Math.min(1, speed * 0.22));
  prevPointerX = x;
  prevPointerY = y;
  prevPointerT = now;

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
window.addEventListener('pointerdown', e => {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target?.closest?.('#gh')) return;
  noteMouseMove(e.clientX, e.clientY);
  fireSignalProbe(e.clientX, e.clientY, 1);
});
window.addEventListener('touchmove', e => {
  if (e.touches.length) noteMouseMove(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

// Continuous idle detector — only surface the interaction hint during DRIFT.
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
// startTime is only set when the entry button bursts — until then the
// loop runs (so dt timing stays warm) but exits early. Setting it on
// burst makes the cycle clock begin from that moment.
let startTime = -1;
let last = -1;
let prevPhaseIdx = -1;
// Marker for the most recent GATHER → HOLD landing event. The brightness
// pulse decays from this moment — combined with the simultaneously-
// scheduled bell, it creates the perceived "now" of message arrival.
let lastLandingTime = -1000;

renderer.setAnimationLoop(async (now) => {
  if (startTime < 0) return;
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
    if (phase.idx === PHASE.GATHER && prevPhaseIdx !== PHASE.GATHER) {
      if (noteEl) noteEl.textContent = "the message hasn't arrived yet";
    }
    if (phase.idx === PHASE.HOLD && prevPhaseIdx !== PHASE.HOLD) {
      // Visual landing event — coincides with the pre-scheduled bell.
      lastLandingTime = elapsed;
      if (noteEl) noteEl.textContent = `received: ${cycleTransmission}`;
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
    const world = screenToWorld(mouseScreenX, mouseScreenY);
    particles.setMouseWorld(world.x, world.y, world.z);
  } else {
    particles.setMouseWorld(0, 0, 0);
  }

  cursorEnergy *= Math.exp(-dt * 2.4);
  impulseLevel *= Math.exp(-dt * 5.2);

  particles.setDt(dt);
  particles.setPhase(phase.idx, phase.progress);
  particles.setCursorEnergy(cursorEnergy);
  particles.setImpulse(impulseWorld.x, impulseWorld.y, impulseWorld.z, impulseLevel, impulseSeed);

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

  caStrength.value =
    0.22 + holdGlow * 0.24 + landingPulse * 0.10 +
    entryBurstLevel * 0.50 + cursorEnergy * 0.12 + impulseLevel * 0.22;
  particles.setLandingPulse(landingPulse);
  // Entry burst — radial kick on all particles for ~0.6s after the
  // hold-button bursts, then decays out. Same envelope used to spike
  // the chromatic aberration above so the visual surge syncs.
  particles.setEntryBurst(entryBurstLevel);
  if (entryBurstLevel > 0.001) entryBurstLevel *= 0.93;
  else                         entryBurstLevel = 0;

  await renderer.computeAsync(particles.cursorUpdateCompute);
  await renderer.computeAsync(particles.updateCompute);
  await pipeline.renderAsync();

  if (statusEl) {
    statusEl.textContent =
      `${isWebGPU ? 'WebGPU' : 'WebGL2'} · ${particles.count.toLocaleString()} · ` +
      `${PHASE_NAME[phase.idx]} ${(phase.progress * 100).toFixed(0)}%`;
  }
});

function showFatal(msg) {
  const el = document.createElement('pre');
  el.textContent = msg;
  el.style.cssText =
    'position:fixed;inset:0;color:#888;background:#040810;padding:2rem;' +
    'font:13px ui-monospace,monospace;white-space:pre-wrap;z-index:9999;';
  document.body.appendChild(el);
}

// ── Entry: progress → click-and-hold → burst ─────────────────────
// Loading is done (we're past `await pipeline.renderAsync()`); show
// the button. Mouse/touch/keyboard hold builds the charge meter +
// audio rumble + screen shake; reaching 1.0 fires the burst, which
// starts the animation clock and fades the overlay.

const FULL_CHARGE_TIME = 1.2;   // seconds of holding to fully charge
const DRAIN_RATE        = 1.6;  // 1/sec — release-then-resume drains a bit faster than it fills

let charge        = 0;
let holding       = false;
let chargeAnim    = false;
let lastChargeT   = 0;
let bursting      = false;

// Hand off to the live state — set boot.ready so the button fades in.
function showButton() {
  if (!bootEl || !buttonEl) {
    // Fallback: no boot UI in DOM, just start immediately.
    triggerBurst({ silent: true });
    return;
  }
  setTimeout(() => bootEl.classList.add('ready'), 280);
}
showButton();

if (buttonEl) {
  // pointerdown handles mouse + touch + pen with one listener; pointerup
  // listens on window so dragging off the button still releases.
  buttonEl.addEventListener('pointerdown', e => { e.preventDefault(); onHoldStart(); });
  window.addEventListener('pointerup', onHoldEnd);
  window.addEventListener('pointercancel', onHoldEnd);
  // Keyboard: space/enter while button is focused.
  buttonEl.addEventListener('keydown', e => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); onHoldStart(); }
  });
  buttonEl.addEventListener('keyup', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onHoldEnd(); }
  });
}

function onHoldStart() {
  if (bursting) return;
  // Reduced-motion users: a single press enters immediately. The hold
  // ritual is the whole point of the gesture — without animation it
  // would just be a silent 1.2s wait, so skip it.
  if (reducedMotion) {
    if (!Audio.isStarted()) Audio.tryStart();
    triggerBurst();
    return;
  }
  if (!holding) {
    holding = true;
    bootEl.classList.add('holding');
    if (!Audio.isStarted()) {
      Audio.tryStart();
      Audio.startChargeTone();
    }
    if (!chargeAnim) {
      chargeAnim = true;
      lastChargeT = performance.now();
      requestAnimationFrame(chargeStep);
    }
  }
}

function onHoldEnd() {
  if (!holding || bursting) return;
  holding = false;
  bootEl.classList.remove('holding');
}

function chargeStep() {
  const now = performance.now();
  const dt = Math.max(0, (now - lastChargeT) / 1000);
  lastChargeT = now;

  if (holding) charge = Math.min(1, charge + dt / FULL_CHARGE_TIME);
  else         charge = Math.max(0, charge - dt * DRAIN_RATE);

  if (chargeFillEl) chargeFillEl.style.width = (charge * 100) + '%';
  if (!reducedMotion) Audio.setChargeLevel(charge);

  // Smooth pressure, not shake. Random transforms here made the first
  // interaction feel like dropped frames even when the browser was fine.
  const target = bootEl.querySelector('.boot-content');
  if (target && !reducedMotion) {
    const scale = 1 + charge * 0.018;
    target.style.transform = `scale(${scale.toFixed(4)})`;
  }

  if (charge >= 1) {
    triggerBurst();
    return;
  }
  if (charge > 0 || holding) {
    requestAnimationFrame(chargeStep);
  } else {
    chargeAnim = false;
    if (target) target.style.transform = '';
  }
}

function spawnMiniParticles(cx, cy) {
  const count = reducedMotion ? 12 : 48;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'mini-particle';
    p.style.left = cx + 'px';
    p.style.top  = cy + 'px';
    const angle = Math.random() * Math.PI * 2;
    const speed = 260 + Math.random() * 820;
    const size  = (2 + Math.random() * 4).toFixed(1);
    p.style.setProperty('--tx',   (Math.cos(angle) * speed).toFixed(0) + 'px');
    p.style.setProperty('--ty',   (Math.sin(angle) * speed).toFixed(0) + 'px');
    p.style.setProperty('--size', size + 'px');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }
}

function triggerBurst({ silent = false } = {}) {
  if (bursting) return;
  bursting = true;
  holding = false;

  const burstNow = performance.now();
  startTime = burstNow;
  last = burstNow;
  entryBurstLevel = 1.0;

  // Visual burst — button dissolves, a small DOM spray starts on the
  // next frame, and the GPU field carries the main release.
  if (bootEl) bootEl.classList.add('bursting');
  const target = bootEl?.querySelector('.boot-content');
  if (target) target.style.transform = '';

  if (!silent) {
    requestAnimationFrame(() => {
      Audio.stopChargeTone();
      Audio.burstSound();
      // Drone takes over the audio bed from the burst onward.
      Audio.bootDrone();
    });
  } else {
    Audio.bootDrone();
  }

  if (buttonEl && !silent) {
    const r = buttonEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top  + r.height / 2;
    requestAnimationFrame(() => spawnMiniParticles(cx, cy));
  }

  setTimeout(() => bootEl?.classList.add('exiting'), 90);
  setTimeout(() => noteEl?.classList.add('show'), 1400);
  setTimeout(() => {
    if (bootEl?.parentNode) bootEl.parentNode.removeChild(bootEl);
  }, 1200);
}

// Entry burst level (0..1) — set to 1 on burst, decayed in the frame
// loop. Drives the WebGPU radial kick.
let entryBurstLevel = 0;
