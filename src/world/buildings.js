// Builds merged building meshes (walls with procedural facades + roofs), chunked for culling.
import * as THREE from 'three';
import { STYLE_ID } from './materials.js';
import { obb, area as polyArea, centroid, labelPoint } from '../shared/geom.js';

const CHUNK = 220;

class WallBuf {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.f = []; this.s = []; }
  // quad with per-corner heights; a/b = [x,z]; y0a,y0b bottoms; y1a,y1b tops
  quad(a, b, y0a, y0b, y1a, y1b, col, style, lh, seed, levels, uOff = 0, L = null, topRef = null) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const nx = dz / len, nz = -dx / len;
    L = L ?? len;
    const top = topRef ?? Math.max(y1a, y1b);
    const V = [
      [a[0], y0a, a[1], uOff], [b[0], y1b, b[1], uOff + len], [b[0], y0b, b[1], uOff + len],
      [a[0], y0a, a[1], uOff], [a[0], y1a, a[1], uOff], [b[0], y1b, b[1], uOff + len],
    ];
    for (const v of V) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(nx, 0, nz);
      this.col.push(col.r, col.g, col.b);
      this.f.push(v[3], v[1], L, top);
      this.s.push(style, lh, seed, levels);
    }
  }
  tri(p0, p1, p2, col, style, lh, seed, levels, uvs, L, top) {
    // generic triangle (gables); compute normal and orient outward = given by winding
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1; n = n.map(v => v / l);
    [p0, p1, p2].forEach((p, i) => {
      this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(col.r, col.g, col.b);
      this.f.push(uvs[i], p[1], L, top); this.s.push(style, lh, seed, levels);
    });
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aF', new THREE.Float32BufferAttribute(this.f, 4));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.s, 4));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

class RoofBuf {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; }
  tri(p0, p1, p2, col, uvFn, down = false) {
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1; n = n.map(v => v / l);
    if ((n[1] < 0) !== down) { [p1, p2] = [p2, p1]; n = n.map(v => -v); }
    for (const p of [p0, p1, p2]) {
      this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(col.r, col.g, col.b);
      const uv = uvFn(p); this.uv.push(uv[0], uv[1]);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

const worldUV = p => [p[0], p[2]];

function isRectLike(poly) {
  if (poly.length < 4 || poly.length > 6) return null;
  const b = obb(poly);
  const ratio = polyArea(poly) / (4 * b.hw * b.hd);
  return ratio > 0.86 ? b : null;
}

// Emit roof for a building record; returns per-vertex wall-top function for walls (for skillion)
function emitRoof(b, roofFlat, roofTile, walls, wallCol, seed) {
  const rc = new THREE.Color(b.rc);
  const wh = b.wh, rh = Math.max(0, b.h - b.wh);
  const p = b.p;
  const shape = b.rs;
  const flat = () => {
    const contour = p.map(q => new THREE.Vector2(q[0], q[1]));
    const holes = (b.hl || []).map(h => h.map(q => new THREE.Vector2(q[0], q[1])));
    const all = contour.concat(...holes);
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    for (const t of tris) {
      const P = t.map(i => [all[i].x, wh, all[i].y]);
      roofFlat.tri(P[0], P[1], P[2], rc, worldUV);
    }
    return null;
  };
  if (shape === 'flat' || rh < 0.3 || b.k === 'roof') return flat();

  const r = isRectLike(p);
  const tileUV = (ux, uz, ox, oz, slopeLen) => q => {
    const s = (q[0] - ox) * ux + (q[2] - oz) * uz;
    return [s, q[1] * 1.6];
  };

  if (shape === 'skillion') {
    const bb = r || obb(p);
    // slope across the short axis
    const vx = -bb.uz, vz = bb.ux;
    let mn = Infinity, mx = -Infinity;
    for (const q of p) { const t = q[0] * vx + q[1] * vz; mn = Math.min(mn, t); mx = Math.max(mx, t); }
    const hAt = (x, z) => wh + rh * ((x * vx + z * vz) - mn) / Math.max(mx - mn, 0.1);
    const contour = p.map(q => new THREE.Vector2(q[0], q[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) {
      const P = t.map(i => [contour[i].x, hAt(contour[i].x, contour[i].y), contour[i].y]);
      roofFlat.tri(P[0], P[1], P[2], rc, worldUV);
    }
    return hAt;
  }

  if (r && (shape === 'gabled' || shape === 'hipped' || shape === 'round' || shape === 'half-hipped' || shape === 'gambrel' || shape === 'mansard' || shape === 'saltbox')) {
    const ov = 0.35;
    const { cx, cz, ux, uz, hw, hd } = r;
    const vx = -uz, vz = ux;
    const L = hw + ov, D = hd + ov;
    const at = (s, t, y) => [cx + ux * s + vx * t, y, cz + uz * s + vz * t];
    const eave = wh - ov * (rh / hd);
    const top = wh + rh;
    const hipped = shape === 'hipped' || shape === 'half-hipped' || shape === 'mansard';
    const ridgeHalf = hipped ? Math.max(0, hw - hd) : L;
    const A = at(-L, -D, eave), B = at(L, -D, eave), C = at(L, D, eave), Dd = at(-L, D, eave);
    const R1 = at(-ridgeHalf, 0, top), R2 = at(ridgeHalf, 0, top);
    const uvf = q => { const s = (q[0] - cx) * ux + (q[2] - cz) * uz; const t = Math.abs((q[0] - cx) * vx + (q[2] - cz) * vz); return [s, (D - t) * 1.25]; };
    roofTile.tri(A, B, R2, rc, uvf); roofTile.tri(A, R2, R1, rc, uvf);
    roofTile.tri(Dd, R1, R2, rc, uvf); roofTile.tri(Dd, R2, C, rc, uvf);
    if (hipped) {
      roofTile.tri(A, R1, Dd, rc, uvf); roofTile.tri(B, C, R2, rc, uvf);
    } else {
      // gable walls (triangles) on both short ends, flush with the footprint
      const g1a = at(-hw, -hd, wh), g1b = at(-hw, hd, wh), g1t = at(-hw, 0, top);
      const g2a = at(hw, -hd, wh), g2b = at(hw, hd, wh), g2t = at(hw, 0, top);
      const Lg = 2 * hd;
      // outward normal for the -hw end points to -u; order so normal faces outward
      walls.tri(g1a, g1b, g1t, wallCol, STYLE_ID.gable, b.lh, seed, b.lv, [0, Lg, hd], Lg, top);
      walls.tri(g2a, g2t, g2b, wallCol, STYLE_ID.gable, b.lh, seed, b.lv, [0, hd, Lg], Lg, top);
      // also underside of the overhang is covered by DoubleSide roof material
    }
    return null;
  }

  // pyramid-ish fallback for complex footprints
  const apexXZ = labelPoint(p);
  const apexH = wh + Math.min(rh, 3.5);
  const apex = [apexXZ[0], apexH, apexXZ[1]];
  const uvf = q => [q[0] * 0.7 + q[2] * 0.7, q[1] * 1.6];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], c = p[(i + 1) % p.length];
    roofTile.tri([a[0], wh, a[1]], [c[0], wh, c[1]], apex, rc, uvf);
  }
  return null;
}

export function buildBuildings(world, mats, opts = {}) {
  const group = new THREE.Group();
  group.name = 'buildings';
  const chunks = new Map();
  const skip = opts.skip || new Set(); // building indices rendered elsewhere (interiors)
  const getChunk = (x, z) => {
    const key = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    let c = chunks.get(key);
    if (!c) { c = { walls: new WallBuf(), roofFlat: new RoofBuf(), roofTile: new RoofBuf() }; chunks.set(key, c); }
    return c;
  };
  world.buildings.forEach((b, idx) => {
    if (skip.has(idx)) return;
    const c = centroid(b.p);
    const ch = getChunk(c[0], c[1]);
    const col = new THREE.Color(b.c);
    const style = STYLE_ID[b.st] ?? 5;
    let seed = (idx * 7.13) % 97;
    const hAt = emitRoof(b, ch.roofFlat, ch.roofTile, ch.walls, col, seed);
    const rings = [b.p, ...(b.hl || [])];
    let bottom = b.mh;
    if (b.k === 'roof') bottom = Math.max(b.mh, b.wh - 0.35);
    for (const ring of rings) {
      let u = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], d = ring[(i + 1) % ring.length];
        const ta = hAt ? hAt(a[0], a[1]) : b.wh, tb = hAt ? hAt(d[0], d[1]) : b.wh;
        ch.walls.quad(a, d, bottom, bottom, ta, tb, col, style, b.lh, seed + i * 0.37, b.lv, 0, null, Math.max(ta, tb));
      }
    }
    // canopies need an underside
    if (b.k === 'roof' || b.mh > 0.5) {
      const contour = b.p.map(q => new THREE.Vector2(q[0], q[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const dark = new THREE.Color(0x77736c);
      for (const t of tris) {
        const P = t.map(i => [contour[i].x, bottom, contour[i].y]);
        ch.roofFlat.tri(P[0], P[1], P[2], dark, worldUV, true);
      }
    }
  });

  const meshes = [];
  for (const [key, c] of chunks) {
    const wg = c.walls.geometry();
    const wm = new THREE.Mesh(wg, mats.facade);
    wm.castShadow = true; wm.receiveShadow = true; wm.name = 'walls ' + key;
    group.add(wm); meshes.push(wm);
    if (c.roofFlat.pos.length) {
      const rm = new THREE.Mesh(c.roofFlat.geometry(), mats.roofFlat);
      rm.castShadow = true; rm.receiveShadow = true; group.add(rm); meshes.push(rm);
    }
    if (c.roofTile.pos.length) {
      const tm = new THREE.Mesh(c.roofTile.geometry(), mats.roofTile);
      tm.castShadow = true; tm.receiveShadow = true; group.add(tm); meshes.push(tm);
    }
  }
  return { group, meshes };
}
