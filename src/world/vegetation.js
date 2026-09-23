// Trees (instanced, two LODs), hedges and shrubs. Autumn foliage colours per instance.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { globalUniforms } from './materials.js';
import { rng } from '../shared/geom.js';
import { chunkedInstances } from './shapes.js';

const AUTUMN = [
  ['#6d8b3c', 14], ['#5b7a33', 10], ['#8f9a3a', 10], ['#b3a032', 10], ['#caa22c', 12], ['#d8b43a', 7],
  ['#cf7d2c', 10], ['#b8632a', 8], ['#9a4426', 5], ['#7f5a2e', 4],
];
const CONIFER = ['#3b5634', '#34502f', '#415c38', '#2f4a2c'];

function pickWeighted(list, r) {
  const tot = list.reduce((s, x) => s + x[1], 0);
  let v = r * tot;
  for (const [c, w] of list) { v -= w; if (v <= 0) return c; }
  return list[0][0];
}

function colorize(g, rgb, fol, jitter, seed) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3), f = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const k = 1 + (r() - 0.5) * jitter;
    col[i * 3] = rgb[0] * k; col[i * 3 + 1] = rgb[1] * k; col[i * 3 + 2] = rgb[2] * k; f[i] = fol;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aFol', new THREE.BufferAttribute(f, 1));
  return g;
}

const flat = g => (g.index ? g.toNonIndexed() : g);
function lumpy(geo, amp, seed) {
  const p = geo.attributes.position, r = rng(seed);
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
    let d = map.get(key); if (d == null) { d = 1 + (r() - 0.5) * amp; map.set(key, d); }
    p.setXYZ(i, p.getX(i) * d, p.getY(i) * d, p.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}

const TRUNK = [0.36, 0.28, 0.22];
function deciduous(detail, seed) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.13, 0.22, 3.6, detail ? 7 : 4, 1).translate(0, 1.8, 0);
  parts.push(colorize(flat(trunk), TRUNK, 0, 0.1, seed));
  if (detail) {
    const r = rng(seed + 9);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.CylinderGeometry(0.05, 0.09, 2.2, 5).translate(0, 1.1, 0);
      b.rotateZ(0.6 + r() * 0.3); b.rotateY(i * 2.1 + r()); b.translate(0, 3.0, 0);
      parts.push(colorize(flat(b), TRUNK, 0, 0.1, seed + i));
    }
    const blobs = [[0, 5.6, 0, 2.4], [1.3, 5.0, 0.5, 1.7], [-1.2, 5.1, -0.4, 1.8], [0.3, 6.6, -0.6, 1.6], [-0.4, 4.6, 1.2, 1.5], [0.6, 4.6, -1.2, 1.4]];
    blobs.forEach(([x, y, z, rad], i) => {
      const g = flat(lumpy(new THREE.IcosahedronGeometry(rad, i === 0 ? 1 : 0), 0.35, seed * 13 + i));
      g.translate(x, y, z);
      parts.push(colorize(g, [1, 1, 1], 1, 0.35, seed * 7 + i));
    });
  } else {
    const g = flat(new THREE.IcosahedronGeometry(2.8, 0)); g.scale(1, 0.95, 1); g.translate(0, 5.4, 0);
    parts.push(colorize(g, [1, 1, 1], 1, 0.3, seed));
  }
  const m = mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p; }));
  m.computeBoundingSphere();
  return m;
}

function conifer(detail, seed) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 3, detail ? 6 : 4).translate(0, 1.5, 0);
  parts.push(colorize(flat(trunk), TRUNK, 0, 0.1, seed));
  const tiers = detail ? 4 : 2;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const c = new THREE.ConeGeometry(2.3 * (1 - t * 0.7), 3.6 - t, detail ? 8 : 5).translate(0, 3.2 + i * (detail ? 1.9 : 3.2), 0);
    parts.push(colorize(flat(detail ? lumpy(c, 0.15, seed + i) : c), [1, 1, 1], 1, 0.2, seed + i));
  }
  const m = mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p; }));
  m.computeBoundingSphere();
  return m;
}

