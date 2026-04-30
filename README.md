# lamba.sh

Procedural logograms forming and dissolving in a cathode-archive void.

This is a small signal machine. Hold to tune it, touch the field, and wait for something that nearly turns into language.

Built with Bun, Three.js WebGPU/WebGL2, GPU particles, and Web Audio.

## Run

```sh
bun install
bun run dev          # http://localhost:3000
bun run build        # ./dist
bun run serve        # http://localhost:8000
```

Add `?debug=1` to show backend, particle count, phase, and progress.

## Project Shape

```txt
src/
  main.js                 boot flow, phase clock, renderer, UI, frame loop
  render/particles.js     GPU particle simulation and cursor disturbance
  audio/audio.js          drone, charge, brush, bells, hold tones
  scene/targets.js        per-particle target building
  scene/logograms/        procedural glyph grammar and shape vocabulary
  core/util.js            shared helpers
```

## What Happens

The entry starts with a short tuning ritual. Once the hold completes, the field wakes up and starts cycling:

- `INITIAL_DRIFT`: particles settle from the entry burst.
- `GATHER`: a fresh logogram forms from a generated seed.
- `HOLD`: the glyph breathes in place.
- `DISSOLVE`: it releases through one of several dissolve modes.
- `DRIFT`: the field returns to a dispersed state.

Every cycle picks a new glyph, mood, sound pattern, bell pitch, and dissolve behavior. Mouse and touch input disturb the field visually without acting like buttons.

## Notes

Particle state stays on the GPU. Targets are uploaded as a float texture so the same scene can run through Three.js's WebGPU path or WebGL2 fallback.

Audio starts only after the entry gesture. `prefers-reduced-motion` is respected by skipping audio and heavy motion accents.

Deployed on Cloudflare Pages at [lamba.sh](https://lamba.sh).
