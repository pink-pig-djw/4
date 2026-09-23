// Procedural textures for trees, generated at load time (no image files, works offline).
//
// Leaf atlas: 4x4 tiles, each a small branch system with many real-size leaves (or needles).
// It is a data texture: R = shading, G = per-leaf autumn offset (0.5 = tree average),
// B = twig mask (1 = bark-coloured twig), A = coverage. The shader turns it into colour with
// the species palette, so every tree can be at its own stage of autumn.
//
// Bark: tileable albedo (sRGB) + normal map per bark type; one tile spans 1 m around × 2 m up.
import * as THREE from 'three';
import { rng } from '../../shared/geom.js';

// ---------------------------------------------------------------------------------------------
// Leaf outlines (leaf-local coordinates: petiole at (0,0), tip at (0,-1))

function profilePath(wfn, { s0 = 0, n = 36, teeth = 0, amp = 0, asym = 1, notch = false } = {}) {
  const right = [], left = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + (1 - s0) * i / n;
    let w = Math.max(0, wfn(s));
    if (teeth) { const f = (s * teeth) % 1; w += amp * (1 - f) * (1 - f) * Math.min(1, w * 8); }
    right.push([w, -s]); left.push([-w * asym, -s]);
  }
  const p = new Path2D();
  if (notch) p.moveTo(0, 0); else p.moveTo(right[0][0], right[0][1]);
  for (const [x, y] of right) p.lineTo(x, y);
  for (let i = left.length - 1; i >= 0; i--) p.lineTo(left[i][0], left[i][1]);
  p.closePath();
  return p;
}

function polarPath(rfn, cy, n = 140) {
  const p = new Path2D();
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI + 2 * Math.PI * i / n, r = rfn(a);
    const x = Math.sin(a) * r, y = cy - Math.cos(a) * r;
    if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

const sinp = (x, e) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(Math.max(x, 0), 1))), e);

const SHAPES = {
  // Linde: heart-shaped, finely serrate, short drip tip
  cordate: (R) => profilePath(s => 0.52 * sinp((s + 0.1) / 1.1, 0.72) * (1.05 - 0.3 * s), { s0: -0.1, teeth: 16, amp: 0.018, asym: 0.9 + R() * 0.2, notch: true }),
  // Buche: oval with wavy margin
  ovate: (R) => profilePath(s => 0.31 * sinp(s, 0.8) * (1.1 - 0.25 * s) + 0.012 * Math.sin(s * 40), { asym: 0.95 + R() * 0.1 }),
  // Birke: triangular, long tip, double serrate
  deltoid: (R) => profilePath(s => 0.44 * (s < 0.28 ? Math.pow(Math.sin(Math.PI / 2 * s / 0.28), 0.55) : Math.pow(1 - (s - 0.28) / 0.72, 1.15)), { teeth: 13, amp: 0.035, asym: 0.95 + R() * 0.1 }),
  // Eiche: rounded lobes, ear-like base
  lobed: (R) => {
    const ph = R() * 0.2;
    return profilePath(s => 0.33 * Math.pow(Math.sin(Math.PI * Math.pow(Math.max(s, 0), 0.72)), 0.7) * (0.52 + 0.48 * Math.pow(Math.abs(Math.sin(Math.PI * (s * 4.4 + 0.25 + ph))), 0.55)) + 0.06 * Math.exp(-Math.pow((s - 0.05) / 0.05, 2)), { n: 60, asym: 0.9 + R() * 0.2 });
  },
  // Hasel / Hainbuche: round-ovate, double serrate
  hazel: (R) => profilePath(s => 0.44 * sinp((s + 0.06) / 1.06, 0.75) * (1.05 - 0.25 * s), { s0: -0.06, teeth: 18, amp: 0.03, asym: 0.9 + R() * 0.2, notch: true }),
  // Liguster / Hartriegel: small elliptic
  ellip: (R) => profilePath(s => 0.25 * sinp(s, 0.85), { asym: 0.95 + R() * 0.1 }),
  // Spitzahorn: five pointed lobes
  palmate: (R) => {
    const lobes = [[0, 0.56, 0.3], [0.98, 0.5, 0.3], [-0.98, 0.5, 0.3], [1.95, 0.3, 0.26], [-1.95, 0.3, 0.26]];
    const j = (R() - 0.5) * 0.1;
    return polarPath(a => {
      let r = 0.17;
      for (const [c, L, w] of lobes) {
        const x = Math.abs(a - c - j) / w;
        r += L * (0.5 * Math.exp(-x * x) + 0.5 * Math.exp(-x * 1.6));
        for (const o of [-0.26, 0.26]) { const y = (a - c - o) / 0.045; r += (L > 0.4 ? 0.07 : 0.04) * Math.exp(-y * y); }
      }
      return r;
    }, -0.17);
  },
  // Kastanie leaflet: obovate, serrate
  leaflet: (R) => profilePath(s => 0.2 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(Math.max(s, 0), 1.35))), 0.8), { teeth: 20, amp: 0.015, asym: 0.95 + R() * 0.1 }),
};

