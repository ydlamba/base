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

  // ── Init: random spawn, zero velocity ───────────────────────────
  const initCompute = Fn(() => {
    const pos = positionBuffer.element(instanceIndex);
    const vel = velocityBuffer.element(instanceIndex);
    const home = homeBuffer.element(instanceIndex);

    const seed = float(instanceIndex).mul(0.0137);
    const h1 = hash(seed.add(7.13));
    const h2 = hash(seed.add(31.7));
    const h3 = hash(seed.add(83.9));
    const h4 = hash(seed.add(157.3));

    // Wider, non-uniform spawn — particles spread across most of the
    // visible field at start, not clustered in a small sphere. baseR
    // gives uniform-by-volume distribution out to 2.5 units; mixing in
    // a wider random radius pushes ~half of particles further out so
    // the initial state reads as a dispersed cloud, not a clump.
    const cosT = h2.mul(2).sub(1);
    const sinT = tslSqrt(cosT.mul(-1).add(1).mul(cosT.add(1)));
    const phi  = h3.mul(6.2831853);
    const baseR = tslPow(h1, float(1.0 / 3.0)).mul(2.5);
    const noisyR = mix(baseR, h4.mul(4.0), float(0.50));

    const spawn = vec3(
      sinT.mul(cos(phi)).mul(noisyR),
      sinT.mul(sin(phi)).mul(noisyR),
      cosT.mul(noisyR),
    );
    pos.assign(spawn);
    home.assign(spawn);  // remember this for homeward pull during DRIFT
    // Strong random initial velocity — each particle starts in motion in
    // its own direction, so the field reads as alive and individuated
    // from frame 1 instead of waiting for curl/thermal to build it up.
    const v1 = hash(seed.add(101.7)).sub(0.5).mul(1.4);
    const v2 = hash(seed.add(211.3)).sub(0.5).mul(1.4);
    const v3 = hash(seed.add(331.9)).sub(0.5).mul(1.4);
    vel.assign(vec3(v1, v2, v3));
  })().compute(count);

  // ── Update kernel ───────────────────────────────────────────────
  const phaseIdx       = uniform(0, 'int');
  const phaseProgress  = uniform(0);
  const dtUniform      = uniform(1 / 60);
  const mouseWorld     = uniform(new THREE.Vector3());
  const landingPulseU  = uniform(0);                // 0..1 — subtle flash
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

      const force = curlForce.add(thermalForce).add(center);
      const driftedVel = vel.mul(0.93).add(force.mul(dtUniform));
      const driftedPos = pos.add(driftedVel.mul(dtUniform));

      newPos.assign(mix(driftedPos, tgt.xyz, eased));
      newVel.assign(driftedVel.mul(oneMinus(eased)));
      newBlend.assign(eased);
    }).ElseIf(phaseIdx.equal(int(PHASE.HOLD)), () => {
      const breathe = sin(uTime.mul(1.5)).mul(0.0008);
      newPos.assign(tgt.xyz.add(tgt.xyz.mul(breathe)));
      newVel.assign(vec3(0));
      newBlend.assign(float(1));
    }).ElseIf(phaseIdx.equal(int(PHASE.DISSOLVE)), () => {
      // Front-loaded burst envelope — sharp kick at DISSOLVE start that
      // fades over the phase. The DIRECTION of the kick depends on which
      // dissolve mode this cycle rolled, so successive dissolves look
      // different: radial burst, vortex spin, directional wind, or a
      // shatter into co-moving clusters.
      const burst = oneMinus(phaseProgress).mul(oneMinus(phaseProgress));
      const dissolveForce = vec3(0, 0, 0).toVar();
      const fi = float(instanceIndex);

      If(dissolveMode.equal(int(0)), () => {
        // Radial burst — push outward from origin.
        dissolveForce.assign(normalize(pos).mul(burst.mul(3.5)));
      }).ElseIf(dissolveMode.equal(int(1)), () => {
        // Vortex — outward + tangential rotation around z-axis.
        const radial = normalize(pos).mul(burst.mul(2.0));
        const tangent = vec3(pos.y.negate(), pos.x, float(0));
        const spin = normalize(tangent).mul(burst.mul(2.8));
        dissolveForce.assign(radial.add(spin));
      }).ElseIf(dissolveMode.equal(int(2)), () => {
        // Directional wind — everyone pushed the same way (per-cycle direction).
        const wx = sin(dissolveSeedU.mul(2.7));
        const wy = cos(dissolveSeedU.mul(3.1));
        const wz = sin(dissolveSeedU.mul(1.9)).mul(0.3);
        const wind = normalize(vec3(wx, wy, wz));
        dissolveForce.assign(wind.mul(burst.mul(3.5)));
      }).Else(() => {
        // Cluster shatter — particles group by instance index (~120 per
        // cluster at 60k). Each cluster gets a unique direction so chunks
        // of particles flow as units instead of dispersing as individuals.
        const clusterId = fi.div(float(120)).floor();
        const cs = clusterId.mul(0.0731).add(dissolveSeedU.mul(11.3));
        const cx = sin(cs.mul(2.7));
        const cy = cos(cs.mul(3.1));
        const cz = sin(cs.mul(1.9)).mul(0.4);
        const clusterDir = normalize(vec3(cx, cy, cz));
        dissolveForce.assign(clusterDir.mul(burst.mul(3.0)));
      });

      // Attraction: same orbit-not-collapse profile as DRIFT.
      const toMouse = mouseWorld.sub(pos);
      const dist = tslMax(length(toMouse), float(0.001));
      const innerFade = smoothstep(float(0.0), float(0.30), dist);
      const outerFade = smoothstep(float(2.0), float(0.40), dist);
      const pull = innerFade.mul(outerFade).mul(attractMask).mul(3.5);
      const attractForce = toMouse.div(dist).mul(pull);

      const force = curlForce.add(thermalForce).add(center).add(dissolveForce).add(attractForce);
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
      const pull = innerFade.mul(outerFade).mul(attractMask).mul(3.5);
      const attractForce = toMouse.div(dist).mul(pull);

      const homeForce = home.sub(pos).mul(0.10);

      const force = curlForce.add(thermalForce).add(homeForce).add(attractForce);
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
    setLandingPulse(v) { landingPulseU.value = v; },
    setDissolveMode(mode, seed) {
      dissolveMode.value = mode;
      dissolveSeedU.value = seed;
    },
    count,
  };
}
