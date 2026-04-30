// ────────────────────────────────────────────────────────────────
// Post-pass decoration. Adds scattered dots, edge accents, tick
// marks, and small flourishes on top of the composed glyph so no
// logogram reads as bare. Dressing intensity scales with mood.
// ────────────────────────────────────────────────────────────────

import { disc, strokeLine } from './primitives.js';

export function applyDressing(rng, elements, mood) {
  const intensity = mood.dressing;
  const out = [...elements];

  // Scattered interior dots — soft punctuation around the figure.
  const dotCount = Math.floor(intensity * (2 + rng() * 4));
  for (let i = 0; i < dotCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.55;
    out.push(disc(Math.cos(a) * r, Math.sin(a) * r, 0.008 + rng() * 0.012));
  }

  // Outer edge punctuation — small dots along the outer boundary.
  if (rng() < intensity * 0.6) {
    const N = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2;
      const r = 0.65 + rng() * 0.10;
      out.push(disc(Math.cos(a) * r, Math.sin(a) * r, 0.008 + rng() * 0.010));
    }
  }

  // Tick marks — short radial dashes near outer boundary.
  if (rng() < intensity * 0.5) {
    const N = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2;
      const r1 = 0.62 + rng() * 0.04;
      const r2 = r1 + 0.06 + rng() * 0.04;
      out.push(strokeLine(
        Math.cos(a) * r1, Math.sin(a) * r1,
        Math.cos(a) * r2, Math.sin(a) * r2,
        0.014,
      ));
    }
  }

  return out;
}
