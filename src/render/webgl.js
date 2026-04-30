// ────────────────────────────────────────────────────────────────
// WebGL boilerplate — shader compile/link, FBO creation, uniform lookup.
// All functions are stateless and take `gl` explicitly.
// ────────────────────────────────────────────────────────────────

export function compile(gl, src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('shader:', gl.getShaderInfoLog(s), '\n', src);
    throw new Error('shader compile');
  }
  return s;
}

export function makeProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, vs, gl.VERTEX_SHADER));
  gl.attachShader(p, compile(gl, fs, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('link:', gl.getProgramInfoLog(p));
    throw new Error('link');
  }
  return p;
}

export function getU(gl, p, n) { return gl.getUniformLocation(p, n); }

export function makeFBO(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}

export function resizeFBO(gl, o, w, h, useHF) {
  gl.bindTexture(gl.TEXTURE_2D, o.tex);
  const ifmt = useHF ? gl.RGBA16F : gl.RGBA;
  const type = useHF ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, gl.RGBA, type, null);
}
