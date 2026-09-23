// Trees, shrubs and hedges.
//
// Every species (trees/species.js) is generated procedurally at load (trees/generator.js) in two
// levels of detail plus a baked impostor. Near the player, trees are drawn as real models:
//   tier 0  full detail (all branches, all leaf cards), casts shadows
//   tier 1  reduced model, casts shadows
//   tier 2  reduced model, no shadows, dithers out at the far end
// Beyond that one instanced billboard mesh shows every tree, dithering in as tier 2 fades out.
// Tier membership is rebuilt a few times per second from a spatial grid.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, hash2 } from '../shared/geom.js';
import { SPECIES, SPECIES_KEYS, HEDGE_PAL } from './trees/species.js';
import { generateTree, VARIANTS } from './trees/generator.js';
import { makeLeafAtlas, makeBark, tileRect } from './trees/textures.js';
import { barkMaterial, leafMaterial, leafDepthMaterial, impostorMaterial, fadeUniform } from './trees/materials.js';
import { bakeImpostors } from './trees/impostor.js';

const CELL = 32;
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export class Vegetation {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group(); this.group.name = 'vegetation';
    game.scene.add(this.group);
    const aa = !!game.renderer.getContextAttributes()?.antialias;
    const t0 = performance.now();

    // ---- textures ----
    this.atlas = makeLeafAtlas(game.renderer, game.quality === 'low' ? 256 : 512);
    const tA = performance.now();
    this.barks = {}; this.barkTimes = {};
    for (const k of new Set(SPECIES_KEYS.map(k => SPECIES[k].bark))) { const s = performance.now(); this.barks[k] = makeBark(k); this.barkTimes[k] = Math.round(performance.now() - s); }
    const t1 = performance.now();

    // ---- models + materials ----
    this.models = [];
    const modelOf = {};
    this.depthMat = leafDepthMaterial(this.atlas);
    const barkLum = {};
    for (const key of SPECIES_KEYS) {
      const sp = SPECIES[key];
      barkLum[key] = lum(new THREE.Color(sp.barkCol));
      const mats = {
        bark: [barkMaterial(this.barks[sp.bark], false), barkMaterial(this.barks[sp.bark], true)],
        leaf: [leafMaterial(this.atlas, sp, false, aa), leafMaterial(this.atlas, sp, true, aa)],
      };
      modelOf[key] = [];
      for (let v = 0; v < VARIANTS[key]; v++) {
        const m = generateTree(key, v, this.atlas.size);
        m.bark = sp.bark; m.mats = mats; m.index = this.models.length; m.species = SPECIES_KEYS.indexOf(key);
        modelOf[key].push(m.index);
        this.models.push(m);
      }
    }
    const t2 = performance.now();

    // ---- per-tree instance data ----
    const trees = game.layout.trees, n = trees.length;
    this.trees = trees;
    this.mat = new Float32Array(n * 16);
    this.icol = new Float32Array(n * 3);
    this.tModel = new Uint16Array(n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const counts = new Array(this.models.length).fill(0);
    this.grid = new Map();
    trees.forEach((t, i) => {
      const sp = SPECIES[t.sp];
      const list = modelOf[t.sp];
      const mi = list[(t.v || 0) % list.length];
      this.tModel[i] = mi; counts[mi]++;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.rot);
      m4.compose(pos.set(t.x, 0, t.z), q, scl.set(t.s, t.s * t.sy, t.s));
      m4.toArray(this.mat, i * 16);
      // autumn stage: neighbours are similar, each tree a bit different
      const r = rng(i * 7 + 11);
      const area = hash2(Math.floor(t.x / 60), Math.floor(t.z / 60));
      let prog, loss = 0;
      if (sp.evergreen) prog = t.ci;
      else {
        prog = Math.min(1, Math.max(0, 0.36 + sp.stage + (t.ci - 0.5) * 0.6 + (area - 0.5) * 0.3));
        loss = Math.max(0, prog - 0.5) * (0.5 + 0.5 * r());
      }
      this.icol[i * 3] = prog; this.icol[i * 3 + 1] = 0.86 + r() * 0.24; this.icol[i * 3 + 2] = loss;
      const k = Math.floor(t.x / CELL) * 100003 + Math.floor(t.z / CELL);
      let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(i);
    });

    // ---- near tiers ----
    for (const m of this.models) {
      const cap = Math.max(1, Math.min(counts[m.index], 900));
      m.tiers = [0, 1, 2].map(tier => {
        const lod = m.lods[tier === 0 ? 0 : 1];
        const leaf = new THREE.InstancedMesh(lod.leaves, m.mats.leaf[tier === 2 ? 1 : 0], cap);
        leaf.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        const bark = new THREE.InstancedMesh(lod.bark, m.mats.bark[tier === 2 ? 1 : 0], cap);
        bark.instanceMatrix = leaf.instanceMatrix;
        leaf.instanceMatrix.setUsage(THREE.DynamicDrawUsage); leaf.instanceColor.setUsage(THREE.DynamicDrawUsage);
        for (const o of [leaf, bark]) {
          o.count = 0; o.visible = false;
          o.castShadow = tier < 2; o.receiveShadow = true;
          this.group.add(o);
        }
        leaf.customDepthMaterial = this.depthMat;
        return { leaf, bark, cap, count: 0 };
      });
    }

    // ---- impostors ----
    this.bake = bakeImpostors(game.renderer, this.models, this.atlas, this.barks, barkLum);
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const imat = impostorMaterial(this.bake, SPECIES_KEYS.map(k => SPECIES[k].pal), SPECIES_KEYS.map(k => SPECIES[k].barkCol));
    const imp = new THREE.InstancedMesh(quad, imat, n);
    const aImp = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const t = trees[i], mi = this.tModel[i];
      m4.compose(pos.set(t.x, 0, t.z), q.identity(), scl.set(t.s, t.s * t.sy, t.s));
      imp.setMatrixAt(i, m4);
      aImp[i * 4] = mi; aImp[i * 4 + 1] = this.models[mi].species; aImp[i * 4 + 2] = hash2(i, 5) < 0.5 ? 1 : -1;
    }
    imp.instanceColor = new THREE.InstancedBufferAttribute(this.icol.slice(), 3);
    quad.setAttribute('aImp', new THREE.InstancedBufferAttribute(aImp, 4));
    imp.frustumCulled = false;
    imp.castShadow = false; imp.receiveShadow = false;
    this.impostors = imp;
    this.group.add(imp);

    this._buildHedges(aa);

    this.lx = 1e9; this.lz = 1e9; this.t = 0;
    this.setQuality(game.quality);
    this.stats = {
      atlas: Math.round(tA - t0), atlasTimes: makeLeafAtlas.times, barks: this.barkTimes, textures: Math.round(t1 - t0), models: Math.round(t2 - t1), total: Math.round(performance.now() - t0),
      tris: this.models.map(m => `${m.key}${m.variant}: ${m.stats.barkTris[0] + m.stats.leafTris[0]}/${m.stats.barkTris[1] + m.stats.leafTris[1]}`),
    };
  }

  setQuality(q) {
    this.lod0 = q === 'high' ? 55 : q === 'medium' ? 38 : 22;
    this.near = q === 'high' ? 150 : q === 'medium' ? 105 : 62;
    this.castDist = q === 'high' ? 90 : q === 'medium' ? 65 : 40;
    fadeUniform.value.set(this.near - 8, 8);
    this.lx = 1e9;
  }

  update(dt) {
    this.t -= dt;
    const c = this.game.camera.position;
    const moved = (c.x - this.lx) ** 2 + (c.z - this.lz) ** 2;
    if (this.t > 0 && moved < 4) return;
    this.t = 0.25; this.lx = c.x; this.lz = c.z;
    for (const m of this.models) for (const t of m.tiers) t.count = 0;
    const R = this.near + 3, r0 = this.lod0, rc = this.castDist;
    const gx0 = Math.floor((c.x - R) / CELL), gx1 = Math.floor((c.x + R) / CELL);
    const gz0 = Math.floor((c.z - R) / CELL), gz1 = Math.floor((c.z + R) / CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const a = this.grid.get(gx * 100003 + gz); if (!a) continue;
      for (const i of a) {
        const t = this.trees[i];
        const d = Math.hypot(t.x - c.x, t.z - c.z);
        if (d > R) continue;
        const tier = this.models[this.tModel[i]].tiers[d < r0 ? 0 : d < rc ? 1 : 2];
        if (tier.count >= tier.cap) continue;
        const k = tier.count++;
        tier.leaf.instanceMatrix.array.set(this.mat.subarray(i * 16, i * 16 + 16), k * 16);
        tier.leaf.instanceColor.array.set(this.icol.subarray(i * 3, i * 3 + 3), k * 3);
      }
    }
    for (const m of this.models) for (const t of m.tiers) {
      const vis = t.count > 0;
      for (const o of [t.leaf, t.bark]) { o.count = t.count; o.visible = vis; o.boundingSphere = null; }
      if (!vis) continue;
      const im = t.leaf.instanceMatrix, ic = t.leaf.instanceColor;
      im.clearUpdateRanges(); im.addUpdateRange(0, t.count * 16); im.needsUpdate = true;
      ic.clearUpdateRanges(); ic.addUpdateRange(0, t.count * 3); ic.needsUpdate = true;
    }
  }

  // Hedges: a dense core plus leafy cards sticking out of every face (hornbeam / privet).
  _buildHedges(aa) {
    const w = this.game.world;
    const r = rng(99);
    const core = [], cards = { pos: [], nor: [], uv: [], card: [], wind: [], idx: [] };
    const tiles = [12, 13];
    const up = new THREE.Vector3(0, 1, 0);
    for (const b of w.barriers) {
      if (b.k !== 'hedge') continue;
      for (let i = 0; i < b.p.length - 1; i++) {
        const [ax, az] = b.p[i], [bx, bz] = b.p[i + 1];
        const L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
        const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
        const g = new THREE.BoxGeometry(L + 0.3, b.h - 0.12, 0.72);
        g.rotateY(-Math.atan2(bz - az, bx - ax));
        g.translate((ax + bx) / 2, (b.h - 0.12) / 2, (az + bz) / 2);
        g.deleteAttribute('uv');
        core.push(g);
        // cards over both sides and the top
        const nCards = Math.round(L * (b.h * 2 + 0.9) * 3.2);
        for (let k = 0; k < nCards; k++) {
          const f = r(), face = r();
          let px, py, pz, out;
          const along = -0.15 + f * (L + 0.3);
          if (face < 0.8) {
            const side = face < 0.4 ? 1 : -1;
            py = 0.1 + r() * (b.h - 0.25);
            out = new THREE.Vector3(nx * side, 0, nz * side);
            px = ax + ux * along + out.x * (0.3 + r() * 0.12); pz = az + uz * along + out.z * (0.3 + r() * 0.12);
          } else {
            py = b.h - 0.2 + r() * 0.12;
            out = up.clone();
            const o = (r() - 0.5) * 0.6;
            px = ax + ux * along + nx * o; pz = az + uz * along + nz * o;
          }
          const size = 0.45 + r() * 0.3;
          const dirUp = out.clone().multiplyScalar(0.8).add(new THREE.Vector3(r() - 0.5, r() * 0.6, r() - 0.5)).normalize();
          const t = Math.abs(dirUp.y) < 0.95 ? new THREE.Vector3().crossVectors(dirUp, up).normalize() : new THREE.Vector3(1, 0, 0);
          const bn = new THREE.Vector3().crossVectors(dirUp, t).normalize();
          const a = r() * Math.PI * 2;
          const right = t.multiplyScalar(Math.cos(a)).addScaledVector(bn, Math.sin(a));
          const tr = tileRect(tiles[k % 2], this.atlas.size);
          const base = new THREE.Vector3(px, py, pz).addScaledVector(dirUp, -size * 0.35);
          const b0 = cards.pos.length / 3, rnd = [r(), r(), r()];
          for (const [cx, cy, u, v] of [[-0.5, 0, tr.u0, tr.vBot], [0.5, 0, tr.u1, tr.vBot], [0.5, 1, tr.u1, tr.vTop], [-0.5, 1, tr.u0, tr.vTop]]) {
            const p = base.clone().addScaledVector(right, cx * size).addScaledVector(dirUp, cy * size);
            cards.pos.push(p.x, p.y, p.z);
            const nn = out.clone().multiplyScalar(0.8).addScaledVector(up, 0.3).normalize();
            cards.nor.push(nn.x, nn.y, nn.z);
            cards.uv.push(u, v);
            cards.card.push(rnd[0], rnd[1], rnd[2], 0.65 + 0.35 * Math.min(1, py / b.h));
            cards.wind.push(0, 0.35 * cy);
          }
          cards.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
        }
      }
    }
    if (!core.length) return;
    const coreMesh = new THREE.Mesh(mergeGeometries(core), new THREE.MeshStandardMaterial({ color: 0x2c3f22, roughness: 0.95 }));
    coreMesh.castShadow = true; coreMesh.receiveShadow = true;
    this.group.add(coreMesh);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cards.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(cards.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(cards.uv, 2));
    g.setAttribute('aCard', new THREE.Float32BufferAttribute(cards.card, 4));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(cards.wind, 2));
    g.setIndex(cards.idx);
    const mat = leafMaterial(this.atlas, { pal: HEDGE_PAL, twig: '#3f3528' }, false, aa, [0.28, 0.9, 0]);
    const mesh = new THREE.Mesh(g, mat);
    mesh.customDepthMaterial = this.depthMat;
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
  }
}