// ---------------------------------------------------------------------------------------------
// Painter: one canvas whose colour channels carry the data (R shading, G autumn offset,
// B twig mask). Leaves and needles are queued into colour buckets (transformed Path2Ds) and
// drawn in a few calls per layer, which is far faster than one fill per leaf.

const qn = (v, n) => Math.round(Math.min(Math.max(v, 0), 1) * n) / n;

class Painter {
  constructor(S) {
    this.S = S;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = S;
    this.L = this.canvas.getContext('2d');
    this.L.lineCap = 'round'; this.L.lineJoin = 'round';
    this.q = new Map(); this.nq = 0;
    this.veinCache = new Map();
  }
  clip(x, y, w, h) { const L = this.L; L.save(); L.beginPath(); L.rect(x, y, w, h); L.clip(); }
  unclip() { this.flush(); this.L.restore(); }

  _b(key) {
    let b = this.q.get(key);
    if (!b) { b = { fill: new Path2D(), veins: new Path2D(), margin: new Path2D(), spots: new Path2D(), stalks: new Path2D(), lines: new Path2D(), n: 0 }; this.q.set(key, b); }
    b.n++;
    return b;
  }

  // draw everything queued so far (one layer)
  flush() {
    const L = this.L;
    for (const [key, b] of this.q) {
      const [lum, g, w] = key.split(',').map(Number);
      if (w) { L.strokeStyle = col(lum, g, 0); L.lineWidth = w; L.stroke(b.lines); continue; }
      L.strokeStyle = col(lum * 0.7, g, 0.25); L.lineWidth = 1.2; L.stroke(b.stalks);
      L.fillStyle = col(lum, g, 0); L.fill(b.fill);
      L.strokeStyle = col(lum * 1.15, g - 0.04, 0); L.lineWidth = 0.9; L.stroke(b.veins);
      L.strokeStyle = col(lum * 0.62, g + 0.1, 0); L.lineWidth = 1.1; L.stroke(b.margin);
      L.fillStyle = col(lum * 0.55, 0.95, 0); L.fill(b.spots);
    }
    this.q.clear(); this.nq = 0;
  }

  // polyline twig in canvas px (drawn at once, under the leaves queued later)
  twig(pts, w0, w1, lum) {
    const L = this.L, n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      L.strokeStyle = col(lum * (0.9 + 0.2 * (i % 2)), 0.5, 1); L.lineWidth = w0 + (w1 - w0) * i / (n - 1);
      L.beginPath(); L.moveTo(pts[i][0], pts[i][1]); L.lineTo(pts[i + 1][0], pts[i + 1][1]); L.stroke();
    }
  }

  // needle / thin line with its own autumn offset
  needle(x0, y0, x1, y1, w, lum, g) {
    const b = this._b(`${qn(lum, 12)},${qn(g, 8)},${Math.max(1, Math.round(w * 2) / 2)}`);
    b.lines.moveTo(x0, y0); b.lines.lineTo(x1, y1);
    if (++this.nq > 700) this.flush();
  }

  _veins(opts) {
    const key = opts.palm ? 'palm' : `${opts.veins ?? 5},${opts.veinSpread ?? 0.3}`;
    let v = this.veinCache.get(key);
    if (!v) {
      v = new Path2D();
      if (opts.palm) { for (const [va, vl] of opts.palm) { v.moveTo(0, opts.palmY || 0); v.lineTo(Math.sin(va) * vl, (opts.palmY || 0) - Math.cos(va) * vl); } }
      else {
        v.moveTo(0, 0); v.lineTo(0, -0.95);
        const nv = opts.veins ?? 5, vs = opts.veinSpread ?? 0.3;
        for (let i = 1; i <= nv; i++) {
          const s = i / (nv + 1) * 0.9;
          v.moveTo(0, -s); v.lineTo(vs, -s - 0.13); v.moveTo(0, -s); v.lineTo(-vs, -s - 0.13);
        }
      }
      this.veinCache.set(key, v);
    }
    return v;
  }

  // leaf: path in leaf-local coords, placed at (x,y), angle a (0 = up, clockwise), length len px,
  // width factor wf (foreshortening), petiole length pl (in leaf lengths)
  leaf(path, x, y, a, len, wf, pl, lum, g, opts = {}) {
    const b = this._b(`${qn(lum * (opts.under ? 1.08 : 1), 14)},${qn(g, 10)},0`);
    const ca = Math.cos(a), sa = Math.sin(a), sx = len * wf, sy = len;
    const px = x + sa * pl * len, py = y - ca * pl * len;
    if (pl > 0) { b.stalks.moveTo(x, y); b.stalks.lineTo(px, py); }
    const m = new DOMMatrix([ca * sx, sa * sx, -sa * sy, ca * sy, px, py]);
    b.fill.addPath(path, m);
    if (len > 14) b.veins.addPath(this._veins(opts), m);
    b.margin.addPath(path, m);
    if (opts.spots) {
      const sp = new Path2D();
      for (const [sxp, syp, sr] of opts.spots) { sp.moveTo(sxp + sr, syp); sp.ellipse(sxp, syp, sr, sr * 1.3, 0, 0, Math.PI * 2); }
      b.spots.addPath(sp, m);
    }
    if (++this.nq > 90) this.flush();
  }
}

