// Terrain height field (bare earth from the Bavarian DGM1, resampled by tools/build-world.mjs).
// Pure JS, shared by the renderer, the physics and the Node walk test.
//   y = 0 is the terrain height at the scene origin; world.terrain.ref is that height above sea level.
// Encoding: steps of meta.q metres (default 1 cm), predicted from left + up − up-left neighbours,
// zig-zag, uint16, deflate, base64.

let active = null;

export class Terrain {
  constructor(meta, heights) {
    this.x0 = meta.x0; this.z0 = meta.z0; this.cell = meta.cell;
    this.nx = meta.nx; this.nz = meta.nz; this.ref = meta.ref;
    this.h = heights;
    this.x1 = this.x0 + (this.nx - 1) * this.cell; this.z1 = this.z0 + (this.nz - 1) * this.cell;
  }

  static _decode(meta, bytes) {
    if (bytes.byteOffset % 2) bytes = bytes.slice();
    const u = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    const { nx, nz } = meta;
    const cm = new Int32Array(nx * nz), h = new Float32Array(nx * nz), q = meta.q || 0.01;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, z = u[k];
      const d = (z >>> 1) ^ -(z & 1);
      const pred = j === 0 ? (i === 0 ? 0 : cm[k - 1]) : i === 0 ? cm[k - nx] : cm[k - 1] + cm[k - nx] - cm[k - nx - 1];
      cm[k] = pred + d;
      h[k] = cm[k] * q;
    }
    return new Terrain(meta, h);
  }

  static _b64(s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // browser: DecompressionStream; Node: zlib (passed in to keep this module bundle-friendly)
  static async fromWorld(meta, inflateSync = null) {
    if (!meta) return null;
    const packed = Terrain._b64(meta.data);
    let raw;
    if (inflateSync) raw = new Uint8Array(inflateSync(packed));
    else {
      const ds = new DecompressionStream('deflate');
      const buf = await new Response(new Blob([packed]).stream().pipeThrough(ds)).arrayBuffer();
      raw = new Uint8Array(buf);
    }
    return Terrain._decode(meta, raw);
  }

  // bilinear height at (x, z); clamped at the edges
  height(x, z) {
    let fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    fx = Math.min(Math.max(fx, 0), this.nx - 1.0001); fz = Math.min(Math.max(fz, 0), this.nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), ax = fx - i, az = fz - j;
    const k = j * this.nx + i, h = this.h;
    const a = h[k], b = h[k + 1], c = h[k + this.nx], d = h[k + this.nx + 1];
    return a + (b - a) * ax + (c - a) * az + (a - b - c + d) * ax * az;
  }

  // unit normal (x, y, z) from central differences
  normal(x, z, out = [0, 1, 0]) {
    const e = this.cell;
    const dx = this.height(x + e, z) - this.height(x - e, z), dz = this.height(x, z + e) - this.height(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    out[0] = -dx / l; out[1] = 2 * e / l; out[2] = -dz / l;
    return out;
  }

  // lowest / highest terrain under a polygon outline (vertices + centre)
  range(poly) {
    let lo = Infinity, hi = -Infinity;
    for (const [x, z] of poly) { const y = this.height(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    return [lo, hi];
  }
}

// Site grading: blend the ground towards height y around (x, z) — full within r0, smooth to r1.
// Used in front of entrances so doors sit at grade (as they do in reality).
Terrain.prototype.flatten = function (x, z, y, r0, r1) {
  const c = this.cell;
  const i0 = Math.max(0, Math.floor((x - r1 - this.x0) / c)), i1 = Math.min(this.nx - 1, Math.ceil((x + r1 - this.x0) / c));
  const j0 = Math.max(0, Math.floor((z - r1 - this.z0) / c)), j1 = Math.min(this.nz - 1, Math.ceil((z + r1 - this.z0) / c));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(this.x0 + i * c - x, this.z0 + j * c - z);
    if (d >= r1) continue;
    const t = d <= r0 ? 1 : 1 - (d - r0) / (r1 - r0), w = t * t * (3 - 2 * t);
    const k = j * this.nx + i;
    this.h[k] += (y - this.h[k]) * w;
  }
};

// Like flatten, but only ever raises the ground (fill up to y).
Terrain.prototype.raise = function (x, z, y, r0, r1) {
  const c = this.cell;
  const i0 = Math.max(0, Math.floor((x - r1 - this.x0) / c)), i1 = Math.min(this.nx - 1, Math.ceil((x + r1 - this.x0) / c));
  const j0 = Math.max(0, Math.floor((z - r1 - this.z0) / c)), j1 = Math.min(this.nz - 1, Math.ceil((z + r1 - this.z0) / c));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(this.x0 + i * c - x, this.z0 + j * c - z);
    if (d >= r1) continue;
    const t = d <= r0 ? 1 : 1 - (d - r0) / (r1 - r0), w = t * t * (3 - 2 * t);
    const k = j * this.nx + i;
    const v = this.h[k] + (y - this.h[k]) * w;
    if (v > this.h[k]) this.h[k] = v;
  }
};

// Like flatten, but only ever lowers the ground (a dip down to y).
Terrain.prototype.lower = function (x, z, y, r0, r1) {
  const c = this.cell;
  const i0 = Math.max(0, Math.floor((x - r1 - this.x0) / c)), i1 = Math.min(this.nx - 1, Math.ceil((x + r1 - this.x0) / c));
  const j0 = Math.max(0, Math.floor((z - r1 - this.z0) / c)), j1 = Math.min(this.nz - 1, Math.ceil((z + r1 - this.z0) / c));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(this.x0 + i * c - x, this.z0 + j * c - z);
    if (d >= r1) continue;
    const t = d <= r0 ? 1 : 1 - (d - r0) / (r1 - r0), w = t * t * (3 - 2 * t);
    const k = j * this.nx + i;
    const v = this.h[k] + (y - this.h[k]) * w;
    if (v < this.h[k]) this.h[k] = v;
  }
};

