// ────────────────────────────────────────────────────────────────
// Post-pass decoration. Adds scattered dots, edge accents, tick
// marks, and small flourishes on top of the composed glyph so no
// logogram reads as bare. Dressing intensity scales with mood,
// and certain moods (mournful, playful, fierce, whispering) get
// signature flourishes that read as their own emotional gesture.
// ────────────────────────────────────────────────────────────────

import { disc, strokeLine, strokeFromFn, strokePolyline } from './primitives.js';

export function applyDressing(rng, elements, mood) {
  const intensity = mood.dressing;
  const out = [...elements];

  // Scattered interior dots.
  const dotCount = Math.floor(intensity * (2 + rng() * 4));
  for (let i = 0; i < dotCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.55;
    out.push(disc(Math.cos(a) * r, Math.sin(a) * r, 0.008 + rng() * 0.012));
  }

  // Outer edge dots.
  if (rng() < intensity * 0.6) {
    const N = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2;
      const r = 0.65 + rng() * 0.10;
      out.push(disc(Math.cos(a) * r, Math.sin(a) * r, 0.008 + rng() * 0.010));
    }
  }

  // Radial tick marks.
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

  // ── Mood-signature flourishes ─────────────────────────────────

  // Mournful — drips falling beneath the glyph.
  if (mood.name === 'mournful' && rng() < 0.75) {
    const N = 2 + Math.floor(rng() * 3);
    const startX = (rng() - 0.5) * 0.50;
    for (let i = 0; i < N; i++) {
      const x = startX + (rng() - 0.5) * 0.20;
      const y = -0.55 - i * 0.10 - rng() * 0.05;
      out.push(disc(x, y, 0.020 - i * 0.004));
    }
  }

  // Playful — bubbles floating around the glyph.
  if (mood.name === 'playful' && rng() < 0.75) {
    const N = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < N; i++) {
      const a  = rng() * Math.PI * 2;
      const r  = 0.70 + rng() * 0.12;
      const cx = Math.cos(a) * r, cy = Math.sin(a) * r;
      const cr = 0.025 + rng() * 0.020;
      out.push(strokeFromFn(28,
        (t) => {
          const ang = t * Math.PI * 2;
          return { x: cx + Math.cos(ang) * cr, y: cy + Math.sin(ang) * cr };
        },
        () => 0.010,
      ));
    }
  }

  // Fierce — jagged spikes radiating outward.
  if (mood.name === 'fierce' && rng() < 0.75) {
    const N = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2;
      const r1 = 0.62 + rng() * 0.04;
      const r2 = 0.86 + rng() * 0.10;
      const mid = (r1 + r2) / 2;
      const sideA = a + 0.04;
      const sideB = a - 0.04;
      out.push(strokePolyline([
        { x: Math.cos(a) * r1,    y: Math.sin(a) * r1 },
        { x: Math.cos(sideA) * mid, y: Math.sin(sideA) * mid },
        { x: Math.cos(a) * r2,    y: Math.sin(a) * r2 },
        { x: Math.cos(sideB) * mid, y: Math.sin(sideB) * mid },
        { x: Math.cos(a) * r1,    y: Math.sin(a) * r1 },
      ], 0.014));
    }
  }

  // Whispering — a faint dust of tiny dots in the outer field.
  if (mood.name === 'whispering' && rng() < 0.80) {
    const N = 8 + Math.floor(rng() * 6);
    for (let i = 0; i < N; i++) {
      const a = rng() * Math.PI * 2;
      const r = 0.65 + rng() * 0.20;
      out.push(disc(Math.cos(a) * r, Math.sin(a) * r, 0.005 + rng() * 0.005));
    }
  }

  // Bold — heavy underline beneath the glyph.
  if (mood.name === 'bold' && rng() < 0.40) {
    const w = 0.45 + rng() * 0.20;
    const y = -0.60 - rng() * 0.06;
    out.push(strokeLine(-w, y, w, y, 0.024));
  }

  // Shouting — extra outer ring of large punctuation.
  if (mood.name === 'shouting' && rng() < 0.55) {
    const N = 6 + Math.floor(rng() * 4);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rng() * 0.10;
      out.push(disc(Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0.014 + rng() * 0.008));
    }
  }

  return out;
}