const q8 = v => Math.round(Math.min(Math.max(v, 0), 1) * 255);
function col(r, g, b) { return `rgb(${q8(r)},${q8(g)},${q8(b)})`; }

// ---------------------------------------------------------------------------------------------
// Branch systems per tile

// Recursive twig system; collects leaf slots, draws twigs immediately.
function twigSystem(P, R, x, y, ang, len, depth, spec, slots) {
  const n = 6, pts = [[x, y]];
  let a = ang, px = x, py = y;
  for (let i = 1; i <= n; i++) {
    a += (R() - 0.5) * 0.18 + spec.bend / n;
    px += Math.sin(a) * len / n; py -= Math.cos(a) * len / n;
    pts.push([px, py]);
  }
  const w0 = spec.twigW * Math.pow(0.62, depth) * P.S / 2048;
  P.twig(pts, Math.max(1, w0), Math.max(0.8, w0 * 0.35), spec.twigLum);
  // children
  if (depth < spec.depth) {
    const kids = spec.kids[depth];
    for (let k = 0; k < kids; k++) {
      const t = 0.18 + 0.72 * (k + R() * 0.6) / kids;
      const i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
      const cx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, cy = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
      const side = (k % 2 ? 1 : -1) * (spec.opposite ? 1 : 1);
      const ka = a + side * (0.55 + R() * 0.45);
      twigSystem(P, R, cx, cy, ka, len * (0.5 + R() * 0.2) * (1 - t * 0.4), depth + 1, spec, slots);
      if (spec.opposite) twigSystem(P, R, cx, cy, a - side * (0.55 + R() * 0.45), len * (0.45 + R() * 0.2) * (1 - t * 0.4), depth + 1, spec, slots);
    }
  }
  // leaf slots along the twig
  const step = spec.leafLen * spec.spacing;
  let side = R() < 0.5 ? 1 : -1;
  let acc = len * 0.12;
  while (acc < len) {
    const t = acc / len, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
    const sx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, sy = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
    const da = Math.atan2(pts[i + 1][0] - pts[i][0], -(pts[i + 1][1] - pts[i][1]));
    slots.push([sx, sy, da + side * (0.7 + R() * 0.55), depth]);
    if (spec.opposite) slots.push([sx, sy, da - side * (0.7 + R() * 0.55), depth]);
    else side = -side;
    acc += step * (0.8 + R() * 0.4);
  }
  slots.push([px, py, a + (R() - 0.5) * 0.4, depth]); // terminal leaf
}

