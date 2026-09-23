// Builds merged building meshes (walls with procedural facades + roofs), chunked for culling.
import * as THREE from 'three';
import { STYLE_ID } from './materials.js';
import { obb, area as polyArea, centroid, labelPoint, pointInPoly, polyBounds } from '../shared/geom.js';

const CHUNK = 220;

export class WallBuf {
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

const SMALL_FLAT = new Set(['garage', 'garages', 'carport', 'shed', 'hut', 'service', 'static_caravan', 'transformer_tower', 'kiosk']);
const HOUSE = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow']);
// Flat roofs sit a little below the top of the walls (parapet / Attika); the wall height from OSM
// already includes it, so the overall height stays as mapped.
export function parapetHeight(b, seed) {
  if (b.rs !== 'flat' || b.k === 'roof' || b.wh < 2.2) return 0;
  if (SMALL_FLAT.has(b.k)) return 0.1;
  if (HOUSE.has(b.k)) return 0.25;
  return Math.min(0.45 + ((seed * 13.7) % 1) * 0.4, b.wh * 0.15);
}

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
  const ry = wh - parapetHeight(b, seed);
  const flat = () => {
    const contour = p.map(q => new THREE.Vector2(q[0], q[1]));
    const holes = (b.hl || []).map(h => h.map(q => new THREE.Vector2(q[0], q[1])));
    const all = contour.concat(...holes);
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    for (const t of tris) {
      const P = t.map(i => [all[i].x, ry, all[i].y]);
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
  // OSM often has several parts sharing a wall (outline + parts, stacked parts). Drawing both makes
  // the facades z-fight, so for every wall we find where another part already covers it and only
  // draw what is really visible.
  const B = world.buildings;
  const bbs = B.map(b => polyBounds(b.p));
  const G = 30, grid = new Map();
  B.forEach((b, i) => {
    if (skip.has(i) || b.k === 'roof') return;
    const [x0, z0, x1, z1] = bbs[i];
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) {
      const k = gx * 100003 + gz; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i);
    }
  });
  const inside = (j, x, z) => { const bb = bbs[j]; return x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pointInPoly(x, z, B[j].p); };
  // visible bottom of wall of building i at point (x,z) with outward normal n
  function visibleBottom(i, bottom, top, x, z, nx, nz) {
    const cand = grid.get(Math.floor(x / G) * 100003 + Math.floor(z / G));
    let vb = bottom;
    if (!cand) return vb;
    const b = B[i];
    const ix = x - nx * 0.12, iz = z - nz * 0.12, ox = x + nx * 0.12, oz = z + nz * 0.12;
    for (const j of cand) {
      if (j === i) continue;
      const o = B[j];
      if (o.mh > bottom + 0.05 || o.wh <= vb + 0.01) continue;
      if (!inside(j, ix, iz)) continue;
      const coplanar = !inside(j, ox, oz);
      if (coplanar && Math.abs(o.wh - top) < 0.05 && Math.abs(o.mh - b.mh) < 0.05 && j > i) continue; // identical wall: lower index draws it
      vb = Math.max(vb, o.wh);
    }
    return vb;
  }
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
    else if (b.mh > 0.5) {
      const cand = grid.get(Math.floor(c[0] / G) * 100003 + Math.floor(c[1] / G)) || [];
      if (cand.some(j => j !== idx && Math.abs(B[j].wh - b.mh) < 0.3 && inside(j, c[0], c[1]))) bottom = b.mh - 0.9;
    }
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], d = ring[(i + 1) % ring.length];
        const ta = hAt ? hAt(a[0], a[1]) : b.wh, tb = hAt ? hAt(d[0], d[1]) : b.wh;
        const L = Math.hypot(d[0] - a[0], d[1] - a[1]);
        if (L < 0.01) continue;
        const ux = (d[0] - a[0]) / L, uz = (d[1] - a[1]) / L, nx = uz, nz = -ux;
        const n = Math.max(1, Math.ceil(L / 1.0));
        // runs of equal visible bottom along the edge
        let runStart = 0, runVb = null;
        const flush = (k) => {
          if (runVb === null) return;
          const d0 = runStart * L / n, d1 = k * L / n;
          const t0 = ta + (tb - ta) * d0 / L, t1 = ta + (tb - ta) * d1 / L;
          if (runVb < Math.max(t0, t1) - 0.05) {
            const A = [a[0] + ux * d0, a[1] + uz * d0], D = [a[0] + ux * d1, a[1] + uz * d1];
            ch.walls.quad(A, D, runVb, runVb, Math.max(t0, runVb), Math.max(t1, runVb), col, style, b.lh, seed + i * 0.37, b.lv, d0, L, Math.max(ta, tb));
          }
        };
        for (let k = 0; k < n; k++) {
          const dm = (k + 0.5) * L / n;
          const vb = b.k === 'roof' ? bottom : visibleBottom(idx, bottom, Math.max(ta, tb), a[0] + ux * dm, a[1] + uz * dm, nx, nz);
          const vq = Math.round(vb * 20) / 20;
          if (runVb === null) { runVb = vq; runStart = k; }
          else if (vq !== runVb) { flush(k); runVb = vq; runStart = k; }
        }
        flush(n);
      }
    }
    // parapet: inner face down to the lowered roof, and the coping on top
    const ph = parapetHeight(b, seed);
    if (ph > 0.05) {
      const tk = ph > 0.2 ? 0.25 : 0.12, dark = col.clone().multiplyScalar(0.85);
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], d = ring[(i + 1) % ring.length];
          const L = Math.hypot(d[0] - a[0], d[1] - a[1]);
          if (L < 0.3) continue;
          const nx = (d[1] - a[1]) / L, nz = -(d[0] - a[0]) / L;
          const ai = [a[0] - nx * tk, a[1] - nz * tk], di = [d[0] - nx * tk, d[1] - nz * tk];
          ch.walls.quad(di, ai, b.wh - ph, b.wh - ph, b.wh, b.wh, dark, STYLE_ID.plain, 3, seed, 0, 0, L, b.wh);
          ch.walls.tri([a[0], b.wh, a[1]], [ai[0], b.wh, ai[1]], [d[0], b.wh, d[1]], col, STYLE_ID.plain, 3, seed, 0, [0, 0, L], L, b.wh);
          ch.walls.tri([d[0], b.wh, d[1]], [ai[0], b.wh, ai[1]], [di[0], b.wh, di[1]], col, STYLE_ID.plain, 3, seed, 0, [L, 0, L], L, b.wh);
        }
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
