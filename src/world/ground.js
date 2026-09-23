// Ground: the terrain itself (Bavarian DGM1) with land cover painted into it, and everything
// draped on top of it — land-use areas, roads, sidewalks, kerbs, markings, water and bridges.
//
// Terrain: 192 m chunks at four levels of detail (3/6/12/24 m), skirts hide the seams.
// Natural cover (forest floor, meadow, fields, scrub) comes from a land-cover texture blended in
// the terrain shader; artificial surfaces are real geometry, subdivided so it follows the ground.
import * as THREE from 'three';
import { getTerrain, groundY, bridgeDecks, waterLevel } from './terrain.js';
import * as T from './textures.js';
import { globalUniforms } from './materials.js';

const DRAPE_EDGE = 3;     // max triangle edge of draped layers (m) = terrain grid
const CHUNK = 256;        // spatial chunks for draped layers
const TCHUNK = 64;        // terrain chunk size in grid cells (64 × 3 m = 192 m)

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Triangle soup split into spatial chunks; optional subdivision so draped layers follow the ground.
class GroundBuf {
  constructor(maxEdge = DRAPE_EDGE) { this.maxEdge = maxEdge; this.chunks = new Map(); }
  _c(x, z) {
    const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    let c = this.chunks.get(k);
    if (!c) this.chunks.set(k, c = { pos: [], uv: [], nor: [], x: (Math.floor(x / CHUNK) + 0.5) * CHUNK, z: (Math.floor(z / CHUNK) + 0.5) * CHUNK });
    return c;
  }
  // a,b,c = [x,z]; y = absolute height (number) or function(p) → height
  tri(a, b, c, y) {
    const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (cr < 0) { const t = b; b = c; c = t; }
    this._tri(a, b, c, y, 0);
  }
  _tri(a, b, c, y, depth) {
    if (this.maxEdge > 0 && depth < 18) {
      const lab = dist2(a, b), lbc = dist2(b, c), lca = dist2(c, a), m = Math.max(lab, lbc, lca);
      if (m > this.maxEdge) {
        if (m === lab) { const p = mid(a, b); this._tri(a, p, c, y, depth + 1); this._tri(p, b, c, y, depth + 1); }
        else if (m === lbc) { const p = mid(b, c); this._tri(a, b, p, y, depth + 1); this._tri(a, p, c, y, depth + 1); }
        else { const p = mid(c, a); this._tri(a, b, p, y, depth + 1); this._tri(p, b, c, y, depth + 1); }
        return;
      }
    }
    const ch = this._c((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3);
    const T0 = getTerrain(), n = [0, 1, 0];
    for (const p of [a, b, c]) {
      ch.pos.push(p[0], typeof y === 'number' ? y : y(p), p[1]);
      ch.uv.push(p[0], p[1]);
      if (T0 && typeof y !== 'number' && this.tn !== false) T0.normal(p[0], p[1], n); else { n[0] = 0; n[1] = 1; n[2] = 0; }
      ch.nor.push(n[0], n[1], n[2]);
    }
  }
  quad(a, b, c, d, y) { this.tri(a, b, c, y); this.tri(a, c, d, y); }
  meshes(mat, opts = {}) {
    const out = [];
    for (const c of this.chunks.values()) {
      if (!c.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      if (opts.renderOrder != null) m.renderOrder = opts.renderOrder;
      m.userData.cull = { x: c.x, z: c.z, r: CHUNK * 0.72, maxDist: opts.maxDist ?? 900, castDist: 0, cast: false };
      out.push(m);
    }
    return out;
  }
}

// Per-vertex miter offsets for a polyline.
function miters(pts) {
  const n = pts.length, out = [];
  const segN = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dz) || 1;
    segN.push([dz / l, -dx / l]); // left normal
  }
  for (let i = 0; i < n; i++) {
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(n - 2, i)];
    let mx = a[0] + b[0], mz = a[1] + b[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = b[0]; mz = b[1]; } else { mx /= ml; mz /= ml; }
    const dot = Math.max(0.35, mx * b[0] + mz * b[1]);
    out.push([mx / dot, mz / dot]);
  }
  return out;
}

