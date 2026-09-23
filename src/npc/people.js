// Instanced low-poly people: one InstancedMesh per body part, poses computed on the CPU each frame.
// A person faces +x in local space; limbs rotate in the x-y (sagittal) plane.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { globalUniforms } from '../world/materials.js';

// vertex "tint": 1 → clothing colour (instanceColor), 0 → skin colour (aSkin), 2 → keep vertex colour
function part(geo, tint, vcol = '#ffffff') {
  geo = geo.index ? geo.toNonIndexed() : geo;
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  const n = geo.attributes.position.count, c = new THREE.Color(vcol);
  const col = new Float32Array(n * 3), t = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; t[i] = tint; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aTint', new THREE.BufferAttribute(t, 1));
  return geo;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r0, r1, h, y, seg = 7) => new THREE.CylinderGeometry(r0, r1, h, seg).translate(0, y, 0);

// Part geometries (pivot at the joint, hanging down along -y)
function buildParts() {
  const P = {};
  P.pelvis = part(box(0.22, 0.2, 0.34, 0, -0.05, 0), 1);
  P.torso = part(mergeGeometries([cyl(0.17, 0.15, 0.52, 0.26, 8).scale(0.72, 1, 1.12), box(0.2, 0.08, 0.4, 0, 0.5, 0)]), 1);
  P.head = mergeGeometries([
    part(new THREE.IcosahedronGeometry(0.105, 1).scale(1.0, 1.18, 0.95).translate(0.01, 0.13, 0), 0),
    part(cyl(0.045, 0.05, 0.08, 0.02, 6), 0),
    part(box(0.02, 0.02, 0.05, 0.1, 0.12, 0.035), 2, '#222').translate(0, 0, 0), part(box(0.02, 0.02, 0.05, 0.1, 0.12, -0.035), 2, '#222'),
  ]);
  P.hair = part(new THREE.IcosahedronGeometry(0.114, 1).scale(1.05, 0.8, 1.0).translate(-0.01, 0.2, 0), 1);
  P.hairLong = part(box(0.06, 0.26, 0.22, -0.09, 0.07, 0), 1);
  P.upperArm = part(cyl(0.052, 0.046, 0.3, -0.15, 6), 1);
  P.foreArm = mergeGeometries([part(cyl(0.045, 0.04, 0.24, -0.12, 6), 1), part(box(0.07, 0.09, 0.05, 0, -0.29, 0), 0)]);
  P.thigh = part(cyl(0.075, 0.062, 0.46, -0.23, 7), 1);
  P.shin = part(cyl(0.058, 0.048, 0.44, -0.22, 7), 1);
  P.shoe = mergeGeometries([part(box(0.25, 0.08, 0.1, 0.05, -0.04, 0), 1), part(box(0.26, 0.02, 0.105, 0.05, -0.08, 0), 2, '#e8e6e0')]);
  P.backpack = part(mergeGeometries([box(0.18, 0.4, 0.3, -0.19, 0.28, 0), box(0.08, 0.16, 0.24, -0.3, 0.2, 0)]), 1);
  P.umbrella = mergeGeometries([part(new THREE.ConeGeometry(0.55, 0.28, 8, 1, true).translate(0, 0.98, 0), 1), part(cyl(0.012, 0.012, 1.0, 0.45, 4), 2, '#333')]);
  P.tray = mergeGeometries([part(box(0.3, 0.02, 0.4, 0, 0, 0), 2, '#d8d1c0'), part(box(0.14, 0.05, 0.14, 0, 0.03, 0.05), 2, '#e6a345'), part(cyl(0.05, 0.05, 0.08, 0.05).translate(0.06, 0, -0.1), 2, '#e8e8e8')]);
  P.cap = part(new THREE.CylinderGeometry(0.11, 0.115, 0.1, 10).translate(0.01, 0.27, 0), 2, '#f4f4f4');
  return P;
}

function personMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = globalUniforms.uWet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;\nattribute vec3 aSkin;')
      .replace('#include <color_vertex>', `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
  vColor.xyz = aTint > 1.5 ? color.xyz : mix(aSkin, instanceColor.xyz, aTint);
#endif`);
  };
  m.customProgramCacheKey = () => 'person-v1';
  return m;
}

