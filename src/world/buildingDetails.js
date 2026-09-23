// Building details that need real geometry:
//  - flat roofs: skylight domes (Lichtkuppeln), air-handling units, vent pipes
//  - entrances mapped in OSM: a door set into the facade (facade shader style "door"), and a
//    canopy over main entrances of public buildings
//  - pitched roofs: eaves gutters and downpipes at the corners
// Everything is merged per chunk, distance-culled, and only built once the camera comes near
// (LazyChunks) — the details of a 5 km map are never all needed at once.
import * as THREE from 'three';
import { Shape, propMaterial, LazyChunks } from './shapes.js';
import { globalUniforms, STYLE_ID } from './materials.js';
import { WallBuf, parapetHeight } from './buildings.js';
import { obb, area as polyArea, pointInPoly, rng, distSegSq, polyBounds } from '../shared/geom.js';
import { groundY } from './terrain.js';

const CHUNK = 150;
const RESID = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'apartments', 'residential', 'dormitory', 'farm']);
const PUBLIC = new Set(['university', 'college', 'office', 'public', 'school', 'kindergarten', 'yes', 'research', 'sports_centre']);

function edgeDist(poly, x, z) {
  let d = 1e9;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; d = Math.min(d, distSegSq(x, z, a[0], a[1], b[0], b[1])); }
  return Math.sqrt(d);
}

