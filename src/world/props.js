// Street furniture & everyday details: benches, bike racks with parked bikes, lamps (lit at night),
// bus stops, German street-name signs, university building signs, bins, post boxes, parked cars …
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Shape, propMaterial, instanced, chunkedInstances } from './shapes.js';
import { globalUniforms } from './materials.js';
import { TextAtlas, fitText, wrapText, pushQuad, SIGN_FONT } from './atlas.js';
import { radialTexture } from './textures.js';
import { CAR_COLORS, BIKE_COLORS } from './layout.js';
import { CAR_DIMS, MISC_SIZE } from '../physics/colliders.js';

const WOOD = '#8a5f3a', METAL = '#5b5f63', STEEL = '#b7babd', DARK = '#26282b', CONCRETE = '#9d9a93';

function benchGeo() {
  const s = new Shape();
  for (const x of [-0.16, 0, 0.16]) s.box(0.13, 0.04, 1.8, x, 0.44, 0, WOOD);
  s.box(0.04, 0.12, 1.8, -0.25, 0.62, 0, WOOD).box(0.04, 0.12, 1.8, -0.26, 0.8, 0, WOOD);
  for (const z of [-0.72, 0.72]) { s.box(0.5, 0.42, 0.07, 0, 0.21, z, METAL); s.box(0.05, 0.5, 0.07, -0.25, 0.65, z, METAL); }
  return s.build();
}
function picnicGeo() {
  const s = new Shape();
  s.box(0.8, 0.05, 1.8, 0, 0.74, 0, WOOD);
  for (const x of [-0.62, 0.62]) s.box(0.3, 0.04, 1.8, x, 0.44, 0, WOOD);
  for (const z of [-0.7, 0.7]) { s.box(1.5, 0.06, 0.08, 0, 0.42, z, WOOD); s.tube([-0.5, 0, z], [0.1, 0.74, z], 0.04, WOOD); s.tube([0.5, 0, z], [-0.1, 0.74, z], 0.04, WOOD); }
  return s.build();
}
function loungerGeo() {
  const s = new Shape();
  const g = new THREE.BoxGeometry(1.9, 0.06, 0.7); g.rotateZ(0.25); g.translate(0, 0.45, 0);
  s.geo(g, WOOD); s.box(0.08, 0.4, 0.6, -0.7, 0.2, 0, METAL); s.box(0.08, 0.6, 0.6, 0.7, 0.3, 0, METAL);
  return s.build();
}
// Anlehnbügel: U-shaped stainless bar in the local x-y plane
function standGeo() {
  const s = new Shape();
  s.tube([-0.38, 0, 0], [-0.38, 0.72, 0], 0.024, STEEL).tube([0.38, 0, 0], [0.38, 0.72, 0], 0.024, STEEL);
  s.tube([-0.38, 0.72, 0], [-0.3, 0.8, 0], 0.024, STEEL).tube([0.38, 0.72, 0], [0.3, 0.8, 0], 0.024, STEEL).tube([-0.3, 0.8, 0], [0.3, 0.8, 0], 0.024, STEEL);
  return s.build();
}
export function bikeGeometry() { return bikeGeo(); }
function bikeGeo() {
  const s = new Shape();
  const BB = [0.0, 0.3, 0], ST = [-0.13, 0.84, 0], HT = [0.4, 0.86, 0], HB = [0.45, 0.66, 0], RA = [-0.52, 0.34, 0], FA = [0.53, 0.34, 0];
  s.tube(BB, ST, 0.018, '#ffffff', 1).tube(ST, HT, 0.016, '#ffffff', 1).tube(BB, HB, 0.02, '#ffffff', 1);
  s.tube(BB, RA, 0.012, '#ffffff', 1).tube(ST, RA, 0.012, '#ffffff', 1);
  s.tube(HB, FA, 0.014, '#9a9c9e').tube(HT, HB, 0.02, '#ffffff', 1);
  s.tube(HT, [0.37, 1.0, 0], 0.014, '#555').tube([0.37, 1.0, -0.28], [0.37, 1.0, 0.28], 0.013, '#555');
  s.tube(ST, [-0.15, 0.9, 0], 0.012, '#888');
  s.box(0.26, 0.05, 0.13, -0.16, 0.93, 0, '#1b1b1b');
  s.torus(0.33, 0.026, RA[0], RA[1], 0, '#1d1d1d').torus(0.33, 0.026, FA[0], FA[1], 0, '#1d1d1d');
  // rear rack + mudguards (typical German city bike)
  s.tube([-0.12, 0.8, 0.07], [-0.6, 0.72, 0.07], 0.008, '#888').tube([-0.12, 0.8, -0.07], [-0.6, 0.72, -0.07], 0.008, '#888');
  s.tube([-0.6, 0.72, 0], [-0.62, 0.34, 0], 0.008, '#888');
  return s.build();
}
function lampTallGeo() {
  const s = new Shape();
  s.cyl(0.07, 0.11, 8, 0, 4, 0, '#6c7074', 8);
  s.tube([0, 7.8, 0], [1.3, 8.05, 0], 0.045, '#6c7074');
  s.box(0.75, 0.14, 0.34, 1.55, 8.02, 0, '#4e5256');
  s.box(0.62, 0.03, 0.26, 1.55, 7.94, 0, '#fff1d6', 0, 0, 1);
  return s.build();
}
function lampShortGeo() {
  const s = new Shape();
  s.cyl(0.05, 0.07, 4.1, 0, 2.05, 0, '#3c4044', 8);
  s.cyl(0.36, 0.2, 0.14, 0, 4.25, 0, '#3c4044', 12);
  s.cyl(0.18, 0.22, 0.2, 0, 4.08, 0, '#fff1d6', 12, 0, 1);
  return s.build();
}
function binGeo() {
  const s = new Shape();
  s.cyl(0.035, 0.035, 1.05, 0, 0.52, -0.23, METAL, 6);
  s.cyl(0.2, 0.18, 0.55, 0, 0.78, 0, '#3e4b41', 10);
  s.cyl(0.21, 0.21, 0.04, 0, 1.06, 0, '#2e3831', 10);
  return s.build();
}
function bollardGeo() {
  const s = new Shape();
  s.cyl(0.08, 0.085, 0.9, 0, 0.45, 0, '#6d7074', 8).cyl(0.086, 0.086, 0.08, 0, 0.78, 0, '#e8e8e8', 8);
  return s.build();
}
const MISC_BUILD = {
  post_box: s => { s.cyl(0.04, 0.04, 0.85, 0, 0.42, 0, METAL, 6); s.box(0.3, 0.55, 0.4, 0, 1.1, 0, '#f2c200'); s.box(0.02, 0.04, 0.26, 0.16, 1.28, 0, DARK); },
  vending_machine: s => { s.box(0.8, 1.9, 1.0, 0, 0.95, 0, '#b71c1c'); s.box(0.02, 1.2, 0.7, 0.41, 1.15, 0.05, '#dfe8f0', 0, 0, 0.6); },
  recycling: s => { const c = ['#2e6b3a', '#6b4a2e', '#dcdcd6']; for (let i = 0; i < 3; i++) { s.box(1.3, 1.45, 1.3, 0, 0.72, (i - 1) * 1.4, c[i]); s.sphere(0.62, 0, 1.45, (i - 1) * 1.4, c[i], 0, 0, 0.35); } },
  grit_bin: s => { s.box(0.7, 0.62, 1.0, 0, 0.31, 0, '#f0a020'); s.box(0.74, 0.06, 1.04, 0, 0.66, 0, '#e09010'); },
  street_cabinet: s => { s.box(0.4, 1.25, 0.9, 0, 0.62, 0, '#8e9294'); s.box(0.42, 0.04, 0.92, 0, 1.26, 0, '#77797b'); },
  charging_station: s => { s.box(0.3, 1.6, 0.5, 0, 0.8, 0, '#e8e8e8'); s.box(0.02, 0.5, 0.06, 0.16, 1.3, 0, '#35c86e', 0, 0, 1); },
  bicycle_repair_station: s => { s.cyl(0.05, 0.05, 1.5, 0, 0.75, 0, '#3a6fb0', 8); s.box(0.1, 0.3, 0.4, 0, 1.25, 0, '#3a6fb0'); },
};
function carGeo(type) {
  const s = new Shape();
  const [L, W, H] = CAR_DIMS[type];
  const hw = W / 2 - 0.04;
  if (type === 2) { // van
    s.box(L, 1.55, W, 0, 0.32 + 0.78, 0, '#ffffff', 1);
    s.box(0.05, 0.55, W - 0.25, L / 2 + 0.005, 1.5, 0, '#1b2126');
    s.box(L - 1.4, 0.5, W + 0.01, -0.3, 1.45, 0, '#1b2126');
  } else {
    const bodyH = 0.62, cabL = type === 0 ? L * 0.55 : L * 0.5, cabOff = type === 0 ? -0.2 : -0.1;
    s.box(L, bodyH, W, 0, 0.3 + bodyH / 2, 0, '#ffffff', 1);
    const cab = new THREE.BoxGeometry(cabL, 0.52, W - 0.12);
    // taper the cabin roof
    const p = cab.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.82); p.setZ(i, p.getZ(i) * 0.92); }
    cab.computeVertexNormals();
    cab.translate(cabOff, 0.3 + bodyH + 0.26, 0);
    s.geo(cab, '#1b2126');
    s.box(cabL * 0.8, 0.05, W - 0.3, cabOff, 0.3 + bodyH + 0.53, 0, '#ffffff', 1);
  }
  for (const x of [-L / 2 + 0.75, L / 2 - 0.8]) for (const z of [-hw + 0.06, hw - 0.06]) {
    const g = new THREE.CylinderGeometry(0.31, 0.31, 0.2, 12); g.rotateX(Math.PI / 2); g.translate(x, 0.31, z); s.geo(g, '#1a1a1a');
  }
  s.box(0.04, 0.1, 0.25, L / 2, 0.68, hw - 0.2, '#f4f4ea', 0, 0, 0.5).box(0.04, 0.1, 0.25, L / 2, 0.68, -hw + 0.2, '#f4f4ea', 0, 0, 0.5);
  s.box(0.04, 0.1, 0.3, -L / 2, 0.75, hw - 0.2, '#a01010', 0, 0, 0.4).box(0.04, 0.1, 0.3, -L / 2, 0.75, -hw + 0.2, '#a01010', 0, 0, 0.4);
  // licence plates (white rectangles)
  s.box(0.02, 0.11, 0.5, L / 2 + 0.01, 0.45, 0, '#f2f2f2').box(0.02, 0.11, 0.5, -L / 2 - 0.01, 0.52, 0, '#f2f2f2');
  return s.build();
}
function signalGeo() {
  const s = new Shape();
  s.cyl(0.06, 0.07, 3.4, 0, 1.7, 0, '#55595d', 8);
  s.box(0.25, 0.85, 0.3, 0.1, 2.95, 0, '#1e2022');
  s.box(0.03, 0.16, 0.16, 0.24, 3.2, 0, '#401010');
  s.box(0.03, 0.16, 0.16, 0.24, 2.95, 0, '#403a10');
  s.box(0.03, 0.16, 0.16, 0.24, 2.7, 0, '#39ff6a', 0, 0, 1);
  return s.build();
}

