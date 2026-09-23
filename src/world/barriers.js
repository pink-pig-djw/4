// Fences, walls, guard rails and handrails mapped in OSM (hedges are in vegetation.js).
// Uses the same pieces as the colliders (layout.barrierPieces: openings at gates and wherever a
// path crosses), follows the terrain, merged per chunk, distance-culled and built once the camera
// comes near (LazyChunks).
import * as THREE from 'three';
import { Shape, propMaterial, LazyChunks } from './shapes.js';
import { globalUniforms } from './materials.js';
import { groundY } from './terrain.js';
import { hash2 } from '../shared/geom.js';

const CHUNK = 160;

// fence infill textures (white = wire/board, alpha = coverage); tinted by the material colour
function fenceTexture(kind) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  if (kind === 'mesh') {
    // Doppelstabmatte: vertical wires every 5 cm, double horizontal wires every 20 cm (1 m tile)
    for (let x = 0; x < 256; x += 12.8) g.fillRect(x, 0, 2.2, 256);
    for (let y = 6; y < 256; y += 51.2) { g.fillRect(0, y, 256, 2.4); g.fillRect(0, y + 5, 256, 2.4); }
  } else if (kind === 'picket') {
    // wooden picket fence: 9 cm boards, 5 cm gaps, two rails
    for (let x = 0; x < 256; x += 35.8) {
      const grd = g.createLinearGradient(x, 0, x + 23, 0);
      grd.addColorStop(0, '#d9d9d9'); grd.addColorStop(0.5, '#fff'); grd.addColorStop(1, '#cfcfcf');
      g.fillStyle = grd; g.fillRect(x, 10, 23, 246);
      g.beginPath(); g.moveTo(x, 10); g.lineTo(x + 11.5, 0); g.lineTo(x + 23, 10); g.fill();
    }
    g.fillStyle = '#bdbdbd'; g.fillRect(0, 50, 256, 12); g.fillRect(0, 200, 256, 12);
  } else {
    // chain link (Maschendraht): diamond mesh
    g.lineWidth = 2;
    for (let k = -256; k < 512; k += 16) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 256, 256); g.stroke();
      g.beginPath(); g.moveTo(k + 256, 0); g.lineTo(k, 256); g.stroke();
    }
    g.fillRect(0, 0, 256, 3); g.fillRect(0, 253, 256, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// style of a fence: industrial and public areas get welded mesh, gardens wooden pickets
const RESID = /house|detached|terrace|semidetached|bungalow/;
function fenceStyle(pc, layout) {
  const h = hash2(Math.round(pc.a[0] / 7), Math.round(pc.a[1] / 7));
  const bi = layout.buildingIndex;
  let resid = false;
  // look for a house close by (grid cells of the building index within 25 m)
  const [px, pz] = pc.a, R = 25, cs = bi.cell;
  for (let gx = Math.floor((px - R) / cs); gx <= Math.floor((px + R) / cs) && !resid; gx++)
    for (let gz = Math.floor((pz - R) / cs); gz <= Math.floor((pz + R) / cs) && !resid; gz++) {
      for (const i of bi.grid.get(gx * 100003 + gz) || []) {
        const b = bi.b[i], [x0, z0, x1, z1] = b._bb;
        if (px < x0 - R || px > x1 + R || pz < z0 - R || pz > z1 + R) continue;
        if (RESID.test(b.k)) { resid = true; break; }
      }
    }
  if (resid && pc.h <= 1.4) return h < 0.6 ? 'picket' : 'chain';
  return h < 0.55 ? 'meshGreen' : h < 0.85 ? 'meshGrey' : 'chain';
}

export class Barriers {
  constructor(game) {
    const L = game.layout;
    this.group = new THREE.Group(); this.group.name = 'barriers';
    const tex = { mesh: fenceTexture('mesh'), picket: fenceTexture('picket'), chain: fenceTexture('chain') };
    const infillMat = {
      meshGreen: new THREE.MeshStandardMaterial({ map: tex.mesh, color: 0x2f5a3a, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.3 }),
      meshGrey: new THREE.MeshStandardMaterial({ map: tex.mesh, color: 0x3a3d40, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.3 }),
      chain: new THREE.MeshStandardMaterial({ map: tex.chain, color: 0x9ea3a6, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 }),
      picket: new THREE.MeshStandardMaterial({ map: tex.picket, color: 0x8a6a48, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }),
    };
    const POST = { meshGreen: '#2f5a3a', meshGrey: '#3a3d40', chain: '#8e9396', picket: '#6d5238' };
    const WALL = ['#a8a59e', '#9a5a44', '#c4b393', '#8f8c86'];
    const lists = new Map();
    for (const pc of L.barrierPieces) {
      if (pc.k === 'hedge') continue;
      const x = (pc.a[0] + pc.b[0]) / 2, z = (pc.a[1] + pc.b[1]) / 2;
      const k = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
      let l = lists.get(k);
      if (!l) lists.set(k, l = { pieces: [], x: (Math.floor(x / CHUNK) + 0.5) * CHUNK, z: (Math.floor(z / CHUNK) + 0.5) * CHUNK });
      l.pieces.push(pc);
    }
    const mat = propMaterial(globalUniforms, { roughness: 0.7 });
    const buildChunk = l => {
    const c = { shape: new Shape(), infill: {}, x: l.x, z: l.z };
    const get = () => c;
    const quadInfill = (c, style, A, B, ya, yb, h, s0, s1) => {
      let f = c.infill[style];
      if (!f) f = c.infill[style] = { pos: [], uv: [], nor: [] };
      const nx = -(B[1] - A[1]), nz = B[0] - A[0], nl = Math.hypot(nx, nz) || 1;
      const P = [[A[0], ya, A[1], s0, 0], [B[0], yb, B[1], s1, 0], [B[0], yb + h, B[1], s1, 1], [A[0], ya + h, A[1], s0, 1]];
      for (const i of [0, 1, 2, 0, 2, 3]) { const q = P[i]; f.pos.push(q[0], q[1], q[2]); f.uv.push(q[3], q[4]); f.nor.push(nx / nl, 0, nz / nl); }
    };

    for (const pc of l.pieces) {
      const [ax, az] = pc.a, [bx, bz] = pc.b;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, rot = -Math.atan2(uz, ux);
      const c = get((ax + bx) / 2, (az + bz) / 2);
      if (pc.k === 'wall' || pc.k === 'city_wall') {
        const col = WALL[Math.floor(hash2(Math.round(ax), Math.round(az)) * WALL.length)];
        const n = Math.max(1, Math.ceil(len / 4));
        for (let k = 0; k < n; k++) {
          const s = (k + 0.5) * len / n, x = ax + ux * s, z = az + uz * s;
          const ga = groundY(ax + ux * k * len / n, az + uz * k * len / n), gb = groundY(ax + ux * (k + 1) * len / n, az + uz * (k + 1) * len / n);
          const lo = Math.min(ga, gb) - 0.2, top = Math.max(ga, gb) + pc.h;
          c.shape.box(len / n + 0.02, top - lo, 0.3, x, (lo + top) / 2, z, col, 0, rot);
          c.shape.box(len / n + 0.02, 0.06, 0.38, x, top + 0.03, z, '#8b8a86', 0, rot);   // coping
        }
        continue;
      }
      if (pc.k === 'guard_rail') {
        for (let s = 0; s <= len; s += 2) {
          const x = ax + ux * s, z = az + uz * s, g = groundY(x, z);
          c.shape.box(0.1, 0.8, 0.06, x, g + 0.35, z, '#9da2a5', 0, rot);
        }
        const n = Math.max(1, Math.ceil(len / 4));
        for (let k = 0; k < n; k++) {
          const s = (k + 0.5) * len / n, x = ax + ux * s + uz * 0.08, z = az + uz * s - ux * 0.08;
          c.shape.box(len / n + 0.02, 0.32, 0.05, x, groundY(x, z) + 0.6, z, '#b4b8bb', 0, rot);
        }
        continue;
      }
      if (pc.k === 'handrail') {
        for (let s = 0; s <= len; s += 1.5) { const x = ax + ux * s, z = az + uz * s; c.shape.cyl(0.025, 0.025, 1.0, x, groundY(x, z) + 0.5, z, '#8e9396', 6); }
        const ga = groundY(ax, az), gb = groundY(bx, bz);
        c.shape.tube([ax, ga + 1.0, az], [bx, gb + 1.0, bz], 0.025, '#8e9396', 0, 6);
        continue;
      }
      // fences: posts every 2.5 m, infill panels between them
      const style = fenceStyle(pc, L);
      const h = Math.max(0.9, Math.min(2.2, pc.h || 1.5));
      const n = Math.max(1, Math.ceil(len / 2.5));
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const s = len * k / n, x = ax + ux * s, z = az + uz * s, g = groundY(x, z);
        if (style === 'picket') c.shape.box(0.08, h + 0.05, 0.08, x, g + (h + 0.05) / 2, z, POST[style], 0, rot);
        else c.shape.cyl(0.03, 0.03, h + 0.1, x, g + (h + 0.1) / 2 - 0.05, z, POST[style], 6);
        if (prev) quadInfill(c, style, prev.p, [x, z], prev.g + 0.04, g + 0.04, h - 0.04, prev.s, s);
        prev = { p: [x, z], g, s };
      }
    }

    const out = [];
    const add = (mesh, maxDist, cast) => {
      mesh.castShadow = cast; mesh.receiveShadow = true;
      mesh.userData.cull = { x: c.x, z: c.z, r: CHUNK * 0.72, maxDist, castDist: 60, cast };
      out.push(mesh);
    };
    if (c.shape.parts.length) add(new THREE.Mesh(c.shape.build(), mat), 400, true);
    for (const [style, f] of Object.entries(c.infill)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(f.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(f.uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(f.nor, 3));
      g.computeBoundingSphere();
      add(new THREE.Mesh(g, infillMat[style]), 220, false);
    }
    return out;
    };
    this.lazy = new LazyChunks(this.group, [...lists.values()].map(l => ({ x: l.x, z: l.z, r: CHUNK * 0.72, maxDist: 400, build: () => buildChunk(l) })));
    game.scene.add(this.group);
  }
  update(dt, game) { this.lazy.update(dt, game); }
}
