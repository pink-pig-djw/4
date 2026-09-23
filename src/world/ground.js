// Ground: base lawn, land-use areas, roads, sidewalks, kerbs and road markings.
import * as THREE from 'three';

class GroundBuf {
  constructor() { this.pos = []; this.uv = []; }
  tri(a, b, c, y) {
    // a,b,c = [x,z]; make it face up
    const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (cr < 0) { const t = b; b = c; c = t; }
    for (const p of [a, b, c]) { this.pos.push(p[0], typeof y === 'number' ? y : y(p), p[1]); this.uv.push(p[0], p[1]); }
  }
  quad(a, b, c, d, y) { this.tri(a, b, c, y); this.tri(a, c, d, y); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const n = new Float32Array(this.pos.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
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
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'primary_link', 'secondary_link', 'tertiary_link']);

export const ROAD_Y = {
  footway: 0.036, path: 0.036, track: 0.036, steps: 0.036, platform: 0.036, bridleway: 0.036, pedestrian: 0.038,
  cycleway: 0.038, service: 0.040, living_street: 0.041, residential: 0.043, unclassified: 0.043,
};
const roadY = k => ROAD_Y[k] ?? 0.045;
export const SIDEWALK_Y = 0.075;

export function buildGround(world, mats) {
  const group = new THREE.Group();
  group.name = 'ground';
  const [x0, z0, x1, z1] = world.meta.bounds;
  const pad = 1600;
  // base plane
  {
    const buf = new GroundBuf();
    const X0 = x0 - pad, X1 = x1 + pad, Z0 = z0 - pad, Z1 = z1 + pad;
    // subdivide a little so fog/lighting interpolation is smooth
    const N = 8;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const ax = X0 + (X1 - X0) * i / N, bx = X0 + (X1 - X0) * (i + 1) / N;
      const az = Z0 + (Z1 - Z0) * j / N, bz = Z0 + (Z1 - Z0) * (j + 1) / N;
      buf.quad([ax, az], [bx, az], [bx, bz], [ax, bz], 0);
    }
    const m = new THREE.Mesh(buf.geometry(), mats.ground);
    m.receiveShadow = true; m.name = 'base';
    m.renderOrder = 50; // drawn after everything opaque → hidden pixels are skipped by the depth test
    group.add(m);
  }
  // areas
  const areaBufs = new Map();
  for (const a of world.areas) {
    const mat = mats.area[a.k];
    if (!mat) continue;
    let b = areaBufs.get(mat);
    if (!b) areaBufs.set(mat, b = new GroundBuf());
    const y = 0.004 + a.o * 0.003;
    try { polygon(b, a.p, a.hl, y); } catch (e) { /* degenerate polygon */ }
  }
  for (const [mat, b] of areaBufs) {
    const m = new THREE.Mesh(b.geometry(), mat);
    m.receiveShadow = true; m.renderOrder = 45 - (mat.polygonOffsetFactor ? -mat.polygonOffsetFactor : 0); group.add(m);
  }
  // waterways
  {
    const b = new GroundBuf();
    for (const w of world.waterways) strip(b, w.p, -w.w / 2, w.w / 2, 0.03, 0.2);
    if (b.pos.length) { const m = new THREE.Mesh(b.geometry(), mats.water); m.receiveShadow = true; group.add(m); }
  }
  // roads
  const roadBufs = new Map();
  const getB = (mat) => { let b = roadBufs.get(mat); if (!b) roadBufs.set(mat, b = new GroundBuf()); return b; };
  const sw = getB(mats.road.sidewalk), curb = getB(mats.road.curb), mark = getB(mats.marking);
  const endpoints = new Map();
  for (const r of world.roads) {
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
  }
  // endpoint discs fill junction gaps and round the ends
  for (const e of endpoints.values()) disc(e.b, e.x, e.z, e.hw, e.y, e.hw > 2 ? 14 : 8);
  // intermediate nodes shared by several roads (junctions not at endpoints)
  const nodeCount = new Map();
  for (const r of world.roads) for (const p of r.p) {
    const key = p[0].toFixed(1) + ',' + p[1].toFixed(1);
    const c = nodeCount.get(key);
    const hw = r.w / 2;
    if (!c) nodeCount.set(key, { n: 1, hw, r, p }); else { c.n++; if (hw > c.hw) { c.hw = hw; c.r = r; } }
  }
  for (const c of nodeCount.values()) {
    if (c.n < 2) continue;
    const mat = mats.road[c.r.s] || mats.road.asphalt;
    disc(getB(mat), c.p[0], c.p[1], c.hw, roadY(c.r.k), c.hw > 2 ? 14 : 8);
  }
  // crossings
  for (const [x, z, kind] of world.crossings) {
    if (!kind) continue;
    const hit = nearestRoad(world, x, z, 1.5, r => MOTOR.has(r.k) && r.k !== 'service');
    if (!hit) continue;
    const { r, ux, uz } = hit;
    const vx = uz, vz = -ux; // across the road
    const y = roadY(r.k) + 0.007;
    const half = r.w / 2 - 0.3;
    if (kind === 1) {
      // zebra: stripes parallel to the road, 0.5 m wide, 1 m pitch, 4 m long
      for (let t = -half + 0.25; t <= half - 0.25; t += 1.0) {
        const cx = x + vx * t, cz = z + vz * t;
        const A = [cx - ux * 2 - vx * 0.25, cz - uz * 2 - vz * 0.25], B = [cx + ux * 2 - vx * 0.25, cz + uz * 2 - vz * 0.25];
        const C = [cx + ux * 2 + vx * 0.25, cz + uz * 2 + vz * 0.25], D = [cx - ux * 2 + vx * 0.25, cz - uz * 2 + vz * 0.25];
        mark.quad(A, B, C, D, y);
      }
    } else {
      // signalised crossing: two dashed borders across the road
      for (const s of [-2, 2]) {
        for (let t = -half; t < half; t += 1.0) {
          const cx = x + ux * s + vx * (t + 0.25), cz = z + uz * s + vz * (t + 0.25);
          mark.quad([cx - vx * 0.25 - ux * 0.06, cz - vz * 0.25 - uz * 0.06], [cx + vx * 0.25 - ux * 0.06, cz + vz * 0.25 - uz * 0.06],
            [cx + vx * 0.25 + ux * 0.06, cz + vz * 0.25 + uz * 0.06], [cx - vx * 0.25 + ux * 0.06, cz - vz * 0.25 + uz * 0.06], y);
        }
      }
    }
  }
  for (const [mat, b] of roadBufs) {
    if (!b.pos.length) continue;
    const m = new THREE.Mesh(b.geometry(), mat);
    // top-most ground layers first so the layers beneath are rejected early
    m.receiveShadow = true; m.renderOrder = 40 - (mat.polygonOffsetFactor ? -mat.polygonOffsetFactor : 0); group.add(m);
  }
  return group;
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