export const PART_NAMES = ['pelvis', 'torso', 'head', 'hair', 'hairLong', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'thighL', 'thighR', 'shinL', 'shinR', 'shoeL', 'shoeR', 'backpack', 'umbrella', 'tray', 'cap'];
const GEO_OF = { upperArmL: 'upperArm', upperArmR: 'upperArm', foreArmL: 'foreArm', foreArmR: 'foreArm', thighL: 'thigh', thighR: 'thigh', shinL: 'shin', shinR: 'shin', shoeL: 'shoe', shoeR: 'shoe' };

export class PeopleRenderer {
  constructor(scene, max = 320) {
    this.max = max;
    const geos = buildParts();
    this.mat = personMaterial();
    this.meshes = {};
    this.skin = {};
    this.group = new THREE.Group(); this.group.name = 'people';
    for (const name of PART_NAMES) {
      const g = geos[GEO_OF[name] || name].clone();
      const skin = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      g.setAttribute('aSkin', skin);
      const mesh = new THREE.InstancedMesh(g, this.mat, max);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      mesh.frustumCulled = false;
      mesh.castShadow = true; mesh.receiveShadow = false;
      mesh.count = 0;
      this.meshes[name] = mesh; this.skin[name] = skin;
      this.group.add(mesh);
    }
    scene.add(this.group);
    // scratch objects
    this._root = new THREE.Matrix4(); this._m = new THREE.Matrix4(); this._l = new THREE.Matrix4();
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._e = new THREE.Euler(); this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.n = 0;
  }
  setShadows(on) { for (const m of Object.values(this.meshes)) m.castShadow = on; }

  begin() { this.n = 0; this.cnt = this.cnt || {}; for (const k of PART_NAMES) this.cnt[k] = 0; }

  // each part mesh is packed independently, so optional parts (umbrella, tray …) cost nothing when unused
  _put(name, _i, local, color, skin) {
    const mesh = this.meshes[name];
    const i = this.cnt[name]++;
    this._m.multiplyMatrices(this._root, local);
    mesh.setMatrixAt(i, this._m);
    const c = mesh.instanceColor.array; c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2];
    const s = this.skin[name].array; s[i * 3] = skin[0]; s[i * 3 + 1] = skin[1]; s[i * 3 + 2] = skin[2];
  }
  _hide() { /* packed instancing: nothing to do */ }

  // local joint transform: translate (x,y,z) then rotate about z (pitch) and x (roll) and y (yaw)
  _joint(x, y, z, rz, rx = 0, ry = 0) {
    this._e.set(rx, ry, rz, 'YXZ');
    this._q.setFromEuler(this._e);
    this._v.set(x, y, z);
    return this._l.compose(this._v, this._q, this._s);
  }

  // p: person with x,y,z,yaw,scale,colors,pose (see *Pose functions)
  add(p) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const s = p.scale;
    const M = this._mats || (this._mats = Array.from({ length: 8 }, () => new THREE.Matrix4()));
    const [torsoM, hm, um, fm, tm, sm, xm] = M;
    this._q.setFromAxisAngle(this._v.set(0, 1, 0), -p.yaw);
    this._root.compose(this._v.set(p.x, p.y, p.z), this._q, this._s.set(s, s, s));
    this._s.set(1, 1, 1);
    const pose = p.pose;
    const C = p.colors;
    const J = (x, y, z, rz, rx, ry) => this._joint(x, y, z, rz, rx, ry);
    const hipY = pose.hipY;
    this._put('pelvis', i, J(0, hipY, 0, 0), C.pants, C.skin);
    torsoM.copy(J(pose.lean * 0.1, hipY, 0, -pose.lean, 0, pose.twist || 0));
    this._put('torso', i, torsoM, C.top, C.skin);
    hm.multiplyMatrices(torsoM, J(0.0, 0.55, 0, pose.headPitch || 0, 0, pose.headYaw || 0));
    this._put('head', i, hm, C.top, C.skin);
    if (p.cap) { this._put('cap', i, hm, C.top, C.skin); this._hide('hair', i); this._hide('hairLong', i); }
    else {
      this._hide('cap', i);
      this._put('hair', i, hm, C.hair, C.skin);
      if (p.longHair) this._put('hairLong', i, hm, C.hair, C.skin); else this._hide('hairLong', i);
    }
    for (let k = 0; k < 2; k++) {
      const L = k === 0, side = L ? 'L' : 'R', sz = L ? 0.215 : -0.215;
      const ua = L ? pose.armL : pose.armR, fa = L ? pose.foreL : pose.foreR;
      const ab = L ? -(pose.abdL ?? 0.08) : (pose.abdR ?? 0.08);
      um.multiplyMatrices(torsoM, J(0, 0.46, sz, ua, ab));
      this._put('upperArm' + side, i, um, C.top, C.skin);
      fm.multiplyMatrices(um, J(0, -0.3, 0, fa));
      this._put('foreArm' + side, i, fm, C.top, C.skin);
    }
    for (let k = 0; k < 2; k++) {
      const L = k === 0, side = L ? 'L' : 'R', sz = L ? 0.095 : -0.095;
      const th = L ? pose.thighL : pose.thighR, sh = L ? pose.shinL : pose.shinR;
      const spread = pose.legSpread ? (L ? -pose.legSpread : pose.legSpread) : 0;
      tm.copy(J(0, hipY - 0.04, sz, th, spread));
      this._put('thigh' + side, i, tm, C.pants, C.skin);
      sm.multiplyMatrices(tm, J(0, -0.46, 0, sh));
      this._put('shin' + side, i, sm, C.pants, C.skin);
      xm.multiplyMatrices(sm, J(0, -0.44, 0, pose.foot ?? -(th + sh)));
      this._put('shoe' + side, i, xm, C.shoes, C.skin);
    }
    if (p.backpack && !pose.noBackpack) this._put('backpack', i, torsoM, C.bag, C.skin); else this._hide('backpack', i);
    if (p.umbrella) { um.multiplyMatrices(torsoM, J(0.18, 0.28, -0.18, 0.12)); this._put('umbrella', i, um, C.umb, C.skin); }
    else this._hide('umbrella', i);
    if (p.tray) { um.multiplyMatrices(torsoM, J(0.34, 0.08, 0, 0)); this._put('tray', i, um, C.top, C.skin); } else this._hide('tray', i);
  }

  end() {
    for (const [name, mesh] of Object.entries(this.meshes)) {
      mesh.count = this.cnt[name] || 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      this.skin[name].needsUpdate = true;
    }
  }
}

