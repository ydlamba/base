// ────────────────────────────────────────────────────────────────
// Bootstrap + render loop.
// Wires the modules together: GL setup, mouse handling, hint UI,
// audio↔phase sync, frame loop.
// ────────────────────────────────────────────────────────────────

import {
  smooth, clamp01, lookAt, perspective, mat4Mul,
} from './core/util.js';
import * as Audio from './audio/audio.js';
import {
  PARTICLE_VERT, PARTICLE_FRAG, QUAD_VERT, FADE_FRAG, COMPOSITE_FRAG,
} from './render/shaders.js';
import {
  compile, makeProgram, getU, makeFBO, resizeFBO,
} from './render/webgl.js';
import {
  N_MAIN, N_CURSOR, N_DUST, N_TOTAL, STRIDE, particleData, PHASES, phaseAt,
  initParticles, initCursor, initDust,
  updateMain, updateCursor, updateDust,
  regenerateLogogram, getBellFreq,
} from './scene/particles.js';

(() => {
  'use strict';

  // ── DOM + GL init ────────────────────────────────────────────
  const canvas = document.getElementById('c');
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    document.body.innerHTML = '<div style="padding:2rem;color:#666;font:14px monospace">WebGL2 required</div>';
    return;
  }
  const useHF = !!gl.getExtension('EXT_color_buffer_float');

  let DPR = 1, W = 0, H = 0;
  let accumA = null, accumB = null;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.0);
    W = Math.floor(window.innerWidth * DPR);
    H = Math.floor(window.innerHeight * DPR);
    canvas.width = W; canvas.height = H;
    if (accumA) { resizeFBO(gl, accumA, W, H, useHF); resizeFBO(gl, accumB, W, H, useHF); }
  }
  window.addEventListener('resize', resize);

  // ── Mouse + idle hint ────────────────────────────────────────
  const mouse = { worldX: 0, worldY: 0, worldXt: 0, worldYt: 0 };
  let mouseScreenX = 0, mouseScreenY = 0;
  let mouseInPage = false;
  let mouseLastSeen = 0;
  let firstMouseScreenX = null, firstMouseScreenY = null;
  const MOVE_THRESHOLD_PX = 8;
  const IDLE_THRESHOLD_MS = 10000;
  let lastMoveTime = performance.now();
  let idleHintShowing = false;

  const audioHintEl = document.getElementById('audio-hint');
  const idleHintEl  = document.getElementById('idle-hint');
  const ghEl        = document.getElementById('gh');

  // GitHub link — brief click animation before opening, so navigation isn't abrupt.
  // The icon scales up and brightens for ~320ms, then we open the URL in a new tab.
  if (ghEl) {
    ghEl.addEventListener('click', (e) => {
      e.preventDefault();
      ghEl.classList.add('clicking');
      setTimeout(() => {
        window.open(ghEl.href, '_blank', 'noopener,noreferrer');
        // Reset state once the new tab has been spawned
        setTimeout(() => ghEl.classList.remove('clicking'), 250);
      }, 320);
    });
  }

  function setIdleHint(visible) {
    if (!idleHintEl) return;
    idleHintEl.classList.toggle('show', visible);
    idleHintEl.classList.toggle('hide', !visible);
    idleHintShowing = visible;
  }
  function setMouse(x, y) {
    mouseScreenX = x; mouseScreenY = y;
    mouseInPage = true;
    mouseLastSeen = performance.now();
    if (firstMouseScreenX === null) {
      // First reported coords — could be a stray synthetic event. Just store them.
      firstMouseScreenX = x; firstMouseScreenY = y;
      return;
    }
    const dx = x - firstMouseScreenX;
    const dy = y - firstMouseScreenY;
    if (Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) {
      lastMoveTime = performance.now();
      firstMouseScreenX = x; firstMouseScreenY = y;
      if (idleHintShowing) setIdleHint(false);
    }
  }
  window.addEventListener('mousemove', e => setMouse(e.clientX, e.clientY));
  window.addEventListener('touchmove', e => {
    if (e.touches.length) setMouse(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener('touchstart', e => {
    if (e.touches.length) setMouse(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  function projectMouseToWorld(eyeX, eyeY, eyeZ, fovYRad) {
    if (!mouseInPage && mouseLastSeen === 0) {
      mouse.worldXt = 0; mouse.worldYt = 0; return;
    }
    const ndcX = (mouseScreenX / window.innerWidth) * 2 - 1;
    const ndcY = -((mouseScreenY / window.innerHeight) * 2 - 1);
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    const halfH = Math.tan(fovYRad / 2) * eyeZ;
    const halfW = halfH * aspect;
    mouse.worldXt = ndcX * halfW + eyeX;
    mouse.worldYt = ndcY * halfH + eyeY;
  }

  // ── Audio unlock + hint flow ─────────────────────────────────
  Audio.setOnUnlock(() => {
    if (!audioHintEl) return;
    audioHintEl.classList.remove('show');
    audioHintEl.classList.add('hide');
    setTimeout(() => audioHintEl.parentNode && audioHintEl.parentNode.removeChild(audioHintEl), 1100);
  });
  Audio.attachUnlockListeners();
  Audio.tryStart(); // optimistic — most browsers will defer until first gesture

  // Show audio hint ~2s after load if audio still hasn't unlocked
  setTimeout(() => {
    if (!Audio.isStarted() && audioHintEl) audioHintEl.classList.add('show');
  }, 2000);
  // Continuous idle detector — surface "move your cursor" only during DRIFT
  // (cursor attraction is off otherwise, so prompting would be misleading).
  setInterval(() => {
    const elapsed = (performance.now() - startTime) / 1000;
    const phase = phaseAt(elapsed);
    const idleFor = performance.now() - lastMoveTime;
    if (phase.name === 'DRIFT') {
      if (!idleHintShowing && idleFor > IDLE_THRESHOLD_MS) setIdleHint(true);
    } else if (idleHintShowing) {
      setIdleHint(false);
    }
  }, 500);

  // ── Camera ───────────────────────────────────────────────────
  const FOVY = 50 * Math.PI / 180;
  function getCamera(t) {
    const breathe = Math.sin(t * 0.07) * 0.06;
    return { ex: 0.0, ey: 0.05, ez: 3.10 + breathe, tx: 0.0, ty: 0.0, tz: 0.0 };
  }

  // ── GL programs / buffers / FBOs ─────────────────────────────
  const particleProg  = makeProgram(gl, PARTICLE_VERT, PARTICLE_FRAG);
  const fadeProg      = makeProgram(gl, QUAD_VERT,    FADE_FRAG);
  const compositeProg = makeProgram(gl, QUAD_VERT,    COMPOSITE_FRAG);
  const uPa = { uVP: getU(gl, particleProg, 'uVP'), uPointSize: getU(gl, particleProg, 'uPointSize') };
  const uF  = { uTex: getU(gl, fadeProg, 'uTex'), uFade: getU(gl, fadeProg, 'uFade') };
  const uC  = {
    uAccum:     getU(gl, compositeProg, 'uAccum'),
    uRes:       getU(gl, compositeProg, 'uRes'),
    uTime:      getU(gl, compositeProg, 'uTime'),
    uHoldGlow:  getU(gl, compositeProg, 'uHoldGlow'),
    uBellFlash: getU(gl, compositeProg, 'uBellFlash'),
  };

  // Fullscreen triangle VAO
  const quadVAO = gl.createVertexArray();
  gl.bindVertexArray(quadVAO);
  const quadVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Particle VAO + dynamic VBO (pos + alpha + color, stride 28 bytes)
  const particleVAO = gl.createVertexArray();
  gl.bindVertexArray(particleVAO);
  const particleVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, particleVBO);
  gl.bufferData(gl.ARRAY_BUFFER, particleData.byteLength, gl.DYNAMIC_DRAW);
  const sb = STRIDE * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, sb, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, sb, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, sb, 16);

  // Ping-pong accumulator FBOs (RGBA16F if available)
  accumA = makeFBO(gl); accumB = makeFBO(gl);
  resize();
  [accumA, accumB].forEach(o => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, o.fbo);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  initParticles();
  initCursor();
  initDust();

  // ── Render loop ──────────────────────────────────────────────
  const startTime = performance.now();
  let lastTime = 0;
  let prevPhaseName = null, prevCycle = -2;
  let bellFlashTime = -1000;     // elapsed-time when the last bell struck

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = (lastTime ? Math.min((now - lastTime) / 1000, 1 / 20) : 1 / 60);
    lastTime = now;
    const elapsed = (now - startTime) / 1000;
    const phase = phaseAt(elapsed);

    // Loading fade-in over the first ~3.5s
    const loadFade = smooth(clamp01(elapsed / 3.5));

    // Generate a fresh logogram at the start of each new GATHER cycle
    const isNewCycle = phase.cycle !== prevCycle && phase.cycle >= 0;
    if (phase.name === 'GATHER' && isNewCycle) {
      regenerateLogogram();
      prevCycle = phase.cycle;
    }

    // Phase transitions → audio cues + visual bell flash
    if (phase.name !== prevPhaseName) {
      if (phase.name === 'HOLD' && prevPhaseName !== 'HOLD') {
        bellFlashTime = elapsed;     // visual cue (independent of audio)
      }
      if (Audio.isStarted()) {
        const at = Audio.getTime();
        if (phase.name === 'GATHER' && prevPhaseName !== 'GATHER') {
          Audio.brushSound(at + 0.02, PHASES.GATHER, 600, 1800, 0.062);
        }
        if (phase.name === 'HOLD' && prevPhaseName !== 'HOLD') {
          Audio.bell(at + 0.02, getBellFreq());
          Audio.startHoldTone(getBellFreq() * 0.5);
        }
        if (phase.name === 'DISSOLVE' && prevPhaseName !== 'DISSOLVE') {
          Audio.brushSound(at + 0.02, PHASES.DISSOLVE, 1500, 450, 0.052);
          Audio.stopHoldTone();
        }
      }
      prevPhaseName = phase.name;
    }

    const cam = getCamera(elapsed);
    projectMouseToWorld(cam.ex, cam.ey, cam.ez, FOVY);

    // Drone breathing — used to gently modulate dust alpha
    const breathe = 0.5 + 0.5 * Math.sin(elapsed * 0.55);

    updateMain(elapsed, dt, phase, loadFade, mouse);
    updateCursor(elapsed, dt, phase, loadFade, mouse);
    updateDust(elapsed, dt, breathe);

    // Upload to GPU
    gl.bindBuffer(gl.ARRAY_BUFFER, particleVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, particleData);

    const view = lookAt(cam.ex, cam.ey, cam.ez, cam.tx, cam.ty, cam.tz, 0, 1, 0);
    const proj = perspective(FOVY, W / Math.max(H, 1), 0.1, 50);
    const vp   = mat4Mul(proj, view);

    // Pass 1 — fade accumA → accumB
    gl.bindFramebuffer(gl.FRAMEBUFFER, accumB.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(fadeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accumA.tex);
    gl.uniform1i(uF.uTex, 0);
    const fadeRate = (phase.name === 'HOLD')   ? 0.90
                   : (phase.name === 'DRIFT')  ? 0.974
                   : (phase.name === 'GATHER') ? 0.955
                   :                              0.948;
    gl.uniform1f(uF.uFade, fadeRate);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass 2 — particles (additive)
    gl.useProgram(particleProg);
    gl.uniformMatrix4fv(uPa.uVP, false, vp);
    const ps = (phase.name === 'HOLD') ? 2.6 : 2.0;
    gl.uniform1f(uPa.uPointSize, ps * DPR);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(particleVAO);
    gl.drawArrays(gl.POINTS, 0, N_TOTAL);
    gl.disable(gl.BLEND);

    // Pass 3 — composite to canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(compositeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accumB.tex);
    gl.uniform1i(uC.uAccum, 0);
    gl.uniform2f(uC.uRes, W, H);
    gl.uniform1f(uC.uTime, elapsed);
    let holdGlow = 0;
    if (phase.name === 'HOLD') {
      const into  = Math.min(phase.progress * 5.0, 1.0);
      const outOf = Math.min((1 - phase.progress) * 5.0, 1.0);
      holdGlow = Math.min(into, outOf);
    }
    gl.uniform1f(uC.uHoldGlow, holdGlow);
    // Bell-flash decay (~250ms): exp(-dt * 7.5) for sharp falloff.
    const bellFlash = Math.max(0, Math.exp(-(elapsed - bellFlashTime) * 7.5));
    gl.uniform1f(uC.uBellFlash, bellFlash);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const tmp = accumA; accumA = accumB; accumB = tmp;
  }
  requestAnimationFrame(frame);

})();
