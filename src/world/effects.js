// Weather & season effects: rain streaks + ripples, fallen leaves on the ground, drifting leaves,
// a few real point lights at the nearest street lamps at night.
import * as THREE from 'three';
import { globalUniforms } from './materials.js';
import { leafAtlas } from './textures.js';
import { rng, hash2, pointInPoly } from '../shared/geom.js';

const LEAF_COLS = ['#c9a22c', '#d8b43a', '#cf7d2c', '#b8632a', '#9a4426', '#8f9a3a', '#b3a032', '#7f5a2e', '#e0b050'].map(c => new THREE.Color(c));

export class Effects {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group(); this.group.name = 'effects';
    game.scene.add(this.group);
    this.quality = game.quality;
    this._rain();
    this._ripples();
    this._groundLeaves();
    this._fallingLeaves();
    this._lampLights();
  }

  setQuality(q) { this.quality = q; this.leafCells.clear(); this.lastCell = null; }

  // ---------- rain ----------
  _rain() {
    const N = 6000;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(0.018, 0.7);
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    const off = new Float32Array(N * 4);
    const r = rng(33);
    for (let i = 0; i < N; i++) { off[i * 4] = r(); off[i * 4 + 1] = r(); off[i * 4 + 2] = r(); off[i * 4 + 3] = i / N; }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = N;
    this.rainU = { uCam: { value: new THREE.Vector3() }, uTime: globalUniforms.uTime, uAmt: { value: 0 }, uBox: { value: new THREE.Vector3(36, 22, 36) } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        uniform vec3 uCam; uniform float uTime; uniform float uAmt; uniform vec3 uBox;
        attribute vec4 aOff; varying float vA; varying vec2 vUv;
        void main() {
          vUv = uv;
          if (aOff.w > uAmt) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
          vec3 c;
          c.x = uCam.x + (fract(aOff.x - uCam.x / uBox.x) - 0.5) * uBox.x;
          c.z = uCam.z + (fract(aOff.z - uCam.z / uBox.z) - 0.5) * uBox.z;
          float fall = fract(aOff.y - uTime * 9.5 / uBox.y);
          c.y = uCam.y - 6.0 + fall * uBox.y;
          c.x += (1.0 - fall) * 0.6; // slight wind slant
          // camera-facing around the vertical axis
          vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
          vec3 p = c + right * position.x + vec3(0.12, 1.0, 0.0) * position.y;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = smoothstep(26.0, 4.0, length(mv.xyz)) * step(0.0, c.y);
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying vec2 vUv;
        void main() { float a = vA * 0.32 * (1.0 - abs(vUv.x - 0.5) * 2.0); gl_FragColor = vec4(0.82, 0.86, 0.9, a); }`,
    });
    this.rainMesh = new THREE.Mesh(g, m);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 10;
    this.group.add(this.rainMesh);
  }

  _ripples() {
    const N = 500;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1); base.rotateX(-Math.PI / 2);
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    const off = new Float32Array(N * 4); const r = rng(44);
    for (let i = 0; i < N; i++) { off[i * 4] = r(); off[i * 4 + 1] = r(); off[i * 4 + 2] = r(); off[i * 4 + 3] = i / N; }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = N;
    const u = this.rippleU = { uCam: this.rainU.uCam, uTime: globalUniforms.uTime, uAmt: this.rainU.uAmt };
    const m = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        uniform vec3 uCam; uniform float uTime; uniform float uAmt; attribute vec4 aOff; varying vec2 vUv; varying float vT; varying float vA;
        void main() {
          vUv = uv;
          if (aOff.w > uAmt) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float t = uTime * (1.2 + aOff.y) + aOff.z * 10.0;
          float cyc = floor(t);
          vT = fract(t);
          vec2 rnd = fract(vec2(sin(cyc * 12.9898 + aOff.x * 78.233), sin(cyc * 39.346 + aOff.z * 11.135)) * 43758.5453);
          vec3 c = vec3(uCam.x + (rnd.x - 0.5) * 22.0, 0.1, uCam.z + (rnd.y - 0.5) * 22.0);
          float s = 0.05 + vT * 0.28;
          vec4 mv = viewMatrix * vec4(c + position * s, 1.0);
          vA = smoothstep(14.0, 3.0, length(mv.xyz));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vT; varying float vA;
        void main() { float d = length(vUv - 0.5) * 2.0; float ring = smoothstep(0.75, 0.9, d) * smoothstep(1.0, 0.92, d); gl_FragColor = vec4(0.85, 0.9, 0.95, ring * (1.0 - vT) * 0.45 * vA); }`,
    });
    this.rippleMesh = new THREE.Mesh(g, m);
    this.rippleMesh.frustumCulled = false;
    this.rippleMesh.renderOrder = 9;
    this.group.add(this.rippleMesh);
  }

  // ---------- leaves on the ground (regenerated around the player) ----------
  _groundLeaves() {
    this.leafTex = leafAtlas();
    const max = 9000;
    const geo = new THREE.PlaneGeometry(0.12, 0.12); geo.rotateX(-Math.PI / 2);
    // pick one of four atlas cells per instance via uv offset attribute
    const cell = new Float32Array(max * 2);
    for (let i = 0; i < max; i++) { cell[i * 2] = (i % 2) * 0.5; cell[i * 2 + 1] = (Math.floor(i / 2) % 2) * 0.5; }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2));
    const m = new THREE.MeshStandardMaterial({ map: this.leafTex, alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      sh.uniforms.uWet = globalUniforms.uWet;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = uv * 0.5 + aCell;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWet;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.35 * uWet;');
    };
    m.customProgramCacheKey = () => 'leaf-ground';
    m.polygonOffset = true; m.polygonOffsetFactor = -6; m.polygonOffsetUnits = -6;
    this.groundLeaves = new THREE.InstancedMesh(geo, m, max);
    this.groundLeaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.groundLeaves.count = 0;
    this.groundLeaves.frustumCulled = false;
    this.groundLeaves.receiveShadow = true;
    this.group.add(this.groundLeaves);
    this.leafCells = new Map();
    // deciduous trees by 20 m cell
    this.treeCells = new Map();
    for (const t of this.game.layout.trees) {
      if (t.k !== 0) continue;
      const k = Math.floor(t.x / 20) * 10000 + Math.floor(t.z / 20);
      let a = this.treeCells.get(k); if (!a) this.treeCells.set(k, a = []); a.push(t);
    }
  }

  _cellLeaves(ci, cj) {
    const key = ci * 10000 + cj;
    let c = this.leafCells.get(key);
    if (c) return c;
    const trees = this.treeCells.get(key) || [];
    const r = rng(key * 7 + 3);
    const per = this.quality === 'high' ? 34 : this.quality === 'medium' ? 22 : 10;
    const out = [];
    const bi = this.game.layout.buildingIndex;
    for (const t of trees) {
      const n = Math.round(per * t.s);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (2.2 + 3.2 * t.s);
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        if (bi.clearance(x, z, 0.5) < 0) continue;
        out.push([x, z, r() * Math.PI * 2, 0.7 + r() * 0.8, Math.floor(r() * LEAF_COLS.length), r() * 0.3]);
      }
    }
    c = out;
    this.leafCells.set(key, c);
    return c;
  }

  _updateGroundLeaves(p) {
    const cx = Math.floor(p.x / 20), cz = Math.floor(p.z / 20);
    const key = cx + ',' + cz;
    if (key === this.lastCell) return;
    this.lastCell = key;
    const R = this.quality === 'low' ? 2 : 3;
    const mesh = this.groundLeaves, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    let n = 0;
    const amt = this.game.weather.current.leaves ?? 1;
    this.lastLeafAmt = amt;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      for (const L of this._cellLeaves(cx + i, cz + j)) {
        if (n >= mesh.instanceMatrix.count) break;
        if (L[5] > amt) continue;
        e.set(L[5] * 0.4, L[2], 0); q.setFromEuler(e);
        m4.compose(v.set(L[0], 0.085, L[1]), q, s.set(L[3], 1, L[3]));
        mesh.setMatrixAt(n, m4);
        mesh.setColorAt(n, LEAF_COLS[L[4]]);
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    // keep cache bounded
    if (this.leafCells.size > 400) this.leafCells.clear();
  }

  // ---------- drifting leaves ----------
  _fallingLeaves() {
    const N = 160;
    const geo = new THREE.PlaneGeometry(0.12, 0.12);
    const cell = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { cell[i * 2] = (i % 2) * 0.5; cell[i * 2 + 1] = (Math.floor(i / 2) % 2) * 0.5; }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2));
    const m = new THREE.MeshStandardMaterial({ map: this.leafTex, alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = uv * 0.5 + aCell;');
    };
    m.customProgramCacheKey = () => 'leaf-fall';
    this.fall = new THREE.InstancedMesh(geo, m, N);
    this.fall.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.fall.frustumCulled = false;
    this.fall.count = 0;
    this.group.add(this.fall);
    this.fallState = Array.from({ length: N }, (_, i) => ({ t: Math.random() * 8, dur: 6 + Math.random() * 5, tree: null, seed: Math.random() * 100, col: LEAF_COLS[i % LEAF_COLS.length] }));
  }

  _updateFalling(dt, p) {
    const amt = (this.game.weather.current.leaves ?? 1) * (1 - (this.game.weather.current.rain || 0) * 0.5);
    const trees = [];
    const cx = Math.floor(p.x / 20), cz = Math.floor(p.z / 20);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const a = this.treeCells.get((cx + i) * 10000 + cz + j); if (a) trees.push(...a); }
    const mesh = this.fall, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    let n = 0;
    const active = Math.floor(this.fallState.length * Math.min(1, amt)) * (this.game.indoor ? 0 : 1);
    for (let i = 0; i < active; i++) {
      const L = this.fallState[i];
      L.t += dt;
      if (!L.tree || L.t > L.dur) {
        if (!trees.length) continue;
        L.tree = trees[Math.floor(Math.random() * trees.length)]; L.t = 0; L.dur = 6 + Math.random() * 5;
        L.ox = (Math.random() - 0.5) * 4 * L.tree.s; L.oz = (Math.random() - 0.5) * 4 * L.tree.s; L.h = 4 + Math.random() * 3 * L.tree.s;
      }
      const f = L.t / L.dur, y = L.h * (1 - f) + 0.1;
      const sway = Math.sin(L.t * 2.2 + L.seed) * 0.6;
      v.set(L.tree.x + L.ox + sway + f * 1.5, y, L.tree.z + L.oz + Math.cos(L.t * 1.7 + L.seed) * 0.4);
      e.set(L.t * 3 + L.seed, L.t * 2.3, L.t * 1.3); q.setFromEuler(e);
      m4.compose(v, q, s);
      mesh.setMatrixAt(n, m4); mesh.setColorAt(n, L.col);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // ---------- real lights at the nearest lamps (night) ----------
  _lampLights() {
    this.lights = [];
    // real point lights make every lit shader loop over them (costly on laptops); the painted light
    // pools under the lamps give the night look instead
    const n = 0;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffd9a0, 0, 22, 1.6);
      this.group.add(l);
      this.lights.push(l);
    }
    this.lampT = 0;
  }

  update(dt, game) {
    const p = game.player, cam = game.camera.position, W = game.weather.current;
    this.rainU.uCam.value.copy(cam);
    const rainAmt = (W.rain || 0) * (game.indoor ? 0 : 1) * (this.quality === 'low' ? 0.5 : this.quality === 'medium' ? 0.8 : 1);
    this.rainU.uAmt.value = rainAmt;
    this.rainMesh.visible = rainAmt > 0.01;
    this.rippleMesh.visible = rainAmt > 0.01;
    const la = W.leaves ?? 1;
    if (Math.abs(la - (this.lastLeafAmt ?? la)) > 0.1) this.lastCell = null;
    this._updateGroundLeaves(p);
    this._updateFalling(dt, p);
    // lamp lights
    this.lampT -= dt;
    const night = W.night || 0;
    if (this.lights.length && (this.lampT <= 0)) {
      this.lampT = 0.5;
      const lamps = game.layout.lamps;
      const near = [];
      for (const l of lamps) { const d = (l.x - p.x) ** 2 + (l.z - p.z) ** 2; if (d < 60 * 60) near.push([d, l]); }
      near.sort((a, b) => a[0] - b[0]);
      this.lights.forEach((L, i) => {
        const e = near[i];
        if (!e) { L.position.set(p.x, -50, p.z); return; }
        const l = e[1];
        const tall = l.h > 6;
        L.position.set(l.x + (tall ? Math.cos(l.yaw) * 1.5 : 0), tall ? 7.6 : 3.9, l.z + (tall ? Math.sin(l.yaw) * 1.5 : 0));
      });
    }
    for (const L of this.lights) L.intensity = night * 55;
  }
}
