// ────────────────────────────────────────────────────────────────
// Low-level stroke/disc factories and transforms.
//
// Element shape (consumed by scene/targets.js):
//   { type: 'stroke', points: [{x,y}], thickness: [number] }
//   { type: 'disc',   center: {x,y}, radius: number }
//
// Every glyph in the vocabulary boils down to a list of these.
// Transforms operate on them uniformly so glyphs can be scaled,
// translated, and rotated for composition.
// ────────────────────────────────────────────────────────────────

export function strokeFromFn(N, posFn, thickFn) {
  const points = [], thickness = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    points.push(posFn(t));
    thickness.push(thickFn(t));
  }
  return { type: 'stroke', points, thickness };
}

export function disc(cx, cy, r) {
  return { type: 'disc', center: { x: cx, y: cy }, radius: r };
}

export function strokeLine(x1, y1, x2, y2, thick) {
  return strokeFromFn(28,
    (t) => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }),
    () => thick,
  );
}

export function strokeArc(cx, cy, r, a1, a2, thick) {
  const span = Math.abs(a2 - a1);
  const N = Math.max(40, Math.floor(span * 60));
  return strokeFromFn(N,
    (t) => {
      const a = a1 + (a2 - a1) * t;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    },
    () => thick,
  );
}

export function strokeQuad(x0, y0, cx, cy, x2, y2, thick) {
  return strokeFromFn(60,
    (t) => {
      const u = 1 - t;
      return {
        x: u * u * x0 + 2 * u * t * cx + t * t * x2,
        y: u * u * y0 + 2 * u * t * cy + t * t * y2,
      };
    },
    () => thick,
  );
}

export function strokeCubic(x0, y0, c1x, c1y, c2x, c2y, x3, y3, thick) {
  return strokeFromFn(80,
    (t) => {
      const u = 1 - t;
      return {
        x: u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x3,
        y: u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y3,
      };
    },
    () => thick,
  );
}

// Densify a polyline so particle allocation is uniform per arc length.
export function strokePolyline(pts, thick, perSeg = 24) {
  const points = [], thickness = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      points.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
      thickness.push(thick);
    }
  }
  const last = pts[pts.length - 1];
  points.push({ x: last.x, y: last.y });
  thickness.push(thick);
  return { type: 'stroke', points, thickness };
}

// Same as strokePolyline but each point can carry its own thickness.
export function strokePolylineVar(pts, thicks, perSeg = 24) {
  const points = [], thickness = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const t0 = thicks[i], t1 = thicks[i + 1];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      points.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
      thickness.push(t0 + (t1 - t0) * t);
    }
  }
  const last = pts[pts.length - 1];
  points.push({ x: last.x, y: last.y });
  thickness.push(thicks[thicks.length - 1]);
  return { type: 'stroke', points, thickness };
}

export function transformElement(el, tx, ty, scale, rot = 0) {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const tp = (p) => ({
    x: (p.x * cs - p.y * sn) * scale + tx,
    y: (p.x * sn + p.y * cs) * scale + ty,
  });
  if (el.type === 'disc') {
    return {
      type: 'disc',
      center: tp(el.center),
      radius: el.radius * scale,
    };
  }
  return {
    type: 'stroke',
    points: el.points.map(tp),
    thickness: el.thickness.map((t) => t * scale),
  };
}

export function transformElements(els, tx, ty, scale, rot = 0) {
  return els.map(el => transformElement(el, tx, ty, scale, rot));
}

// Multiply all stroke thicknesses by a mood factor (discs unchanged).
export function applyMoodThickness(els, thickScale) {
  return els.map(el => {
    if (el.type === 'disc') return el;
    return {
      ...el,
      thickness: el.thickness.map(t => Math.max(0.003, t * thickScale)),
    };
  });
}