const TILE_SPECS = {
  // leafLen: fraction of the tile (card ~1.35 m → linden leaf ~9 cm)
  linden:   { shape: 'cordate', leafLen: 0.075, spacing: 0.42, wf: [0.6, 1], pl: 0.35, depth: 2, kids: [7, 4], bend: 0.1, twigW: 3.2, twigLum: 0.34, lum: [0.72, 0.95], veins: 4, veinSpread: 0.33 },
  maple:    { shape: 'palmate', leafLen: 0.09, spacing: 0.5, wf: [0.65, 1], pl: 0.55, depth: 2, kids: [6, 3], bend: 0.05, twigW: 3.2, twigLum: 0.35, lum: [0.72, 0.95], opposite: true, palm: true },
  oak:      { shape: 'lobed', leafLen: 0.085, spacing: 0.36, wf: [0.55, 1], pl: 0.05, depth: 2, kids: [7, 4], bend: 0.3, twigW: 3.4, twigLum: 0.32, lum: [0.68, 0.9], veins: 5, veinSpread: 0.25, clustered: true },
  birch:    { shape: 'deltoid', leafLen: 0.055, spacing: 0.45, wf: [0.6, 1], pl: 0.4, depth: 2, kids: [8, 5], bend: 0.45, twigW: 2.4, twigLum: 0.26, lum: [0.75, 0.98], veins: 4, veinSpread: 0.3 },
  chestnut: { shape: 'leaflet', leafLen: 0.11, spacing: 1.1, wf: [0.65, 1], pl: 0.6, depth: 2, kids: [5, 2], bend: 0.1, twigW: 4.5, twigLum: 0.36, lum: [0.7, 0.92], compound: 7, veins: 6, veinSpread: 0.22, opposite: true, spots: 0.35 },
  beech:    { shape: 'ovate', leafLen: 0.065, spacing: 0.42, wf: [0.55, 1], pl: 0.12, depth: 2, kids: [8, 4], bend: 0.2, twigW: 2.6, twigLum: 0.42, lum: [0.72, 0.95], veins: 6, veinSpread: 0.24 },
  hazel:    { shape: 'hazel', leafLen: 0.11, spacing: 0.45, wf: [0.6, 1], pl: 0.15, depth: 2, kids: [6, 3], bend: 0.15, twigW: 3, twigLum: 0.38, lum: [0.72, 0.95], veins: 5, veinSpread: 0.3 },
  privet:   { shape: 'ellip', leafLen: 0.07, spacing: 0.4, wf: [0.55, 1], pl: 0.08, depth: 2, kids: [7, 4], bend: 0.2, twigW: 2.6, twigLum: 0.36, lum: [0.62, 0.85], opposite: true, veins: 3, veinSpread: 0.18 },
};

function drawBroadleafTile(P, x0, y0, T, spec, seed, variant) {
  const R = rng(seed);
  const shapes = [0, 1, 2].map(() => SHAPES[spec.shape](R));
  const slots = [];
  P.clip(x0 + 3, y0 + 3, T - 6, T - 6);
  const L = spec.leafLen * T;
  const lspec = { ...spec, leafLen: L };
  if (variant === 0) {
    // one main twig from the bottom centre
    twigSystem(P, R, x0 + T * (0.5 + (R() - 0.5) * 0.08), y0 + T * 0.99, (R() - 0.5) * 0.25, T * 0.84, 0, lspec, slots);
    const side = R() < 0.5 ? -1 : 1;
    twigSystem(P, R, x0 + T * 0.5, y0 + T * 0.97, side * (0.55 + R() * 0.2), T * 0.55, 1, lspec, slots);
  } else {
    // a fan of shoots
    for (const a of [-0.8, -0.35, 0.05, 0.4, 0.85]) twigSystem(P, R, x0 + T * 0.5, y0 + T * 0.99, a + (R() - 0.5) * 0.2, T * (0.58 + R() * 0.2), 1, lspec, slots);
  }
  // shuffle for natural overlap
  for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  for (const [sx, sy, a] of slots) {
    const under = R() < 0.18;
    const lum = (spec.lum[0] + R() * (spec.lum[1] - spec.lum[0])) * (under ? 1.12 : 1);
    const g = 0.5 + (R() - 0.5) * 0.75;
    const len = L * (0.7 + R() * 0.45);
    const wf = spec.wf[0] + R() * (spec.wf[1] - spec.wf[0]);
    const path = shapes[Math.floor(R() * shapes.length)];
    const spots = spec.spots && R() < spec.spots ? Array.from({ length: 1 + Math.floor(R() * 3) }, () => [(R() - 0.5) * 0.25, -0.2 - R() * 0.6, 0.03 + R() * 0.05]) : null;
    if (spec.compound) {
      // horse chestnut: 5–7 leaflets on a long petiole
      const pl = spec.pl * len * 1.6;
      const cx = sx + Math.sin(a) * pl, cy = sy - Math.cos(a) * pl;
      P.twig([[sx, sy], [cx, cy]], Math.max(1, len * 0.04), Math.max(1, len * 0.03), 0.5);
      const n = spec.compound;
      for (let k = 0; k < n; k++) {
        const o = (k - (n - 1) / 2) / ((n - 1) / 2);
        const la = a + o * 1.25 + (R() - 0.5) * 0.1;
        const ll = len * (1 - 0.5 * o * o);
        P.leaf(path, cx, cy, la, ll, wf, 0, lum * (0.95 + R() * 0.1), g + (R() - 0.5) * 0.1, { veins: spec.veins, veinSpread: spec.veinSpread, spots: R() < 0.5 ? spots : null });
      }
    } else if (spec.palm) {
      P.leaf(path, sx, sy, a, len * 1.1, wf, spec.pl, lum, g, { under, palm: [[0, 0.72], [0.98, 0.62], [-0.98, 0.62], [1.95, 0.38], [-1.95, 0.38]], palmY: -0.17, spots });
    } else {
      P.leaf(path, sx, sy, a, len, wf, spec.pl, lum, g, { under, veins: spec.veins, veinSpread: spec.veinSpread, spots });
    }
  }
  P.unclip();
}