function shrub(detail, seed) {
  const g = flat(lumpy(new THREE.IcosahedronGeometry(1, detail ? 1 : 0), 0.4, seed));
  g.scale(1.2, 0.8, 1.2); g.translate(0, 0.6, 0);
  const m = colorize(g, [1, 1, 1], 1, 0.3, seed);
  m.deleteAttribute('uv');
  return m;
}

function treeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = globalUniforms.uTime;
    sh.uniforms.uWet = globalUniforms.uWet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFol;\nuniform float uTime;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.xyz = mix(color.xyz, vColor.xyz, aFol);\n#endif')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
  float sway = aFol * smoothstep(2.5, 8.0, position.y);
  transformed.x += sin(uTime * 1.1 + ph) * 0.09 * sway;
  transformed.z += cos(uTime * 0.9 + ph * 1.3) * 0.07 * sway;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.25 * uWet;');
  };
  m.customProgramCacheKey = () => 'tree-v1';
  return m;
}

export class Vegetation {
  constructor(game) {
    this.game = game;
    const w = game.world;
    this.material = treeMaterial();
    // types: 0 deciduous, 1 conifer, 2 (unused), 3 shrub
    this.kinds = [
      { near: deciduous(true, 1), far: deciduous(false, 1), list: [] },
      { near: conifer(true, 2), far: conifer(false, 2), list: [] },
      { near: shrub(true, 3), far: shrub(false, 3), list: [] },
    ];
    const tmpC = new THREE.Color();
    for (const t of game.layout.trees) {
      const col = t.k === 1 ? CONIFER[Math.floor(t.ci * CONIFER.length)] : pickWeighted(AUTUMN, t.ci);
      tmpC.set(col);
      this.kinds[t.k].list.push({ x: t.x, z: t.z, s: t.s, rot: t.rot, c: [tmpC.r, tmpC.g, tmpC.b], sy: t.sy });
    }
    this.group = new THREE.Group(); this.group.name = 'vegetation';
    game.scene.add(this.group);
    this.nearDist = 150;
    this.setQuality(game.quality);
    const veg = this;
    for (const kd of this.kinds) {
      const place = (t, p, s, c) => { p.set(t.x, 0, t.z); s.set(t.s, t.s * t.sy, t.s); c.setRGB(t.c[0], t.c[1], t.c[2]); return { rot: t.rot }; };
      const near = chunkedInstances(this.group, kd.near, this.material, kd.list, place, { color: true, chunk: 80, maxDist: 2000, castDist: 110 });
      const far = chunkedInstances(this.group, kd.far, this.material, kd.list, place, { color: true, chunk: 80, maxDist: 2000, cast: false });
      for (const m of near) m.userData.cull.lod = d => d < veg.nearDist;
      for (const m of far) m.userData.cull.lod = d => d >= veg.nearDist;
    }
    this._buildHedges();
  }

  setQuality(q) {
    this.nearDist = q === 'high' ? 200 : q === 'medium' ? 120 : 65;
  }

  _buildHedges() {
    const w = this.game.world;
    const geos = [];
    const r = rng(99);
    for (const b of w.barriers) {
      if (b.k !== 'hedge') continue;
      for (let i = 0; i < b.p.length - 1; i++) {
        const [ax, az] = b.p[i], [bx, bz] = b.p[i + 1];
        const L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
        const g = flat(lumpy(new THREE.BoxGeometry(L + 0.4, b.h, 0.9, Math.max(1, Math.round(L / 1.5)), 2, 1), 0.08, i));
        g.rotateY(-Math.atan2(bz - az, bx - ax));
        g.translate((ax + bx) / 2, b.h / 2, (az + bz) / 2);
        const c = new THREE.Color().setHSL(0.24 + r() * 0.04, 0.38, 0.24 + r() * 0.05);
        colorize(g, [c.r, c.g, c.b], 0, 0.25, i);
        g.deleteAttribute('uv');
        geos.push(g);
      }
    }
    if (geos.length) {
      const m = new THREE.Mesh(mergeGeometries(geos), this.material);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }
  }

  update() { /* chunk visibility handled by DistanceCuller */ }
}
