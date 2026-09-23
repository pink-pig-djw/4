// Tiny helpers to build merged low-poly prop geometries with vertex colours and a "tint" channel
// (tint = 1 → vertex colour is multiplied by the per-instance colour, 0 → keeps its own colour).
import * as THREE from 'three';

export class Shape {
  // Primitives are written straight into flat vertex arrays (non-indexed triangles with position,
  // normal, colour, tint and emissive); no per-primitive three.js geometry is created.
  constructor() { this.pos = []; this.nor = []; this.col = []; this.tint = []; this.emis = []; this.count = 0; }
  get parts() { return { length: this.count }; }
  _vert(x, y, z, nx, ny, nz, c, tint, emis) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(c.r, c.g, c.b); this.tint.push(tint); this.emis.push(emis);
  }
  _add(g, color, tint = 0, emissive = 0) {
    g = g.index ? g.toNonIndexed() : g;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, c = colorOf(color);
    for (let i = 0; i < p.count; i++) this._vert(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), c, tint, emissive);
    this.count++;
    return this;
  }
  box(w, h, d, x, y, z, color, tint = 0, rotY = 0, emissive = 0) {
    const c = colorOf(color), H = [w / 2, h / 2, d / 2];
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    // rotateY as three.js does: x' = x cos + z sin, z' = -x sin + z cos
    for (const [n, u, v] of BOX_FACES) {
      const q = (s, t) => {
        const lx = (n[0] + u[0] * s + v[0] * t) * H[0], ly = (n[1] + u[1] * s + v[1] * t) * H[1], lz = (n[2] + u[2] * s + v[2] * t) * H[2];
        return [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
      };
      const nx = n[0] * cs + n[2] * sn, nz = -n[0] * sn + n[2] * cs;
      const a = q(-1, -1), b = q(1, -1), cc = q(1, 1), e = q(-1, 1);
      for (const P of [a, b, cc, a, cc, e]) this._vert(P[0], P[1], P[2], nx, n[1], nz, c, tint, emissive);
    }
    this.count++;
    return this;
  }
  // frustum along +y: radius r0 at the top, r1 at the bottom (like THREE.CylinderGeometry)
  cyl(r0, r1, h, x, y, z, color, seg = 8, tint = 0, emissive = 0) {
    return this._frustum([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1], r0, r1, h, seg, color, tint, emissive);
  }
  sphere(r, x, y, z, color, tint = 0, emissive = 0, sy = 1) {
    const c = colorOf(color), T = icoTemplate();
    for (let i = 0; i < T.pos.length; i += 3) {
      let nx = T.nor[i], ny = T.nor[i + 1] / sy, nz = T.nor[i + 2]; const l = Math.hypot(nx, ny, nz) || 1;
      this._vert(x + T.pos[i] * r, y + T.pos[i + 1] * r * sy, z + T.pos[i + 2] * r, nx / l, ny / l, nz / l, c, tint, emissive);
    }
    this.count++;
    return this;
  }
  // cylinder between two points
  tube(p0, p1, r, color, tint = 0, seg = 5, emissive = 0) {
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return this;
    dx /= L; dy /= L; dz /= L;
    // right-handed frame (e1, d, e2) like (x, y, z)
    let e1 = Math.abs(dy) < 0.9 ? cross([0, 1, 0], [dx, dy, dz]) : cross([1, 0, 0], [dx, dy, dz]);
    e1 = norm(e1);
    const e2 = cross(e1, [dx, dy, dz]);
    const m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    return this._frustum(m, e1, [dx, dy, dz], e2, r, r, L, seg, color, tint, emissive);
  }
  _frustum(m, X, Y, Z, rTop, rBot, h, seg, color, tint, emissive) {
    const c = colorOf(color), slope = (rBot - rTop) / h;
    const P = (r, yy, th) => { const s = Math.sin(th) * r, k = Math.cos(th) * r; return [m[0] + X[0] * s + Y[0] * yy + Z[0] * k, m[1] + X[1] * s + Y[1] * yy + Z[1] * k, m[2] + X[2] * s + Y[2] * yy + Z[2] * k]; };
    const N = th => { const s = Math.sin(th), k = Math.cos(th), l = Math.hypot(1, slope); return [(X[0] * s + Y[0] * slope + Z[0] * k) / l, (X[1] * s + Y[1] * slope + Z[1] * k) / l, (X[2] * s + Y[2] * slope + Z[2] * k) / l]; };
    const top = [m[0] + Y[0] * h / 2, m[1] + Y[1] * h / 2, m[2] + Y[2] * h / 2], bot = [m[0] - Y[0] * h / 2, m[1] - Y[1] * h / 2, m[2] - Y[2] * h / 2];
    const v = (p, n) => this._vert(p[0], p[1], p[2], n[0], n[1], n[2], c, tint, emissive);
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const T0 = P(rTop, h / 2, a0), B0 = P(rBot, -h / 2, a0), T1 = P(rTop, h / 2, a1), B1 = P(rBot, -h / 2, a1);
      const n0 = N(a0), n1 = N(a1);
      v(T0, n0); v(B0, n0); v(T1, n1);
      v(B0, n0); v(B1, n1); v(T1, n1);
      if (rTop > 0) { v(top, Y); v(T0, Y); v(T1, Y); }
      if (rBot > 0) { const ny = [-Y[0], -Y[1], -Y[2]]; v(bot, ny); v(B1, ny); v(B0, ny); }
    }
    this.count++;
    return this;
  }
  torus(R, r, x, y, z, color, rotAxis = 'y', tint = 0) {
    const g = new THREE.TorusGeometry(R, r, 3, 12);
    if (rotAxis === 'y') { /* ring in xy plane */ } else if (rotAxis === 'x') g.rotateY(Math.PI / 2);
    g.translate(x, y, z);
    return this._add(g, color, tint);
  }
  geo(g, color, tint = 0, emissive = 0) { return this._add(g, color, tint, emissive); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tint, 1));
    g.setAttribute('aEmis', new THREE.Float32BufferAttribute(this.emis, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// box faces: outward normal n and tangents u, v with u × v = n
const BOX_FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
const colorCache = new Map();
function colorOf(c) {
  if (c && c.isColor) return c;
  let v = colorCache.get(c);
  if (!v) { v = new THREE.Color(c); colorCache.set(c, v); }
  return v;
}
let ico = null;
function icoTemplate() {
  if (!ico) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    ico = { pos: Array.from(g.attributes.position.array), nor: Array.from(g.attributes.normal.array) };
  }
  return ico;
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

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
// Builds chunk geometry on demand: each entry {x, z, r, maxDist, build() → meshes} is built once
// the camera comes within its view distance (plus a margin), a few milliseconds per frame. The
// first update builds everything near the start position at once, so nothing pops in there.
export class LazyChunks {
  constructor(group, entries) { this.group = group; this.pending = entries; this.t = 0; this.first = true; this.queue = []; }
  update(dt, game) {
    const c = game.camera.position;
    const scale = game.culler ? game.culler.scale : 1;
    const dist = e => Math.hypot(e.x - c.x, e.z - c.z) - e.r;
    this.t -= dt;
    if (this.t <= 0 || this.first) {
      this.t = 0.4;
      const rest = [];
      for (const e of this.pending) (dist(e) < e.maxDist * scale + 80 ? this.queue : rest).push(e);
      this.pending = rest;
      this.queue.sort((a, b) => dist(a) - dist(b));
    }
    const t0 = performance.now(), budget = this.first ? 1e9 : 5;
    while (this.queue.length && performance.now() - t0 < budget) {
      for (const m of this.queue.shift().build()) {
        this.group.add(m);
        if (game.culler && game.culler.list) game.culler.list.push(m);
      }
    }
    this.first = false;
  }
}

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
