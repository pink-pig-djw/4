// Fountains, statues and monuments mapped in OSM (nothing is added that isn't mapped).
// Fountains: sandstone basin rim (size from the mapped area), water surface, central column.
// Statues: stone pedestal with a bronze figure; busts on a pillar; abstract sculptures; memorial
// stones; monuments: obelisk.
import * as THREE from 'three';
import { Shape, propMaterial } from './shapes.js';
import { globalUniforms } from './materials.js';
import { groundY } from './terrain.js';
import { pointInPoly } from '../shared/geom.js';

const STONE = '#b8a888', STONE_D = '#9c8e72', BRONZE = '#4d5a4c';

// basin radius and rim height used for rendering and colliders
export function fountainSize(m) { return { r: Math.max(1.2, Math.min(m.r || 1.6, 12)), rim: 0.55 }; }

export class Monuments {
  constructor(game) {
    const list = game.world.monuments || [];
    this.group = new THREE.Group(); this.group.name = 'monuments';
    const s = new Shape(), water = [];
    for (const m of list) {
      const y = groundY(m.x, m.z);
      if (m.k === 'fountain' && m.c) {
        // centrepiece in a mapped basin: rock mountain ("Felsenberg") of stacked, tilted blocks
        // with a figure on top, and a sandstone rim along the mapped basin
        const r = Math.max(1.2, Math.min(m.r || 2, 8)), rh = Math.min(6, r * 1.5);
        const ROCK = ['#8f8778', '#9a9282', '#877f70', '#a39b8a'];
        const layers = 6;
        for (let L = 0; L < layers; L++) {
          const f = 1 - L / layers, ly = y - 0.3 + rh * L / layers, lh = rh / layers + 0.25;
          const n = 3 + Math.round(f * 4);
          for (let i = 0; i < n; i++) {
            const a = i / n * Math.PI * 2 + L * 0.9, d = r * 0.42 * f * (0.5 + 0.5 * ((i * 37 + L * 11) % 10) / 10);
            const w = r * (0.25 + 0.35 * f) * (0.7 + 0.3 * ((i * 53 + L) % 10) / 10);
            s.box(w, lh, w * 0.8, m.x + Math.cos(a) * d, ly + lh / 2, m.z + Math.sin(a) * d, ROCK[(i + L) % 4], 0, a * 1.7);
          }
        }
        s.box(0.9, 0.7, 0.9, m.x, y + rh + 0.05, m.z, STONE);
        const basin = (game.world.areas || []).find(q => q.k === 'water' && pointInPoly(m.x, m.z, q.p));
        if (basin) for (let i = 0; i < basin.p.length; i++) {
          const A = basin.p[i], B = basin.p[(i + 1) % basin.p.length];
          const ya = groundY(A[0], A[1]) + 0.32, yb = groundY(B[0], B[1]) + 0.32;
          s.tube([A[0], ya, A[1]], [B[0], yb, B[1]], 0.2, STONE, 0, 6);
          s.tube([A[0], ya - 0.28, A[1]], [B[0], yb - 0.28, B[1]], 0.24, STONE_D, 0, 6);
        }
        const fy = y + rh + 0.4;
        s.cyl(0.24, 0.3, 1.0, m.x, fy + 0.5, m.z, STONE, 8);
        s.cyl(0.2, 0.24, 0.5, m.x, fy + 1.25, m.z, STONE, 8);
        s.sphere(0.14, m.x, fy + 1.65, m.z, STONE);
      } else if (m.k === 'fountain') {
        const { r, rim } = fountainSize(m);
        const seg = r > 4 ? 16 : 8;
        // rim: ring of stones as a tube polygon
        for (let i = 0; i < seg; i++) {
          const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
          s.tube([m.x + Math.cos(a0) * r, y + rim - 0.12, m.z + Math.sin(a0) * r], [m.x + Math.cos(a1) * r, y + rim - 0.12, m.z + Math.sin(a1) * r], 0.2, STONE, 0, 6);
          s.tube([m.x + Math.cos(a0) * r, y + 0.1, m.z + Math.sin(a0) * r], [m.x + Math.cos(a1) * r, y + 0.1, m.z + Math.sin(a1) * r], 0.24, STONE_D, 0, 6);
        }
        if (r > 4) {
          // large baroque fountain: a rock mountain ("Felsenberg") carrying a figure on top
          const rr = r * 0.32, rh = Math.min(5.5, r * 0.6);
          for (let i = 0; i < 9; i++) {
            const a = i * 2.4, d = rr * (0.35 + 0.4 * ((i * 37) % 10) / 10), hh = rh * (0.35 + 0.35 * ((i * 53) % 10) / 10);
            s.cyl(0.05, rr * 0.55, hh, m.x + Math.cos(a) * d * 0.5, y + rim + hh / 2 - 0.2, m.z + Math.sin(a) * d * 0.5, '#8f8778', 7);
          }
          s.cyl(0.25, rr, rh, m.x, y + rim + rh / 2 - 0.2, m.z, '#9a9282', 9);
          s.box(0.9, 0.8, 0.9, m.x, y + rim + rh + 0.2, m.z, STONE);
          s.cyl(0.24, 0.3, 1.2, m.x, y + rim + rh + 1.2, m.z, STONE, 8);
          s.sphere(0.17, m.x, y + rim + rh + 1.95, m.z, STONE);
        } else {
          // central column with a small upper basin
          const ch = Math.min(4.5, 1.2 + r * 0.45);
          s.cyl(Math.min(0.5, r * 0.18), Math.min(0.62, r * 0.22), ch, m.x, y + ch / 2, m.z, STONE, 10);
          if (r > 2) s.cyl(Math.min(1.4, r * 0.35), 0.35, 0.3, m.x, y + ch * 0.7, m.z, STONE, 14);
          s.sphere(Math.min(0.35, r * 0.12), m.x, y + ch + 0.2, m.z, STONE);
        }
        water.push({ x: m.x, z: m.z, y: y + rim - 0.2, r: r - 0.1 });
      } else if (m.k === 'statue') {
        s.box(1.3, 1.7, 1.3, m.x, y + 0.85, m.z, STONE);
        s.box(1.5, 0.15, 1.5, m.x, y + 1.72, m.z, STONE_D);
        // standing bronze figure
        const fy = y + 1.8;
        s.cyl(0.26, 0.32, 1.1, m.x, fy + 0.55, m.z, BRONZE, 8);          // coat / legs
        s.cyl(0.22, 0.26, 0.55, m.x, fy + 1.35, m.z, BRONZE, 8);         // chest
        s.sphere(0.15, m.x, fy + 1.78, m.z, BRONZE);                     // head
        s.tube([m.x + 0.24, fy + 1.55, m.z], [m.x + 0.36, fy + 1.05, m.z + 0.08], 0.07, BRONZE, 0, 5);
        s.tube([m.x - 0.24, fy + 1.55, m.z], [m.x - 0.3, fy + 1.1, m.z - 0.1], 0.07, BRONZE, 0, 5);
      } else if (m.k === 'bust') {
        // bust on a slim pillar
        s.box(0.55, 1.35, 0.55, m.x, y + 0.675, m.z, STONE);
        s.box(0.68, 0.1, 0.68, m.x, y + 1.4, m.z, STONE_D);
        s.cyl(0.26, 0.2, 0.32, m.x, y + 1.61, m.z, BRONZE, 8);           // shoulders
        s.cyl(0.07, 0.08, 0.1, m.x, y + 1.82, m.z, BRONZE, 6);           // neck
        s.sphere(0.13, m.x, y + 1.98, m.z, BRONZE, 0, 0, 1.2);           // head
      } else if (m.k === 'sculpture') {
        // abstract sculpture: the shape varies per artwork (no figure is invented)
        const v = Math.abs(Math.round(m.x * 7 + m.z * 13)) % 3;
        s.box(1.4, 0.25, 1.4, m.x, y + 0.125, m.z, STONE_D);
        if (v === 0) {
          // stacked, offset stone blocks
          for (let i = 0; i < 4; i++) s.box(0.9 - i * 0.12, 0.55, 0.6 - i * 0.05, m.x + (i % 2 ? 0.12 : -0.1), y + 0.52 + i * 0.55, m.z, i % 2 ? STONE : '#a89c86', 0, i * 0.35);
        } else if (v === 1) {
          // weathering-steel ring
          const R = 0.85, cy = y + 0.25 + R + 0.1;
          for (let i = 0; i < 14; i++) {
            const a0 = i / 14 * Math.PI * 2, a1 = (i + 1) / 14 * Math.PI * 2;
            s.tube([m.x + Math.cos(a0) * R, cy + Math.sin(a0) * R, m.z], [m.x + Math.cos(a1) * R, cy + Math.sin(a1) * R, m.z], 0.11, '#7a4a2c', 0, 6);
          }
        } else {
          // slender twisted column
          for (let i = 0; i < 7; i++) s.box(0.34, 0.42, 0.34, m.x, y + 0.46 + i * 0.4, m.z, '#8d8f8c', 0, i * 0.22);
        }
      } else if (m.k === 'stone') {
        // memorial stone with a bronze plaque
        s.box(1.1, 1.05, 0.55, m.x, y + 0.5, m.z, '#8f887c', 0, 0.2);
        s.box(0.95, 0.12, 0.45, m.x, y + 1.05, m.z, '#857e72', 0, 0.2);
        s.box(0.5, 0.36, 0.03, m.x - Math.sin(0.2) * 0.29, y + 0.6, m.z + Math.cos(0.2) * 0.29, BRONZE, 0, 0.2);
      } else {
        s.box(1.2, 0.3, 1.2, m.x, y + 0.15, m.z, STONE_D);
        s.box(0.8, 2.6, 0.8, m.x, y + 1.6, m.z, STONE);
        s.cyl(0.01, 0.4, 0.5, m.x, y + 3.15, m.z, STONE, 4);
      }
    }
    if (s.parts.length) {
      const mesh = new THREE.Mesh(s.build(), propMaterial(globalUniforms, { roughness: 0.75, metalness: 0.1 }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (water.length) {
      const gs = water.map(w => { const g = new THREE.CircleGeometry(w.r, 24); g.rotateX(-Math.PI / 2); g.translate(w.x, w.y, w.z); return g; });
      const wm = new THREE.Mesh(mergeAll(gs), game.mats.water);
      wm.receiveShadow = true;
      this.group.add(wm);
    }
    game.scene.add(this.group);
  }
  update() {}
}

function mergeAll(gs) {
  const pos = [], nor = [], idx = [];
  for (const g of gs) {
    const b = pos.length / 3, p = g.attributes.position, n = g.attributes.normal, ix = g.index;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    for (let i = 0; i < ix.count; i++) idx.push(b + ix.getX(i));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
