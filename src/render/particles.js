// ────────────────────────────────────────────────────────────────
// GPU-resident particle system with phase-driven convergence.
//
// Buffers:
//   position  (vec3 storage)  — current world position
//   velocity  (vec3 storage)  — drift velocity
//   start     (vec3 storage)  — captured at GATHER begin (lerp source)
//   target    (DataTexture)   — CPU-written, sampled by index in compute
//
// Why a texture for target: Three.js's WebGL2 fallback ping-pongs storage
// buffers as render targets, and a CPU-side `needsUpdate` doesn't reliably
// re-upload through that emulation path. Texture uploads are universally
// well-supported, so packing per-particle targets into an RGBA32F texture
// and fetching by `(instanceIndex % W, instanceIndex / W)` works
// identically on WebGPU and WebGL2.
// ────────────────────────────────────────────────────────────────

import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, instancedArray, uniform, time as uTime,
  vec3, vec4, ivec2, float, int, sin, cos, hash, mx_noise_vec3, color,
  length, smoothstep, uv, mix, saturate, If, oneMinus,
  pow as tslPow, sqrt as tslSqrt, normalize, textureLoad,
} from 'three/tsl';

export const PHASE = Object.freeze({
  DRIFT: 0,
  GATHER: 1,
  HOLD: 2,
  DISSOLVE: 3,
});

const CONV_DUR = 0.20;

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
  const startBuffer    = instancedArray(count, 'vec3');

  // ── Init: random spawn, zero velocity, start = pos ──────────────
  const initCompute = Fn(() => {
    const pos = positionBuffer.element(instanceIndex);
    const vel = velocityBuffer.element(instanceIndex);
    const start = startBuffer.element(instanceIndex);

    const seed = float(instanceIndex).mul(0.0137);
    const h1 = hash(seed.add(7.13));
    const h2 = hash(seed.add(31.7));
    const h3 = hash(seed.add(83.9));

    const cosT = h2.mul(2).sub(1);
    const sinT = tslSqrt(cosT.mul(-1).add(1).mul(cosT.add(1)));
    const phi  = h3.mul(6.2831853);
    const r    = tslPow(h1, float(1.0 / 3.0)).mul(1.4);

    pos.assign(vec3(
      sinT.mul(cos(phi)).mul(r),
      sinT.mul(sin(phi)).mul(r),
      cosT.mul(r),
    ));
    vel.assign(vec3(0));
    start.assign(pos);
  })().compute(count);

  // ── Capture-start: dispatched once per GATHER begin ─────────────
  const captureStartCompute = Fn(() => {
    startBuffer.element(instanceIndex).assign(
      positionBuffer.element(instanceIndex)
    );
  })().compute(count);

  // ── Update kernel ───────────────────────────────────────────────
  const phaseIdx      = uniform(0, 'int');
  const phaseProgress = uniform(0);
  const dtUniform     = uniform(1 / 60);

  const TEX_W_NODE = int(TEX_W);

  const updateCompute = Fn(() => {
    const pos = positionBuffer.element(instanceIndex);
    const vel = velocityBuffer.element(instanceIndex);
    const start = startBuffer.element(instanceIndex);

    // Sample target from texture by (i % W, i / W)
    const ix = instanceIndex.modInt(TEX_W_NODE);
    const iy = instanceIndex.div(TEX_W_NODE);
    const tgt = textureLoad(targetTexture, ivec2(ix, iy));   // vec4

    // Curl-ish flow
    const t = uTime.mul(0.18);
    const ns = float(0.55);
    const a = mx_noise_vec3(pos.mul(ns).add(vec3(t, 1.7, 4.1)));
    const b = mx_noise_vec3(pos.mul(ns).add(vec3(11.3, t, 7.7)));
    const curlForce = a.cross(b).mul(0.45);
    const center = pos.mul(-0.10);

    const newPos = pos.toVar();
    const newVel = vel.toVar();

    If(phaseIdx.equal(int(PHASE.GATHER)), () => {
      const startT = tgt.w.mul(oneMinus(CONV_DUR));
      const c = saturate(phaseProgress.sub(startT).div(CONV_DUR));
      const eased = oneMinus(oneMinus(c).pow(float(3)));
      newPos.assign(mix(start, tgt.xyz, eased));
      newVel.assign(vec3(0));
    }).ElseIf(phaseIdx.equal(int(PHASE.HOLD)), () => {
      const breathe = sin(uTime.mul(1.5)).mul(0.0008);
      newPos.assign(tgt.xyz.add(tgt.xyz.mul(breathe)));
      newVel.assign(vec3(0));
    }).ElseIf(phaseIdx.equal(int(PHASE.DISSOLVE)), () => {
      const outward = normalize(pos).mul(phaseProgress.mul(0.5));
      const v = vel.mul(0.96).add(curlForce.add(outward).add(center).mul(dtUniform));
      newVel.assign(v);
      newPos.assign(pos.add(v.mul(dtUniform)));
    }).Else(() => {
      const v = vel.mul(0.93).add(curlForce.add(center).mul(dtUniform));
      newVel.assign(v);
      newPos.assign(pos.add(v.mul(dtUniform)));
    });

    pos.assign(newPos);
    vel.assign(newVel);
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
  material.colorNode   = color(0xA8DCFF);
  material.opacityNode = alpha.mul(0.55);
  material.scaleNode   = float(0.012);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;

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
    initCompute,
    updateCompute,
    captureStartCompute,
    uploadTargets,
    setPhase(idx, progress) {
      phaseIdx.value = idx;
      phaseProgress.value = progress;
    },
    setDt(dt) { dtUniform.value = dt; },
    count,
  };
}
