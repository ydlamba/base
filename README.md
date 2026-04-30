# lamba.sh

A placeholder for now. Heptapod-style logograms forming and dissolving in a cathode-archive void. *Arrival* on the brain. WebGL2, Web Audio, vanilla JS, no build step.

## Running it

ES modules need an HTTP origin, not `file://`:

```sh
python3 -m http.server 8000
# open http://127.0.0.1:8000
```

Any static host serves it as-is. Cloudflare Pages, Netlify, GitHub Pages, whatever.

## What's in here

```
index.html              HTML, CSS, entry tag
README.md               you're here
src/
├── main.js             Bootstrap, GL setup, mouse, hints, render loop
├── audio/
│   └── audio.js        Drone, brush, bell, hold tone
├── core/
│   └── util.js         Math, RNG, curl noise, matrix helpers
├── render/
│   ├── shaders.js      GLSL strings
│   └── webgl.js        Compile/link, FBO helpers
└── scene/
    ├── logograms.js    Procedural symbol generator
    ├── targets.js      Per-particle target precomputation (area-weighted)
    └── particles.js    Three particle systems plus the phase machine
```

Folders split by concern. `core/` is pure utilities. `audio/` is the sound engine. `render/` is WebGL plumbing. `scene/` is the visual logic, what gets drawn and how it moves.

## How it loops

```
INITIAL_DRIFT   9.0s    curl-noise drift only
GATHER         12.0s    drawing head sweeps a fresh logogram into existence
HOLD            5.5s    symbol crisp, bell rings, warm halo
DISSOLVE        6.0s    particles release back into the flow
DRIFT          16.0s    ambient idle, then a new random logogram
```

The cycle never repeats the same symbol. Seed is `Math.random()` per cycle, so the visual is technically infinite.

## Colors

Deep blue-black background `#040810`. Phosphor cyan-white particles `#A8DCFF`. Sodium-orange cursor and HOLD halo `#FF7B1C`.

## On-screen text

Three small cues:
- Top-left "tap anywhere for sound" appears 2s after load, fades the moment audio unlocks. Browsers block autoplay until you interact.
- Bottom-center "move your cursor" appears after 10 seconds idle in the DRIFT phase, hides on movement.
- Bottom-right is the placeholder line, currently "the message hasn't arrived yet".