// Waldkiefer: needles all round the young shoots (bottle-brush), bare older twigs inside
function drawPineTile(P, x0, y0, T, seed) {
  const R = rng(seed);
  P.clip(x0 + 3, y0 + 3, T - 6, T - 6);
  const s = P.S / 2048;
  const shoots = [];
  const main = { x: x0 + T * 0.5, y: y0 + T * 0.99, a: (R() - 0.5) * 0.2, len: T * 0.86 };
  shoots.push(main);
  for (let k = 0; k < 10; k++) {
    const t = 0.18 + k * 0.072;
    const sh = { x: main.x + Math.sin(main.a) * main.len * t, y: main.y - Math.cos(main.a) * main.len * t, a: main.a + (k % 2 ? 1 : -1) * (0.55 + R() * 0.35), len: T * (0.36 - t * 0.2 + R() * 0.08) };
    shoots.push(sh);
    // secondary shoots near the tip of each side shoot
    for (const o of [-0.5, 0.5]) if (R() < 0.7) shoots.push({ x: sh.x + Math.sin(sh.a) * sh.len * 0.6, y: sh.y - Math.cos(sh.a) * sh.len * 0.6, a: sh.a + o + (R() - 0.5) * 0.3, len: sh.len * (0.35 + R() * 0.15) });
  }
  for (const sh of shoots) {
    const ex = sh.x + Math.sin(sh.a) * sh.len, ey = sh.y - Math.cos(sh.a) * sh.len;
    P.twig([[sh.x, sh.y], [(sh.x + ex) / 2, (sh.y + ey) / 2], [ex, ey]], 5 * s, 2.5 * s, 0.45);
  }
  for (const sh of shoots) {
    const n = Math.round(sh.len / (0.7 * s));
    for (let i = 0; i < n; i++) {
      const t = 0.3 + 0.7 * i / n;
      const bx = sh.x + Math.sin(sh.a) * sh.len * t, by = sh.y - Math.cos(sh.a) * sh.len * t;
      const na = sh.a + (R() - 0.5) * 2 * (0.35 + R() * 0.75);
      const nl = T * (0.04 + R() * 0.03) * (0.8 + 0.4 * Math.abs(Math.sin(na - sh.a)));
      P.needle(bx, by, bx + Math.sin(na) * nl, by - Math.cos(na) * nl, (2.4 + R() * 1.4) * s, 0.45 + R() * 0.45, 0.5 + (R() - 0.5) * 0.5);
    }
    // tip brush
    const ex = sh.x + Math.sin(sh.a) * sh.len, ey = sh.y - Math.cos(sh.a) * sh.len;
    for (let i = 0; i < 34; i++) {
      const na = sh.a + (R() - 0.5) * 1.5, nl = T * (0.035 + R() * 0.035);
      P.needle(ex, ey, ex + Math.sin(na) * nl, ey - Math.cos(na) * nl, 2.6 * s, 0.6 + R() * 0.35, 0.5 + (R() - 0.5) * 0.5);
    }
  }
  P.unclip();
}