export class Props {
  constructor(game) {
    this.game = game;
    const L = game.layout;
    const mat = this.mat = propMaterial(globalUniforms);
    const steel = this.steel = propMaterial(globalUniforms, { metalness: 0.7, roughness: 0.35 });
    const group = this.group = new THREE.Group();
    group.name = 'props';
    const add = m => { group.add(m); return m; };

    const C = (geo, m, list, place, o = {}) => chunkedInstances(group, geo, m, list, place, o);
    // benches / picnic tables / loungers
    C(benchGeo(), mat, L.benches.filter(b => b.type === 0), (b, p) => { p.set(b.x, 0, b.z); return { rot: -b.yaw }; }, { maxDist: 220, castDist: 60 });
    C(picnicGeo(), mat, L.benches.filter(b => b.type === 1), (b, p) => { p.set(b.x, 0, b.z); return { rot: -b.yaw }; }, { maxDist: 220, castDist: 60 });
    C(loungerGeo(), mat, L.benches.filter(b => b.type === 2), (b, p) => { p.set(b.x, 0, b.z); return { rot: -b.yaw + Math.PI / 2 }; }, { maxDist: 220, castDist: 60 });

    // bike racks & bikes
    const stands = [];
    for (const r of L.racks) {
      const ux = Math.cos(r.along), uz = Math.sin(r.along);
      for (let i = 0; i < r.n; i++) { const o = (i - (r.n - 1) / 2) * 1.0; stands.push({ x: r.x + ux * o, z: r.z + uz * o, yaw: r.along + Math.PI / 2 }); }
    }
    C(standGeo(), steel, stands, (st, p) => { p.set(st.x, 0, st.z); return { rot: -st.yaw }; }, { maxDist: 140, castDist: 40, chunk: 64 });
    const bikes = L.racks.flatMap(r => r.bikes);
    C(bikeGeo(), mat, bikes, (b, p, s, c) => { p.set(b.x, 0, b.z); c.set(BIKE_COLORS[b.c]); return { rot: -b.yaw, tilt: b.lean }; }, { color: true, maxDist: 150, castDist: 45, chunk: 64 });

    // lamps
    const tall = L.lamps.filter(l => l.h > 6), short = L.lamps.filter(l => l.h <= 6);
    C(lampTallGeo(), mat, tall, (l, p) => { p.set(l.x, 0, l.z); return { rot: -l.yaw }; }, { maxDist: 600, castDist: 90, chunk: 128 });
    C(lampShortGeo(), mat, short, (l, p) => { p.set(l.x, 0, l.z); return { rot: 0 }; }, { maxDist: 350, castDist: 70, chunk: 128 });
    this._lightPools(L.lamps);

    // bins, bollards, misc
    C(binGeo(), mat, L.bins, (b, p) => { p.set(b.x, 0, b.z); return { rot: (b.x * 13.1) % 6.28 }; }, { maxDist: 160, castDist: 40 });
    C(bollardGeo(), mat, L.bollards, (b, p) => { p.set(b.x, 0, b.z); return { rot: 0 }; }, { cast: false, maxDist: 150 });
    for (const [k, fn] of Object.entries(MISC_BUILD)) {
      const list = L.misc.filter(m => m.k === k);
      if (!list.length) continue;
      const s = new Shape(); fn(s);
      C(s.build(), mat, list, (m, p) => { p.set(m.x, 0, m.z); return { rot: -m.yaw }; }, { maxDist: 200, castDist: 50 });
    }
    // cars
    const carMat = propMaterial(globalUniforms, { metalness: 0.45, roughness: 0.35 });
    for (let type = 0; type < 3; type++) {
      const list = L.cars.filter(c => c.type === type);
      C(carGeo(type), carMat, list, (c, p, s, col) => { p.set(c.x, 0, c.z); col.set(CAR_COLORS[c.c]); return { rot: -c.yaw }; }, { color: true, maxDist: 320, castDist: 70, chunk: 128 });
    }
    // traffic signals
    C(signalGeo(), mat, L.signals, (s, p) => { p.set(s.x, 0, s.z); return { rot: -s.yaw }; }, { maxDist: 300, castDist: 60, chunk: 128 });
    // parking stall lines
    {
      const pos = [];
      for (const [x0, z0, x1, z1] of L.stallLines) {
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.06, nz = dx / l * 0.06, y = 0.03;
        pos.push(x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz, x0 - nx, y, z0 - nz, x0 + nx, y, z0 + nz, x1 + nx, y, z1 + nz);
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.computeVertexNormals();
        // ensure up-facing normals
        const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
        const m = new THREE.Mesh(g, game.mats.marking); m.receiveShadow = true; add(m);
      }
    }
    this._signs(L);
    this._stops(L);
    game.scene.add(group);
  }