export function buildDetails(world, mats, opts = {}) {
  const skip = opts.skip || new Set();
  const group = new THREE.Group(); group.name = 'building-details';
  const B = world.buildings;
  // buildings and entrances per chunk (by the centre of the building's bounds)
  const lists = new Map();
  const listAt = (x, z) => {
    const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    let l = lists.get(k);
    if (!l) lists.set(k, l = { b: [], e: [], x: (Math.floor(x / CHUNK) + 0.5) * CHUNK, z: (Math.floor(z / CHUNK) + 0.5) * CHUNK });
    return l;
  };
  B.forEach((b, idx) => { if (skip.has(idx)) return; const [x0, z0, x1, z1] = polyBounds(b.p); listAt((x0 + x1) / 2, (z0 + z1) / 2).b.push(idx); });
  for (const e of world.entrances) listAt(e.x, e.z).e.push(e);
  const mat = propMaterial(globalUniforms, { roughness: 0.6, metalness: 0.35 });
  const concrete = propMaterial(globalUniforms, { roughness: 0.85, metalness: 0.05 });
  const entries = [...lists.values()].map(l => ({ x: l.x, z: l.z, r: CHUNK * 0.72, maxDist: 450, build: () => buildChunk(l) }));
  group.userData.lazy = new LazyChunks(group, entries);
  return group;

  function buildChunk(L) {
  const c = { roof: new Shape(), pipes: new Shape(), canopy: new Shape(), doors: new WallBuf(), x: L.x, z: L.z };
  const get = () => c;
  const each = f => { for (const idx of L.b) f(B[idx], idx); };

  // ---- rooftop equipment ----
  each((b, idx) => {
    if (skip.has(idx) || b.sm || b.rs !== 'flat' || b.k === 'roof' || b.wh < 4) return;
    const a = polyArea(b.p);
    if (a < 120) return;
    const seed = (idx * 7.13) % 97;
    const y = (b.y0 ?? 0) + b.wh - parapetHeight(b, seed);
    const r = rng(idx * 31 + 7);
    const bb = obb(b.p);
    const [x0, z0, x1, z1] = polyBounds(b.p);
    const n = Math.min(14, Math.round(a / 160));
    const c = get((x0 + x1) / 2, (z0 + z1) / 2);
    const rot = Math.atan2(bb.uz, bb.ux);
    const placed = [];
    for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (!pointInPoly(x, z, b.p) || (b.hl && b.hl.some(h => pointInPoly(x, z, h)))) continue;
      if (edgeDist(b.p, x, z) < 2.2) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3)) continue;
      placed.push([x, z]); k++;
      const t = r();
      if (t < 0.45) {
        // skylight dome on an upstand
        const s = 1.0 + r() * 0.6;
        c.roof.box(s, 0.35, s, x, y + 0.175, z, '#8d8f90', 0, -rot);
        c.roof.sphere(s * 0.55, x, y + 0.35, z, '#dfe3e2', 0, 0, 0.45);
      } else if (t < 0.75) {
        // air-handling unit with fan grille on top
        const w = 1.6 + r() * 1.6, d = 1.0 + r() * 0.6, h = 1.0 + r() * 0.6;
        c.roof.box(w, h, d, x, y + h / 2, z, '#a7aaab', 0, -rot);
        c.roof.cyl(0.35, 0.35, 0.08, x + bb.ux * w * 0.25, y + h + 0.04, z + bb.uz * w * 0.25, '#3a3d40', 10);
        c.roof.box(w + 0.1, 0.12, d + 0.1, x, y + 0.06, z, '#5b5e60', 0, -rot);
      } else {
        // vent pipes / exhaust
        const h = 0.8 + r() * 1.4;
        c.roof.cyl(0.14, 0.14, h, x, y + h / 2, z, '#8e9294', 8);
        c.roof.cyl(0.22, 0.22, 0.12, x, y + h + 0.06, z, '#6d7072', 8);
      }
    }
  });

  // ---- entrance doors and canopies ----
  for (const e of L.e) {
    const b = B[e.b];
    if (!b || skip.has(e.b) || b.mh > 0.1 || b.wh < 2.4) continue;
    if (e.k === 'garage' || e.k === 'emergency_exit') continue;
    const resid = RESID.has(b.k);
    const w = Math.max(resid ? 1.1 : 1.5, Math.min(e.k === 'main' ? 3.2 : 2.4, e.w || 1.6));
    const h = Math.min(resid ? 2.35 : 2.95, b.wh - 0.25);
    const tx = -e.nz, tz = e.nx;                     // along the wall, u increasing
    const off = 0.02;
    const A = [e.x - tx * w / 2 + e.nx * off, e.z - tz * w / 2 + e.nz * off];
    const D = [e.x + tx * w / 2 + e.nx * off, e.z + tz * w / 2 + e.nz * off];
    const c = get(e.x, e.z);
    const col = new THREE.Color(resid ? 0x5a4a3a : 0x303234);
    const Y = b.y0 ?? 0;
    c.doors.yOff = Y;
    c.doors.quad(A, D, 0, 0, h, h, col, STYLE_ID.door, 10, e.b % 97, 1, 0, w, h);
    if (e.k === 'main' && !b.sm && PUBLIC.has(b.k) && b.wh > h + 0.6) {
      // canopy: slab on the wall, 1.8 m deep
      const cw = w + 1.4, cd = 1.8, cy = Y + Math.min(h + 0.35, b.wh - 0.2);
      const cx = e.x + e.nx * cd / 2, cz = e.z + e.nz * cd / 2;
      const ang = Math.atan2(tz, tx);
      c.canopy.box(cw, 0.18, cd, cx, cy, cz, '#6e6f70', 0, -ang);
      c.canopy.box(cw, 0.04, 0.06, cx + e.nx * cd / 2, cy - 0.1, cz + e.nz * cd / 2, '#3b3d3f', 0, -ang);
    }
  }

  // ---- dormers on the pitched roofs of baroque houses ----
  each((b, idx) => {
    if (skip.has(idx) || b.sm || (b.st !== 'baroque' && b.st !== 'ashlar') || b.rs === 'flat' || b.mh > 0.1) return;
    if (b.p.length < 4 || b.p.length > 6) return;
    const r = obb(b.p);
    if (polyArea(b.p) / (4 * r.hw * r.hd) < 0.86) return;
    const rh = Math.max(0, b.h - b.wh);
    if (rh < 2.2 || r.hd < 3.5) return;
    const Y = (b.y0 ?? 0) + b.wh;
    const c = get(r.cx, r.cz);
    const vx = -r.uz, vz = r.ux, rot = -Math.atan2(r.uz, r.ux);
    const wallCol = '#' + new THREE.Color(b.c).getHexString(), roofCol = '#' + new THREE.Color(b.rc).getHexString();
    const n = Math.floor((2 * r.hw - 2.5) / 3.6);
    for (let k = 0; k < n; k++) {
      const s = -r.hw + 1.25 + 3.6 * (k + 0.5) * (2 * r.hw - 2.5) / (3.6 * n);
      for (const side of [-1, 1]) {
        // front face at 72 % of the half depth, reaching back into the slope
        const tf = r.hd * 0.72, tb = r.hd * 0.35, yf = Y + rh * (1 - tf / r.hd), yb = Y + rh * (1 - tb / r.hd);
        const depth = tf - tb, tm = (tf + tb) / 2 * side;
        const cx = r.cx + r.ux * s + vx * tm, cz = r.cz + r.uz * s + vz * tm;
        const top = Math.max(yf + 1.45, yb + 0.1);
        c.roof.box(1.3, top - yf + 0.3, depth, cx, (yf - 0.3 + top) / 2, cz, wallCol, 0, rot);
        c.roof.box(1.55, 0.14, depth + 0.3, cx + vx * side * 0.15, top + 0.07, cz + vz * side * 0.15, roofCol, 0, rot);
        // window: white frame, dark glass
        const fx = r.cx + r.ux * s + vx * side * (tf + 0.02), fz = r.cz + r.uz * s + vz * side * (tf + 0.02);
        c.roof.box(0.86, 1.0, 0.04, fx, yf + 0.65, fz, '#ecebe6', 0, rot);
        c.roof.box(0.7, 0.84, 0.05, fx + vx * side * 0.005, yf + 0.65, fz + vz * side * 0.005, '#1c2328', 0, rot);
      }
    }
  });

  // ---- gutters and downpipes on pitched roofs ----
  each((b, idx) => {
    if (skip.has(idx) || b.sm || b.rs === 'flat' || b.k === 'roof' || b.mh > 0.1) return;
    if (b.p.length < 4 || b.p.length > 6) return;
    const r = obb(b.p);
    if (polyArea(b.p) / (4 * r.hw * r.hd) < 0.86) return;
    const rh = Math.max(0, b.h - b.wh);
    if (rh < 0.3) return;
    const c = get(r.cx, r.cz);
    const ov = 0.35, eave = (b.y0 ?? 0) + b.wh - ov * (rh / r.hd);
    const vx = -r.uz, vz = r.ux;
    const at = (s, t) => [r.cx + r.ux * s + vx * t, r.cz + r.uz * s + vz * t];
    const zinc = RESID.has(b.k) ? '#8a8d8e' : '#5d6062';
    for (const side of [-1, 1]) {
      // gutter along the eave
      const g0 = at(-r.hw - ov, side * (r.hd + ov - 0.06)), g1 = at(r.hw + ov, side * (r.hd + ov - 0.06));
      c.pipes.tube([g0[0], eave - 0.06, g0[1]], [g1[0], eave - 0.06, g1[1]], 0.07, zinc, 0, 6);
      // downpipes at both ends, down the wall corner
      for (const end of [-1, 1]) {
        const top = at(end * (r.hw - 0.25), side * (r.hd + ov - 0.06));
        const wall = at(end * (r.hw - 0.25), side * (r.hd + 0.08));
        c.pipes.tube([top[0], eave - 0.08, top[1]], [wall[0], eave - 0.45, wall[1]], 0.045, zinc, 0, 6);
        c.pipes.tube([wall[0], eave - 0.45, wall[1]], [wall[0], groundY(wall[0], wall[1]) + 0.12, wall[1]], 0.045, zinc, 0, 6);
      }
    }
  });

  const out = [];
  const add = (geo, m, maxDist, cast) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = cast; mesh.receiveShadow = true;
    mesh.userData.cull = { x: c.x, z: c.z, r: CHUNK * 0.72, maxDist, castDist: 90, cast };
    out.push(mesh);
  };
  if (c.roof.parts.length) add(c.roof.build(), mat, 450, true);
  if (c.pipes.parts.length) add(c.pipes.build(), mat, 160, false);
  if (c.canopy.parts.length) add(c.canopy.build(), concrete, 400, true);
  if (c.doors.pos.length) add(c.doors.geometry(), mats.facade, 300, false);
  return out;
  }
}