// ---------- appearance ----------
const JACKETS = ['#1f2a44', '#1b1c1f', '#4a5a3a', '#6b2432', '#6c6e72', '#b9a58a', '#3c5a7d', '#2f4f3a', '#b08a2e', '#7a4a2f', '#8e3b2e', '#2c2c3a', '#c9c3b6', '#3d6f73'];
const PANTS = ['#2c3e5c', '#1c1d20', '#454850', '#3b4d6e', '#b8a98a', '#2a2f3a', '#5a4a3a'];
const SHOES = ['#eeeeea', '#1b1b1b', '#5a3a26', '#3a3a3a', '#d9d5cc'];
const HAIR = ['#1b1512', '#2e2119', '#4a3222', '#6b4a2f', '#a37a4a', '#c9a46a', '#7a3a1e', '#1c1c1c', '#8a8580'];
const SKIN = ['#f1d3bd', '#e8c1a0', '#d9a883', '#c28e68', '#a5714f', '#7d5237', '#5a3a28', '#f4dccb'];
const BAGS = ['#1b1c1f', '#3a3d44', '#2c3e5c', '#8e2f2f', '#4a5a3a', '#b08a2e'];
const UMB = ['#1b1c1f', '#2c3e5c', '#8e2f2f', '#2f5a3a', '#5a2f6b', '#d9b43a'];

function hex(c) { const col = new THREE.Color(c); return [col.r, col.g, col.b]; }

export function randomLook(r, role = 'student') {
  const pick = a => a[Math.floor(r() * a.length)];
  const look = {
    scale: 0.93 + r() * 0.13,
    longHair: r() < 0.42,
    backpack: role === 'student' && r() < 0.62,
    cap: role === 'mensa',
    colors: {
      top: hex(role === 'mensa' ? '#f2f2ef' : role === 'staff' && r() < 0.3 ? '#e8e6e0' : pick(JACKETS)),
      pants: hex(role === 'mensa' ? '#2a2c30' : pick(PANTS)),
      shoes: hex(pick(SHOES)), hair: hex(role === 'staff' && r() < 0.35 ? '#8a8580' : pick(HAIR)),
      skin: hex(pick(SKIN)), bag: hex(pick(BAGS)), umb: hex(pick(UMB)),
    },
  };
  return look;
}