// Keep the ground below height y inside a polygon (under the floor of an enterable building).
Terrain.prototype.clampInside = function (poly, y) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const c = this.cell;
  // include grid points just outside the outline so the terrain triangles under the walls dip too
  for (let j = Math.max(0, Math.floor((z0 - this.z0) / c) - 1); j <= Math.min(this.nz - 1, Math.ceil((z1 - this.z0) / c) + 1); j++)
    for (let i = Math.max(0, Math.floor((x0 - this.x0) / c) - 1); i <= Math.min(this.nx - 1, Math.ceil((x1 - this.x0) / c) + 1); i++) {
      const x = this.x0 + i * c, z = this.z0 + j * c;
      if (!inPoly(x, z, poly) && !(inPoly(x + c * 0.7, z, poly) && inPoly(x - c * 0.7, z, poly)) && !(inPoly(x, z + c * 0.7, poly) && inPoly(x, z - c * 0.7, poly))) continue;
      const k = j * this.nx + i;
      if (this.h[k] > y) this.h[k] = y;
    }
};

// Bridge decks: world data r.by holds the deck height at every vertex of a bridge road.
// Returns one inclined rectangle per polyline segment: centre, direction, half length/width, end
// heights. The deck carries the mapped sidewalks (on their side only). At a free end (abutment) a
// flat approach slab continues the deck for SLAB m, so the road meets the bridge level even where
// the ground next to the abutment was cut down for an underpass.
const SLAB = 3;
const deckCache = new WeakMap();
export function bridgeDecks(world) {
  if (deckCache.has(world)) return deckCache.get(world);
  const out = [];
  const key = p => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  const uses = new Map();
  for (const r of world.roads) if (r.br && r.by) for (const p of r.p) uses.set(key(p), (uses.get(key(p)) || 0) + 1);
  for (const r of world.roads) {
    if (!r.br || !r.by || r.p.length < 2) continue;
    let total = 0;
    for (let i = 1; i < r.p.length; i++) total += Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]);
    if (total < 1) continue;
    // extents to the left (strip offset > 0, normal (uz, -ux)) and right, sidewalks included
    const sw = r.sw || [0, 0];
    const eL = r.w / 2 + (sw[0] ? 0.15 + sw[0] : 0) + 0.3, eR = r.w / 2 + (sw[1] ? 0.15 + sw[1] : 0) + 0.3;
    const hw = (eL + eR) / 2, off = (eL - eR) / 2;
    const pv = r.by.length === r.p.length;       // r.by per vertex (older data: at the two ends only)
    let acc = 0;
    for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05) continue;
      const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
      const y0 = pv ? r.by[i] : r.by[0] + (r.by[1] - r.by[0]) * acc / total, y1 = pv ? r.by[i + 1] : r.by[0] + (r.by[1] - r.by[0]) * (acc + L) / total;
      const cx = (a[0] + b[0]) / 2 + uz * off, cz = (a[1] + b[1]) / 2 - ux * off;
      const first = i === 0, last = i === r.p.length - 2;
      // overlap into the neighbouring piece so joints and the outside of bends have no gap:
      // e0/e1 extend the walkable ramp (deckRamp) beyond this segment's ends
      const bend = j => {
        const p = r.p[j - 1], q = r.p[j], n = r.p[j + 1];
        const a1 = Math.atan2(q[1] - p[1], q[0] - p[0]), a2 = Math.atan2(n[1] - q[1], n[0] - q[0]);
        let t = Math.abs(a2 - a1); if (t > Math.PI) t = 2 * Math.PI - t;
        return Math.min(3, hw * Math.tan(Math.min(t, 1.2) / 2) + 0.3);
      };
      const e0 = first ? (uses.get(key(a)) === 1 ? 0.25 : 1) : bend(i);
      const e1 = last ? (uses.get(key(b)) === 1 ? 0.25 : 1) : bend(i + 1);
      out.push({ road: r, cx, cz, ux, uz, hl: L / 2, hw, y0, y1, first, last, s0: acc, s1: acc + L, total, e0, e1 });
      // approach slabs at free ends: anchor (deck end centre), outward direction, deck level
      if (first && uses.get(key(a)) === 1) out.push({ road: r, slab: true, ax: cx - ux * L / 2, az: cz - uz * L / 2, dx: -ux, dz: -uz, y: y0, hw });
      if (last && uses.get(key(b)) === 1) out.push({ road: r, slab: true, ax: cx + ux * L / 2, az: cz + uz * L / 2, dx: ux, dz: uz, y: y1, hw });
      acc += L;
    }
  }
  deckCache.set(world, out);
  return out;
}