// Strip between lateral offsets o0..o1 (left positive) along pts.
export function strip(buf, pts, o0, o1, y, extend = 0) {
  if (pts.length < 2) return;
  pts = pts.slice();
  if (extend) {
    const e = (p, q) => { const dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz) || 1; return [p[0] + dx / l * extend, p[1] + dz / l * extend]; };
    pts[0] = e(pts[0], pts[1]);
    pts[pts.length - 1] = e(pts[pts.length - 1], pts[pts.length - 2]);
  }
  const m = miters(pts);
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1], mp = m[i], mq = m[i + 1];
    const A = [p[0] + mp[0] * o0, p[1] + mp[1] * o0], B = [p[0] + mp[0] * o1, p[1] + mp[1] * o1];
    const C = [q[0] + mq[0] * o1, q[1] + mq[1] * o1], D = [q[0] + mq[0] * o0, q[1] + mq[1] * o0];
    buf.quad(A, B, C, D, y);
  }
}

function disc(buf, x, z, r, y, seg = 10) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    buf.tri([x, z], [x + Math.cos(a0) * r, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, z + Math.sin(a1) * r], y);
  }
}

function polygon(buf, outer, holes, y) {
  const contour = outer.map(p => new THREE.Vector2(p[0], p[1]));
  const hs = (holes || []).map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
  const all = contour.concat(...hs);
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  for (const t of tris) buf.tri([all[t[0]].x, all[t[0]].y], [all[t[1]].x, all[t[1]].y], [all[t[2]].x, all[t[2]].y], y);
}

const MOTOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'primary_link', 'secondary_link', 'tertiary_link', 'motorway', 'motorway_link', 'trunk_link']);
// natural land cover is painted into the terrain, not drawn as geometry
const COVER = { forest: 0, wetland: 0, meadow: 1, farmland: 2, scrub: 3, heath: 3, grass: -1, island: -1 };

export const ROAD_Y = {
  footway: 0.036, path: 0.036, track: 0.036, steps: 0.036, platform: 0.036, bridleway: 0.036, pedestrian: 0.038,
  cycleway: 0.038, service: 0.040, living_street: 0.041, residential: 0.043, unclassified: 0.043,
};
const roadY = k => ROAD_Y[k] ?? 0.045;
export const SIDEWALK_Y = 0.075;

const drape = off => p => groundY(p[0], p[1]) + off;

// Height function for a road: the ground, or on a bridge the straight deck between its ends.
function roadHeight(r, decks, off) {
  if (!r.br || !r.by) return drape(off);
  const ds = decks.filter(d => d.road === r);
  return p => {
    let best = null, bd = Infinity;
    for (const d of ds) {
      const a = (p[0] - d.cx) * d.ux + (p[1] - d.cz) * d.uz;
      const cl = Math.max(-d.hl, Math.min(d.hl, a));
      const e = Math.abs(a - cl) + Math.abs(-(p[0] - d.cx) * d.uz + (p[1] - d.cz) * d.ux) * 0.01;
      if (e < bd) { bd = e; best = d.y0 + (d.y1 - d.y0) * (cl + d.hl) / (2 * d.hl); }
    }
    return (best ?? groundY(p[0], p[1])) + off + 0.05;
  };
}

// ---------------------------------------------------------------------------------------------

export function buildGround(world, mats, renderer) {
  const group = new THREE.Group();
  group.name = 'ground';
  const terrain = getTerrain();
  const decks = bridgeDecks(world);
  // roads, areas and markings are painted into the terrain (see GroundDecals)
  const decals = terrain && renderer ? new GroundDecals(renderer, world, mats, terrain) : null;
  group.userData.decals = decals;
  buildTerrain(group, world, mats, terrain, decals);
  if (!decals) {
    // no terrain: the flat layers go straight into the scene
    for (const m of flatLayers(world, mats, false)) group.add(m);
  }

  // ---- water: flat at the lowest shore ----
  {
    const b = new GroundBuf(0);
    for (const a of world.areas) {
      if (a.k !== 'water') continue;
      try { polygon(b, a.p, a.hl, waterLevel(a)); } catch (e) { /* degenerate */ }
    }
    for (const m of b.meshes(mats.water)) group.add(m);
  }

  // ---- roads on bridges: real geometry on the deck ----
  {
    const bufs = new Map();
    const getB = mat => { let b = bufs.get(mat); if (!b) { bufs.set(mat, b = new GroundBuf(0)); b.tn = false; } return b; };
    for (const r of world.roads) {
      if (!r.br || !r.by) continue;
      const hw = r.w / 2;
      strip(getB(mats.road[r.s] || mats.road.asphalt), r.p, -hw, hw, roadHeight(r, decks, 0.04), 0);
      if (r.sw) {
        const [l, rr] = r.sw;
        if (l) strip(getB(mats.road.sidewalk), r.p, hw + 0.15, hw + 0.15 + l, roadHeight(r, decks, SIDEWALK_Y));
        if (rr) strip(getB(mats.road.sidewalk), r.p, -hw - 0.15 - rr, -hw - 0.15, roadHeight(r, decks, SIDEWALK_Y));
      }
    }
    for (const [mat, b] of bufs) for (const m of b.meshes(mat, { renderOrder: 40 })) group.add(m);
  }
  buildBridges(group, decks, mats);
  return group;
}

