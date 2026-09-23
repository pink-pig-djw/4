// Grass tufts around the player: short sparse clumps on mown lawns, taller straw-tipped grass in
// meadows, scrub and forest, and in the strips a mower can't reach (tree bases, wall and hedge
// feet). Generated per 8 m cell (deterministic, cached), instanced, shrinking out with distance.
import * as THREE from 'three';
import { groundY } from './terrain.js';
import { globalUniforms } from './materials.js';
import { rng } from '../shared/geom.js';

const CELL = 8;

// one clump: n curved blades (base, two mid points, tip), vertex colour from base to tip
function clumpGeometry(n, h, w, seed) {
  const r = rng(seed);
  const pos = [], col = [], nor = [], hgt = [], idx = [];
  for (let b = 0; b < n; b++) {
    const a = r() * Math.PI * 2, d = r() * 0.08;
    const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
    const lean = (0.15 + r() * 0.45), la = r() * Math.PI * 2;
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const bh = h * (0.6 + r() * 0.5), bw = w * (0.7 + r() * 0.6);
    const px = -Math.sin(la), pz = Math.cos(la);   // blade width direction
    const base = pos.length / 3;
    const pts = [0, 0.4, 0.75, 1];
    pts.forEach((t, i) => {
      const bend = t * t;
      const x = bx + lx * bend * bh, z = bz + lz * bend * bh, y = t * bh;
      const ww = bw * (1 - t * 0.85) * 0.5;
      if (i < 3) {
        pos.push(x - px * ww, y, z - pz * ww, x + px * ww, y, z + pz * ww);
        for (let k = 0; k < 2; k++) { col.push(t, t, t); nor.push(lx * 0.3, 1, lz * 0.3); hgt.push(t * bh); }
      } else {
        pos.push(x, y, z); col.push(1, 1, 1); nor.push(lx * 0.3, 1, lz * 0.3); hgt.push(bh);
      }
    });
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 5, base + 2, base + 5, base + 4, base + 4, base + 5, base + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(col.filter((_, i) => i % 3 === 0), 1));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hgt, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function grassMaterial(base, tip, fadeUniform) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = globalUniforms.uTime; sh.uniforms.uWind = globalUniforms.uWind; sh.uniforms.uWet = globalUniforms.uWet;
    sh.uniforms.uFadeR = fadeUniform;
    sh.uniforms.uBase = { value: new THREE.Color(base) }; sh.uniforms.uTip = { value: new THREE.Color(tip) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aT; attribute float aH;
uniform float uTime; uniform float uWind; uniform float uFadeR; uniform vec3 uBase; uniform vec3 uTip;
varying vec3 vGrass;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 gi = instanceMatrix[3].xyz;
float gd = distance(cameraPosition.xz, gi.xz);
float gs = 1.0 - smoothstep(uFadeR * 0.65, uFadeR, gd);
transformed *= gs;
float gph = dot(gi.xz, vec2(0.37, 0.61));
float gw = uWind * (0.6 + 0.4 * sin(uTime * 0.7 + gi.x * 0.05));
transformed.x += sin(uTime * 2.1 + gph) * aH * aH * 0.9 * gw;
transformed.z += cos(uTime * 1.7 + gph * 1.3) * aH * aH * 0.6 * gw;
vGrass = mix(uBase, uTip, aT) * instanceColor;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrass;\nuniform float uWet;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vGrass * (1.0 - 0.3 * uWet);')
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  m.customProgramCacheKey = () => 'grass-v1';
  return m;
}

const LAWN = new Set([null, 'grass', 'island']);
const TALL = { meadow: 2.2, scrub: 1.4, forest: 0.35, wetland: 1.2, farmland: 0 };

export class Grass {
  constructor(game) {
    this.game = game;
    this.fade = { value: 22 };
    this.kinds = [
      { geo: clumpGeometry(10, 0.15, 0.013, 3), mat: grassMaterial('#3c5a2a', '#7f9447', this.fade), cap: 5000 },
      { geo: clumpGeometry(14, 0.42, 0.014, 7), mat: grassMaterial('#4a5f2e', '#b7a86a', this.fade), cap: 3500 },
    ];
    for (const k of this.kinds) {
      k.mesh = new THREE.InstancedMesh(k.geo, k.mat, k.cap);
      k.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(k.cap * 3), 3);
      k.mesh.count = 0; k.mesh.frustumCulled = false; k.mesh.receiveShadow = true; k.mesh.castShadow = false;
      game.scene.add(k.mesh);
    }
    this.cells = new Map();
    this.lastKey = null;
    // tree trunks by cell for the unmown rings
    this.treeCells = new Map();
    for (const t of game.layout.trees) {
      const k = Math.floor(t.x / CELL) * 100003 + Math.floor(t.z / CELL);
      let a = this.treeCells.get(k); if (!a) this.treeCells.set(k, a = []); a.push(t);
    }
    this.setQuality(game.quality);
  }

  setQuality(q) {
    this.density = q === 'high' ? 1.4 : q === 'medium' ? 1 : 0.5;
    this.fade.value = q === 'high' ? 30 : q === 'medium' ? 22 : 14;
    this.cells.clear(); this.lastKey = null;
  }

  _cell(ci, cj) {
    const key = ci * 100003 + cj;
    let c = this.cells.get(key);
    if (c) return c;
    const L = this.game.layout, ai = L.areaIndex, ri = L.roadIndex, bi = L.buildingIndex;
    const r = rng(key * 13 + 5);
    c = [[], []];
    const x0 = ci * CELL, z0 = cj * CELL;
    const trees = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = this.treeCells.get((ci + i) * 100003 + cj + j); if (a) trees.push(...a); }
    const n = Math.round(CELL * CELL * 1.6 * this.density);
    for (let k = 0; k < n; k++) {
      const x = x0 + r() * CELL, z = z0 + r() * CELL, rr = r(), sc = r(), tint = r();
      const kind = ai.kindAt(x, z);
      const lawn = LAWN.has(kind);
      if (!lawn && !(kind in TALL)) continue;
      if (ri.intrusion(x, z, 0.12)) continue;
      const cl = bi.clearance(x, z, 1.2);
      if (cl < 0.05) continue;
      let tall = !lawn && rr < TALL[kind] / 2.2;
      if (lawn) {
        // unmown strips at walls and around trunks
        if (cl < 0.5) tall = rr < 0.8;
        else for (const t of trees) { const d = Math.hypot(t.x - x, t.z - z); if (d < 0.25 + t.s * 0.35) { if (d < 0.2 + t.s * 0.2) { tall = false; break; } tall = rr < 0.7; } }
        if (!tall && rr > 0.55) continue;
      } else if (!tall) continue;
      c[tall ? 1 : 0].push([x, z, r() * Math.PI * 2, tall ? 0.7 + sc * 0.8 : 0.7 + sc * 0.7, 0.85 + tint * 0.3]);
    }
    this.cells.set(key, c);
    if (this.cells.size > 400) { const first = this.cells.keys().next().value; this.cells.delete(first); }
    return c;
  }

  update() {
    const g = this.game;
    const p = g.camera.position;
    const ci = Math.floor(p.x / CELL), cj = Math.floor(p.z / CELL);
    const key = ci + ',' + cj + (g.indoor ? 'i' : '');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const R = Math.ceil(this.fade.value / CELL);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const counts = [0, 0];
    if (!g.indoor || p.y < 3) {
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        const cell = this._cell(ci + i, cj + j);
        for (let k = 0; k < 2; k++) {
          const K = this.kinds[k];
          for (const [x, z, rot, sc, tint] of cell[k]) {
            if (counts[k] >= K.cap) break;
            q.setFromAxisAngle(up, rot);
            m4.compose(v.set(x, groundY(x, z), z), q, s.set(sc, sc, sc));
            K.mesh.setMatrixAt(counts[k], m4);
            K.mesh.setColorAt(counts[k], c.setRGB(tint, tint * (0.97 + (tint - 1) * 0.3), tint * 0.95));
            counts[k]++;
          }
        }
      }
    }
    this.kinds.forEach((K, k) => {
      K.mesh.count = counts[k];
      K.mesh.instanceMatrix.needsUpdate = true;
      if (K.mesh.instanceColor) K.mesh.instanceColor.needsUpdate = true;
    });
  }
}
