// ────────────────────────────────────────────────────────────────
// GPU-resident particle system with phase-driven convergence.
//
// State buffers (all GPU-resident, never copied back to JS):
//   position  vec3 storage  — current world position
//   velocity  vec3 storage  — drift velocity
//   home      vec3 storage  — spawn position; gentle homeward pull
//                              during DRIFT brings the field back to its
//                              initial dispersed state after each cycle
//   colorBlend float storage — per-particle 0..1 blend toward accent
//                              color, written by the compute kernel
//                              based on each particle's actual
//                              convergence state
//   target    DataTexture   — CPU-written per cycle, sampled by index
//                              in compute. A texture rather than a
//                              storage buffer because Three.js's WebGL2
//                              compute emulation doesn't reliably
//                              re-upload storage buffers from CPU.
//
// Two compute kernels run per frame: the main update (curl + thermal +
// phase logic + cursor attraction) and the cursor cluster orbit.
// ────────────────────────────────────────────────────────────────

import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, instancedArray, uniform, time as uTime,
  vec3, ivec2, float, int, sin, cos, hash, mx_noise_vec3, color,
  length, smoothstep, uv, mix, saturate, If, oneMinus, max as tslMax,
  pow as tslPow, sqrt as tslSqrt, normalize, textureLoad, step,
} from 'three/tsl';

export const PHASE = Object.freeze({
  DRIFT: 0,
  GATHER: 1,
  HOLD: 2,
  DISSOLVE: 3,
});