// Fichte: flat spray, short needles all round the twigs
function drawSpruceTile(P, x0, y0, T, seed) {
  const R = rng(seed);
  P.clip(x0 + 3, y0 + 3, T - 6, T - 6);
  const s = P.S / 2048;
  const twigs = [];
  const main = { x: x0 + T * 0.5, y: y0 + T * 0.99, a: (R() - 0.5) * 0.1, len: T * 0.92, w: 5 };
  twigs.push(main);
  for (let k = 0; k < 9; k++) {
    const t = 0.12 + k * 0.095;
    const side = k % 2 ? 1 : -1;
    const tw = { x: main.x + Math.sin(main.a) * main.len * t, y: main.y - Math.cos(main.a) * main.len * t, a: main.a + side * (0.75 + R() * 0.25), len: T * (0.42 - t * 0.28) * (0.85 + R() * 0.3), w: 3 };
    twigs.push(tw);
    if (tw.len > T * 0.2) for (let j = 0; j < 2; j++) {
      const u = 0.35 + j * 0.3;
      twigs.push({ x: tw.x + Math.sin(tw.a) * tw.len * u, y: tw.y - Math.cos(tw.a) * tw.len * u, a: tw.a + (j % 2 ? 1 : -1) * 0.8, len: tw.len * 0.35, w: 2 });
    }
  }
  for (const tw of twigs) {
    const ex = tw.x + Math.sin(tw.a) * tw.len, ey = tw.y - Math.cos(tw.a) * tw.len;
    P.twig([[tw.x, tw.y], [ex, ey]], tw.w * s, tw.w * 0.5 * s, 0.4);
  }
  for (const tw of twigs) {
    const n = Math.round(tw.len / (1.3 * s));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const bx = tw.x + Math.sin(tw.a) * tw.len * t, by = tw.y - Math.cos(tw.a) * tw.len * t;
      const side = i % 2 ? 1 : -1;
      const na = tw.a + side * (0.7 + R() * 0.5), nl = T * (0.016 + R() * 0.01);
      P.needle(bx, by, bx + Math.sin(na) * nl, by - Math.cos(na) * nl, 1.8 * s * 1.5, 0.55 + R() * 0.4, 0.5 + (R() - 0.5) * 0.4);
    }
  }
  P.unclip();
}

// tile index → drawing
const TILE_TABLE = [
  ['linden', 0], ['linden', 1], ['maple', 0], ['maple', 1], ['oak', 0], ['oak', 1], ['birch', 0], ['birch', 1],
  ['chestnut', 0], ['chestnut', 1], ['beech', 0], ['beech', 1], ['hazel', 0], ['privet', 1], ['pine'], ['spruce'],
];

const DILATE_FS = /* glsl */`
uniform sampler2D src; uniform float texel; varying vec2 vUv;
void main() {
  vec4 c = texture2D(src, vUv);
  if (c.a > 0.0) { gl_FragColor = vec4(c.rgb / c.a, c.a); return; }
  // transparent: take the colour of the nearest covered texels (keeps mipmaps free of dark fringes)
  vec3 acc = vec3(0.0); float w = 0.0; float d = 1.0;
  for (int r = 0; r < 7; r++) {
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.785398;
      vec4 s = texture2D(src, vUv + vec2(cos(a), sin(a)) * d * texel);
      if (s.a > 0.02) { acc += s.rgb / s.a; w += 1.0; }
    }
    if (w > 0.0) break;
    d *= 2.0;
  }
  gl_FragColor = vec4(w > 0.0 ? acc / w : vec3(0.6, 0.5, 0.0), 0.0);
}`;

