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
//   3. One or more glyphs from the abstract/runic vocabulary.
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

const NAME_PREFIX = [
  'salt', 'low', 'blind', 'slow', 'hollow', 'warm', 'red', 'thin',
  'buried', 'static', 'inner', 'false', 'third', 'cold', 'bright',
  'mute', 'open', 'ash', 'silver', 'broken', 'late', 'black',
  'soft', 'remote', 'left', 'unlit', 'narrow', 'old',
];

const NAME_NOUN = [
  'mirror', 'interval', 'vessel', 'threshold', 'witness', 'signal',
  'root', 'weather', 'mouth', 'glyph', 'archive', 'pulse', 'door',
  'thread', 'stone', 'echo', 'axis', 'field', 'shell', 'orbit',
  'fault', 'index', 'coil', 'tablet', 'room', 'breath', 'mark',
];

const NAME_FORM = {
  single:        ['fragment', 'mark', 'index'],
  compound:      ['pair', 'hinge', 'argument'],
  stack:         ['stack', 'ledger', 'descent'],
  triplet:       ['triad', 'count', 'witness'],
  orbited:       ['orbit', 'halo', 'satellite'],
  framed:        ['seal', 'window', 'border'],
  constellation: ['map', 'weather', 'field'],
  cartouche:     ['tablet', 'vessel', 'chamber'],
  mirror:        ['mirror', 'return', 'echo'],
};

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function nameTransmission(seed, moodName, pattern) {
  const rng = makeRng((seed ^ 0x9E3779B9) >>> 0);
  const prefix = pick(NAME_PREFIX, rng);
  const noun = rng() < 0.72
    ? pick(NAME_NOUN, rng)
    : pick(NAME_FORM[pattern] || NAME_NOUN, rng);

  // Rarely let the mood leak into the name, but keep it restrained.
  if (rng() < 0.16) {
    const moodWord = {
      calm: 'still',
      bold: 'heavy',
      shouting: 'loud',
      whispering: 'faint',
      sharp: 'cut',
      playful: 'restless',
      mournful: 'low',
      fierce: 'hard',
    }[moodName];
    if (moodWord && moodWord !== prefix) return `${moodWord} ${noun}`;
  }

  return `${prefix} ${noun}`;
}

export function generateLogogram(seed) {
  const rng = makeRng(seed);
  const mood = pickMood(rng);
  const { pattern, elements } = composeLogogram(rng, mood);
  const moody = applyMoodThickness(elements, mood.thickScale);
  const dressed = applyDressing(rng, moody, mood);
  const name = nameTransmission(seed, mood.name, pattern);
  return { seed, name, mood: mood.name, pattern, elements: dressed };
}