// The walkable ramp of a deck piece, extended by its joint overlaps.
export function deckRamp(d) {
  const e0 = d.e0 || 0, e1 = d.e1 || 0;
  if (!e0 && !e1) return d;
  const k = (d.y1 - d.y0) / (2 * d.hl), sh = (e1 - e0) / 2;
  return { ...d, cx: d.cx + d.ux * sh, cz: d.cz + d.uz * sh, hl: d.hl + (e0 + e1) / 2, y0: d.y0 - k * e0, y1: d.y1 + k * e1 };
}

// An approach slab reaches from the abutment over a dip in the (graded) ground — the cut of an
// underpass next to the abutment — to where the ground is back at deck level. Returns a flat
// deck piece, or null where the road meets the bridge at grade or falls away from it.
export function fitSlab(d) {
  const px = -d.dz, pz = d.dx;
  let D = 0, back = false;
  for (let s = 0.5; s <= 14; s += 0.5) {
    let low = false;
    for (const o of [-0.7, 0, 0.7]) if (groundY(d.ax + d.dx * s + px * o * d.hw, d.az + d.dz * s + pz * o * d.hw) < d.y - 0.25) low = true;
    if (!low) { back = true; break; }
    D = s;
  }
  // only a dip the ground climbs back out of; a road that keeps falling away needs no slab
  if (D < 0.5 || !back) return null;
  const L = D + 0.75;
  return { ...d, cx: d.ax + d.dx * L / 2, cz: d.az + d.dz * L / 2, ux: d.dx, uz: d.dz, hl: L / 2, y0: d.y, y1: d.y };
}