export function createParticleSystem({ count = 30000 } = {}) {
  // ── Target texture (CPU-writable, sampled by compute) ───────────
  const TEX_W = Math.ceil(Math.sqrt(count));
  const TEX_H = Math.ceil(count / TEX_W);
  const targetData = new Float32Array(TEX_W * TEX_H * 4);
  // Pre-seed globalT so the no-snap convergence math has sensible per-
  // particle pacing even before the first uploadTargets() call.
  for (let i = 0; i < count; i++) targetData[i * 4 + 3] = i / count;

  const targetTexture = new THREE.DataTexture(
    targetData, TEX_W, TEX_H, THREE.RGBAFormat, THREE.FloatType
  );
  targetTexture.minFilter = THREE.NearestFilter;
  targetTexture.magFilter = THREE.NearestFilter;
  targetTexture.needsUpdate = true;

  // ── Storage buffers (compute-written, never CPU-written) ────────
  const positionBuffer = instancedArray(count, 'vec3');
  const velocityBuffer = instancedArray(count, 'vec3');
  // Home position — captured at init, gives each particle "memory" of
  // its spawn location. A gentle homeward pull during DRIFT brings the
  // field back to its initial dispersed distribution after each cycle.
  const homeBuffer     = instancedArray(count, 'vec3');
  // Per-particle color blend — written by the compute kernel based on
  // each particle's actual convergence state, so drift particles stay
  // phosphor even during GATHER while converging particles tint.
  const colorBlendBuffer = instancedArray(count, 'float');

  // ── Init: tight cluster at origin, chaotic plasma explosion ─────
  // The entry button sits at the centre of the screen (camera looks
  // at origin), so spawning all 18k particles in a small cluster at
  // origin makes the button-burst visually continuous.
  //
  // Velocity is *mostly random* with a small bias toward each
  // particle's home position. A clean radial wavefront would read as
  // a sphere; the random component breaks that symmetry so the
  // burst feels turbulent instead of geometric. Speed follows a
  // power-law — most particles slow, a few very fast — which gives
  // depth and asymmetry to the expansion. Home pull during the 6s
  // INITIAL_DRIFT corrects each particle to its home position.
  const initCompute = Fn(() => {
    const pos = positionBuffer.element(instanceIndex);
    const vel = velocityBuffer.element(instanceIndex);
    const home = homeBuffer.element(instanceIndex);

    const seed = float(instanceIndex).mul(0.0137);
    const h1 = hash(seed.add(7.13));
    const h2 = hash(seed.add(31.7));
    const h3 = hash(seed.add(83.9));
    const h4 = hash(seed.add(157.3));
    const h5 = hash(seed.add(421.1));
    const h6 = hash(seed.add(523.7));
    const h7 = hash(seed.add(617.3));
    const h8 = hash(seed.add(733.9));

    // Home position — the dispersed sphere where this particle will
    // settle. Same distribution as the previous random spawn.
    const cosT = h2.mul(2).sub(1);
    const sinT = tslSqrt(cosT.mul(-1).add(1).mul(cosT.add(1)));
    const phi  = h3.mul(6.2831853);
    const baseR = tslPow(h1, float(1.0 / 3.0)).mul(2.5);
    const noisyR = mix(baseR, h4.mul(4.0), float(0.50));
    const homePos = vec3(
      sinT.mul(cos(phi)).mul(noisyR),
      sinT.mul(sin(phi)).mul(noisyR),
      cosT.mul(noisyR),
    );
    home.assign(homePos);

    // Initial position — tight cluster within ~0.06 units of origin.
    pos.assign(normalize(homePos).mul(h4.mul(0.06)));

    // Direction — mostly random (chaos), small bias toward home so the
    // overall mass still expands in a sensible way. ~25% home-biased,
    // 75% random.
    const dirRand = vec3(h6.mul(2).sub(1), h7.mul(2).sub(1), h8.mul(2).sub(1));
    const dirHome = normalize(homePos);
    const finalDir = normalize(mix(dirRand, dirHome, float(0.25)));

    // Speed — power-law distribution: pow(h5, 2) biases toward 0 so
    // most particles are slow, a few are fast. Gives a turbulent feel
    // rather than a uniform shell.
    const speed = mix(float(1.5), float(14.0), tslPow(h5, float(2.0)));
    vel.assign(finalDir.mul(speed));
  })().compute(count);

  // ── Update kernel ───────────────────────────────────────────────
  const phaseIdx       = uniform(0, 'int');
  const phaseProgress  = uniform(0);
  const dtUniform      = uniform(1 / 60);
  const mouseWorld     = uniform(new THREE.Vector3());
  const cursorEnergyU  = uniform(0);
  const impulseWorld   = uniform(new THREE.Vector3());
  const impulseLevelU  = uniform(0);
  const impulseSeedU   = uniform(0);
  const landingPulseU  = uniform(0);                // 0..1 — subtle flash
  // Entry burst — radial kick applied to all particles for ~0.6s
  // after the button-hold burst. JS sets it to 1.0 on burst, decays
  // each frame. Decoupled from phase logic since the entry happens
  // entirely within INITIAL_DRIFT.
  const entryBurstU    = uniform(0);
  // Dissolve variety: each cycle picks a different mode + seed so
  // successive dissolves don't look identical.
  const dissolveMode   = uniform(0, 'int');
  const dissolveSeedU  = uniform(0);

  const TEX_W_NODE = int(TEX_W);

  const updateCompute = Fn(() => {
    const pos = positionBuffer.element(instanceIndex);
    const vel = velocityBuffer.element(instanceIndex);
    const home = homeBuffer.element(instanceIndex);

    // Sample target from texture by (i % W, i / W)
    const ix = instanceIndex.modInt(TEX_W_NODE);
    const iy = instanceIndex.div(TEX_W_NODE);
    const tgt = textureLoad(targetTexture, ivec2(ix, iy));   // vec4

    // Position-coherent curl flow: gentle large-scale eddies. On its own
    // this reads as a flock — neighbors move together — so we keep it weak
    // and layer per-particle thermal jitter on top.
    const t = uTime.mul(0.25);
    const ns = float(0.45);
    const a = mx_noise_vec3(pos.mul(ns).add(vec3(t, 1.7, 4.1)));
    const b = mx_noise_vec3(pos.mul(ns).add(vec3(11.3, t, 7.7)));
    const curlForce = a.cross(b).mul(0.30);

    // Per-particle thermal jitter. Sampling Perlin noise at a per-instance
    // seed gives each particle its own independently-evolving direction.
    // Amplitude 1.8 + faster time evolution means particles never really
    // come to rest — they perpetually shift directions, keeping the field
    // visually alive even after the post-DISSOLVE explosion damps out.
    const fi = float(instanceIndex);
    const thermalSeed = vec3(
      fi.mul(0.013).add(uTime.mul(0.55)),
      fi.mul(0.027).add(uTime.mul(0.58)),
      fi.mul(0.041).add(uTime.mul(0.52)),
    );
    const thermalForce = mx_noise_vec3(thermalSeed).mul(1.8);

    // Cursor susceptibility — only ~30% of particles respond to the
    // cursor at any given moment, with the susceptibility rotating over
    // time. Caps the maximum number of particles the cursor can grab so
    // it reads as a swarm following the cursor instead of a black hole
    // consuming the entire field.
    const susceptibility = hash(fi.mul(0.0173).add(uTime.mul(0.40)));
    const attractMask = smoothstep(float(0.65), float(0.75), susceptibility);

    // Per-particle cursor polarity — 50/50 attract vs repel, persistent
    // identity. Half the susceptible particles flock toward the cursor
    // (attractors), the other half flee from it (repellers), so moving
    // the cursor through the field opens a void at the same time as it
    // gathers a swarm.
    const cursorPolarity = step(float(0.5), hash(fi.mul(0.0231))).mul(2).sub(1);
    const cursorPullScale = float(3.0).add(cursorEnergyU.mul(4.5));

    // Local interaction pulse — fired by click/tap. It kicks nearby
    // particles outward with a little tangential spin, so a tap feels
    // like disturbing the signal rather than pressing a UI button.
    const toImpulse = pos.sub(impulseWorld);
    const impulseDist = tslMax(length(toImpulse), float(0.001));
    const impulseNear = smoothstep(float(1.45), float(0.05), impulseDist);
    const impulseCore = smoothstep(float(0.0), float(0.18), impulseDist);
    const impulseDir = toImpulse.div(impulseDist);
    const impulseTan = normalize(vec3(toImpulse.y.negate(), toImpulse.x, float(0)));
    const impulseHash = hash(fi.mul(0.097).add(impulseSeedU.mul(0.311)));
    const lobeAngle = impulseSeedU.mul(2.371);
    const lobeDir = vec3(cos(lobeAngle), sin(lobeAngle), float(0));
    const lobe = smoothstep(float(-0.65), float(0.9), impulseDir.dot(lobeDir));
    const jitterSeed = vec3(
      fi.mul(0.181).add(impulseSeedU.mul(0.17)),
      fi.mul(0.293).add(impulseSeedU.mul(0.23)),
      fi.mul(0.417).add(impulseSeedU.mul(0.31)),
    );
    const impulseJitter = mx_noise_vec3(jitterSeed);
    const impulseGate = smoothstep(float(0.22), float(0.92), impulseHash);
    const impulseEnv = impulseNear.mul(impulseCore).mul(impulseLevelU).mul(mix(float(0.25), float(1.25), lobe)).mul(impulseGate);
    const impulseForce = normalize(impulseDir.mul(0.55).add(impulseTan.mul(0.28)).add(impulseJitter.mul(1.15)))
      .mul(impulseEnv.mul(20.0));

    // Very soft centering — barely a tug, just enough to keep the field
    // on screen over long sessions.
    const center = pos.mul(-0.025);

    const newPos = pos.toVar();
    const newVel = vel.toVar();
    const newBlend = float(0).toVar();

    If(phaseIdx.equal(int(PHASE.GATHER)), () => {
      // Variable-duration convergence: ALL particles finish at exactly
      // phaseProgress=1.0, with staggered start times based on globalT.
      // Cubic ease-in (c³) concentrates the actual landing in the last
      // ~15% of each particle's window — at c=0.8 a particle is only
      // 51% blended toward target. This keeps the glyph reading as
      // in-progress until the very end of GATHER, lands as a single
      // coordinated moment at 100%.
      const startT = tgt.w.mul(float(0.70));
      const span = tslMax(oneMinus(startT), float(0.001));
      const c = saturate(phaseProgress.sub(startT).div(span));
      const eased = c.mul(c).mul(c);   // cubic ease-in

      const toMouse = mouseWorld.sub(pos);
      const dist = tslMax(length(toMouse), float(0.001));
      const innerFade = smoothstep(float(0.0), float(0.30), dist);
      const outerFade = smoothstep(float(2.0), float(0.40), dist);
      const pull = innerFade.mul(outerFade).mul(attractMask).mul(cursorPullScale).mul(0.45);
      const attractForce = toMouse.div(dist).mul(pull).mul(cursorPolarity);

      const force = curlForce.add(thermalForce).add(center).add(attractForce).add(impulseForce.mul(0.55));
      const driftedVel = vel.mul(0.93).add(force.mul(dtUniform));
      const driftedPos = pos.add(driftedVel.mul(dtUniform));

      newPos.assign(mix(driftedPos, tgt.xyz, eased));
      newVel.assign(driftedVel.mul(oneMinus(eased)));
      newBlend.assign(eased);
    }).ElseIf(phaseIdx.equal(int(PHASE.HOLD)), () => {
      const breathe = sin(uTime.mul(1.5)).mul(0.0008);
      newPos.assign(tgt.xyz.add(tgt.xyz.mul(breathe)).add(impulseForce.mul(0.0025)));
      newVel.assign(vec3(0));
      newBlend.assign(float(1));
    }).ElseIf(phaseIdx.equal(int(PHASE.DISSOLVE)), () => {
      // Per-particle stagger: each particle starts its own burst at a
      // different moment within the phase (0..0.65 of dissolve), with a
      // 0.4-wide active window. Spreads release across all 4 seconds so
      // there's continuous eruption activity instead of one synchronized
      // whoosh at progress=0 that fades to nothing by 96%.
      const fiD = float(instanceIndex);
      const dStart = hash(fiD.mul(0.0297).add(dissolveSeedU.mul(0.013))).mul(0.65);
      const dSpan  = float(0.40);
      const cD     = saturate(phaseProgress.sub(dStart).div(dSpan));
      const burst  = oneMinus(cD).mul(oneMinus(cD));

      // Sparks — ~5% of particles get a much bigger kick. They read as
      // comets streaking through the dispersing cloud.
      const sparkSeed  = hash(fiD.mul(0.0911).add(dissolveSeedU.mul(0.07)));
      const sparkBoost = float(1).add(step(float(0.95), sparkSeed).mul(1.8));

      const dissolveForce = vec3(0, 0, 0).toVar();

      If(dissolveMode.equal(int(0)), () => {
        // Shockwave — radial burst with a position-dependent swirl, so
        // the wave isn't a clean sphere. Per-particle stagger gives the
        // wavefront a propagation feel.
        const radial = normalize(pos);
        const tan    = normalize(vec3(pos.y.negate(), pos.x, float(0)));
        const swirl  = sin(length(pos).mul(3.0).add(dissolveSeedU.mul(0.5)));
        dissolveForce.assign(radial.mul(burst.mul(4.5)).add(tan.mul(burst.mul(swirl).mul(2.2))));
      }).ElseIf(dissolveMode.equal(int(1)), () => {
        // Implode-explode — pull inward for first ~30% of the phase, then
        // a dramatic outward burst. The "winding up before release" gives
        // the dissolve a clear arc instead of just dispersing.
        const implodeMask = oneMinus(smoothstep(float(0.20), float(0.32), phaseProgress));
        const explodeMask = smoothstep(float(0.28), float(0.42), phaseProgress);
        const explodeEnv  = oneMinus(phaseProgress).mul(oneMinus(phaseProgress));
        const inward      = normalize(pos).mul(implodeMask).mul(-2.5);
        const outward     = normalize(pos).mul(explodeEnv.mul(explodeMask).mul(7.5));
        dissolveForce.assign(inward.add(outward));
      }).ElseIf(dissolveMode.equal(int(2)), () => {
        // Tear — split along a per-cycle randomized axis. Each half flies
        // in its assigned direction; perpendicular fan-out makes the two
        // halves spread like ripped paper, not collapse into two lines.
        const angle = dissolveSeedU.mul(0.31);
        const axisX = sin(angle);
        const axisY = cos(angle);
        const proj  = pos.x.mul(axisX).add(pos.y.mul(axisY));
        const sgn   = step(float(0), proj).mul(2).sub(1);
        const splitDir = vec3(axisX.mul(sgn), axisY.mul(sgn), float(0));
        const perpProj = pos.x.mul(axisY.negate()).add(pos.y.mul(axisX));
        const perpSgn  = step(float(0), perpProj).mul(2).sub(1);
        const fan = vec3(axisY.negate().mul(perpSgn), axisX.mul(perpSgn), float(0));
        dissolveForce.assign(splitDir.mul(burst.mul(4.0)).add(fan.mul(burst.mul(1.8))));
      }).Else(() => {
        // Swarm-helical — particles grouped into ~30 swarms at 18k
        // (~600 each), each flying in its own direction with a tangential
        // spiral. Reads as chunks of the glyph leaving in formation.
        const clusterId = fiD.div(float(600)).floor();
        const cs = clusterId.mul(0.3171).add(dissolveSeedU.mul(0.08));
        const cx = sin(cs.mul(2.7));
        const cy = cos(cs.mul(3.1));
        const cz = sin(cs.mul(1.9)).mul(0.5);
        const dir = normalize(vec3(cx, cy, cz));
        const tan = normalize(vec3(cy.negate(), cx, float(0)));
        dissolveForce.assign(dir.mul(burst.mul(3.5)).add(tan.mul(burst.mul(2.0))));
      });

      dissolveForce.assign(dissolveForce.mul(sparkBoost));

      // Attraction: same orbit-not-collapse profile as DRIFT, with per-
      // particle polarity flipping ~half into repellers.
      const toMouse = mouseWorld.sub(pos);
      const dist = tslMax(length(toMouse), float(0.001));
      const innerFade = smoothstep(float(0.0), float(0.30), dist);
      const outerFade = smoothstep(float(2.0), float(0.40), dist);
      const pull = innerFade.mul(outerFade).mul(attractMask).mul(cursorPullScale);
      const attractForce = toMouse.div(dist).mul(pull).mul(cursorPolarity);

      // Boosted thermal during dissolve — the dispersing field shimmers
      // instead of flying in clean straight lines.
      const thermalBoost = thermalForce.mul(1.4);

      const force = curlForce.add(thermalBoost).add(center).add(dissolveForce).add(attractForce).add(impulseForce);
      const v = vel.mul(0.95).add(force.mul(dtUniform));
      newVel.assign(v);
      newPos.assign(pos.add(v.mul(dtUniform)));
      newBlend.assign(oneMinus(phaseProgress));
    }).Else(() => {
      // DRIFT — curl + per-particle jitter + homeward pull + cursor.
      // Attraction profile peaks at ~0.4 world units and falls to zero
      // at the very centre — particles orbit/swirl around the cursor
      // instead of collapsing into a single point. Susceptibility mask
      // gates only ~30% in the swarm at a time. Homeward force pulls
      // each particle gently toward its spawn position so the field
      // organically returns to its initial dispersed state after each
      // cycle, replacing what used to be a generic centering pull.
      const toMouse = mouseWorld.sub(pos);
      const dist = tslMax(length(toMouse), float(0.001));
      const innerFade = smoothstep(float(0.0), float(0.30), dist);
      const outerFade = smoothstep(float(2.0), float(0.40), dist);
      const pull = innerFade.mul(outerFade).mul(attractMask).mul(cursorPullScale);
      const attractForce = toMouse.div(dist).mul(pull).mul(cursorPolarity);

      const homeForce = home.sub(pos).mul(0.10);

      // Entry burst — outward kick during the first ~0.6s after the
      // button-hold bursts. Direction is radial *plus* a strong
      // per-particle Perlin noise vector, so the wavefront isn't a
      // clean sphere — it reads as turbulent plasma exploding rather
      // than a geometric shell expanding.
      const burstNoiseSeed = vec3(
        fi.mul(0.131).add(uTime.mul(0.40)),
        fi.mul(0.273).add(uTime.mul(0.45)),
        fi.mul(0.419).add(uTime.mul(0.38)),
      );
      const burstNoise = mx_noise_vec3(burstNoiseSeed);
      const entryBurstDir = normalize(normalize(pos).add(burstNoise.mul(1.4)));
      const entryBurstForce = entryBurstDir.mul(entryBurstU.mul(10.0));

      const force = curlForce.add(thermalForce).add(homeForce).add(attractForce).add(entryBurstForce).add(impulseForce);
      const v = vel.mul(0.93).add(force.mul(dtUniform));
      newVel.assign(v);
      newPos.assign(pos.add(v.mul(dtUniform)));
    });

    pos.assign(newPos);
    vel.assign(newVel);
    colorBlendBuffer.element(instanceIndex).assign(newBlend);
  })().compute(count);

  // ── Render: instanced billboards ────────────────────────────────
  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.positionNode = positionBuffer.toAttribute();

  const d = length(uv().sub(0.5)).mul(2.0);
  const alpha = smoothstep(1.0, 0.0, d).pow(1.6);
  // Color: cyan-white phosphor in DRIFT; once the message lands, each
  // particle takes on one of three theme accents — phosphor, sodium
  // orange, or magenta — chosen by per-particle hash. The logogram
  // becomes a multi-color tapestry instead of a uniform tint, giving
  // the formed glyph individual character.
  const phosphor = color(0xA8DCFF);
  const sodium   = color(0xFF7B1C);
  const magenta  = color(0xE04085);
  const amber    = color(0xFFB347);

  const colorSeed = hash(float(instanceIndex).mul(0.0379));
  // Distribution: ~55% phosphor, ~25% sodium, ~12% magenta, ~8% amber.
  const t1 = step(float(0.55), colorSeed);
  const t2 = step(float(0.80), colorSeed);
  const t3 = step(float(0.92), colorSeed);
  const targetColor = mix(mix(mix(phosphor, sodium, t1), magenta, t2), amber, t3);

  // Per-particle color blend — read from the float buffer that the
  // compute kernel writes each frame. Particles still drifting (eased=0)
  // stay phosphor; particles converging tint progressively; HOLD locks
  // tint at 1; DISSOLVE fades back uniformly.
  const perParticleBlend = colorBlendBuffer.toAttribute();
  const tinted = mix(phosphor, targetColor, perParticleBlend);
  material.colorNode   = tinted.mul(float(1.0).add(landingPulseU.mul(0.25)));
  material.opacityNode = alpha.mul(float(0.55).add(landingPulseU.mul(0.10)));
  material.scaleNode   = float(0.012);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;

  // ── Cursor cluster ──────────────────────────────────────────────
  // 28 sodium-orange particles in a tight, time-varying orbit around the
  // mouse. Always visible — decoupled from phase logic so the cursor never
  // disappears when the main field locks during HOLD.
  const CURSOR_N = 28;
  const cursorBuffer = instancedArray(CURSOR_N, 'vec3');

  const cursorInitCompute = Fn(() => {
    cursorBuffer.element(instanceIndex).assign(vec3(0));
  })().compute(CURSOR_N);

  const cursorUpdateCompute = Fn(() => {
    const i = instanceIndex;
    const fi = float(i);
    // Per-particle orbit phase + radius. Slight radius variance gives the
    // cluster a soft, breathing edge rather than a hard ring.
    const phase = fi.mul(0.45).add(uTime.mul(2.4));
    const radius = float(0.030).add(sin(fi.mul(0.7).add(uTime.mul(1.1))).mul(0.012));
    const offset = vec3(
      cos(phase).mul(radius),
      sin(phase).mul(radius),
      float(0),
    );
    cursorBuffer.element(i).assign(mouseWorld.add(offset));
  })().compute(CURSOR_N);

  const cursorMaterial = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  cursorMaterial.positionNode = cursorBuffer.toAttribute();
  const cd = length(uv().sub(0.5)).mul(2.0);
  const cursorAlpha = smoothstep(1.0, 0.0, cd).pow(1.4);
  cursorMaterial.colorNode   = color(0xFF7B1C);  // sodium-vapor orange
  cursorMaterial.opacityNode = cursorAlpha.mul(0.85);
  cursorMaterial.scaleNode   = float(0.022);

  const cursorMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    cursorMaterial,
    CURSOR_N,
  );
  cursorMesh.frustumCulled = false;

  // ── CPU-side methods ────────────────────────────────────────────
  function uploadTargets(arr) {
    for (let i = 0; i < count; i++) {
      const t = arr[i];
      targetData[i * 4]     = t.x;
      targetData[i * 4 + 1] = t.y;
      targetData[i * 4 + 2] = t.z;
      targetData[i * 4 + 3] = t.globalT;
    }
    targetTexture.needsUpdate = true;
  }

  return {
    mesh,
    cursorMesh,
    initCompute,
    updateCompute,
    cursorInitCompute,
    cursorUpdateCompute,
    uploadTargets,
    setPhase(idx, progress) {
      phaseIdx.value = idx;
      phaseProgress.value = progress;
    },
    setDt(dt) { dtUniform.value = dt; },
    setMouseWorld(x, y, z = 0) { mouseWorld.value.set(x, y, z); },
    setCursorEnergy(v) { cursorEnergyU.value = v; },
    setImpulse(x, y, z = 0, level = 0, seed = 0) {
      impulseWorld.value.set(x, y, z);
      impulseLevelU.value = level;
      impulseSeedU.value = seed;
    },
    setLandingPulse(v) { landingPulseU.value = v; },
    setEntryBurst(v)   { entryBurstU.value = v; },
    setDissolveMode(mode, seed) {
      dissolveMode.value = mode;
      dissolveSeedU.value = seed;
    },
    count,
  };
}
