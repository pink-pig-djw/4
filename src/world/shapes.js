// Tiny helpers to build merged low-poly prop geometries with vertex colours and a "tint" channel
// (tint = 1 → vertex colour is multiplied by the per-instance colour, 0 → keeps its own colour).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export class Shape {
  constructor() { this.parts = []; }
  _add(g, color, tint = 0, emissive = 0) {
    g = g.index ? g.toNonIndexed() : g;
    if (g.attributes.uv) g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3), t = new Float32Array(n), e = new Float32Array(n);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; t[i] = tint; e[i] = emissive; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(t, 1));
    g.setAttribute('aEmis', new THREE.BufferAttribute(e, 1));
    this.parts.push(g);
    return this;
  }
  box(w, h, d, x, y, z, color, tint = 0, rotY = 0, emissive = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    return this._add(g, color, tint, emissive);
  }
  cyl(r0, r1, h, x, y, z, color, seg = 8, tint = 0, emissive = 0) {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg);
    g.translate(x, y, z);
    return this._add(g, color, tint, emissive);
  }
  sphere(r, x, y, z, color, tint = 0, emissive = 0, sy = 1) {
    const g = new THREE.IcosahedronGeometry(r, 1); g.scale(1, sy, 1); g.translate(x, y, z);
    return this._add(g, color, tint, emissive);
  }
  // cylinder between two points
  tube(p0, p1, r, color, tint = 0, seg = 5, emissive = 0) {
    const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
    const d = b.clone().sub(a), L = d.length();
    const g = new THREE.CylinderGeometry(r, r, L, seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.applyQuaternion(q);
    const m = a.clone().add(b).multiplyScalar(0.5);
    g.translate(m.x, m.y, m.z);
    return this._add(g, color, tint, emissive);
  }
  torus(R, r, x, y, z, color, rotAxis = 'y', tint = 0) {
    const g = new THREE.TorusGeometry(R, r, 3, 12);
    if (rotAxis === 'y') { /* ring in xy plane */ } else if (rotAxis === 'x') g.rotateY(Math.PI / 2);
    g.translate(x, y, z);
    return this._add(g, color, tint);
  }
  geo(g, color, tint = 0, emissive = 0) { return this._add(g, color, tint, emissive); }
  build() {
    const g = mergeGeometries(this.parts);
    g.computeBoundingSphere();
    return g;
  }
}

// Standard material for props: vertex colours, per-instance tint on tinted vertices, emissive channel
// scaled by `uNight` (lamps, lit signs).
export function propMaterial(globalUniforms, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.roughness ?? 0.7, metalness: opts.metalness ?? 0.1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = globalUniforms.uNight;
    sh.uniforms.uWet = globalUniforms.uWet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;\nattribute float aEmis;\nvarying float vEmis;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.xyz = mix(color.xyz, color.xyz * instanceColor.xyz, aTint);\n#endif\nvEmis = aEmis;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uWet;\nvarying float vEmis;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vEmis * (0.15 + 2.6 * uNight);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, uWet * 0.7);');
  };
  m.customProgramCacheKey = () => 'prop-v1';
  return m;
}

export function instanced(geo, mat, list, place, opts = {}) {
  const n = Math.max(1, list.length);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  let i = 0;
  for (const it of list) {
    const r = place(it, p, s, col);
    if (r === false) continue;
    q.setFromAxisAngle(up, r.rot ?? 0);
    if (r.tilt) { const qt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), r.tilt); q.multiply(qt); }
    m4.compose(p, q, s);
    mesh.setMatrixAt(i, m4);
    if (opts.color) mesh.setColorAt(i, col);
    i++;
  }
  mesh.count = i;
  mesh.castShadow = opts.cast ?? true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// Split a list into spatial chunks, one InstancedMesh per chunk, so frustum culling, shadow culling
// and distance culling work. Meshes get userData.cull = {x, z, r, maxDist, castDist}.
export function chunkedInstances(group, geo, mat, list, place, opts = {}) {
  const size = opts.chunk ?? 96;
  const buckets = new Map();
  const tmp = new THREE.Vector3(), ts = new THREE.Vector3(), tc = new THREE.Color();
  for (const it of list) {
    const r = place(it, tmp, ts.set(1, 1, 1), tc);
    if (r === false) continue;
    const k = Math.floor(tmp.x / size) + ',' + Math.floor(tmp.z / size);
    let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(it);
  }
  const meshes = [];
  for (const [k, items] of buckets) {
    const mesh = instanced(geo, mat, items, place, opts);
    const [i, j] = k.split(',').map(Number);
    mesh.userData.cull = { x: (i + 0.5) * size, z: (j + 0.5) * size, r: size * 0.72, maxDist: opts.maxDist ?? 400, castDist: opts.castDist ?? 90, cast: opts.cast ?? true };
    group.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

// Distance culling for chunked meshes (checked a few times per second).
export class DistanceCuller {
  constructor(root) { this.root = root; this.t = 0; this.list = null; this.scale = 1; }
  refresh() { this.list = []; this.root.traverse(o => { if (o.userData && o.userData.cull) this.list.push(o); }); }
  update(dt, game) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    if (!this.list) this.refresh();
    const c = game.camera.position;
    const fogFar = game.scene.fog ? game.scene.fog.far + 40 : 1e9;
    const s = this.scale;
    for (const m of this.list) {
      const u = m.userData.cull;
      const d = Math.hypot(u.x - c.x, u.z - c.z) - u.r;
      const vis = d < Math.min(u.maxDist * s, fogFar) && (!u.lod || u.lod(d));
      m.visible = vis;
      m.castShadow = u.cast && d < u.castDist;
    }
  }
}