// Flat (y ≈ 0) ground layers: land-use areas, roads, sidewalks, kerbs, markings, streams.
// With terrain these are rendered top-down into textures; without, straight into the scene.
function flatLayers(world, mats, decal) {
  const out = [];
  const M = m => decal ? decalMaterial(m) : m;
  const areaBufs = new Map();
  for (const a of world.areas) {
    if (a.k in COVER || a.k === 'water') continue;
    const mat = mats.area[a.k];
    if (!mat) continue;
    let b = areaBufs.get(mat);
    if (!b) areaBufs.set(mat, b = new GroundBuf(0));
    try { polygon(b, a.p, a.hl, 0.004 + a.o * 0.003); } catch (e) { /* degenerate polygon */ }
  }
  for (const [mat, b] of areaBufs) out.push(...b.meshes(M(mat), { renderOrder: 45 - (mat.polygonOffsetFactor ? -mat.polygonOffsetFactor : 0) }));
  {
    const b = new GroundBuf(0);
    for (const w of world.waterways) strip(b, w.p, -w.w / 2, w.w / 2, 0.03, 0.2);
    out.push(...b.meshes(M(mats.water)));
  }
  const roadBufs = new Map();
  const getB = (mat) => { let b = roadBufs.get(mat); if (!b) roadBufs.set(mat, b = new GroundBuf(0)); return b; };
  const sw = getB(mats.road.sidewalk), curb = getB(mats.road.curb), mark = getB(mats.marking);
  const endpoints = new Map();
  for (const r of world.roads) {
    if (r.br && r.by && decal) continue;   // bridges are geometry on their deck
    const mat = mats.road[r.s] || mats.road.asphalt;
    const b = getB(mat);
    const y = roadY(r.k);
    const hw = r.w / 2;
    strip(b, r.p, -hw, hw, y, 0);
    for (const e of [r.p[0], r.p[r.p.length - 1]]) {
      const key = e[0].toFixed(1) + ',' + e[1].toFixed(1);
      const cur = endpoints.get(key);
      if (!cur || cur.hw < hw || (cur.hw === hw && cur.y < y)) endpoints.set(key, { x: e[0], z: e[1], hw, y, b });
    }
    if (r.sw) {
      const [l, rr] = r.sw;
      if (l) { strip(sw, r.p, hw + 0.15, hw + 0.15 + l, SIDEWALK_Y); strip(curb, r.p, hw, hw + 0.15, SIDEWALK_Y + 0.002); }
      if (rr) { strip(sw, r.p, -hw - 0.15 - rr, -hw - 0.15, SIDEWALK_Y); strip(curb, r.p, -hw - 0.15, -hw, SIDEWALK_Y + 0.002); }
    }
    // centre dashes on two-way major roads (3 m line / 6 m gap)
    if (MAJOR.has(r.k) && !r.ow && r.w >= 6.4) dashes(mark, r.p, 0, 0.12, 3, 6, y + 0.006);
    // edge lines on motorways and major roads
    if ((r.k === 'motorway' || r.k === 'trunk' || r.k === 'motorway_link' || r.k === 'trunk_link') && r.w >= 6) {
      strip(mark, r.p, hw - 0.5, hw - 0.3, y + 0.006); strip(mark, r.p, -hw + 0.3, -hw + 0.5, y + 0.006);
    }
  }
  for (const e of endpoints.values()) disc(e.b, e.x, e.z, e.hw, e.y, e.hw > 2 ? 14 : 8);
  const nodeCount = new Map();
  for (const r of world.roads) {
    if (r.br && r.by && decal) continue;
    for (const p of r.p) {
      const key = p[0].toFixed(1) + ',' + p[1].toFixed(1);
      const c = nodeCount.get(key);
      const hw = r.w / 2;
      if (!c) nodeCount.set(key, { n: 1, hw, r, p }); else { c.n++; if (hw > c.hw) { c.hw = hw; c.r = r; } }
    }
  }
  for (const c of nodeCount.values()) {
    if (c.n < 2) continue;
    disc(getB(mats.road[c.r.s] || mats.road.asphalt), c.p[0], c.p[1], c.hw, roadY(c.r.k), c.hw > 2 ? 14 : 8);
  }
  for (const [x, z, kind] of world.crossings) {
    if (!kind) continue;
    const hit = nearestRoad(world, x, z, 1.5, r => MOTOR.has(r.k) && r.k !== 'service');
    if (!hit) continue;
    const { r, ux, uz } = hit;
    const vx = uz, vz = -ux;
    const y = roadY(r.k) + 0.007;
    const half = r.w / 2 - 0.3;
    if (kind === 1) {
      for (let t = -half + 0.25; t <= half - 0.25; t += 1.0) {
        const cx = x + vx * t, cz = z + vz * t;
        mark.quad([cx - ux * 2 - vx * 0.25, cz - uz * 2 - vz * 0.25], [cx + ux * 2 - vx * 0.25, cz + uz * 2 - vz * 0.25],
          [cx + ux * 2 + vx * 0.25, cz + uz * 2 + vz * 0.25], [cx - ux * 2 + vx * 0.25, cz - uz * 2 + vz * 0.25], y);
      }
    } else {
      for (const s of [-2, 2]) for (let t = -half; t < half; t += 1.0) {
        const cx = x + ux * s + vx * (t + 0.25), cz = z + uz * s + vz * (t + 0.25);
        mark.quad([cx - vx * 0.25 - ux * 0.06, cz - vz * 0.25 - uz * 0.06], [cx + vx * 0.25 - ux * 0.06, cz + vz * 0.25 - uz * 0.06],
          [cx + vx * 0.25 + ux * 0.06, cz + vz * 0.25 + uz * 0.06], [cx - vx * 0.25 + ux * 0.06, cz - vz * 0.25 + uz * 0.06], y);
      }
    }
  }
  for (const [mat, b] of roadBufs) out.push(...b.meshes(M(mat), { renderOrder: 40 - (mat.polygonOffsetFactor ? -mat.polygonOffsetFactor : 0) }));
  return out;
}