  _lightPools(lamps) {
    const tex = radialTexture('rgba(255,214,150,0.9)', 'rgba(255,200,130,0)');
    const m = this.poolMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const mesh = instanced(g, m, lamps, (l, p, s) => {
      const tallL = l.h > 6;
      const off = tallL ? 1.5 : 0;
      p.set(l.x + Math.cos(l.yaw) * off, 0.09, l.z + Math.sin(l.yaw) * off);
      s.set(tallL ? 16 : 9, 1, tallL ? 16 : 9);
      return { rot: 0 };
    }, { cast: false });
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    this.pools = mesh;
  }

  _signs(L) {
    const atlas = this.atlas = new TextAtlas(2048);
    const buf = { pos: [], nor: [], uv: [] };
    const shapes = new Shape();
    // street name signs (white, black text + frame; DIN style)
    for (const s of L.streetSigns) {
      shapes.cyl(0.035, 0.035, 2.95, s.x, 1.475, s.z, '#8a8d90', 6);
      s.names.forEach((name, i) => {
        const uv = atlas.add(384, 84, (ctx, w, h) => {
          ctx.fillStyle = '#fbfbf7'; ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#111'; ctx.lineWidth = 5; ctx.strokeRect(7, 7, w - 14, h - 14);
          ctx.fillStyle = '#111'; fitText(ctx, name, w - 36, 50, '600'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, w / 2, h / 2 + 2);
        });
        const dir = s.dirs[i] ?? 0;
        const y = 2.62 - i * 0.26;
        // plate parallel to the street: facing = street normal
        const face = dir + Math.PI / 2;
        const cx = s.x + Math.cos(dir) * 0.47, cz = s.z + Math.sin(dir) * 0.47;
        pushQuad(buf, cx, y, cz, face, 0.9, 0.2, uv, 0.012);
        pushQuad(buf, cx, y, cz, face + Math.PI, 0.9, 0.2, uv, 0.012);
        const g = new THREE.BoxGeometry(0.9, 0.2, 0.02); g.rotateY(-dir); g.translate(cx, y, cz);
        shapes.geo(g, '#e9e9e4');
      });
    }
    // university building steles (navy, white text)
    for (const s of L.buildingSigns) {
      const uv = atlas.add(300, 360, (ctx, w, h) => {
        ctx.fillStyle = '#1f3f6e'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `500 15px ${SIGN_FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('Friedrich-Alexander-Universität', 20, 20); ctx.fillText('Erlangen-Nürnberg', 20, 38);
        ctx.fillStyle = '#fff'; ctx.fillRect(20, 64, 40, 3);
        ctx.font = `600 30px ${SIGN_FONT}`;
        let lines = wrapText(ctx, s.name, w - 40);
        let size = 30;
        while (lines.length > 5 && size > 18) { size -= 2; ctx.font = `600 ${size}px ${SIGN_FONT}`; lines = wrapText(ctx, s.name, w - 40); }
        lines.slice(0, 6).forEach((l, i) => ctx.fillText(l, 20, 84 + i * (size + 6)));
        if (s.addr) { ctx.font = `500 18px ${SIGN_FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(s.addr, 20, h - 40); }
      });
      shapes.box(0.18, 2.2, 1.8, s.x, 1.1, s.z, '#1f3f6e', 0, -s.yaw);
      pushQuad(buf, s.x, 1.25, s.z, s.yaw, 1.5, 1.8, uv, 0.095);
      pushQuad(buf, s.x, 1.25, s.z, s.yaw + Math.PI, 1.5, 1.8, uv, 0.095);
    }
    this._atlasBuf = buf;
    this._atlasShapes = shapes;
  }

