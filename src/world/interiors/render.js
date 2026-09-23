// Renders interior plans: see-through exterior shell, floors/ceilings, partitions with doors,
// stairs, railings, furniture, ceiling lights, room signs and automatic sliding entrance doors.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { wallPieces } from './plan.js';
import { STYLE_ID, globalUniforms } from '../materials.js';
import { Shape, propMaterial, chunkedInstances } from '../shapes.js';
import { FURNITURE } from './furniture.js';
import { TextAtlas, fitText, pushQuad, SIGN_FONT } from '../atlas.js';
import * as T from '../textures.js';

class WallBuf {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.f = []; this.s = []; }
  // vertical quad a→b (world xz), heights y0..y1, facing given normal (nx,nz)
  quad(a, b, y0, y1, nx, nz, col, style, lh, seed, levels, u0, u1, L, top) {
    const V = [[a, y0, u0], [b, y0, u1], [b, y1, u1], [a, y0, u0], [b, y1, u1], [a, y1, u0]];
    // winding: make the geometric normal agree with (nx,nz)
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const gx = ez, gz = -ex; // normal of (a0,b0,b1) is (-ez, 0, ex)?? compute below
    const flip = (-ez * nx + ex * nz) < 0; // (a0,b0,b1) normal ∝ (-ez, 0, ex)
    const order = flip ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
    for (const k of order) {
      const [p, y, u] = V[k];
      this.pos.push(p[0], y, p[1]); this.nor.push(nx, 0, nz); this.col.push(col.r, col.g, col.b);
      this.f.push(u, y, L, top); this.s.push(style, lh, seed, levels);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aF', new THREE.Float32BufferAttribute(this.f, 4));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.s, 4));
    g.computeBoundingSphere();
    return g;
  }
}

class FlatBuf {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; }
  poly(outer, holes, y, up, col = [1, 1, 1]) {
    const c = outer.map(p => new THREE.Vector2(p[0], p[1]));
    const hs = (holes || []).map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
    const all = c.concat(...hs);
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(c, hs); } catch (e) { return; }
    for (const t of tris) {
      let [i0, i1, i2] = t;
      const a = all[i0], b = all[i1], d = all[i2];
      const cr = (b.y - a.y) * (d.x - a.x) - (b.x - a.x) * (d.y - a.y); // >0 → faces up for our winding
      if ((cr > 0) !== up) { const tmp = i1; i1 = i2; i2 = tmp; }
      for (const i of [i0, i1, i2]) { this.pos.push(all[i].x, y, all[i].y); this.nor.push(0, up ? 1 : -1, 0); this.uv.push(all[i].x, all[i].y); this.col.push(...col); }
    }
  }
  vquad(a, b, y0, y1, col = [1, 1, 1]) {
    const ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez) || 1;
    const nx = -ez / l, nz = ex / l;
    for (const [p, y] of [[a, y0], [b, y1], [b, y0], [a, y0], [a, y1], [b, y1]]) { this.pos.push(p[0], y, p[1]); this.nor.push(nx, 0, nz); this.uv.push(p[0] + p[1], y); this.col.push(...col); }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

function boxBetween(shape, a, b, y0, y1, t, color) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 0.01 || y1 - y0 < 0.01) return;
  const g = new THREE.BoxGeometry(L, y1 - y0, t);
  g.rotateY(-Math.atan2(dz, dx));
  g.translate((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2);
  shape.geo(g, color);
}