// Albedo-only copy of a ground material for the top-down decal pass (no lighting, no wetness –
// the terrain shader lights it and makes it wet).
const decalMats = new Map();
function decalMaterial(m) {
  let d = decalMats.get(m);
  if (!d) {
    d = new THREE.MeshBasicMaterial({ map: m.map || null, color: m.color.clone(), vertexColors: !!m.vertexColors });
    d.polygonOffset = m.polygonOffset; d.polygonOffsetFactor = m.polygonOffsetFactor; d.polygonOffsetUnits = m.polygonOffsetUnits;
    d.fog = false;
    decalMats.set(m, d);
  }
  return d;
}

// Roads, sidewalks, markings and land-use areas rendered from above into three textures that the
// terrain shader samples: near (128 m around the player, 6 cm/px), mid (512 m, 25 cm/px) and the
// whole region (~1.2 m/px). Near and mid follow the camera.
class GroundDecals {
  constructor(renderer, world, mats, terrain) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    for (const m of flatLayers(world, mats, true)) { m.frustumCulled = true; this.scene.add(m); }
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 60);
    this.cam.up.set(0, 0, -1);
    const mk = (w, h, mip) => {
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, generateMipmaps: mip, minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, anisotropy: 8 });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      return rt;
    };
    const X0 = terrain.x0, X1 = terrain.x1, Z0 = terrain.z0, Z1 = terrain.z1;
    const px = Math.max(1, Math.max(X1 - X0, Z1 - Z0) / 4096);   // ~1.2 m per texel over the whole region
    const fw = Math.ceil((X1 - X0) / px), fh = Math.ceil((Z1 - Z0) / px);
    this.levels = {
      near: { rt: mk(2048, 2048, true), size: 128, step: 16, box: new THREE.Vector4(1e9, 1e9, 128, 128), cx: null, cz: null },
      mid: { rt: mk(2048, 2048, true), size: 512, step: 64, box: new THREE.Vector4(1e9, 1e9, 512, 512), cx: null, cz: null },
      far: { rt: mk(fw, fh, true), sx: X1 - X0, sz: Z1 - Z0, box: new THREE.Vector4((X0 + X1) / 2, (Z0 + Z1) / 2, X1 - X0, Z1 - Z0) },
    };
    this.uniforms = {
      uDecN: { value: this.levels.near.rt.texture }, uBoxN: { value: this.levels.near.box },
      uDecM: { value: this.levels.mid.rt.texture }, uBoxM: { value: this.levels.mid.box },
      uDecF: { value: this.levels.far.rt.texture }, uBoxF: { value: this.levels.far.box },
    };
    this._render(this.levels.far, this.levels.far.box.x, this.levels.far.box.y, this.levels.far.sx, this.levels.far.sz);
  }

  _render(L, cx, cz, sx, sz) {
    const c = this.cam;
    c.left = -sx / 2; c.right = sx / 2; c.top = sz / 2; c.bottom = -sz / 2;
    c.position.set(cx, 30, cz); c.lookAt(cx, 0, cz); c.updateProjectionMatrix(); c.updateMatrixWorld();
    const r = this.r, prev = r.getRenderTarget(), pc = r.getClearColor(new THREE.Color()), pa = r.getClearAlpha();
    const shadow = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
    r.setRenderTarget(L.rt);
    r.setClearColor(0x000000, 0); r.clear(true, true, false);
    r.render(this.scene, c);
    r.setRenderTarget(prev); r.setClearColor(pc, pa);
    r.shadowMap.autoUpdate = shadow;
    L.box.x = cx; L.box.y = cz;
  }

  update(dt, game) {
    const p = game.camera.position;
    for (const k of ['near', 'mid']) {
      const L = this.levels[k];
      const cx = Math.round(p.x / L.step) * L.step, cz = Math.round(p.z / L.step) * L.step;
      if (cx !== L.cx || cz !== L.cz) { L.cx = cx; L.cz = cz; this._render(L, cx, cz, L.size, L.size); }
    }
  }
}