// Railings along both deck edges, as straight pieces {ax, az, bx, bz, ya, yb} (deck heights).
// They stop 1.5 m short of every way end and leave a gap wherever the edge runs across another
// deck at about the same level (junctions, slip roads, the inside of bends).
const railCache = new WeakMap();
export function bridgeRailings(world) {
  if (railCache.has(world)) return railCache.get(world);
  const decks = bridgeDecks(world).filter(d => !d.slab);
  const GC = 24, grid = new Map();
  decks.forEach((d, i) => {
    const r = d.hl + d.hw + 1;
    for (let gx = Math.floor((d.cx - r) / GC); gx <= Math.floor((d.cx + r) / GC); gx++)
      for (let gz = Math.floor((d.cz - r) / GC); gz <= Math.floor((d.cz + r) / GC); gz++) {
        const k = gx + ',' + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
      }
  });
  const inOther = (self, x, z, y) => {
    for (const i of grid.get(Math.floor(x / GC) + ',' + Math.floor(z / GC)) || []) {
      const d = decks[i]; if (d === self) continue;
      const u = (x - d.cx) * d.ux + (z - d.cz) * d.uz, v = -(x - d.cx) * d.uz + (z - d.cz) * d.ux;
      if (Math.abs(u) > d.hl + 0.2 || Math.abs(v) > d.hw - 0.15) continue;
      const dy = d.y0 + (d.y1 - d.y0) * Math.min(1, Math.max(0, (u + d.hl) / (2 * d.hl)));
      if (Math.abs(dy - y) < 2) return true;
    }
    return false;
  };
  let out = [];
  for (const d of decks) {
    const s0 = d.first ? 1.5 : 0, s1 = d.last ? 1.5 : 0;
    const len = d.hl * 2 - s0 - s1;
    if (len < 0.3) continue;
    const n = Math.max(1, Math.ceil(len / 0.5));
    for (const side of [-1, 1]) {
      const ox = -d.uz * (d.hw + 0.05) * side, oz = d.ux * (d.hw + 0.05) * side;
      const P = s => { const t = -d.hl + s0 + len * s; return [d.cx + d.ux * t + ox, d.cz + d.uz * t + oz, d.y0 + (d.y1 - d.y0) * (t + d.hl) / (2 * d.hl)]; };
      let start = -1;
      for (let k = 0; k <= n; k++) {
        const q = P(k / n), free = !inOther(d, q[0], q[1], q[2]);
        if (free && start < 0) start = k;
        if ((!free || k === n) && start >= 0) {
          const end = free ? k : k - 1;
          if (end > start) { const A = P(start / n), B = P(end / n); out.push({ ax: A[0], az: A[1], ya: A[2], bx: B[0], bz: B[1], yb: B[2] }); }
          start = -1;
        }
      }
    }
  }
  // gaps where a way on the ground meets the deck edge at deck level (paths joining a bridge)
  const pg = new Map();
  out.forEach((q, i) => {
    for (let gx = Math.floor(Math.min(q.ax, q.bx) / GC); gx <= Math.floor(Math.max(q.ax, q.bx) / GC); gx++)
      for (let gz = Math.floor(Math.min(q.az, q.bz) / GC); gz <= Math.floor(Math.max(q.az, q.bz) / GC); gz++) {
        const k = gx + ',' + gz; if (!pg.has(k)) pg.set(k, []); pg.get(k).push(i);
      }
  });
  const cuts = new Map();
  for (const r of world.roads) {
    if (r.br || r.k === 'motorway' || r.k === 'trunk') continue;
    const half = r.w / 2 + 0.4;
    for (let i = 1; i < r.p.length; i++) {
      const [x1, z1] = r.p[i - 1], [x2, z2] = r.p[i];
      const cand = new Set();
      for (let gx = Math.floor(Math.min(x1, x2) / GC); gx <= Math.floor(Math.max(x1, x2) / GC); gx++)
        for (let gz = Math.floor(Math.min(z1, z2) / GC); gz <= Math.floor(Math.max(z1, z2) / GC); gz++)
          for (const j of pg.get(gx + ',' + gz) || []) cand.add(j);
      for (const j of cand) {
        const q = out[j];
        const ex = q.bx - q.ax, ez = q.bz - q.az, fx = x2 - x1, fz = z2 - z1;
        const den = ex * fz - ez * fx; if (Math.abs(den) < 1e-9) continue;
        const t = ((x1 - q.ax) * fz - (z1 - q.az) * fx) / den, u = ((x1 - q.ax) * ez - (z1 - q.az) * ex) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const px = q.ax + ex * t, pz = q.az + ez * t, y = q.ya + (q.yb - q.ya) * t;
        if (Math.abs(groundY(px, pz) - y) > 0.8) continue;
        const L = Math.hypot(ex, ez), sn = Math.abs(ex * fz - ez * fx) / (L * Math.hypot(fx, fz) || 1);
        const w = half / Math.max(0.35, sn);           // wider gap for a way crossing at a slant
        if (!cuts.has(j)) cuts.set(j, []);
        cuts.get(j).push([t * L - w, t * L + w]);
      }
    }
  }
  if (cuts.size) {
    const cut = [];
    out.forEach((q, j) => {
      const cs = cuts.get(j);
      if (!cs) { cut.push(q); return; }
      const L = Math.hypot(q.bx - q.ax, q.bz - q.az);
      cs.sort((a, b) => a[0] - b[0]);
      let s = 0;
      const piece = (a, b) => {
        if (b - a < 0.3) return;
        const f0 = a / L, f1 = b / L;
        cut.push({ ax: q.ax + (q.bx - q.ax) * f0, az: q.az + (q.bz - q.az) * f0, ya: q.ya + (q.yb - q.ya) * f0, bx: q.ax + (q.bx - q.ax) * f1, bz: q.az + (q.bz - q.az) * f1, yb: q.ya + (q.yb - q.ya) * f1 });
      };
      for (const [a, b] of cs) { if (a > s) piece(s, Math.min(a, L)); s = Math.max(s, b); }
      if (s < L) piece(s, L);
    });
    out = cut;
  }
  railCache.set(world, out);
  return out;
}

