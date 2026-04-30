// ────────────────────────────────────────────────────────────────
// Public entry point: generateLogogram(seed).
//
// One seeded utterance produces:
//   1. A mood (calm / bold / shouting / whispering / sharp /
//      playful / mournful / fierce). Mood biases vocabulary and
//      stroke thickness.
//   2. A composition pattern (single / compound / stack / triplet
//      / orbited / framed). Patterns control how the chosen
//      glyph(s) are arranged in the visible field.
//   3. One or more glyphs from the vocabulary (~40 entries:
//      pictographs and runic abstracts).
//   4. A dressing pass — interior dots, edge accents, ticks.
//
// Returns `{ seed, mood, pattern, elements }` where each element is
//   { type: 'stroke', points: [{x,y}], thickness: [number] }
//   { type: 'disc',   center: {x,y}, radius: number }
// consumed by scene/targets.js.
// ────────────────────────────────────────────────────────────────

import { makeRng } from '../../core/util.js';
import { pickMood, composeLogogram } from './grammar.js';
import { applyMoodThickness } from './primitives.js';
import { applyDressing } from './dressing.js';

export function generateLogogram(seed) {
  const rng = makeRng(seed);
  const mood = pickMood(rng);
  const { pattern, elements } = composeLogogram(rng, mood);
  const moody = applyMoodThickness(elements, mood.thickScale);
  const dressed = applyDressing(rng, moody, mood);
  return { seed, mood: mood.name, pattern, elements: dressed };
}