// ---------- poses ----------
export function walkPose(pose, phase, amp = 1) {
  const s = Math.sin(phase), c = Math.cos(phase);
  pose.hipY = 0.93 + Math.abs(c) * 0.025 * amp;
  pose.lean = 0.05 * amp; pose.twist = s * 0.08 * amp;
  pose.thighL = s * 0.42 * amp; pose.thighR = -s * 0.42 * amp;
  pose.shinL = -Math.max(0, -Math.sin(phase - 0.9)) * 0.85 * amp - 0.05;
  pose.shinR = -Math.max(0, Math.sin(phase - 0.9)) * 0.85 * amp - 0.05;
  pose.armL = -s * 0.38 * amp; pose.armR = s * 0.38 * amp;
  pose.foreL = 0.25 + Math.max(0, -s) * 0.3 * amp; pose.foreR = 0.25 + Math.max(0, s) * 0.3 * amp;
  pose.headYaw = 0; pose.headPitch = 0; pose.foot = null; pose.legSpread = 0; pose.noBackpack = false;
  return pose;
}
export function standPose(pose, t, talk = 0) {
  pose.hipY = 0.93; pose.lean = 0.0; pose.twist = Math.sin(t * 0.5) * 0.04;
  pose.thighL = 0.02; pose.thighR = -0.03; pose.shinL = -0.02; pose.shinR = -0.02;
  pose.armL = 0.05 + Math.sin(t * 2.1) * 0.25 * talk; pose.armR = 0.02;
  pose.foreL = 0.25 + (talk ? 0.9 + Math.sin(t * 3.3) * 0.3 : 0); pose.foreR = 0.2;
  pose.headYaw = Math.sin(t * 0.3) * 0.2; pose.headPitch = 0; pose.foot = null; pose.legSpread = 0; pose.noBackpack = false;
  return pose;
}
// seated on a chair/bench of height h (hips above floor)
export function sitPose(pose, t, h = 0.46, eat = 0) {
  pose.hipY = h + 0.1; pose.lean = -0.05 + eat * 0.15; pose.twist = 0;
  pose.thighL = 1.5; pose.thighR = 1.45; pose.shinL = -1.5; pose.shinR = -1.45;
  pose.armL = 0.5 + eat * 0.35; pose.armR = 0.45 + eat * (0.35 + Math.max(0, Math.sin(t * 1.6)) * 0.25);
  pose.foreL = 0.9; pose.foreR = 0.9 + eat * 0.4 * Math.max(0, Math.sin(t * 1.6));
  pose.headYaw = Math.sin(t * 0.4) * 0.25; pose.headPitch = -eat * 0.2; pose.foot = null; pose.legSpread = 0.06; pose.noBackpack = true;
  return pose;
}
// sitting on the ground (lawn)
export function groundPose(pose, t) {
  pose.hipY = 0.12; pose.lean = -0.12; pose.twist = 0;
  pose.thighL = 1.25; pose.thighR = 1.15; pose.shinL = -2.1; pose.shinR = -2.0;
  pose.armL = -0.5; pose.armR = 0.9; pose.foreL = 0.1; pose.foreR = 1.0;
  pose.headYaw = Math.sin(t * 0.35) * 0.35; pose.headPitch = 0.05; pose.foot = null; pose.legSpread = 0.25; pose.noBackpack = true;
  return pose;
}
export function cyclePose(pose, crank) {
  pose.hipY = 0.98; pose.lean = 0.45; pose.twist = 0;
  const s = Math.sin(crank), c = Math.cos(crank);
  pose.thighL = 0.95 + s * 0.35; pose.thighR = 0.95 - s * 0.35;
  pose.shinL = -1.0 - c * 0.45; pose.shinR = -1.0 + c * 0.45;
  pose.armL = 1.0; pose.armR = 1.0; pose.foreL = 0.35; pose.foreR = 0.35;
  pose.headYaw = 0; pose.headPitch = 0.3; pose.foot = null; pose.legSpread = 0.02; pose.noBackpack = false;
  return pose;
}