// The ground in front of every mapped entrance is graded to its building's floor level.
export function gradeEntrances(world, t) {
  for (const e of world.entrances) {
    const b = world.buildings[e.b];
    if (!b || b.y0 == null || b.mh > 0.1) continue;
    t.flatten(e.x + e.nx * 1.2, e.z + e.nz * 1.2, b.y0, 2.0, 6.0);
  }
}

// Grade the ground in front of every mapped entrance to its building's floor level, and keep
// the ground clear below bridge decks.
export function gradeSite(world, t) {
  if (!t) return;
  // underpasses: where a bridge couldn't be raised enough, the way below dips under it
  for (const [x, z, y, r0, r1] of world.sinks || []) t.lower(x, z, y, r0, r1);
  for (const d of bridgeDecks(world)) {
    if (d.slab) continue;
    const n = Math.ceil(d.hl * 2 / t.cell) + 1;
    for (let k = 0; k <= n; k++) {
      const f = k / n, s = d.s0 + (d.s1 - d.s0) * f;
      if (s < 2 || s > d.total - 2) continue;         // abutments stay on the ground
      const x = d.cx + d.ux * (f - 0.5) * d.hl * 2, z = d.cz + d.uz * (f - 0.5) * d.hl * 2;
      const deck = d.y0 + (d.y1 - d.y0) * f;
      for (const o of [-d.hw, 0, d.hw]) {
        const px = x - d.uz * o, pz = z + d.ux * o;
        if (t.height(px, pz) > deck - 0.6) t.flatten(px, pz, deck - 0.9, 0.5, 2.5);
      }
    }
  }
  gradeEntrances(world, t);
  // ponds: the water surface is level at the lowest shore, the bed lies below it
  for (const a of world.areas) {
    if (a.k !== 'water') continue;
    const lvl = waterLevel(a, t);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of a.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const c = t.cell;
    for (let j = Math.max(0, Math.floor((z0 - t.z0) / c)); j <= Math.min(t.nz - 1, Math.ceil((z1 - t.z0) / c)); j++)
      for (let i = Math.max(0, Math.floor((x0 - t.x0) / c)); i <= Math.min(t.nx - 1, Math.ceil((x1 - t.x0) / c)); i++) {
        const x = t.x0 + i * c, z = t.z0 + j * c;
        if (!inPoly(x, z, a.p) || (a.hl && a.hl.some(h => inPoly(x, z, h)))) continue;
        const k = j * t.nx + i;
        t.h[k] = Math.min(t.h[k], lvl - 0.5);
      }
  }
  // abutments last: the ground at every free bridge end is back at deck level (lowering nearby
  // grid points for an underpass or a pond must not leave a step between the path and the deck)
  for (const d of bridgeDecks(world)) if (d.slab) t.raise(d.ax + d.dx * 0.5, d.az + d.dz * 0.5, d.y - 0.03, 1.0, 3.5);
}

function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// water surface of a pond: the lowest point of its shore (cached on the area)
export function waterLevel(a, t = active) {
  if (a._lvl != null) return a._lvl;
  let lo = Infinity;
  for (const [x, z] of a.p) lo = Math.min(lo, t ? t.height(x, z) : 0);
  return (a._lvl = lo - 0.05);
}

export function setTerrain(t) { active = t; }
export function getTerrain() { return active; }
// terrain height, 0 when no terrain is loaded (old data, tests without terrain)
export function groundY(x, z) { return active ? active.height(x, z) : 0; }