// Draws the atlas on a 2D canvas, uploads it and cleans it up on the GPU (no pixel readback).
export function makeLeafAtlas(renderer, tile = 512) {
  const S = tile * 4;
  const P = new Painter(S);
  const times = {};
  let t = performance.now();
  TILE_TABLE.forEach(([kind, variant], i) => {
    const x0 = (i % 4) * tile, y0 = Math.floor(i / 4) * tile;
    if (kind === 'pine') drawPineTile(P, x0, y0, tile, 900 + i);
    else if (kind === 'spruce') drawSpruceTile(P, x0, y0, tile, 900 + i);
    else drawBroadleafTile(P, x0, y0, tile, TILE_SPECS[kind], 500 + i * 17, variant);
  });
  times.draw = Math.round(performance.now() - t); t = performance.now();

  const src = new THREE.CanvasTexture(P.canvas);
  src.flipY = false; src.premultiplyAlpha = true; src.colorSpace = THREE.NoColorSpace;
  src.generateMipmaps = false; src.minFilter = THREE.NearestFilter; src.magFilter = THREE.NearestFilter;
  const rt = new THREE.WebGLRenderTarget(S, S, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, anisotropy: 4,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.ShaderMaterial({
    uniforms: { src: { value: src }, texel: { value: 1 / S } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: DILATE_FS, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  renderer.initTexture(src);
  times.upload = Math.round(performance.now() - t);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, new THREE.Camera());
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose(); src.dispose();
  P.canvas.width = P.canvas.height = 1;   // free the 2D backing store
  times.gpu = Math.round(performance.now() - t);
  makeLeafAtlas.times = times;
  return { texture: rt.texture, size: S, tile };
}

// UV rectangle of an atlas tile (texture v = canvas y / size, DataTexture is not flipped)
export function tileRect(i, size) {
  const c = i % 4, r = Math.floor(i / 4), pad = 4 / size;
  return { u0: c / 4 + pad, u1: (c + 1) / 4 - pad, vTop: r / 4 + pad, vBot: (r + 1) / 4 - pad };
}

// ---------------------------------------------------------------------------------------------
// Bark

function makeNoise(seed) {
  const R = rng(seed);
  const perm = new Uint16Array(512), vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = R(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x, y) => vals[perm[perm[x & 255] + (y & 255)]];
  // periodic value noise: x in [0,px), y in [0,py)
  const noise = (x, y, px, py) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const x0 = ((ix % px) + px) % px, y0 = ((iy % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = h(x0, y0), b = h(x1, y0), c = h(x0, y1), d = h(x1, y1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (u, v, fx, fy, oct) => {
    let s = 0, a = 0.5, n = 0;
    for (let o = 0; o < oct; o++) { s += a * noise(u * fx, v * fy, fx, fy); n += a; fx *= 2; fy *= 2; a *= 0.5; }
    return s / n;
  };
  // periodic Worley: cx × cy cells over the unit square → [F1, F2] in cell units
  const pts = new Map();
  const cell = (i, j, cx, cy) => {
    const k = i * 1000 + j;
    let p = pts.get(k); if (!p) { const r2 = rng(seed * 31 + k * 7 + cx * 131); p = [r2(), r2()]; pts.set(k, p); }
    return p;
  };
  const worley = (u, v, cx, cy) => {
    const x = u * cx, y = v * cy, ix = Math.floor(x), iy = Math.floor(y);
    let f1 = 9, f2 = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ix + di, j = iy + dj;
      const p = cell(((i % cx) + cx) % cx, ((j % cy) + cy) % cy, cx, cy);
      const dx = i + p[0] - x, dy = j + p[1] - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return [f1, f2];
  };
  return { noise, fbm, worley };
}

const hexCache = new Map();
const hex = c => { let r = hexCache.get(c); if (!r) { const v = parseInt(c.slice(1), 16); r = [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; hexCache.set(c, r); } return r; };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

const BARKS = {
  // Linde / Ahorn / Kastanie: grey-brown, shallow network of fissures
  grey: { strength: 5, fn(N, u, v) {
    const n1 = N.fbm(u, v, 9, 3, 4), n2 = N.fbm(u + 0.3, v, 4, 2, 5), n3 = N.fbm(u, v, 3, 3, 3);
    const crack = 1 - sstep(0.0, 0.06, Math.abs(n1 - 0.5));
    const h = 0.55 + 0.35 * n2 - crack * 0.55;
    let c = mix3(hex('#625b52'), hex('#8d867b'), n2);
    c = mix3(c, hex('#332d28'), crack * 0.85);
    c = mix3(c, hex('#8f9a80'), sstep(0.62, 0.75, n3) * 0.5);
    return [c, h];
  } },
  // Eiche: deep vertical fissures between tall plates
  oak: { strength: 10, fn(N, u, v) {
    const wu = u + (N.fbm(u, v, 4, 4, 3) - 0.5) * 0.12;
    const [f1, f2] = N.worley(wu, v, 7, 5);
    const edge = f2 - f1, n = N.fbm(u, v, 12, 6, 4);
    const fis = 1 - sstep(0.02, 0.2, edge + (n - 0.5) * 0.1);
    const h = (0.5 + 0.4 * n) * (1 - fis * 0.9);
    let c = mix3(hex('#4f473f'), hex('#7a7064'), n);
    c = mix3(c, hex('#1f1b17'), fis);
    c = mix3(c, hex('#56663a'), sstep(0.6, 0.72, N.fbm(u, v, 3, 2, 3)) * 0.45 * (0.4 + fis));
    return [c, h];
  } },
  // Buche: smooth light grey, mottled
  beech: { strength: 2.5, fn(N, u, v) {
    const n = N.fbm(u, v, 3, 3, 5), m = N.fbm(u + 0.5, v, 8, 8, 3);
    const ring = Math.pow(Math.abs(Math.sin((v * 22 + n * 3) * Math.PI)), 12) * sstep(0.55, 0.7, m);
    const h = 0.5 + 0.12 * m - ring * 0.2;
    let c = mix3(hex('#7c7d77'), hex('#a3a49d'), n);
    c = mix3(c, hex('#5f615b'), ring * 0.6);
    c = mix3(c, hex('#b7bca6'), sstep(0.66, 0.72, m) * 0.6);
    return [c, h];
  } },
  // Birke: white with dark horizontal lenticels and black patches
  birch: { strength: 3, fn(N, u, v, ctx) {
    const n = N.fbm(u, v, 4, 3, 5), p = N.fbm(u, v, 5, 4, 4);
    const len = ctx.lent(u, v);
    const dark = sstep(0.62, 0.68, p);
    const h = 0.6 + 0.1 * n - len * 0.35 - dark * 0.3;
    let c = mix3(hex('#d2cec4'), hex('#ece9e1'), n);
    c = mix3(c, hex('#8b8579'), sstep(0.55, 0.62, p) * 0.4);
    c = mix3(c, hex('#2a2724'), Math.max(len, dark));
    return [c, h];
  } },
  // Kiefer: irregular flaky plates, reddish crevices (orange tint on the upper trunk comes from vertex colour)
  pine: { strength: 8, fn(N, u, v) {
    const wu = u + (N.fbm(u, v, 5, 5, 3) - 0.5) * 0.1;
    const [f1, f2] = N.worley(wu, v, 6, 9);
    const edge = f2 - f1, n = N.fbm(u, v, 16, 16, 4);
    const fis = 1 - sstep(0.02, 0.16, edge);
    const h = (0.45 + 0.4 * n + 0.15 * f1) * (1 - fis * 0.8);
    let c = mix3(hex('#625850'), hex('#8a7666'), n);
    c = mix3(c, hex('#30251e'), fis);
    return [c, h];
  } },
  // Fichte: small rounded scales
  spruce: { strength: 5, fn(N, u, v) {
    const [f1, f2] = N.worley(u, v, 12, 22);
    const n = N.fbm(u, v, 12, 12, 3);
    const edge = f2 - f1;
    const fis = 1 - sstep(0.03, 0.18, edge);
    const h = (1 - f1 * 0.6) * (1 - fis * 0.6);
    let c = mix3(hex('#5f4a3e'), hex('#86695a'), n * 0.7 + (1 - f1) * 0.3);
    c = mix3(c, hex('#34271f'), fis * 0.9);
    return [c, h];
  } },
};

export const BARK_KINDS = Object.keys(BARKS);

export function makeBark(kind, w = 256, h = 512) {
  const B = BARKS[kind];
  const N = makeNoise(kind.length * 97 + kind.charCodeAt(0));
  // birch lenticels: horizontal dashes
  const ctx = {};
  if (kind === 'birch') {
    const R = rng(77), mask = new Float32Array(w * h);
    for (let i = 0; i < 160; i++) {
      const cx = R() * w, cy = R() * h, l = (0.02 + R() * 0.1) * w, t = Math.max(0.8, (0.002 + R() * 0.004) * h);
      for (let y = Math.floor(cy - t * 2); y <= Math.ceil(cy + t * 2); y++) for (let x = Math.floor(cx - l); x <= Math.ceil(cx + l); x++) {
        const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
        const m = (1 - sstep(t * 0.5, t * 2, dy)) * (1 - sstep(l * 0.6, l, dx));
        const k = (((y % h) + h) % h) * w + (((x % w) + w) % w);
        if (m > mask[k]) mask[k] = m;
      }
    }
    ctx.lent = (u, v) => mask[Math.min(h - 1, Math.floor(v * h)) * w + Math.min(w - 1, Math.floor(u * w))];
  }
  const n = w * h, hf = new Float32Array(n), col = new Uint8Array(n * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [c, hv] = B.fn(N, x / w, y / h, ctx);
    const i = y * w + x;
    hf[i] = hv;
    col[i * 4] = Math.min(255, c[0] * 255); col[i * 4 + 1] = Math.min(255, c[1] * 255); col[i * 4 + 2] = Math.min(255, c[2] * 255); col[i * 4 + 3] = 255;
  }
  const nor = new Uint8Array(n * 4);
  const k = B.strength;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xl = (x + w - 1) % w, xr = (x + 1) % w, yu = (y + h - 1) % h, yd = (y + 1) % h;
    // DataTexture rows are not flipped: row y is v = y/h, so +v is +y
    const dx = (hf[y * w + xr] - hf[y * w + xl]) * k, dy = (hf[yd * w + x] - hf[yu * w + x]) * k;
    const L = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    nor[i] = (-dx / L * 0.5 + 0.5) * 255; nor[i + 1] = (-dy / L * 0.5 + 0.5) * 255; nor[i + 2] = (1 / L * 0.5 + 0.5) * 255; nor[i + 3] = 255;
  }
  const mk = (data, cs) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = cs; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4; t.needsUpdate = true;
    return t;
  };
  return { map: mk(col, THREE.SRGBColorSpace), normalMap: mk(nor, THREE.NoColorSpace) };
}
