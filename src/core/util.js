// ────────────────────────────────────────────────────────────────
// Small CPU-side helpers used by the logogram generator and target
// builder. Pure functions, no side effects.
// ────────────────────────────────────────────────────────────────

// Clamp v to [a, b].
export const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

// Seeded PRNG (mulberry32). Same `seed` regenerates the same logogram.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sign-preserved squared dist: triangular squared (t * |t|).
// Returns a value in [-1, 1] with a steep peak at zero — used for the
// brush-jitter perpendicular offset so particles concentrate near the
// stroke centerline.
export function sharpJitter() {
  const t = Math.random() - Math.random();   // triangular [-1, 1]
  return t * Math.abs(t);
}
