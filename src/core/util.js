// ────────────────────────────────────────────────────────────────
// Small math + procedural-noise + matrix helpers.
// Pure functions, no side effects (except flowField which returns a shared scratch vec3).
// ────────────────────────────────────────────────────────────────

export const lerp     = (a, b, t) => a + (b - a) * t;
export const clamp    = (v, a, b) => v < a ? a : (v > b ? b : v);
export const clamp01  = v => v < 0 ? 0 : (v > 1 ? 1 : v);
export const smooth   = t => t * t * (3 - 2 * t);
export const easeOut  = t => 1 - Math.pow(1 - t, 3);

// Seeded PRNG (mulberry32). Use the same `seed` to regenerate identical logograms.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sign-preserved squared dist: triangular squared (t * |t|), very concentrated at 0.
// Returns value in [-1, 1] with steep peak at center → sharp brush centerline.
export function sharpJitter() {
  const t = Math.random() - Math.random();   // triangular [-1, 1]
  return t * Math.abs(t);
}

// ── Procedural noise ─────────────────────────────────────────────
// Integer hash. noise3 only ever calls this with integer coords, so we
// avoid Math.sin entirely — the sin-based `frac(sin(dot))` hash was eating
// >50% of CPU at 14k particles × 6 noise calls × 8 corners per frame.
// Math.imul keeps multiplications in signed-32-bit (no double promotion),
// and the final shift+mix gives a well-distributed [0, 1) float.
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 73856093)
        ^ Math.imul(y | 0, 19349663)
        ^ Math.imul(z | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h = h ^ (h >>> 15);
  return (h >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = hash3(ix, iy, iz);
  const c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz);
  const c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1);
  const c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1);
  const c111 = hash3(ix + 1, iy + 1, iz + 1);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0  = x00  + (x10 - x00)  * uy;
  const y1  = x01  + (x11 - x01)  * uy;
  return (y0 + (y1 - y0) * uz) - 0.5;
}

const FLOW_SCALE = 0.55;
const FLOW_STRENGTH = 0.30;
// Module-local scratch — flowField returns a reference to this object every call,
// so the caller reads `.vx/.vy/.vz` without allocating a new object per particle.
const _flow = { vx: 0, vy: 0, vz: 0 };
export function flowField(x, y, z, t) {
  const sx = x * FLOW_SCALE, sy = y * FLOW_SCALE, sz = z * FLOW_SCALE;
  const tt = t * 0.04;
  _flow.vx = (noise3(sy + 1.7,  sz + tt + 4.1, sx + 9.3) -
              noise3(sz + 5.3,  sx + 8.7,      sy + 1.1 + tt)) * FLOW_STRENGTH;
  _flow.vy = (noise3(sz + 11.7, sx + tt + 2.5, sy + 7.3) -
              noise3(sx + 3.9,  sy + 6.1,      sz + 13.4 + tt)) * FLOW_STRENGTH;
  _flow.vz = (noise3(sx + 9.1,  sy + tt + 4.7, sz + 17.7) -
              noise3(sy + 12.4, sz + 14.1,     sx + 2.2 + tt)) * FLOW_STRENGTH;
  return _flow;
}

// ── Matrix helpers (column-major, OpenGL convention) ────────────
export function lookAt(ex, ey, ez, tx, ty, tz, ux, uy, uz) {
  let zx = ex - tx, zy = ey - ty, zz = ez - tz;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xX = uy * zz - uz * zy;
  let xY = uz * zx - ux * zz;
  let xZ = ux * zy - uy * zx;
  const xl = Math.hypot(xX, xY, xZ) || 1;
  xX /= xl; xY /= xl; xZ /= xl;
  const yX = zy * xZ - zz * xY;
  const yY = zz * xX - zx * xZ;
  const yZ = zx * xY - zy * xX;
  return new Float32Array([
    xX, yX, zx, 0,
    xY, yY, zy, 0,
    xZ, yZ, zz, 0,
    -(xX*ex + xY*ey + xZ*ez),
    -(yX*ex + yY*ey + yZ*ez),
    -(zx*ex + zy*ey + zz*ez),
    1,
  ]);
}
export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}
export function mat4Mul(a, b) {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
    r[c * 4 + row] = s;
  }
  return r;
}
