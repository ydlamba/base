// ────────────────────────────────────────────────────────────────
// GLSL shader source strings (WebGL2 / GLSL ES 3.00).
// Three programs: particle, fade-pass, composite.
// ────────────────────────────────────────────────────────────────

export const PARTICLE_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in float aAlpha;
layout(location=2) in vec3 aColor;
uniform mat4 uVP;
uniform float uPointSize;
out float vAlpha;
out vec3  vColor;
void main() {
  vec4 cs = uVP * vec4(aPos, 1.0);
  gl_Position = cs;
  gl_PointSize = uPointSize / max(cs.w, 0.45);
  // Atmospheric perspective: particles further from camera dim slightly
  // (mostly affects the dust layer; symbol particles cluster near z=0)
  float depthDim = mix(0.55, 1.05, smoothstep(-2.5, 2.0, aPos.z));
  vAlpha = aAlpha * depthDim;
  vColor = aColor;
}`;

export const PARTICLE_FRAG = `#version 300 es
precision highp float;
in float vAlpha;
in vec3  vColor;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = pow(1.0 - r * 2.0, 1.6) * vAlpha;
  // Pre-multiplied: rgb = color*alpha, alpha channel = alpha (for density)
  fragColor = vec4(vColor * a, a);
}`;

export const QUAD_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FADE_FRAG = `#version 300 es
precision highp float;
in  vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform float uFade;
void main() { fragColor = texture(uTex, vUv) * uFade; }`;

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in  vec2 vUv;
out vec4 fragColor;
uniform sampler2D uAccum;
uniform vec2  uRes;
uniform float uTime;
uniform float uHoldGlow;
uniform float uBellFlash;            // 0..1 — sharp pulse synced to bell strike

float hash21(vec2 p) { p = fract(p*vec2(123.34,456.21)); p += dot(p, p+34.5); return fract(p.x*p.y); }

void main() {
  vec2 px = 1.0 / uRes;

  // Chromatic aberration during HOLD — R/B sampled at offset positions.
  // Reads as "transmission coming through old hardware."
  float aberr = uHoldGlow * 0.0035;
  vec4 accR = texture(uAccum, vUv + vec2(aberr, 0.0));
  vec4 accB = texture(uAccum, vUv - vec2(aberr, 0.0));
  vec4 accG = texture(uAccum, vUv);
  vec4 acc  = vec4(accR.r, accG.g, accB.b, accG.a);

  // Bloom — gather alpha-weighted color from neighborhood
  vec3 bloomCol = vec3(0.0);
  float bloomA  = 0.0;
  const int NN = 12;
  for (int i = 0; i < NN; i++) {
    float fi = float(i);
    float a  = fi * 6.2831853 / float(NN);
    for (int r = 1; r <= 3; r++) {
      float fr = float(r) * 4.0;
      vec4 s = texture(uAccum, vUv + vec2(cos(a), sin(a)) * fr * px);
      bloomCol += s.rgb;
      bloomA   += s.a;
    }
  }
  bloomCol /= float(NN) * 3.0;
  bloomA   /= float(NN) * 3.0;

  // Combine bloom + sharp accumulator
  vec3 sumCol = acc.rgb + bloomCol * 0.55;
  float sumA  = max(acc.a + bloomA * 0.55, 0.0001);
  vec3 inkColor = sumCol / sumA;
  float density = clamp(sumA, 0.0, 1.6);

  // Cathode archive background — deep blue-black
  vec3 paper = vec3(0.016, 0.031, 0.063);   // #040810

  // Density curve — phosphor particles emit against the void
  float k = 1.0 - exp(-density * 1.7);
  vec3 col = mix(paper, inkColor, k);

  // Sodium-orange HOLD glow — symbol's edges bloom warm against cold space.
  // Narrative tie: the cursor's sodium-orange color is what "transmits."
  vec3 glowC = vec3(1.000, 0.541, 0.200);
  float halo = clamp(bloomA * 1.6 - 0.05, 0.0, 1.0);
  col = mix(col, mix(col, glowC, 0.30), halo * uHoldGlow);

  // Bell-flash pulse — sharp brightness boost on bell strike, fast decay
  col *= 1.0 + uBellFlash * 0.55;

  // Vignette — darkens edges further toward near-black
  vec2 q = vUv - 0.5;
  float vig = 1.0 - smoothstep(0.40, 1.05, length(q) * 1.35);
  col = mix(paper * 0.30, col, vig);

  float g = hash21(gl_FragCoord.xy + uTime * 60.0);
  col += (g - 0.5) * 0.014;

  col = pow(col, vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}`;