  _stops(L) {
    const atlas = this.atlas, buf = this._atlasBuf, shapes = this._atlasShapes;
    const glass = [];
    const cache = new Map();
    for (const st of L.stops) {
      const key = st.name || '';
      let uv = cache.get(key);
      if (!uv) {
        uv = atlas.add(200, 300, (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#f7d117'; ctx.beginPath(); ctx.arc(w / 2, 90, 86, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 8; ctx.strokeStyle = '#11813f'; ctx.stroke();
          ctx.fillStyle = '#11813f'; ctx.font = `700 120px ${SIGN_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', w / 2, 96);
          ctx.fillStyle = '#fbfbf7'; ctx.fillRect(4, 190, w - 8, 104); ctx.strokeStyle = '#11813f'; ctx.lineWidth = 4; ctx.strokeRect(6, 192, w - 12, 100);
          ctx.fillStyle = '#111'; ctx.textBaseline = 'middle';
          ctx.font = `600 26px ${SIGN_FONT}`;
          const lines = wrapText(ctx, key || 'Haltestelle', w - 24);
          if (lines.length === 1) { fitText(ctx, lines[0], w - 20, 30); ctx.fillText(lines[0], w / 2, 242); }
          else lines.slice(0, 3).forEach((l, i) => { fitText(ctx, l, w - 20, 24); ctx.fillText(l, w / 2, 242 + (i - (Math.min(3, lines.length) - 1) / 2) * 28); });
        });
        cache.set(key, uv);
      }
      shapes.cyl(0.04, 0.04, 3.0, st.x, 1.5, st.z, '#8a8d90', 6);
      // sign faces along the road both ways
      pushQuad(buf, st.x, 2.55, st.z, st.along, 0.4, 0.6, uv, 0.03);
      pushQuad(buf, st.x, 2.55, st.z, st.along + Math.PI, 0.4, 0.6, uv, 0.03);
      shapes.box(0.05, 0.45, 0.32, st.x - st.nx * 0.07, 1.5, st.z - st.nz * 0.07, '#dfe3e6', 0, -st.along); // timetable case
      if (st.sh) {
        const nx = st.nx, nz = st.nz, yaw = Math.atan2(nz, nx);
        const cx = st.sh.x, cz = st.sh.z;
        // posts
        for (const sg of [-1.8, 1.8]) for (const d of [0.7, -0.3]) shapes.cyl(0.04, 0.04, 2.4, cx + -nz * sg + nx * d, 1.2, cz + nx * sg + nz * d, '#44484c', 6);
        const roof = new THREE.BoxGeometry(1.5, 0.08, 3.9); roof.rotateY(-yaw); roof.translate(cx + nx * 0.2, 2.42, cz + nz * 0.2); shapes.geo(roof, '#44484c');
        const bench = new THREE.BoxGeometry(0.35, 0.05, 2.2); bench.rotateY(-yaw); bench.translate(cx + nx * 0.45, 0.45, cz + nz * 0.45); shapes.geo(bench, '#8a8d90');
        glass.push({ x: cx + nx * 0.7, z: cz + nz * 0.7, yaw, w: 3.6, len: 3.6 });
        for (const sg of [-1.8, 1.8]) glass.push({ x: cx - nz * sg + nx * 0.2, z: cz + nx * sg + nz * 0.2, yaw: yaw + Math.PI / 2, len: 1.0 });
      }
    }
    atlas.done();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    const signMat = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.6, transparent: true, alphaTest: 0.3 });
    const signs = new THREE.Mesh(g, signMat);
    this.group.add(signs);
    const sm = new THREE.Mesh(shapes.build(), this.mat); sm.castShadow = true; sm.receiveShadow = true;
    this.group.add(sm);
    if (glass.length) {
      const gm = new THREE.MeshStandardMaterial({ color: 0xcfe3ea, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide });
      const gg = [];
      for (const q of glass) { const b = new THREE.PlaneGeometry(q.len, 2.0); b.rotateY(-q.yaw + Math.PI / 2); b.translate(q.x, 1.25, q.z); gg.push(b); }
      const gmesh = new THREE.Mesh(mergeGeometries(gg), gm);
      gmesh.renderOrder = 3;
      this.group.add(gmesh);
    }
  }

  update(dt, game) {
    const night = globalUniforms.uNight.value;
    this.poolMat.opacity = Math.min(1, night * 1.1);
    this.pools.visible = night > 0.02;
  }
}