export class Interiors {
  constructor(game, plans) {
    this.game = game;
    this.plans = plans;
    this.group = new THREE.Group(); this.group.name = 'interiors';
    const mats = game.mats;
    this.floorMat = new THREE.MeshStandardMaterial({ map: T.slabsTexture(), color: 0xd9d4ca, roughness: 0.55, vertexColors: true, side: THREE.DoubleSide });
    this.floorMat.map.repeat.set(0.5, 0.5);
    this.ceilMat = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.95, vertexColors: true, emissive: 0x9a978f, emissiveIntensity: 0.55 });
    this.roofMat = mats.roofFlat;
    this.glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb4bf, transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0.4, depthWrite: false, side: THREE.DoubleSide });
    this.propMat = propMaterial(globalUniforms, { roughness: 0.65 });
    this.doors = [];
    for (const P of plans) this._buildPlan(P);
    this._buildFurniture();
    this._buildLabels();
    game.scene.add(this.group);
  }

  _buildPlan(P) {
    const b = P.b;
    const walls = new WallBuf();
    const col = new THREE.Color(b.c);
    const paint = new THREE.Color(0xf0ede6);
    const style = STYLE_ID[b.st] ?? 0;
    const seed = (P.bIdx * 7.13) % 97;
    const inner = P.inner;
    const glassParts = [];
    const extra = new Shape();
    const g = new THREE.Group(); g.name = 'plan ' + P.key;
    // ---- exterior shell: outer facade + inner face, with window cut-outs and door openings ----
    P.ext.forEach((e, i) => {
      if (!e) return;
      const ia = inner[i], ib = inner[(i + 1) % inner.length];
      const w = { a: e.a, b: e.b, len: e.len, y0: 0, y1: P.topY, openings: e.openings };
      const pieces = wallPieces(w);
      const ux = (e.b[0] - e.a[0]) / e.len, uz = (e.b[1] - e.a[1]) / e.len;
      const iLen = Math.hypot(ib[0] - ia[0], ib[1] - ia[1]);
      const iu = [(ib[0] - ia[0]) / iLen, (ib[1] - ia[1]) / iLen];
      const pst = e.party ? STYLE_ID.plain : style;
      for (const pc of pieces) {
        const A = [e.a[0] + ux * pc.d0, e.a[1] + uz * pc.d0], B = [e.a[0] + ux * pc.d1, e.a[1] + uz * pc.d1];
        if (!e.party) walls.quad(A, B, pc.y0, pc.y1, e.nx, e.nz, col, pst, b.lh, seed + i * 0.37, b.lv, pc.d0, pc.d1, e.len, P.topY);
        const f0 = pc.d0 / e.len, f1 = pc.d1 / e.len;
        const IA = [ia[0] + iu[0] * f0 * iLen, ia[1] + iu[1] * f0 * iLen], IB = [ia[0] + iu[0] * f1 * iLen, ia[1] + iu[1] * f1 * iLen];
        walls.quad(IA, IB, pc.y0, Math.min(pc.y1, P.topY - 0.6), -e.nx, -e.nz, paint, pst + 20, b.lh, seed + i * 0.37, b.lv, pc.d0, pc.d1, e.len, P.topY);
      }
      // reveals: short jamb faces at door openings (outer→inner)
      for (const o of e.openings) {
        for (const d of [o.d0, o.d1]) {
          const A = [e.a[0] + ux * d, e.a[1] + uz * d], f = d / e.len, IA = [ia[0] + iu[0] * f * iLen, ia[1] + iu[1] * f * iLen];
          boxBetween(extra, A, IA, 0, o.y1, 0.06, '#5d6166');
        }
        const m0 = (o.d0 + o.d1) / 2;
        const A = [e.a[0] + ux * o.d0, e.a[1] + uz * o.d0], B = [e.a[0] + ux * o.d1, e.a[1] + uz * o.d1];
        boxBetween(extra, [A[0] - e.nx * 0.15, A[1] - e.nz * 0.15], [B[0] - e.nx * 0.15, B[1] - e.nz * 0.15], o.y1, o.y1 + 0.12, 0.34, '#5d6166');
        if (!o.inner) {
          // canopy over the entrance
          boxBetween(extra, [A[0] + e.nx * 0.9 - ux * 0.6, A[1] + e.nz * 0.9 - uz * 0.6], [B[0] + e.nx * 0.9 + ux * 0.6, B[1] + e.nz * 0.9 + uz * 0.6], 3.0, 3.18, 2.0, '#4f5358');
          this.doors.push({ x: (A[0] + B[0]) / 2, z: (A[1] + B[1]) / 2, ux, uz, w: o.d1 - o.d0, nx: e.nx, nz: e.nz, h: o.y1, open: 0 });
        }
      }
      if (!e.party) glassParts.push([[e.a[0] - e.nx * 0.14, e.a[1] - e.nz * 0.14], [e.b[0] - e.nx * 0.14, e.b[1] - e.nz * 0.14], e.openings]);
    });
    const wm = new THREE.Mesh(walls.geometry(), this.game.mats.facadeCut);
    wm.castShadow = true; wm.receiveShadow = true; g.add(wm);
    // glass panes behind the cut-out windows (skip door openings)
    const gg = [];
    for (const [a, c, ops] of glassParts) {
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]); const ux = (c[0] - a[0]) / len, uz = (c[1] - a[1]) / len;
      const pcs = wallPieces({ a, b: c, len, y0: 0.9, y1: P.topY - 0.7, openings: ops.map(o => ({ ...o, y1: o.y1 + 0.1 })) });
      for (const pc of pcs) {
        const pl = new THREE.PlaneGeometry(pc.d1 - pc.d0, pc.y1 - pc.y0);
        pl.rotateY(-Math.atan2(uz, ux));
        pl.translate(a[0] + ux * (pc.d0 + pc.d1) / 2, (pc.y0 + pc.y1) / 2, a[1] + uz * (pc.d0 + pc.d1) / 2);
        gg.push(pl);
      }
    }
    if (gg.length) { const gm = new THREE.Mesh(mergeGeometries(gg), this.glassMat); gm.renderOrder = 5; g.add(gm); }

    // ---- floors, ceilings, roof ----
    const floors = new FlatBuf(), ceils = new FlatBuf();
    for (const f of P.floors) {
      const poly = f.poly;
      if (f.kind === 'tier') {
        floors.poly(poly, null, f.y, true, [0.78, 0.62, 0.48]);
        floors.vquad(poly[0], poly[3], f.y - f.thick, f.y, [0.7, 0.55, 0.42]);
        continue;
      }
      const tint = f.kind === 'landing' ? [0.85, 0.85, 0.85] : [1, 1, 1];
      floors.poly(poly, f.holes, f.y + 0.002, true, tint);
      if (f.level > 0 || f.kind === 'landing' || f.kind === 'ceilingOnly') ceils.poly(poly, f.holes, f.y - f.thick, false);
      if (f.kind === 'landing') for (let i = 0; i < poly.length; i++) floors.vquad(poly[i], poly[(i + 1) % poly.length], f.y - f.thick, f.y, [0.8, 0.8, 0.8]);
    }
    // top ceiling + roof
    ceils.poly(inner, null, P.topY - 0.6, false);
    const roof = new FlatBuf(); roof.poly(P.poly, null, P.topY, true, [0.55, 0.54, 0.52]);
    const fm = new THREE.Mesh(floors.geometry(), this.floorMat); fm.receiveShadow = true; g.add(fm);
    const cm = new THREE.Mesh(ceils.geometry(), this.ceilMat); g.add(cm);
    const rm = new THREE.Mesh(roof.geometry(), this.roofMat); rm.castShadow = true; g.add(rm);

    // ---- partitions ----
    const parts = new WallBuf();
    const pShape = extra;
    for (const w of P.walls) {
      const pcs = wallPieces(w);
      const ux = (w.b[0] - w.a[0]) / w.len, uz = (w.b[1] - w.a[1]) / w.len;
      const nx = uz, nz = -ux, h = w.t / 2;
      const c = new THREE.Color(w.color ?? 0xf1eee7);
      for (const pc of pcs) {
        const A = [w.a[0] + ux * pc.d0, w.a[1] + uz * pc.d0], B = [w.a[0] + ux * pc.d1, w.a[1] + uz * pc.d1];
        parts.quad([A[0] + nx * h, A[1] + nz * h], [B[0] + nx * h, B[1] + nz * h], pc.y0, pc.y1, nx, nz, c, STYLE_ID.interior, P.lh, 0, 1, pc.d0, pc.d1, w.len, pc.y1);
        parts.quad([A[0] - nx * h, A[1] - nz * h], [B[0] - nx * h, B[1] - nz * h], pc.y0, pc.y1, -nx, -nz, c, STYLE_ID.interior, P.lh, 0, 1, pc.d0, pc.d1, w.len, pc.y1);
        // end caps
        parts.quad([A[0] + nx * h, A[1] + nz * h], [A[0] - nx * h, A[1] - nz * h], pc.y0, pc.y1, -ux, -uz, c, STYLE_ID.interior, P.lh, 0, 1, 0, 0.1, 1, pc.y1);
        parts.quad([B[0] - nx * h, B[1] - nz * h], [B[0] + nx * h, B[1] + nz * h], pc.y0, pc.y1, ux, uz, c, STYLE_ID.interior, P.lh, 0, 1, 0, 0.1, 1, pc.y1);
      }
      // door frames + open door leaves
      for (const o of w.openings) {
        if (o.d1 - o.d0 > 2.5) continue;
        const A = [w.a[0] + ux * o.d0, w.a[1] + uz * o.d0], B = [w.a[0] + ux * o.d1, w.a[1] + uz * o.d1];
        const fcol = '#6f757b';
        boxBetween(pShape, [A[0] - nx * h, A[1] - nz * h], [A[0] + nx * h, A[1] + nz * h], o.y0, o.y1, 0.07, fcol);
        boxBetween(pShape, [B[0] - nx * h, B[1] - nz * h], [B[0] + nx * h, B[1] + nz * h], o.y0, o.y1, 0.07, fcol);
        boxBetween(pShape, A, B, o.y1, o.y1 + 0.06, w.t + 0.04, fcol);
        if (o.leaf) {
          // leaf opened 90° into the side away from the building centre (rooms are at the facade)
          const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
          const s = ((mx + nx - P.F.cx) ** 2 + (mz + nz - P.F.cz) ** 2) > ((mx - nx - P.F.cx) ** 2 + (mz - nz - P.F.cz) ** 2) ? 1 : -1;
          const lw = o.d1 - o.d0 - 0.12;
          boxBetween(pShape, [A[0] + ux * 0.05, A[1] + uz * 0.05], [A[0] + ux * 0.05 + nx * s * lw, A[1] + uz * 0.05 + nz * s * lw], o.y0 + 0.02, o.y1 - 0.04, 0.045, '#b58a5a');
        }
      }
    }
    if (parts.pos.length) { const pm = new THREE.Mesh(parts.geometry(), this.game.mats.facade); pm.receiveShadow = true; g.add(pm); }

    // ---- stairs ----
    for (const r of P.ramps) {
      const v = r.vis;
      const L = Math.hypot(v.bx - v.ax, v.bz - v.az), ux = (v.bx - v.ax) / L, uz = (v.bz - v.az) / L;
      const n = r.steps, run = L / n, rise = (v.y1 - v.y0) / n;
      for (let i = 0; i < n; i++) {
        const s0 = i * run, top = v.y0 + (i + 1) * rise;
        const cx = v.ax + ux * (s0 + run / 2), cz = v.az + uz * (s0 + run / 2);
        const gb = new THREE.BoxGeometry(run + 0.02, 0.28, v.width); gb.rotateY(-Math.atan2(uz, ux)); gb.translate(cx, top - 0.14, cz);
        pShape.geo(gb, i % 2 ? '#cbc7bf' : '#c4c0b8');
        const nose = new THREE.BoxGeometry(0.04, 0.02, v.width); nose.rotateY(-Math.atan2(uz, ux)); nose.translate(cx + ux * run / 2, top + 0.005, cz + uz * run / 2);
        pShape.geo(nose, '#555a5f');
      }
      // handrails on both sides
      const nx = -uz, nz = ux;
      for (const sd of [-1, 1]) {
        const o = (v.width / 2 - 0.06) * sd;
        pShape.tube([v.ax + nx * o, v.y0 + 0.92, v.az + nz * o], [v.bx + nx * o, v.y1 + 0.92, v.bz + nz * o], 0.022, '#8d9296');
      }
    }
    // ---- railings ----
    for (const r of P.rails) {
      const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
      if (L < 0.05) continue;
      pShape.tube([r.a[0], r.y + r.h, r.a[1]], [r.b[0], r.y + r.h, r.b[1]], 0.03, '#8d9296');
      const n = Math.max(1, Math.round(L / 1.2));
      for (let i = 0; i <= n; i++) { const f = i / n; pShape.tube([r.a[0] + (r.b[0] - r.a[0]) * f, r.y, r.a[1] + (r.b[1] - r.a[1]) * f], [r.a[0] + (r.b[0] - r.a[0]) * f, r.y + r.h, r.a[1] + (r.b[1] - r.a[1]) * f], 0.025, '#8d9296'); }
      if (r.glass) {
        const pl = new THREE.PlaneGeometry(L, r.h - 0.12); pl.rotateY(-Math.atan2(r.b[1] - r.a[1], r.b[0] - r.a[0])); pl.translate((r.a[0] + r.b[0]) / 2, r.y + (r.h - 0.12) / 2 + 0.05, (r.a[1] + r.b[1]) / 2);
        gg.length = 0; const gm = new THREE.Mesh(pl, this.glassMat); gm.renderOrder = 5; g.add(gm);
      } else {
        boxBetween(pShape, r.a, r.b, r.y + 0.12, r.y + 0.14, 0.03, '#8d9296');
      }
    }
    const em = new THREE.Mesh(pShape.build(), this.propMat); em.castShadow = true; em.receiveShadow = true; g.add(em);
    // distance culling for the whole interior
    const cx = P.F.cx, cz = P.F.cz, rad = Math.hypot(P.F.hw, P.F.hd);
    g.userData.cull = { x: cx, z: cz, r: rad, maxDist: 260, castDist: 120, cast: true };
    this.group.add(g);
  }

  _buildFurniture() {
    const items = this.plans.flatMap(P => P.furn);
    const byType = new Map();
    for (const it of items) { let a = byType.get(it.type); if (!a) byType.set(it.type, a = []); a.push(it); }
    for (const [type, list] of byType) {
      const f = FURNITURE[type];
      if (!f) continue;
      const geo = f();
      chunkedInstances(this.group, geo, this.propMat, list, (it, p, s, c) => {
        p.set(it.x, it.y ?? 0, it.z);
        if (type === 'seatrow' || type === 'bigboard' || type === 'screen') s.set(1, 1, it.len ?? 1);
        if (type === 'column') s.set(1, it.h ?? 3.4, 1);
        if (type === 'chair') c.set(['#2d4f7c', '#3a5f3a', '#7c2d2d', '#4a4a52'][Math.floor(Math.abs(it.x * 7.3 + it.z * 3.1)) % 4]);
        return { rot: -it.yaw };
      }, { chunk: 64, maxDist: 110, castDist: 30, color: type === 'chair' });
    }
    // ceiling lights (emissive panels)
    const lights = this.plans.flatMap(P => P.lights);
    chunkedInstances(this.group, FURNITURE.light(), this.propMat, lights, (l, p, s) => { p.set(l.x, l.y, l.z); s.set(l.w, 1, l.d); return { rot: -l.yaw }; }, { chunk: 64, maxDist: 160, cast: false });
    // sliding entrance doors (animated)
    this.doorMeshes = [];
    const leafGeo = new THREE.BoxGeometry(1, 1, 1);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x9fb4bf, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.5, depthWrite: false });
    for (const d of this.doors) {
      const half = d.w / 2;
      const leaves = [];
      for (const sd of [-1, 1]) {
        const m = new THREE.Mesh(leafGeo, frameMat);
        m.scale.set(half, d.h - 0.05, 0.03);
        m.rotation.y = -Math.atan2(d.uz, d.ux);
        m.renderOrder = 6;
        this.group.add(m);
        leaves.push({ m, sd });
      }
      d.leaves = leaves;
      this._placeDoor(d, 0);
    }
  }

  _placeDoor(d, open) {
    const half = d.w / 2;
    for (const { m, sd } of d.leaves) {
      const off = sd * (half / 2 + open * half * 0.95);
      m.position.set(d.x + d.ux * off - d.nx * 0.15, (d.h - 0.05) / 2, d.z + d.uz * off - d.nz * 0.15);
    }
  }

  _buildLabels() {
    const atlas = new TextAtlas(2048);
    const buf = { pos: [], nor: [], uv: [] };
    const cache = new Map();
    for (const P of this.plans) for (const l of P.labels) {
      let uv = cache.get(l.text);
      if (!uv) {
        uv = atlas.add(256, 72, (ctx, w, h) => {
          ctx.fillStyle = '#f4f4f1'; ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#1f3f6e'; ctx.fillRect(0, 0, 8, h);
          ctx.fillStyle = '#1b1d20'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
          const m = l.text.match(/^(\d\d\.\d+)\s+(.*)$/);
          if (m) {
            ctx.font = `700 26px ${SIGN_FONT}`; ctx.fillText(m[1], 18, 22);
            fitText(ctx, m[2], w - 28, 22, '500'); ctx.fillText(m[2], 18, 53);
          } else { fitText(ctx, l.text, w - 28, 30, '600'); ctx.fillText(l.text, 18, h / 2); }
        });
        cache.set(l.text, uv);
      }
      const big = !/^\d\d\./.test(l.text);
      pushQuad(buf, l.x, l.y, l.z, l.yaw, big ? 1.2 : 0.5, big ? 0.36 : 0.15, uv, 0.012);
    }
    atlas.done();
    if (!buf.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.5 }));
    this.group.add(m);
  }

  update(dt, game) {
    // automatic doors open when the player (or anybody tracked) is near
    const p = game.player;
    const people = game.crowd ? game.crowd.positions() : null;
    for (const d of this.doors) {
      let near = Math.hypot(p.x - d.x, p.z - d.z) < 3.2 && p.y < 2;
      if (!near && people) for (const q of people) { if (Math.abs(q.x - d.x) < 3 && Math.abs(q.z - d.z) < 3 && q.y < 2) { near = true; break; } }
      const target = near ? 1 : 0;
      const o = d.open + Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt * 2.2);
      if (o !== d.open) { d.open = o; this._placeDoor(d, o); }
    }
  }
}
