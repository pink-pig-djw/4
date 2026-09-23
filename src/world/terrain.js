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

// Bridge decks: the road runs straight between the ground at both ends (world data r.by).
// Returns one inclined rectangle per polyline segment: centre, direction, half length/width, end heights.
export function bridgeDecks(world) {
  const out = [];
  for (const r of world.roads) {
    if (!r.br || !r.by || r.p.length < 2) continue;
    let total = 0;
    for (let i = 1; i < r.p.length; i++) total += Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]);
    if (total < 1) continue;
    let acc = 0;
    for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05) continue;
      const y0 = r.by[0] + (r.by[1] - r.by[0]) * acc / total, y1 = r.by[0] + (r.by[1] - r.by[0]) * (acc + L) / total;
      out.push({ road: r, cx: (a[0] + b[0]) / 2, cz: (a[1] + b[1]) / 2, ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L, hl: L / 2, hw: r.w / 2 + 0.3, y0, y1, first: i === 0, last: i === r.p.length - 2, s0: acc, s1: acc + L, total });
      acc += L;
    }
  }
  return out;
}

// Grade the ground in front of every mapped entrance to its building's floor level, and keep
// the ground clear below bridge decks.
export function gradeSite(world, t) {
  if (!t) return;
  for (const d of bridgeDecks(world)) {
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
  for (const e of world.entrances) {
    const b = world.buildings[e.b];
    if (!b || b.y0 == null || b.mh > 0.1) continue;
    t.flatten(e.x + e.nx * 1.2, e.z + e.nz * 1.2, b.y0, 2.0, 6.0);
  }
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
