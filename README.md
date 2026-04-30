# lamba.sh

Procedural logograms forming and dissolving in a cathode-archive void. *Arrival* on the brain. WebGPU + Three.js + Web Audio, built with Bun.

## Run

```sh
bun install
bun run dev          # http://localhost:3000
bun run build        # → ./dist
```

WebGPU primary, automatic WebGL2 fallback via Three.js's `WebGPURenderer`. Same scene, same compute, same audio on both backends.

## Layout

```
src/
├── main.js              bootstrap, phase clock, post-process pipeline,
│                        audio scheduling, hint UI, frame loop
├── audio/audio.js       Web Audio synth: drone, brush, bell, hold tone
├── core/util.js         clamp, makeRng (mulberry32), sharpJitter
├── render/particles.js  GPU-resident particle system
└── scene/
    ├── logograms.js     procedural glyph generator
    └── targets.js       per-particle target precomputation
```

## Cycle

| Phase           | Duration | What happens                                            |
| --------------- | -------- | ------------------------------------------------------- |
| `INITIAL_DRIFT` |   6.0s   | curl + thermal jitter, particles roam                   |
| `GATHER`        |   8.0s   | every particle lands at exactly `phaseProgress=1.0`     |
| `HOLD`          |   4.0s   | glyph locked, breathing, sodium-orange tint             |
| `DISSOLVE`      |   4.0s   | one of four release modes, front-loaded burst envelope  |
| `DRIFT`         |  10.0s   | homeward pull restores the initial dispersed state      |

Each new GATHER picks a fresh logogram seed and dissolve mode. Bell pitch rotates through a pentatonic across cycles, so the cycle never rings the same note twice in a row.

## Architecture

Particle state lives on the GPU. Nothing copies back to JS per frame.

| Buffer       | Type                     | Notes                                                    |
| ------------ | ------------------------ | -------------------------------------------------------- |
| `position`   | vec3 storage             | written by compute kernel each frame                     |
| `velocity`   | vec3 storage             | written by compute kernel each frame                     |
| `home`       | vec3 storage             | spawn position; homeward pull during DRIFT               |
| `colorBlend` | float storage            | per-particle accent blend, follows convergence state     |
| `target`     | RGBA32F `DataTexture`    | CPU-written per cycle, sampled by `instanceIndex`        |

`target` is a texture rather than a storage buffer because Three.js's WebGL2 compute emulation can't reliably re-upload storage buffers from CPU.

Convergence is variable-duration. Every particle finishes at `phaseProgress=1.0`, but each starts at a staggered time based on `globalT`. Cubic ease-in keeps the visual reading "in motion" until the very end of GATHER, so the bell, brightness pulse, and color punch all land as one perceived moment.

Each cycle picks one of four dissolve modes:

- `radial`, outward push from origin
- `vortex`, outward + tangential rotation
- `wind`, whole field pushed in one direction
- `cluster`, ~500 groups of ~120 particles each moving as a unit

Mouse interaction uses a rotating susceptibility mask. Only ~30% of nearby particles respond to the cursor at any moment, with the chosen 30% rotating over time. Attraction peaks at ~0.4 world units and falls to zero at the very centre, so particles orbit the cursor rather than collapse into it.

The bell is pre-scheduled at `audioContext.currentTime + GATHER_DURATION` at GATHER start, so it lands with the visual completion regardless of frame jitter.

## Glyph generator

Vocabulary of shape primitives:

- Lines and curves: rings (closed, broken), nested arcs, crescents, hooks, tongues, chords, arches, spokes, accents, ticks, satellites
- Polygons: triangle, square, pentagon, hexagon, octagon, rectangle
- Discs: eyelets, drips, splats

Archetypes select coherent subsets: `eye`, `vessel`, `compass`, `beacon`, `constellation`, `halo`, `geometric`, `splatter`, and a few more. Each glyph picks one archetype, then gets a dressing pass on top: edge ticks, scattered interior dots, an optional outer accent. A per-glyph mood scales stroke thickness so some symbols read quiet and faint, others bold.

## Colors

| Role                          | Hex       | Particle mix |
| ----------------------------- | --------- | ------------ |
| Background (cathode archive)  | `#0A1828` | —            |
| Phosphor (default)            | `#A8DCFF` | ~55%         |
| Sodium-vapor (cursor, accent) | `#FF7B1C` | ~25%         |
| Magenta (rare)                | `#E04085` | ~12%         |
| Amber (rare)                  | `#FFB347` | ~8%          |

Per-particle hash assigns each particle one accent. The accent emerges progressively as the particle converges, so a formed glyph carries a mix of warm and cool dots rather than a single tint.

## On-screen text

| Position      | Text                              | Behavior                                       |
| ------------- | --------------------------------- | ---------------------------------------------- |
| top-left      | "tap anywhere for sound"          | shows 2s after load, hides on audio unlock     |
| bottom-center | "move your cursor"                | shows after 10s idle during DRIFT              |
| bottom-right  | "the message hasn't arrived yet"  | always visible                                 |
| bottom-left   | GitHub icon                       | opens this repo, brief click animation         |

## Accessibility

`prefers-reduced-motion` is respected: audio is skipped, the CA spike and brightness pulse are pinned to zero.