// Bridge structure below the deck (slab + edge beams) and railings.
function buildBridges(group, decks, mats) {
  const pos = [], nor = [], idx = [];
  const box = (d, o0, o1, yTop, yBot) => {
    // prism along the deck segment between lateral offsets o0..o1, top follows the deck
    const base = pos.length / 3;
    const L = d.hl, px = -d.uz, pz = d.ux;
    const P = (s, o, y) => [d.cx + d.ux * s + px * o, y, d.cz + d.uz * s + pz * o];
    const yt = s => d.y0 + (d.y1 - d.y0) * (s + L) / (2 * L);
    const corners = [
      P(-L, o0, yt(-L) + yTop), P(L, o0, yt(L) + yTop), P(L, o1, yt(L) + yTop), P(-L, o1, yt(-L) + yTop),
      P(-L, o0, yt(-L) + yBot), P(L, o0, yt(L) + yBot), P(L, o1, yt(L) + yBot), P(-L, o1, yt(-L) + yBot),
    ];
    const faces = [[0, 1, 2, 3, [0, 1, 0]], [7, 6, 5, 4, [0, -1, 0]], [4, 5, 1, 0, [-px, 0, -pz]], [3, 2, 6, 7, [px, 0, pz]], [4, 0, 3, 7, [-d.ux, 0, -d.uz]], [1, 5, 6, 2, [d.ux, 0, d.uz]]];
    for (const [a, b, c, e, n] of faces) {
      const k = pos.length / 3;
      for (const i of [a, b, c, e]) { pos.push(...corners[i]); nor.push(...n); }
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    return base;
  };
  for (const d of decks) {
    const hw = d.hw;
    box(d, -hw, hw, -0.02, -0.55);                       // deck slab
    for (const s of [-1, 1]) box(d, s * hw - 0.12, s * hw + 0.12, 0.25, -0.75);   // edge beams / kerbs
    // railing: top rail and posts
    for (const s of [-1, 1]) {
      box(d, s * (hw + 0.05) - 0.03, s * (hw + 0.05) + 0.03, 1.15, 1.08);
      box(d, s * (hw + 0.05) - 0.015, s * (hw + 0.05) + 0.015, 0.6, 0.57);
    }
    const n = Math.max(1, Math.round(d.hl * 2 / 1.6));
    for (let k = 0; k <= n; k++) {
      const s = -d.hl + d.hl * 2 * k / n;
      for (const side of [-1, 1]) {
        const o = side * (d.hw + 0.05), y = d.y0 + (d.y1 - d.y0) * (s + d.hl) / (2 * d.hl);
        const sub = { cx: d.cx + d.ux * s, cz: d.cz + d.uz * s, ux: d.ux, uz: d.uz, hl: 0.03, y0: y, y1: y };
        box(sub, o - 0.03, o + 0.03, 1.12, 0.2);
      }
    }
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mats.bridge);
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
}

// ---------------------------------------------------------------------------------------------
// Terrain mesh

function coverTexture(world, terrain) {
  const S = 4; // metres per texel
  const x0 = terrain.x0, z0 = terrain.z0, w = Math.ceil((terrain.x1 - x0) / S), h = Math.ceil((terrain.z1 - z0) / S);
  const layers = [0, 1, 2, 3].map(() => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; return { c, g }; });
  for (const a of world.areas) {
    const ch = COVER[a.k];
    if (ch == null || ch < 0) continue;
    const g = layers[ch].g;
    g.beginPath();
    for (const ring of [a.p, ...(a.hl || [])]) {
      ring.forEach((p, i) => { const X = (p[0] - x0) / S, Y = (p[1] - z0) / S; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.closePath();
    }
    g.fill('evenodd');
  }
  const data = new Uint8Array(w * h * 4);
  layers.forEach(({ g }, ch) => {
    const d = g.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) data[i * 4 + ch] = d[i * 4 + 3];
  });
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return { tex, box: new THREE.Vector4(x0, z0, w * S, h * S) };
}

function terrainMaterial(mats, cover, decals) {
  const m = mats.ground.clone();
  const forestTex = T.forestFloorTexture(), dirtTex = T.dirtTexture(), gravelTex = T.gravelTexture();
  for (const t of [forestTex, dirtTex, gravelTex]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  const base = mats.ground.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base(sh, r);
    Object.assign(sh.uniforms, { uCover: { value: cover.tex }, uCoverBox: { value: cover.box }, uForest: { value: forestTex }, uDirt: { value: dirtTex }, uGravel: { value: gravelTex } }, decals ? decals.uniforms : {});
    if (decals) sh.defines.DECALS = '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uCover; uniform vec4 uCoverBox; uniform sampler2D uForest; uniform sampler2D uDirt; uniform sampler2D uGravel;
#ifdef DECALS
uniform sampler2D uDecN; uniform sampler2D uDecM; uniform sampler2D uDecF; uniform vec4 uBoxN; uniform vec4 uBoxM; uniform vec4 uBoxF;
vec2 decUV(vec4 b, vec2 p) { return vec2((p.x - b.x) / b.z + 0.5, (b.y - p.y) / b.w + 0.5); }
#endif
varying vec3 vTN;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float fPaved = 0.0;
{
  vec4 cov = texture2D(uCover, (vGXZ - uCoverBox.xy) / uCoverBox.zw);
  vec3 forest = texture2D(uForest, vGXZ / 5.0).rgb;
  vec3 dirt = texture2D(uDirt, vGXZ / 4.0).rgb;
  vec3 gravel = texture2D(uGravel, vGXZ / 3.0).rgb;
  vec3 c = diffuseColor.rgb;
  c = mix(c, c * vec3(1.12, 1.04, 0.74), cov.g * 0.85);                       // meadow: taller, drier grass
  c = mix(c, mix(dirt, c * vec3(1.2, 1.05, 0.7), 0.35) * vec3(0.95, 0.85, 0.72), cov.b); // fields after harvest
  c = mix(c, c * vec3(0.78, 0.8, 0.62), cov.a);                               // scrub
  c = mix(c, forest, smoothstep(0.1, 0.9, cov.r));                            // forest floor (needles, leaves)
  // steep ground (embankments, cuttings): grass thins out to soil and gravel
  float steep = smoothstep(0.86, 0.7, vTN.y);
  c = mix(c, mix(dirt, gravel, 0.4), steep * 0.75);
#ifdef DECALS
  // roads, sidewalks, markings, pitches … painted from above (near / mid / whole region)
  vec2 uvN = decUV(uBoxN, vGXZ), uvM = decUV(uBoxM, vGXZ), uvF = decUV(uBoxF, vGXZ);
  vec4 dF = texture2D(uDecF, uvF), dM = texture2D(uDecM, uvM), dN = texture2D(uDecN, uvN);
  float wM = 1.0 - smoothstep(0.38, 0.48, max(abs(uvM.x - 0.5), abs(uvM.y - 0.5)));
  float wN = 1.0 - smoothstep(0.34, 0.47, max(abs(uvN.x - 0.5), abs(uvN.y - 0.5)));
  vec4 dec = mix(mix(dF, dM, wM), dN, wN);
  c = mix(c, dec.rgb, dec.a);
  fPaved = dec.a;
#endif
  diffuseColor.rgb = c;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, mix(0.88, 0.28, uWet), fPaved);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= 1.0 - 0.22 * uWet * fPaved;`);
  };
  m.customProgramCacheKey = () => 'terrain-v2' + (decals ? 'd' : '');
  return m;
}

// Terrain chunks: LOD 1–3 (6/12/24 m) are built up front, LOD 0 (3 m) only near the player.
class TerrainChunks {
  constructor(group, terrain, mat) {
    this.group = group; this.t = terrain; this.mat = mat;
    this.chunks = [];
    this.fine = new Map();   // chunk index → LOD0 mesh
    this.timer = 0;
    const { nx, nz, cell, x0, z0 } = terrain;
    for (let cj = 0; cj < nz - 1; cj += TCHUNK) for (let ci = 0; ci < nx - 1; ci += TCHUNK) {
      const i1 = Math.min(nx - 1, ci + TCHUNK), j1 = Math.min(nz - 1, cj + TCHUNK);
      const c = { ci, cj, i1, j1, x: x0 + (ci + i1) / 2 * cell, z: z0 + (cj + j1) / 2 * cell, r: TCHUNK * cell * 0.72, lods: [] };
      for (const step of [2, 4, 8]) {
        const m = this.mesh(c, step);
        m.visible = false;
        group.add(m); c.lods.push(m);
      }
      this.chunks.push(c);
    }
  }

  // normal from the height grid (central differences)
  _n(i, j, out) {
    const { nx, nz, cell } = this.t, H = this.t.h;
    const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1), jl = Math.max(0, j - 1), jr = Math.min(nz - 1, j + 1);
    const dx = (H[j * nx + ir] - H[j * nx + il]) / ((ir - il) * cell), dz = (H[jr * nx + i] - H[jl * nx + i]) / ((jr - jl) * cell);
    const l = Math.hypot(dx, 1, dz);
    out[0] = -dx / l; out[1] = 1 / l; out[2] = -dz / l;
  }

  mesh(c, step) {
    const { nx, cell, x0, z0 } = this.t, H = this.t.h;
    const pos = [], nor = [], uv = [], idx = [], n = [0, 1, 0];
    const cols = [], rows = [];
    for (let i = c.ci; i < c.i1; i += step) cols.push(i); cols.push(c.i1);
    for (let j = c.cj; j < c.j1; j += step) rows.push(j); rows.push(c.j1);
    const vert = (i, j, dy = 0) => {
      const x = x0 + i * cell, z = z0 + j * cell;
      pos.push(x, H[j * nx + i] + dy, z); uv.push(x, z);
      this._n(i, j, n); nor.push(n[0], n[1], n[2]);
      return pos.length / 3 - 1;
    };
    const grid = rows.map(j => cols.map(i => vert(i, j)));
    for (let r = 0; r < rows.length - 1; r++) for (let k = 0; k < cols.length - 1; k++) {
      const a = grid[r][k], b = grid[r][k + 1], d = grid[r + 1][k], e = grid[r + 1][k + 1];
      idx.push(a, d, b, b, d, e);
    }
    // skirts along the borders hide cracks between neighbouring levels of detail
    const skirt = (line) => {
      for (let k = 0; k < line.length - 1; k++) {
        const [ia, ja] = line[k], [ib, jb] = line[k + 1];
        const A = vert(ia, ja), B = vert(ib, jb), A2 = vert(ia, ja, -2.5), B2 = vert(ib, jb, -2.5);
        idx.push(A, A2, B, B, A2, B2, A, B, A2, B, B2, A2);
      }
    };
    skirt(cols.map(i => [i, rows[0]])); skirt(cols.map(i => [i, rows[rows.length - 1]]));
    skirt(rows.map(j => [cols[0], j])); skirt(rows.map(j => [cols[cols.length - 1], j]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat);
    m.receiveShadow = true; m.renderOrder = 50;
    return m;
  }

  update(dt, game) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const p = game.camera.position;
    this.fogFar = (game.scene.fog ? game.scene.fog.far : 1e9) + 60;
    for (let k = 0; k < this.chunks.length; k++) {
      const c = this.chunks[k];
      const d = Math.hypot(c.x - p.x, c.z - p.z) - c.r * 0.5;
      const want = d < 170 ? 0 : d < 380 ? 1 : d < 720 ? 2 : 3;
      const beyond = d > this.fogFar;
      let m = this.fine.get(k);
      if (want === 0 && !m) { m = this.mesh(c, 1); this.group.add(m); this.fine.set(k, m); }
      if (m) {
        m.visible = want === 0;
        if (d > 280) { this.group.remove(m); m.geometry.dispose(); this.fine.delete(k); }
      }
      c.lods.forEach((l, i) => { l.visible = want === i + 1 && !beyond; });
    }
  }
}

function buildTerrain(group, world, mats, terrain, decals) {
  if (!terrain) {
    // flat fallback (no elevation data)
    const b = new GroundBuf(0);
    const [x0, z0, x1, z1] = world.meta.bounds, pad = 1600;
    b.quad([x0 - pad, z0 - pad], [x1 + pad, z0 - pad], [x1 + pad, z1 + pad], [x0 - pad, z1 + pad], 0);
    for (const m of b.meshes(mats.ground, { renderOrder: 50, maxDist: 1e9 })) group.add(m);
    return;
  }
  const cover = coverTexture(world, terrain);
  const mat = terrainMaterial(mats, cover, decals);
  group.userData.terrainChunks = new TerrainChunks(group, terrain, mat);
  // beyond the elevation data: a coarse apron at the edge heights, out to the horizon
  const b = new GroundBuf(0);
  const X0 = terrain.x0, X1 = terrain.x1, Z0 = terrain.z0, Z1 = terrain.z1, pad = 1600, st = 96;
  const ring = (xa, za, xb, zb) => b.quad([xa, za], [xb, za], [xb, zb], [xa, zb], p => groundY(Math.min(Math.max(p[0], X0), X1), Math.min(Math.max(p[1], Z0), Z1)) - 0.3);
  for (let x = X0 - pad; x < X1 + pad; x += st) for (let z = Z0 - pad; z < Z1 + pad; z += st) {
    if (x >= X0 && x + st <= X1 && z >= Z0 && z + st <= Z1) continue;
    ring(x, z, Math.min(x + st, X1 + pad), Math.min(z + st, Z1 + pad));
  }
  for (const m of b.meshes(mat, { renderOrder: 50, maxDist: 1e9 })) group.add(m);
}

function dashes(buf, pts, off, w, on, gap, y) {
  let acc = 0, drawing = true, left = on;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, nx = uz, nz = -ux;
    let s = 0;
    while (s < L) {
      const step = Math.min(left, L - s);
      if (drawing) {
        const p0 = [ax + ux * s, az + uz * s], p1 = [ax + ux * (s + step), az + uz * (s + step)];
        const h = w / 2;
        buf.quad([p0[0] + nx * (off - h), p0[1] + nz * (off - h)], [p1[0] + nx * (off - h), p1[1] + nz * (off - h)],
          [p1[0] + nx * (off + h), p1[1] + nz * (off + h)], [p0[0] + nx * (off + h), p0[1] + nz * (off + h)], y);
      }
      s += step; left -= step;
      if (left <= 1e-6) { drawing = !drawing; left = drawing ? on : gap; }
    }
  }
}

// Nearest road segment to a point, returns road + unit direction.
let roadIndex = null;
export function nearestRoad(world, x, z, maxD, filter) {
  if (!roadIndex || roadIndex.world !== world) {
    const grid = new Map();
    for (const r of world.roads) for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1];
      const cx0 = Math.floor(Math.min(a[0], b[0]) / 20), cx1 = Math.floor(Math.max(a[0], b[0]) / 20);
      const cz0 = Math.floor(Math.min(a[1], b[1]) / 20), cz1 = Math.floor(Math.max(a[1], b[1]) / 20);
      for (let gx = cx0; gx <= cx1; gx++) for (let gz = cz0; gz <= cz1; gz++) {
        const k = gx + ',' + gz; let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push([r, a, b]);
      }
    }
    roadIndex = { world, grid };
  }
  let best = null, bd = maxD * maxD;
  for (let gx = Math.floor((x - maxD) / 20); gx <= Math.floor((x + maxD) / 20); gx++)
    for (let gz = Math.floor((z - maxD) / 20); gz <= Math.floor((z + maxD) / 20); gz++) {
      const arr = roadIndex.grid.get(gx + ',' + gz); if (!arr) continue;
      for (const [r, a, b] of arr) {
        if (filter && !filter(r)) continue;
        const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz; if (l2 < 1e-6) continue;
        let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = Math.max(0, Math.min(1, t));
        const px = a[0] + t * dx - x, pz = a[1] + t * dz - z, d = px * px + pz * pz;
        if (d < bd) { bd = d; const l = Math.sqrt(l2); best = { r, ux: dx / l, uz: dz / l, d: Math.sqrt(d), cx: a[0] + t * dx, cz: a[1] + t * dz }; }
      }
    }
  return best;
}
