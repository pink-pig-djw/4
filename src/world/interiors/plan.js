// Interior plans for the enterable buildings. The outer shell is the real OSM footprint;
// the inside (rooms, stairs, furniture) is invented but generated to fit that footprint.
// Pure JS: consumed by the renderer, the collision builder and the Node walk test.
import { obb, pointInPoly, clipSegToPoly, rng, signedArea, distSegSq } from '../../shared/geom.js';

// Which building parts can be entered (ids are OSM way/relation ids of building parts).
export const ENTERABLE = [
  { key: 'mensa', id: 'w25359011', program: 'mensa', title: { de: 'Mensa Erlangen-Süd', zh: '南区食堂 Mensa' } },
  { key: 'hoersaal', id: 'w149469609', program: 'lecture', title: { de: 'Hörsaalgebäude', zh: '报告厅楼' } },
  { key: 'rrze', id: 'w25358914', program: 'rrze', title: { de: 'Regionales Rechenzentrum (RRZE)', zh: '区域计算中心 RRZE' } },
  { key: 'mathe', id: 'r3570551', program: 'math', title: { de: 'Felix-Klein-Gebäude · Mathematik', zh: '数学楼 Felix-Klein-Gebäude' } },
];

const SLAB = 0.3;          // floor slab thickness
const EXT_T = 0.3;         // exterior wall thickness (visual)
const INT_T = 0.14;        // interior partitions
const DOOR_H = 2.15;

const ROOM_NAMES = {
  seminar: { de: 'Seminarraum', zh: '研讨室' },
  uebung: { de: 'Übungsraum', zh: '练习室' },
  buero: { de: 'Büro', zh: '办公室' },
  sekretariat: { de: 'Sekretariat', zh: '秘书处' },
  cip: { de: 'CIP-Pool', zh: '计算机房 CIP-Pool' },
  bibliothek: { de: 'Bibliothek', zh: '图书室' },
  lernraum: { de: 'Lernraum', zh: '自习室' },
  besprechung: { de: 'Besprechungsraum', zh: '会议室' },
  kueche: { de: 'Teeküche', zh: '茶水间' },
  wc: { de: 'WC', zh: '洗手间' },
  server: { de: 'Serverraum', zh: '服务器机房' },
  foyer: { de: 'Foyer', zh: '门厅' },
  service: { de: 'Service-Theke', zh: 'IT 服务台' },
  hoersaal: { de: 'Hörsaal', zh: '阶梯报告厅' },
  mensa: { de: 'Speisesaal', zh: '用餐大厅' },
  cafeteria: { de: 'Cafeteria', zh: '咖啡角' },
  treppe: { de: 'Treppenhaus', zh: '楼梯间' },
};

// ---------------- frame helpers ----------------
function makeFrame(poly) {
  const b = obb(poly);
  return { cx: b.cx, cz: b.cz, ux: b.ux, uz: b.uz, vx: -b.uz, vz: b.ux, hw: b.hw, hd: b.hd };
}
const toW = (F, s, t) => [F.cx + F.ux * s + F.vx * t, F.cz + F.uz * s + F.vz * t];
const toL = (F, x, z) => { const dx = x - F.cx, dz = z - F.cz; return [dx * F.ux + dz * F.uz, dx * F.vx + dz * F.vz]; };
const yawOfLocal = (F, ds, dt) => { const x = F.ux * ds + F.vx * dt, z = F.uz * ds + F.vz * dt; return Math.atan2(z, x); };

// Inset polygon (positive area orientation) by d using mitred offsets.
export function insetPoly(poly, d) {
  const n = poly.length, out = [];
  const pos = signedArea(poly) > 0;
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i + n - 1) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const e1 = norm([p1[0] - p0[0], p1[1] - p0[1]]), e2 = norm([p2[0] - p1[0], p2[1] - p1[1]]);
    // inward normal for positive orientation = (-dz, dx)
    const s = pos ? 1 : -1;
    const n1 = [-e1[1] * s, e1[0] * s], n2 = [-e2[1] * s, e2[0] * s];
    let m = [n1[0] + n2[0], n1[1] + n2[1]];
    const ml = Math.hypot(m[0], m[1]);
    if (ml < 1e-6) m = n1; else m = [m[0] / ml, m[1] / ml];
    const dot = Math.max(0.3, m[0] * n2[0] + m[1] * n2[1]);
    out.push([p1[0] + m[0] * d / dot, p1[1] + m[1] * d / dot]);
  }
  return out;
}
function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

// Solid pieces of a wall after cutting openings and clipping: returns [{d0,d1,y0,y1}]
export function wallPieces(w) {
  const ranges = w.ranges || [[0, w.len]];
  const out = [];
  for (const [c0, c1] of ranges) {
    const cuts = new Set([c0, c1]);
    const ops = (w.openings || []).filter(o => o.d1 > c0 && o.d0 < c1);
    for (const o of ops) { cuts.add(Math.max(c0, o.d0)); cuts.add(Math.min(c1, o.d1)); }
    const xs = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i], b = xs[i + 1];
      if (b - a < 1e-3) continue;
      const mid = (a + b) / 2;
      const covering = ops.filter(o => o.d0 <= mid && o.d1 >= mid).map(o => [o.y0, o.y1]).sort((p, q) => p[0] - q[0]);
      let y = w.y0;
      for (const [o0, o1] of covering) {
        if (o0 > y + 1e-3) out.push({ d0: a, d1: b, y0: y, y1: Math.min(o0, w.y1) });
        y = Math.max(y, o1);
      }
      if (y < w.y1 - 1e-3) out.push({ d0: a, d1: b, y0: y, y1: w.y1 });
    }
  }
  return out;
}

// ---------------- plan builder ----------------
class Plan {
  constructor(world, spec, bIdx, allBuildings) {
    const b = world.buildings[bIdx];
    this.key = spec.key; this.spec = spec; this.program = spec.program; this.title = spec.title;
    this.b = b; this.bIdx = bIdx; this.buildingIdx = [bIdx];
    this.poly = b.p;
    this.F = makeFrame(b.p);
    this.lh = b.lh; this.levels = b.lv;
    this.topY = b.wh;
    this.r = rng(bIdx * 31 + 7);
    this.walls = []; this.floors = []; this.ramps = []; this.rooms = []; this.furn = []; this.labels = [];
    this.lights = []; this.rails = []; this.extDoors = []; this.npcSpots = []; this.tests = []; this.holes = [];
    this.stairs = []; this.landings = []; this.tiers = []; this.voids = [];
    this.accessible = 1;
    this.inner = insetPoly(b.p, EXT_T);
    this.clipPoly = insetPoly(b.p, EXT_T - 0.02);
    this.roomNo = {};
    this.world = world; this.all = allBuildings;
  }
  Y(k) { return k * this.lh; }
  ceil(k) { return Math.min(this.Y(k + 1) - SLAB, this.topY - 0.6); }
  W(s, t) { return toW(this.F, s, t); }
  inside(s, t, margin = 0) {
    const p = this.W(s, t);
    if (!pointInPoly(p[0], p[1], this.inner)) return false;
    if (margin > 0) {
      for (let i = 0; i < this.inner.length; i++) {
        const a = this.inner[i], c = this.inner[(i + 1) % this.inner.length];
        if (distSegSq(p[0], p[1], a[0], a[1], c[0], c[1]) < margin * margin) return false;
      }
    }
    return true;
  }

  // Interior wall between local points; openings in metres from the start, y relative to floor.
  wall(s0, t0, s1, t1, level, opts = {}) {
    const a = this.W(s0, t0), b = this.W(s1, t1);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) return null;
    const y0 = opts.y0 ?? this.Y(level), y1 = opts.y1 ?? this.ceil(level);
    const ranges = clipSegToPoly(a[0], a[1], b[0], b[1], this.clipPoly).map(([p, q]) => [p * len, q * len]).filter(r => r[1] - r[0] > 0.05);
    if (!ranges.length) return null;
    const w = {
      a, b, len, y0, y1, t: opts.t ?? INT_T, kind: opts.kind || 'int', color: opts.color || null, ranges,
      openings: (opts.doors || []).map(d => ({ d0: d.at - d.w / 2, d1: d.at + d.w / 2, y0: y0 - 0.01, y1: y0 + (d.h ?? DOOR_H), leaf: d.leaf ?? true, glass: d.glass || false })),
      level,
    };
    this.walls.push(w);
    return w;
  }
  room(kind, level, s0, t0, s1, t1, door) {
    const n = (this.roomNo[level] = (this.roomNo[level] || 100 + Math.floor(this.r() * 30)) + 1 + Math.floor(this.r() * 3));
    const num = `${String(level).padStart(2, '0')}.${n}`;
    const name = ROOM_NAMES[kind] || { de: kind, zh: kind };
    const c = this.W((s0 + s1) / 2, (t0 + t1) / 2);
    const rm = { kind, level, s0: Math.min(s0, s1), s1: Math.max(s0, s1), t0: Math.min(t0, t1), t1: Math.max(t0, t1), name, num, x: c[0], z: c[1], y: this.Y(level) };
    this.rooms.push(rm);
    return rm;
  }
  label(s, t, level, text, sub, faceS, faceT, h = 1.55) {
    const p = this.W(s, t);
    this.labels.push({ x: p[0], z: p[1], y: this.Y(level) + h, yaw: yawOfLocal(this.F, faceS, faceT), text, sub });
  }
  item(type, s, t, level, ds = 1, dt = 0, extra = {}) {
    const p = this.W(s, t);
    const it = { type, x: p[0], z: p[1], y: extra.y ?? this.Y(level), yaw: yawOfLocal(this.F, ds, dt), level, ...extra };
    this.furn.push(it);
    return it;
  }
  light(s, t, level, w = 1.2, d = 0.6) {
    const p = this.W(s, t);
    this.lights.push({ x: p[0], z: p[1], y: this.ceil(level) - 0.02, w, d, yaw: yawOfLocal(this.F, 1, 0), level });
  }
  rail(s0, t0, s1, t1, level, h = 1.05, glass = false, y = null) {
    const a = this.W(s0, t0), b = this.W(s1, t1);
    this.rails.push({ a, b, y: y ?? this.Y(level), h, glass });
  }
  rectW(s0, t0, s1, t1) { return [this.W(s0, t0), this.W(s1, t0), this.W(s1, t1), this.W(s0, t1)]; }

  // ----- exterior shell -----
  shell() {
    const p = this.poly;
    const n = p.length;
    const others = this.all;
    this.ext = [];
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.05) { this.ext.push(null); continue; }
      const nx = dz / len, nz = -dx / len; // outward
      // party wall if another ground-level building touches this edge
      let party = false;
      for (const f of [0.25, 0.5, 0.75]) {
        const mx = a[0] + dx * f + nx * 0.45, mz = a[1] + dz * f + nz * 0.45;
        for (const o of others) {
          if (o === this.b || o.mh > 1 || this.absorbed?.has(o)) continue;
          if (o._bb && (mx < o._bb[0] || mx > o._bb[2] || mz < o._bb[1] || mz > o._bb[3])) continue;
          if (pointInPoly(mx, mz, o.p)) { party = true; break; }
        }
        if (party) break;
      }
      this.ext.push({ i, a, b, len, nx, nz, party, openings: [], y0: 0, y1: this.topY, kind: 'ext' });
    }
  }
  removeExtDoor(d) {
    const e = this.ext[d.edge];
    if (e) e.openings = e.openings.filter(o => Math.abs((o.d0 + o.d1) / 2 - d.at) > 0.01);
    this.extDoors = this.extDoors.filter(x => x !== d);
  }
  nearExtDoor(x, z, r) { return this.extDoors.some(d => Math.hypot(d.x - x, d.z - z) < r); }
  // Exterior door at world point (x,z) on the nearest edge.
  extDoor(x, z, w = 1.9, main = false) {
    let best = null, bd = 1.5;
    for (const e of this.ext) {
      if (!e) continue;
      const d = Math.sqrt(distSegSq(x, z, e.a[0], e.a[1], e.b[0], e.b[1]));
      if (d < bd) { bd = d; best = e; }
    }
    if (!best || best.party) return null;
    const ux = (best.b[0] - best.a[0]) / best.len, uz = (best.b[1] - best.a[1]) / best.len;
    let at = (x - best.a[0]) * ux + (z - best.a[1]) * uz;
    at = Math.max(w / 2 + 0.4, Math.min(best.len - w / 2 - 0.4, at));
    if (best.len < w + 0.8) return null;
    best.openings.push({ d0: at - w / 2, d1: at + w / 2, y0: -0.01, y1: 2.6, door: true });
    const px = best.a[0] + ux * at, pz = best.a[1] + uz * at;
    const d = { x: px, z: pz, nx: best.nx, nz: best.nz, w, main, edge: best.i, at, yaw: Math.atan2(best.nz, best.nx) };
    this.extDoors.push(d);
    return d;
  }

  // ----- stairwell (switch-back, stacked over several floors) -----
  // a0: open end (towards corridor/hall) along `axis` ('s' or 't'), dir: +-1, c: centre across. Returns rect {s0,s1,t0,t1}.
  stairwell(a0, dir, c, fromLevel, toLevel, name = true, axis = 's') {
    const S = axis === 's';
    const W = (a, b) => S ? this.W(a, b) : this.W(b, a);
    const R = (a0_, b0_, a1_, b1_) => S ? this.rectW(Math.min(a0_, a1_), Math.min(b0_, b1_), Math.max(a0_, a1_), Math.max(b0_, b1_)) : this.rectW(Math.min(b0_, b1_), Math.min(a0_, a1_), Math.max(b0_, b1_), Math.max(a0_, a1_));
    const wall = (p0, q0, p1, q1, k, o) => S ? this.wall(p0, q0, p1, q1, k, o) : this.wall(q0, p0, q1, p1, k, o);
    const lane = 1.5, gap = 0.2, landing = 1.6, run = 3.2, mid = 1.6;
    const aA = a0 + dir * landing, aB = a0 + dir * (landing + run), aE = a0 + dir * (landing + run + mid);
    const cA0 = c - gap / 2 - lane, cA1 = c - gap / 2, cB0 = c + gap / 2, cB1 = c + gap / 2 + lane;
    const lh = this.lh;
    const faceA = S ? [-dir, 0] : [0, -dir];
    for (let k = fromLevel; k <= toLevel; k++) {
      const y0 = this.Y(k), y1 = k < this.levels - 1 ? this.Y(k + 1) : this.ceil(k);
      wall(a0, cA0 - 0.1, aE + dir * 0.1, cA0 - 0.1, k, { y0, y1, color: 0xe9e6df });
      wall(a0, cB1 + 0.1, aE + dir * 0.1, cB1 + 0.1, k, { y0, y1, color: 0xe9e6df });
      wall(aE + dir * 0.1, cA0 - 0.1, aE + dir * 0.1, cB1 + 0.1, k, { y0, y1, color: 0xe9e6df });
      wall(aA, c, aB, c, k, { y0, y1, t: gap, color: 0xd9d5cc });
      if (name) { const lp = S ? [a0 - dir * 0.02, cA0 - 0.45] : [cA0 - 0.45, a0 - dir * 0.02]; this.label(lp[0], lp[1], k, 'Treppenhaus', ROOM_NAMES.treppe.zh, faceA[0], faceA[1], 2.3); }
    }
    for (let k = fromLevel; k < toLevel; k++) {
      const F0 = this.Y(k), Fm = F0 + lh / 2, F1 = this.Y(k + 1);
      this.flightW(W(aA, (cA0 + cA1) / 2), W(aB, (cA0 + cA1) / 2), lane, F0, Fm, k);
      this.flightW(W(aB, (cB0 + cB1) / 2), W(aA, (cB0 + cB1) / 2), lane, Fm, F1, k);
      const Lp = R(aB, cA0, aE, cB1);
      this.landings.push({ poly: Lp, y: Fm, level: k });
      this.floors.push({ poly: Lp, y: Fm, thick: 0.25, kind: 'landing', level: k });
    }
    for (let k = fromLevel + 1; k <= toLevel; k++) this.holes.push({ level: k, poly: R(aA, cA0 - 0.05, aE, cB1 + 0.05) });
    const railW = (p0, q0, p1, q1, k) => { const A = W(p0, q0), B = W(p1, q1); this.rails.push({ a: A, b: B, y: this.Y(k), h: 1.1, glass: false }); };
    railW(aA, cB0, aA, cB1, fromLevel);
    railW(aA, cA0, aA, cA1, toLevel);
    this.stairs.push({ axis, a0, dir, c, fromLevel, toLevel, aA, aB, aE, cA0, cA1, cB0, cB1 });
    const mA = (cA0 + cA1) / 2, mB = (cB0 + cB1) / 2;
    const P = (a, b, y) => { const q = W(a, b); return y == null ? { x: q[0], z: q[1] } : { x: q[0], z: q[1], y }; };
    const pts = [];
    for (let k = fromLevel; k < toLevel; k++) {
      pts.push(P(a0 + dir * 0.8, mA), P(aB - dir * 0.3, mA), P((aB + aE) / 2, c, this.Y(k) + lh / 2), P(aB - dir * 0.3, mB), P(aA + dir * 0.3, mB), P(a0 + dir * 0.8, c, this.Y(k + 1)));
    }
    for (let k = toLevel; k > fromLevel; k--) {
      pts.push(P(aA + dir * 0.3, mB), P(aB - dir * 0.2, mB), P((aB + aE) / 2, c, this.Y(k - 1) + lh / 2), P(aB - dir * 0.3, mA), P(aA + dir * 0.2, mA), P(a0 + dir * 0.8, c, this.Y(k - 1)));
    }
    const start = W(a0 + dir * 0.8, c);
    this.tests.push({ name: `${this.key} stairs ${fromLevel}->${toLevel}->${fromLevel}`, from: { x: start[0], z: start[1], y: this.Y(fromLevel) }, points: pts });
    const aMin = Math.min(a0, aE + dir * 0.2), aMax = Math.max(a0, aE + dir * 0.2);
    return S ? { s0: aMin, s1: aMax, t0: cA0 - 0.2, t1: cB1 + 0.2 } : { s0: cA0 - 0.2, s1: cB1 + 0.2, t0: aMin, t1: aMax };
  }
  flightW(a, b, width, y0, y1, level) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, ext = 0.06;
    this.ramps.push({
      cx: (a[0] + b[0]) / 2, cz: (a[1] + b[1]) / 2, ux, uz, hl: L / 2 + ext, hw: width / 2, y0: y0 - (y1 - y0) * ext / L, y1: y1 + (y1 - y0) * ext / L,
      steps: Math.round((y1 - y0) / 0.17), vis: { ax: a[0], az: a[1], bx: b[0], bz: b[1], y0, y1, width }, level,
    });
  }
  finalizeFloors() {
    // floor slabs for levels 1..levels-1 (+ roof) with openings (stairs, voids)
    for (let k = 0; k < this.levels; k++) {
      const holes = this.holes.filter(h => h.level === k).map(h => h.poly);
      this.floors.push({ poly: this.inner, y: this.Y(k), thick: SLAB, kind: 'floor', level: k, holes });
    }
  }
}

// ---------------- programs ----------------

// Ring layout: rooms along the facades, ring corridor, core with stairs + atrium + service block.
function ringProgram(P, cfg) {
  const { hw, hd } = P.F;
  const R = cfg.roomDepth ?? 6.4, C = cfg.corr ?? 2.5;
  const iS = hw - R, iT = hd - R;            // corridor outer boundary (room band inner edge)
  const cS = hw - R - C, cT = hd - R - C;     // core boundary
  const top = cfg.topLevel;
  P.accessible = top + 1;
  for (const d of [...P.extDoors]) {
    const l = toL(P.F, d.x, d.z);
    const onS = Math.abs(Math.abs(l[1]) - hd) < 1.5 && Math.abs(l[0]) < iS - 3;
    const onT = Math.abs(Math.abs(l[0]) - hw) < 1.5 && Math.abs(l[1]) < iT - 3;
    if (!onS && !onT) P.removeExtDoor(d);
  }
  if (!P.extDoors.length) {
    // make one in the middle of the longest free side
    const cands = [[0, -hd], [0, hd], [-hw, 0], [hw, 0]].map(([s, t]) => P.W(s, t));
    for (const c of cands) if (P.extDoor(c[0], c[1], 2.4, true)) break;
  }
  // stairwell in the core at the -s end, open towards the west corridor
  const st = P.stairwell(-cS, +1, 0, 0, top);
  // service block (WC / elevator / server room) at the +s end of the core
  const svc0 = cS - 5.5;
  // atrium between
  const aS0 = st.s1 + 1.2, aS1 = svc0 - 1.2, aT = cT - 0.6;
  const hasAtrium = cfg.atrium !== false && aS1 - aS0 > 6 && aT > 3;
  for (let k = 0; k <= top; k++) {
    const y = P.Y(k);
    // --- core boundary walls ---
    // west core wall is the stairwell itself; service block walls
    P.wall(svc0, -cT, svc0, cT, k);
    P.wall(svc0, -cT, cS, -cT, k); P.wall(svc0, cT, cS, cT, k);
    P.wall(cS, -cT, cS, cT, k, { doors: [{ at: cT * 0.5, w: 1.2 }, { at: cT * 1.5, w: 1.2 }] });
    const svcKind = k === 0 && cfg.server ? 'server' : 'wc';
    const rm = P.room(svcKind, k, svc0, -cT, cS, cT);
    P.label(cS + 0.08, cT * 0.5 - cT + 0.6, k, svcKind === 'wc' ? 'WC Damen · Herren' : 'Serverraum', svcKind === 'wc' ? ROOM_NAMES.wc.zh : ROOM_NAMES.server.zh, 1, 0);
    if (svcKind === 'server') {
      for (let s = svc0 + 1.2; s < cS - 0.8; s += 1.4) { P.item('rack', s, -cT + 1.2, k, 0, 1); P.item('rack', s, cT - 1.2, k, 0, -1); }
    } else {
      P.item('elevator', svc0 + 1.3, -cT + 1.4, k, 0, 1);
    }
    // stairwell side walls to the core (already by stairwell); walls between stair and atrium zone
    P.wall(st.s1, -cT, st.s1, cT, k);
    for (const sg of [-1, 1]) { const tt = sg * (st.t1 + cT) / 2; if (cT - st.t1 > 3) { P.item('studytable', (-cS + st.s1) / 2, tt, k, 0, -sg); P.npcSpots.push({ kind: 'sitTable', ...xz(P.W((-cS + st.s1) / 2, tt + sg * 0.7)), y, yaw: yawOfLocal(P.F, 0, -sg) }); } }
    // core long walls (corridor side): glass railing on upper floors around the atrium, open on EG
    if (hasAtrium) {
      if (k === 0) {
        // EG: open lobby with benches and plants
        P.item('bench', (aS0 + aS1) / 2, -aT + 1.4, 0, 1, 0); P.item('bench', (aS0 + aS1) / 2, aT - 1.4, 0, -1, 0);
        P.item('plant', aS0 + 0.8, -aT + 0.8, 0); P.item('plant', aS1 - 0.8, aT - 0.8, 0);
        P.item('plant', aS1 - 0.8, -aT + 0.8, 0); P.item('plant', aS0 + 0.8, aT - 0.8, 0);
        for (let s = aS0 + 2.5; s < aS1 - 2; s += 4) { P.item('studytable', s, 0, 0, 1, 0); P.npcSpots.push({ kind: 'sitTable', ...xz(P.W(s, 0.9)), y, yaw: yawOfLocal(P.F, 0, -1) }); }
      } else {
        P.rail(aS0, -aT, aS1, -aT, k, 1.1, true); P.rail(aS0, aT, aS1, aT, k, 1.1, true);
        P.rail(aS0, -aT, aS0, aT, k, 1.1, true); P.rail(aS1, -aT, aS1, aT, k, 1.1, true);
        P.holes.push({ level: k, poly: P.rectW(aS0, -aT, aS1, aT) });
      }
      // walls between atrium zone and stair/service blocks (corridor sides stay open)
    }
    // corridor lights (ring)
    for (let s = -iS + 1.2; s <= iS - 1.2; s += 3.75) { P.light(s, -(cT + C / 2), k, 1.2, 0.3); P.light(s, cT + C / 2, k, 1.2, 0.3); }
    for (let t = -cT; t <= cT; t += 3.75) { P.light(-(cS + C / 2), t, k, 0.3, 1.2); P.light(cS + C / 2, t, k, 0.3, 1.2); }
    if (hasAtrium) for (let s = aS0 + 2; s < aS1 - 1; s += 3.5) for (let t = -aT + 2; t < aT - 1; t += 3.5) if (k === top) P.light(s, t, k, 1.2, 1.2);
    // corridor NPC spots
    P.npcSpots.push({ kind: 'corridor', ...xz(P.W(-cS - C / 2, 0)), y, yaw: 0 });
    P.npcSpots.push({ kind: 'corridor', ...xz(P.W(cS + C / 2, 0)), y, yaw: 0 });
    P.npcSpots.push({ kind: 'corridor', ...xz(P.W(0, -cT - C / 2)), y, yaw: 0 });
    P.npcSpots.push({ kind: 'corridor', ...xz(P.W(0, cT + C / 2)), y, yaw: 0 });
  }
  // --- perimeter rooms ---
  const doorsOnSide = side => P.extDoors.map(d => ({ d, l: toL(P.F, d.x, d.z) })).filter(({ l }) => {
    if (side === 'S') return Math.abs(l[1] + hd) < 1.5; if (side === 'N') return Math.abs(l[1] - hd) < 1.5;
    if (side === 'W') return Math.abs(l[0] + hw) < 1.5; return Math.abs(l[0] - hw) < 1.5;
  });
  const sides = [
    { id: 'S', along: 's', from: -iS, to: iS, fixed: -hd, inner: -iT, faceIn: [0, 1] },
    { id: 'N', along: 's', from: -iS, to: iS, fixed: hd, inner: iT, faceIn: [0, -1] },
    { id: 'W', along: 't', from: -iT, to: iT, fixed: -hw, inner: -iS, faceIn: [1, 0] },
    { id: 'E', along: 't', from: -iT, to: iT, fixed: hw, inner: iS, faceIn: [-1, 0] },
  ];
  const pick = (k, idx, len) => cfg.roomKind(k, idx, len, P.r);
  for (let k = 0; k <= top; k++) {
    // corridor outer wall per side with doors, plus partitions
    for (const sd of sides) {
      const ents = k === 0 ? doorsOnSide(sd.id).map(({ l }) => (sd.along === 's' ? l[0] : l[1])) : [];
      // split the side into rooms
      const cuts = [sd.from];
      let pos = sd.from;
      const len = sd.to - sd.from;
      const widths = [];
      while (pos < sd.to - 0.1) {
        let w = [3.75, 5, 7.5, 7.5, 5, 10][Math.floor(P.r() * 6)];
        // entrance foyers
        const e = ents.find(x => x > pos - 0.1 && x < pos + w + 2.5);
        if (e != null) { const fw = 5.2; const start = Math.max(pos, e - fw / 2); if (start - pos > 2.5) w = start - pos; else w = Math.max(fw, e + fw / 2 - pos); }
        if (sd.to - (pos + w) < 3) w = sd.to - pos;
        widths.push(w); pos += w; cuts.push(Math.min(pos, sd.to));
      }
      const doors = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i], b = cuts[i + 1], mid = (a + b) / 2, w = b - a;
        const isFoyer = ents.some(x => x > a && x < b);
        const kind = isFoyer ? 'foyer' : pick(k, i, w);
        const dAt = (isFoyer ? mid : a + Math.min(1.1, w / 2)) - sd.from;
        doors.push({ at: dAt, w: isFoyer ? Math.min(3.2, w - 0.6) : 1.2, leaf: !isFoyer });
        // partition wall at b (not at the last)
        if (i < cuts.length - 2) {
          if (sd.along === 's') P.wall(b, sd.fixed, b, sd.inner, k); else P.wall(sd.fixed, b, sd.inner, b, k);
        }
        // room record + furniture
        const [s0, t0, s1, t1] = sd.along === 's' ? [a, sd.fixed, b, sd.inner] : [sd.fixed, a, sd.inner, b];
        const rm = P.room(kind, k, s0, t0, s1, t1);
        furnishRoom(P, rm, sd, k);
        // door sign on corridor side
        const signAlong = isFoyer ? mid + Math.min(2.2, w / 2 - 0.3) : a + Math.min(1.1, w / 2) + 0.95;
        const inner = sd.inner + (sd.faceIn[0] + sd.faceIn[1]) * 0.08;
        if (!isFoyer && signAlong < b - 0.2) {
          if (sd.along === 's') P.label(signAlong, inner, k, `${rm.num} ${rm.name.de}`, rm.name.zh, sd.faceIn[0], sd.faceIn[1]);
          else P.label(inner, signAlong, k, `${rm.num} ${rm.name.de}`, rm.name.zh, sd.faceIn[0], sd.faceIn[1]);
        }
      }
      // corridor wall along the side
      if (sd.along === 's') P.wall(sd.from, sd.inner, sd.to, sd.inner, k, { doors });
      else P.wall(sd.inner, sd.from, sd.inner, sd.to, k, { doors });
    }
    // corner rooms (closed, accessible from a side) – partitions at corners
    for (const [ss, tt] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      P.wall(ss * iS, tt * hd, ss * iS, tt * iT, k);
      P.wall(ss * hw, tt * iT, ss * iS, tt * iT, k, { doors: [{ at: Math.abs(hw - iS) / 2, w: 1.2 }] });
      const rm = P.room(k === 0 ? 'kueche' : 'buero', k, ss * iS, tt * iT, ss * hw, tt * hd);
      furnishRoom(P, rm, null, k);
    }
  }
  P.finalizeFloors();
  // corridor walk test: ring around on EG and top floor
  for (const k of [0, top]) {
    const y = P.Y(k), m = R + C / 2;
    const pts = [[-hw + m, -hd + m], [hw - m, -hd + m], [hw - m, hd - m], [-hw + m, hd - m], [-hw + m, -hd + m]].map(([s, t]) => ({ ...xz(P.W(s, t)) }));
    P.tests.push({ name: `${P.key} ring corridor L${k}`, from: { ...pts[0], y }, points: pts.slice(1) });
  }
}

const xz = p => ({ x: p[0], z: p[1] });

function furnishRoom(P, rm, side, k) {
  const { s0, s1, t0, t1 } = rm;
  const cs = (s0 + s1) / 2, ct = (t0 + t1) / 2, ws = s1 - s0, wt = t1 - t0;
  const y = P.Y(k);
  // facing towards the corridor (for boards on the wall opposite windows)
  P.light(cs, ct, k, Math.min(ws - 1, 2.4), 0.6);
  if (ws > 7 || wt > 7) P.light(cs, ct + (wt > ws ? wt / 4 : 0), k, 1.2, 0.6);
  const inside = (s, t) => { if (!P.inside(s, t, 0.6)) return false; const w = P.W(s, t); return !P.nearExtDoor(w[0], w[1], 2.6); };
  if (rm.kind === 'seminar' || rm.kind === 'uebung' || rm.kind === 'lernraum') {
    // board on one end wall, table rows facing it
    const alongS = ws >= wt;
    const L0 = alongS ? s0 : t0, L1 = alongS ? s1 : t1, M0 = alongS ? t0 : s0, M1 = alongS ? t1 : s1;
    const boardAt = L0 + 0.12;
    const bs = alongS ? boardAt : (s0 + s1) / 2, bt = alongS ? (t0 + t1) / 2 : boardAt;
    if (inside(bs + (alongS ? 0.5 : 0), bt + (alongS ? 0 : 0.5))) P.item(rm.kind === 'lernraum' ? 'pinboard' : 'board', bs, bt, k, alongS ? 1 : 0, alongS ? 0 : 1);
    for (let l = L0 + 2.2; l < L1 - 1.0; l += 1.7) {
      for (let m = M0 + 1.1; m < M1 - 1.0; m += 1.9) {
        const s = alongS ? l : m + 0.8, t = alongS ? m + 0.8 : l;
        if (!inside(s, t)) continue;
        P.item('table', s, t, k, alongS ? -1 : 0, alongS ? 0 : -1);
        P.item('chair', s + (alongS ? 0.55 : 0), t + (alongS ? 0 : 0.55), k, alongS ? -1 : 0, alongS ? 0 : -1);
        if (P.r() < 0.35) P.npcSpots.push({ kind: 'sitChair', ...xz(P.W(s + (alongS ? 0.55 : 0), t + (alongS ? 0 : 0.55))), y, yaw: yawOfLocal(P.F, alongS ? -1 : 0, alongS ? 0 : -1) });
      }
    }
  } else if (rm.kind === 'cip') {
    for (let s = s0 + 1.2; s < s1 - 0.8; s += 1.6) for (let t = t0 + 1.2; t < t1 - 0.8; t += 2.2) {
      if (!inside(s, t)) continue;
      P.item('pcdesk', s, t, k, 0, 1); P.item('chair', s, t - 0.55, k, 0, 1);
      if (P.r() < 0.4) P.npcSpots.push({ kind: 'sitChair', ...xz(P.W(s, t - 0.55)), y, yaw: yawOfLocal(P.F, 0, 1) });
    }
  } else if (rm.kind === 'buero' || rm.kind === 'sekretariat' || rm.kind === 'besprechung') {
    if (rm.kind === 'besprechung') { if (inside(cs, ct)) P.item('bigtable', cs, ct, k, ws > wt ? 1 : 0, ws > wt ? 0 : 1); return; }
    const n = Math.max(1, Math.min(3, Math.floor(Math.max(ws, wt) / 3.2)));
    for (let i = 0; i < n; i++) {
      const alongS = ws >= wt;
      const s = alongS ? s0 + (i + 0.5) * ws / n : cs, t = alongS ? ct : t0 + (i + 0.5) * wt / n;
      if (inside(s, t)) { P.item('desk', s, t, k, alongS ? 0 : 1, alongS ? 1 : 0); }
    }
    if (inside(s0 + 0.4, t1 - 0.4)) P.item('shelf', s0 + 0.35, (t0 + t1) / 2, k, 1, 0);
  } else if (rm.kind === 'bibliothek') {
    for (let s = s0 + 1.2; s < s1 - 1.0; s += 1.8) if (inside(s, ct)) P.item('bookshelf', s, ct, k, 0, 1);
  } else if (rm.kind === 'kueche') {
    if (inside(cs, ct)) { P.item('kitchen', s0 + 0.4, ct, k, 1, 0); P.item('smalltable', cs + 0.5, ct, k); }
  } else if (rm.kind === 'foyer') {
    P.npcSpots.push({ kind: 'stand', ...xz(P.W(cs, ct)), y, yaw: 0 });
  }
}

// ---- Mensa: open dining hall on EG and 1.OG ----
function mensaProgram(P) {
  const { hw, hd } = P.F;
  const main = P.extDoors.find(d => d.main) || P.extDoors[0];
  const ml = main ? toL(P.F, main.x, main.z) : [-hw, 0];
  // orientation: "front" is the side with the main door
  let fs = 0, ft = 0;
  if (Math.abs(Math.abs(ml[0]) - hw) < Math.abs(Math.abs(ml[1]) - hd)) fs = Math.sign(ml[0]); else ft = Math.sign(ml[1]);
  // helpers in front-relative coords: f = depth from front wall (0 at front), g = lateral
  const depth = fs ? hw * 2 : hd * 2, width = fs ? hd * 2 : hw * 2;
  const FG = (f, g) => fs ? [fs * (hw - f), g] : [g, ft * (hd - f)];
  const fdir = fs ? [-fs, 0] : [0, -ft];      // from front towards back
  const gdir = fs ? [0, 1] : [1, 0];
  P.accessible = 2;
  const lat0 = -width / 2, lat1 = width / 2;
  // stairwell near the front, on the side away from the main door
  const doorG = fs ? ml[1] : ml[0];
  const stG = doorG > 0 ? lat0 + 2.4 : lat1 - 2.4;
  const stS = FG(1.2, stG);
  // stairwell axis runs from front towards back (dir along -fs or -ft), open towards the hall
  // stair body against the front wall, open towards the hall
  const st = fs ? P.stairwell(fs * (hw - 8.4), fs, stG, 0, 1, true, 's') : P.stairwell(ft * (hd - 8.4), ft, stG, 0, 1, true, 't');
  for (let k = 0; k <= 1; k++) {
    const y = P.Y(k);
    // service counters along the back wall (EG), cafeteria bar on 1.OG
    const backF = depth - 4.2;
    if (k === 0) {
      const cl = Math.min(width * 0.62, 38);
      for (let g = -cl / 2; g <= cl / 2; g += 2.5) {
        const [s, t] = FG(backF, g);
        if (P.inside(s, t, 0.8)) P.item('counter', s, t, 0, -fdir[0], -fdir[1]);
      }
      // staff behind the counter
      for (let g = -cl / 2 + 3; g <= cl / 2 - 2; g += 7) { const [s, t] = FG(backF + 1.3, g); if (P.inside(s, t, 0.5)) P.npcSpots.push({ kind: 'staff', ...xz(P.W(s, t)), y, yaw: Math.atan2(-(P.F.uz * fdir[0] + P.F.vz * fdir[1]), -(P.F.ux * fdir[0] + P.F.vx * fdir[1])) }); }
      // wall behind the counters (kitchen), with a service door
      const kw0 = FG(backF + 2.2, -width / 2), kw1 = FG(backF + 2.2, width / 2);
      P.wall(kw0[0], kw0[1], kw1[0], kw1[1], 0, { color: 0xe8e3d8 });
      const lbl = FG(backF + 2.1, 0);
      P.label(lbl[0], lbl[1], 0, 'Essensausgabe', '取餐台', -fdir[0], -fdir[1], 2.6);
      // cashiers
      for (let i = -1; i <= 1; i++) { const [s, t] = FG(backF - 3.2, i * 4.5 + (cl / 2 - 6) * 0.3); if (P.inside(s, t, 0.8)) P.item('kasse', s, t, 0, fdir[0], fdir[1]); }
      const kl = FG(backF - 3.2, 0); P.label(kl[0], kl[1], 0, 'Kasse', '收银台', fdir[0], fdir[1], 2.4);
      // tray return on the far side
      const tr = FG(depth * 0.45, doorG > 0 ? lat1 - 0.9 : lat0 + 0.9);
      if (P.inside(tr[0], tr[1], 0.4)) { P.item('trayreturn', tr[0], tr[1], 0, gdir[0] * (doorG > 0 ? -1 : 1), gdir[1] * (doorG > 0 ? -1 : 1)); P.label(tr[0], tr[1], 0, 'Geschirrrückgabe', '餐具回收', gdir[0] * (doorG > 0 ? -1 : 1), gdir[1] * (doorG > 0 ? -1 : 1), 2.3); }
      // card top-up machines + notice board near the entrance
      for (const dg of [2.8, 4.0]) { const [s, t] = FG(0.75, doorG + (doorG > 0 ? -dg : dg)); if (P.inside(s, t, 0.3)) P.item('aufwerter', s, t, 0, fdir[0], fdir[1]); }
      const nb = FG(0.4, doorG + (doorG > 0 ? -6.5 : 6.5)); if (P.inside(nb[0], nb[1], 0.2)) P.item('pinboard', nb[0], nb[1], 0, fdir[0], fdir[1]);
    } else {
      const [s, t] = FG(depth - 4, 0);
      if (P.inside(s, t, 0.8)) { P.item('cafebar', s, t, 1, -fdir[0], -fdir[1]); P.label(s, t, 1, 'Cafeteria', ROOM_NAMES.cafeteria.zh, -fdir[0], -fdir[1], 2.5); }
    }
    // structural columns on a 7.5 m grid
    for (let f = 7.5; f < depth - 5; f += 7.5) for (let g = -width / 2 + 7.5; g < width / 2 - 3; g += 7.5) {
      const [s, t] = FG(f, g);
      if (P.inside(s, t, 1.5) && !inStair(st, s, t, 1.2)) P.item('column', s, t, k, 1, 0, { h: P.ceil(k) - P.Y(k) });
    }
    // tables (4-seat and long 8-seat), aisles every other row
    const f0 = k === 0 ? 8.5 : 3.5, f1 = depth - (k === 0 ? 10 : 7);
    let row = 0;
    for (let f = f0; f < f1; f += 2.6, row++) {
      if (row % 3 === 2) continue; // aisle
      for (let g = -width / 2 + 2.5; g < width / 2 - 2; g += 2.2) {
        const [s, t] = FG(f, g);
        if (!P.inside(s, t, 1.4) || inStair(st, s, t, 1.6) || nearColumn(P, s, t, k)) continue;
        if (Math.abs(g - doorG) < 2.0 || Math.abs(g) < 1.5 || Math.abs(g - stG) < 2.6) continue; // walkways
        P.item('mtable', s, t, k, gdir[0], gdir[1]);
        if (P.r() < 0.45) {
          const side = P.r() < 0.5 ? 1 : -1;
          const cp = FG(f + side * 0.62, g + (P.r() - 0.5) * 0.8);
          P.npcSpots.push({ kind: 'eat', ...xz(P.W(cp[0], cp[1])), y, yaw: Math.atan2(-(P.F.uz * fdir[0] + P.F.vz * fdir[1]) * side, -(P.F.ux * fdir[0] + P.F.vx * fdir[1]) * side) });
        }
      }
    }
    // lights grid
    for (let f = 3; f < depth - 2; f += 4.5) for (let g = -width / 2 + 3; g < width / 2 - 2; g += 4.5) { const [s, t] = FG(f, g); if (P.inside(s, t, 1)) P.light(s, t, k, 1.2, 1.2); }
    P.room('mensa', k, -hw, -hd, hw, hd);
  }
  const lb = FG(0.25, doorG + (doorG > 0 ? -1.8 : 1.8));
  P.label(lb[0], lb[1], 0, 'Mensa Erlangen-Süd', '南区食堂', fdir[0], fdir[1], 2.7);
  P.finalizeFloors();
  // walk test across the hall to the stairs and up
  const a = FG(3, doorG), b = FG(depth - 11, doorG), c = FG(depth - 11, 0), d = FG(depth - 8.5, 0);
  P.tests.push({ name: 'mensa hall', from: { ...xz(P.W(a[0], a[1])), y: 0 }, points: [xz(P.W(b[0], b[1])), xz(P.W(c[0], c[1])), xz(P.W(d[0], d[1])), xz(P.W(a[0], a[1]))] });
}
function inStair(st, s, t, m) { return st && s > st.s0 - m && s < st.s1 + m && t > st.t0 - m && t < st.t1 + m; }
function nearColumn(P, s, t, k) {
  const p = P.W(s, t);
  return P.furn.some(f => f.type === 'column' && f.level === k && Math.hypot(f.x - p[0], f.z - p[1]) < 1.3);
}

// ---- Lecture hall building: foyer + two tiered halls (double height) ----
function lectureProgram(P) {
  const { hw, hd } = P.F;
  const main = P.extDoors.find(d => d.main) || P.extDoors[0];
  const ml = main ? toL(P.F, main.x, main.z) : [-hw, 0];
  let fs = 0, ft = 0;
  if (Math.abs(Math.abs(ml[0]) - hw) < Math.abs(Math.abs(ml[1]) - hd)) fs = Math.sign(ml[0]); else ft = Math.sign(ml[1]);
  const depth = fs ? hw * 2 : hd * 2, width = fs ? hd * 2 : hw * 2;
  const FG = (f, g) => fs ? [fs * (hw - f), g] : [g, ft * (hd - f)];
  const fd = fs ? [-fs, 0] : [0, -ft];
  const gd = fs ? [0, 1] : [1, 0];
  P.accessible = 1;
  const foyer = 11;
  const H = P.topY - 0.6; // halls use the full height
  // wall between foyer and halls with doors into each hall (front-side entrances near lectern)
  const halls = [];
  const hallW = Math.min(26, width / 2 - 3);
  const gaps = [-width / 4, width / 4];
  const wp0 = FG(foyer, -width / 2), wp1 = FG(foyer, width / 2);
  const doors = [];
  for (const gc of gaps) { doors.push({ at: gc - hallW / 2 + 1.6 + width / 2, w: 1.8, glass: false }); doors.push({ at: gc + hallW / 2 - 1.6 + width / 2, w: 1.8 }); }
  P.wall(wp0[0], wp0[1], wp1[0], wp1[1], 0, { doors, y1: H, color: 0xd8d2c6 });
  // walls between the two halls and around
  const back = Math.min(depth - 3, foyer + 24);
  for (const [i, gc] of gaps.entries()) {
    const g0 = gc - hallW / 2, g1 = gc + hallW / 2;
    const a = FG(foyer, g0), b = FG(back, g0), c = FG(back, g1), d = FG(foyer, g1);
    P.wall(a[0], a[1], b[0], b[1], 0, { y1: H, color: 0xd8d2c6 });
    P.wall(d[0], d[1], c[0], c[1], 0, { y1: H, color: 0xd8d2c6 });
    P.wall(b[0], b[1], c[0], c[1], 0, { y1: H, color: 0xd8d2c6 });
    halls.push({ g0, g1, f0: foyer, f1: back, name: i === 0 ? 'Großer Hörsaal' : 'Kleiner Hörsaal' });
  }
  // tiers: the front (near the foyer) has the lectern, rows rise towards the back
  for (const h of halls) {
    const rows = Math.floor((h.f1 - h.f0 - 5.5) / 1.0);
    const rise = 0.26;
    const f0 = h.f0 + 4.5;
    for (let r = 0; r < rows; r++) {
      const fa = f0 + r * 1.0, fb = h.f1 - 0.15;
      const p = [FG(fa, h.g0 + 0.15), FG(fb, h.g0 + 0.15), FG(fb, h.g1 - 0.15), FG(fa, h.g1 - 0.15)].map(q => P.W(q[0], q[1]));
      const y = (r + 1) * rise;
      P.tiers.push({ poly: p, y, level: 0 });
      P.floors.push({ poly: p, y, thick: rise, kind: 'tier', level: 0 });
      // seat row blocks between aisles (aisles at both sides and in the middle)
      const aisle = 1.3, mid = (h.g0 + h.g1) / 2;
      for (const [ga, gb] of [[h.g0 + aisle, mid - aisle / 2], [mid + aisle / 2, h.g1 - aisle]]) {
        const c = FG(fa + 0.5, (ga + gb) / 2);
        P.item('seatrow', c[0], c[1], 0, -fd[0], -fd[1], { y, len: gb - ga, rowBlock: true });
        if (P.r() < 0.6) {
          const n = 1 + Math.floor(P.r() * 3);
          for (let q = 0; q < n; q++) {
            const sp = FG(fa + 0.55, ga + 0.4 + P.r() * (gb - ga - 0.8));
            P.npcSpots.push({ kind: 'lecture', ...xz(P.W(sp[0], sp[1])), y: y, yaw: Math.atan2(-(P.F.uz * fd[0] + P.F.vz * fd[1]), -(P.F.ux * fd[0] + P.F.vx * fd[1])) });
          }
        }
      }
    }
    // lectern + boards on the front wall
    const lc = FG(h.f0 + 2.2, (h.g0 + h.g1) / 2 + 3);
    P.item('lectern', lc[0], lc[1], 0, fd[0], fd[1]);
    const bc = FG(h.f0 + 0.2, (h.g0 + h.g1) / 2);
    P.item('bigboard', bc[0], bc[1], 0, fd[0], fd[1], { len: Math.min(10, h.g1 - h.g0 - 6) });
    P.item('screen', bc[0], bc[1], 0, fd[0], fd[1], { y: 3.1, len: 6 });
    const lb = FG(h.f0 - 0.1, h.g0 + 0.2 + 1.6 + 1.3);
    P.label(lb[0], lb[1], 0, h.name, ROOM_NAMES.hoersaal.zh, fd[0] * -1, fd[1] * -1, 2.45);
    for (let f = h.f0 + 2; f < h.f1 - 1; f += 4) for (let g = h.g0 + 2; g < h.g1 - 1; g += 4) { const [s, t] = FG(f, g); P.lights.push({ ...xz(P.W(s, t)), y: H - 0.05, w: 1.2, d: 1.2, yaw: 0, level: 0 }); }
    P.room('hoersaal', 0, ...FG(h.f0, h.g0), ...FG(h.f1, h.g1));
    // test: walk from the foyer through the side door, up the aisle to the back row and back
    const d0 = FG(foyer - 1.5, h.g0 + 1.6), d1 = FG(foyer + 1.5, h.g0 + 0.8), up = FG(h.f1 - 1.2, h.g0 + 0.7);
    P.tests.push({ name: `lecture hall ${h.name}`, from: { ...xz(P.W(d0[0], d0[1])), y: 0 }, points: [xz(P.W(d1[0], d1[1])), xz(P.W(up[0], up[1])), xz(P.W(d1[0], d1[1])), xz(P.W(d0[0], d0[1]))] });
  }
  // foyer furniture + lights
  for (let g = -width / 2 + 3; g < width / 2 - 2; g += 4.5) { const [s, t] = FG(foyer / 2, g); if (P.inside(s, t, 1)) P.light(s, t, 0, 1.2, 1.2); }
  for (const g of [-width / 3, 0, width / 3]) { const [s, t] = FG(foyer / 2 + 1, g); if (P.inside(s, t, 1.2)) { P.item('bench', s, t, 0, fd[0], fd[1]); P.npcSpots.push({ kind: 'stand', ...xz(P.W(...FG(foyer / 2 - 1, g + 1.5))), y: 0, yaw: 0 }); } }
  const lb = FG(0.25, (fs ? ml[1] : ml[0]) + 2.2);
  P.label(lb[0], lb[1], 0, 'Hörsaalgebäude', '报告厅楼', fd[0], fd[1], 2.7);
  // 1.OG slab only above the foyer (halls are double height)
  // foyer slab = inner outline clipped to the foyer band (f <= foyer)
  const fdW = [P.F.ux * fd[0] + P.F.vx * fd[1], P.F.uz * fd[0] + P.F.vz * fd[1]];
  const front = P.W(...FG(0, 0));
  const fpoly = clipHalf(P.inner, fdW[0], fdW[1], fdW[0] * front[0] + fdW[1] * front[1] + foyer);
  P.floors.push({ poly: P.inner, y: 0, thick: SLAB, kind: 'floor', level: 0, holes: [] });
  P.floors.push({ poly: fpoly, y: P.Y(1), thick: SLAB, kind: 'ceilingOnly', level: 1, holes: [], clipTo: P.inner });
}

// Keep the part of a polygon where n·p <= c (Sutherland–Hodgman, one plane)
function clipHalf(poly, nx, nz, c) {
  const out = [];
  const inside = p => p[0] * nx + p[1] * nz <= c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const da = a[0] * nx + a[1] * nz - c, db = b[0] * nx + b[1] * nz - c, t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function rrzeRooms(k, idx, w) {
  if (k === 0) return w >= 9 ? 'cip' : w >= 7 ? 'seminar' : idx % 4 === 1 ? 'service' : 'buero';
  return w >= 9 ? 'uebung' : w >= 7 ? 'besprechung' : 'buero';
}
function mathRooms(k, idx, w) {
  if (k === 0) return w >= 9 ? 'seminar' : w >= 7 ? 'uebung' : idx % 3 === 0 ? 'lernraum' : 'seminar';
  if (k === 1) return w >= 9 ? 'bibliothek' : w >= 7 ? 'seminar' : 'buero';
  return w >= 9 ? 'seminar' : w >= 7 ? (idx % 2 ? 'besprechung' : 'uebung') : idx % 5 === 0 ? 'sekretariat' : 'buero';
}

// ---------------- entry points ----------------
export function buildPlans(world) {
  const all = world.buildings;
  for (const b of all) if (!b._bb) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of b.p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } b._bb = [x0, z0, x1, z1]; }
  const plans = [];
  for (const spec of ENTERABLE) {
    const bIdx = all.findIndex(b => b.id === spec.id);
    if (bIdx < 0) continue;
    const P = new Plan(world, spec, bIdx, all);
    // other OSM parts lying (mostly) inside this part are hidden – the interior replaces them
    all.forEach((o, i) => {
      if (i === bIdx || o.mh > 2.3) return;
      const bb = o._bb, pb = P.b._bb;
      if (bb[2] < pb[0] || bb[0] > pb[2] || bb[3] < pb[1] || bb[1] > pb[3]) return;
      let n = 0, inside = 0;
      for (let x = bb[0]; x <= bb[2]; x += 0.7) for (let z = bb[1]; z <= bb[3]; z += 0.7) {
        if (!pointInPoly(x, z, o.p)) continue; n++; if (pointInPoly(x, z, P.poly)) inside++;
      }
      if (n && inside / n > 0.5) P.buildingIdx.push(i);
    });
    P.absorbed = new Set(P.buildingIdx.map(i => all[i]));
    P.shell();
    // exterior doors from real OSM entrance nodes on this part
    const ents = world.entrances.filter(e => e.b === bIdx);
    ents.sort((a, b) => (b.k === 'main') - (a.k === 'main'));
    for (const e of ents.slice(0, 3)) P.extDoor(e.x, e.z, e.k === 'main' ? 2.4 : 2.0, e.k === 'main');
    if (!P.extDoors.length) {
      // no mapped entrance: use the middle of the longest non-party edge
      const e = P.ext.filter(x => x && !x.party).sort((a, b) => b.len - a.len)[0];
      if (e) P.extDoor((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, 2.4, true);
    }
    if (spec.program === 'math') ringProgram(P, { topLevel: Math.min(P.levels - 1, 4), roomKind: mathRooms, server: false });
    else if (spec.program === 'rrze') ringProgram(P, { topLevel: Math.min(P.levels - 1, 1), roomKind: rrzeRooms, server: true });
    else if (spec.program === 'mensa') mensaProgram(P);
    else if (spec.program === 'lecture') lectureProgram(P);
    // walk-in test for every exterior door
    for (const d of P.extDoors) {
      const out = { x: d.x + d.nx * 3, z: d.z + d.nz * 3 }, inn = { x: d.x - d.nx * 2.2, z: d.z - d.nz * 2.2 };
      P.tests.push({ name: `${P.key} door ${d.edge}`, from: { ...out, y: 0 }, points: [inn, out] });
    }
    plans.push(P);
  }
  // connecting doors between adjacent enterable parts (e.g. Mensa ↔ Hörsaalgebäude)
  for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) connect(plans[i], plans[j]);
  return plans;
}

function connect(A, B) {
  for (const ea of A.ext) {
    if (!ea || !ea.party || ea.len < 4) continue;
    for (const eb of B.ext) {
      if (!eb || !eb.party || eb.len < 4) continue;
      // collinear & overlapping?
      const ux = (ea.b[0] - ea.a[0]) / ea.len, uz = (ea.b[1] - ea.a[1]) / ea.len;
      const d1 = Math.abs((eb.a[0] - ea.a[0]) * uz - (eb.a[1] - ea.a[1]) * ux), d2 = Math.abs((eb.b[0] - ea.a[0]) * uz - (eb.b[1] - ea.a[1]) * ux);
      if (d1 > 0.6 || d2 > 0.6) continue;
      const pa = (eb.a[0] - ea.a[0]) * ux + (eb.a[1] - ea.a[1]) * uz, pb = (eb.b[0] - ea.a[0]) * ux + (eb.b[1] - ea.a[1]) * uz;
      const o0 = Math.max(0, Math.min(pa, pb)), o1 = Math.min(ea.len, Math.max(pa, pb));
      if (o1 - o0 < 4) continue;
      const mainA = A.extDoors.find(d => d.main) || A.extDoors[0], mainB = B.extDoors.find(d => d.main) || B.extDoors[0];
      const cost = at => { const x = ea.a[0] + ux * at, z = ea.a[1] + uz * at; return (mainA ? Math.hypot(mainA.x - x, mainA.z - z) : 0) + (mainB ? Math.hypot(mainB.x - x, mainB.z - z) : 0); };
      const at = cost(o0 + 1.8) < cost(o1 - 1.8) ? o0 + 1.8 : o1 - 1.8;
      const x = ea.a[0] + ux * at, z = ea.a[1] + uz * at;
      // both plans must be free at that spot on the inside
      ea.openings.push({ d0: at - 1.1, d1: at + 1.1, y0: -0.01, y1: 2.6, door: true, inner: true });
      const ubx = (eb.b[0] - eb.a[0]) / eb.len, ubz = (eb.b[1] - eb.a[1]) / eb.len;
      const atb = (x - eb.a[0]) * ubx + (z - eb.a[1]) * ubz;
      eb.openings.push({ d0: atb - 1.1, d1: atb + 1.1, y0: -0.01, y1: 2.6, door: true, inner: true });
      A.links = (A.links || []).concat({ x, z, to: B.key }); B.links = (B.links || []).concat({ x, z, to: A.key });
      A.tests.push({ name: `${A.key}↔${B.key} link`, from: { x: x + ea.nx * -2.5, z: z + ea.nz * -2.5, y: 0 }, points: [{ x: x + ea.nx * 2.5, z: z + ea.nz * 2.5 }, { x: x - ea.nx * 2.5, z: z - ea.nz * 2.5 }] });
      return;
    }
  }
}

// Colliders from plans. Returns plans (with .buildingIdx) so callers can skip those buildings.
export function buildInteriorColliders(world, cw, plans = null) {
  plans = plans || buildPlans(world);
  for (const P of plans) {
    // exterior shell with openings (thick so the camera never touches the inner face)
    for (const e of P.ext) {
      if (!e) continue;
      const w = { a: e.a, b: e.b, len: e.len, y0: 0, y1: P.topY + 1, openings: e.openings };
      for (const pc of wallPieces(w)) {
        const ux = (e.b[0] - e.a[0]) / e.len, uz = (e.b[1] - e.a[1]) / e.len;
        cw.addSegment(e.a[0] + ux * pc.d0, e.a[1] + uz * pc.d0, e.a[0] + ux * pc.d1, e.a[1] + uz * pc.d1, pc.y0, pc.y1, 0.62, 'ext:' + P.key);
      }
    }
    for (const w of P.walls) {
      const ux = (w.b[0] - w.a[0]) / w.len, uz = (w.b[1] - w.a[1]) / w.len;
      for (const pc of wallPieces(w)) cw.addSegment(w.a[0] + ux * pc.d0, w.a[1] + uz * pc.d0, w.a[0] + ux * pc.d1, w.a[1] + uz * pc.d1, pc.y0, pc.y1, Math.max(w.t, 0.14), 'wall:' + P.key);
    }
    for (const f of P.floors) {
      if (f.kind === 'floor' && f.level === 0) continue; // ground floor = terrain
      if (f.kind === 'ceilingOnly') { cw.addFloor(f.poly, f.y, f.thick, null, 'slab'); continue; }
      cw.addFloor(f.poly, f.y, f.thick, f.holes && f.holes.length ? f.holes : null, f.kind);
    }
    // roof slab (ceiling of the top floor)
    cw.addFloor(P.inner, P.topY, 0.6, null, 'roof');
    for (const r of P.ramps) cw.addRamp(r.cx, r.cz, r.ux, r.uz, r.hl, r.hw, r.y0, r.y1, 'stairs');
    for (const r of P.rails) cw.addSegment(r.a[0], r.a[1], r.b[0], r.b[1], r.y, r.y + r.h, 0.08, 'rail');
    for (const it of P.furn) {
      const c = FURN_COLLIDER[it.type];
      if (!c) continue;
      const len = it.len ?? c[0];
      cw.addBox(it.x, it.z, len / 2, c[1] / 2, it.yaw + Math.PI / 2, it.y, it.y + (it.h ?? c[2]), !!c[3], it.type);
    }
  }
  return plans;
}

// furniture colliders: [width across facing, depth along facing, height, walkableTop]
// (yaw = facing direction; box local x = perpendicular to facing)
export const FURN_COLLIDER = {
  table: [1.4, 0.7, 0.75], bigtable: [3.6, 1.4, 0.75], desk: [1.6, 0.8, 0.75], pcdesk: [1.4, 0.75, 0.75], mtable: [0.8, 1.6, 0.75],
  studytable: [1.8, 1.0, 0.75], smalltable: [0.8, 0.8, 0.75], shelf: [1.0, 0.4, 2.0], bookshelf: [3.0, 0.5, 2.1], rack: [0.7, 1.1, 2.1],
  counter: [2.5, 0.9, 1.1], kasse: [1.4, 0.8, 1.0], trayreturn: [3.0, 0.9, 1.4], aufwerter: [0.7, 0.5, 1.8], cafebar: [5, 1.0, 1.1],
  kitchen: [2.4, 0.65, 0.95], column: [0.6, 0.6, 3.4], lectern: [1.0, 0.7, 1.1], elevator: [2.2, 2.2, 3.4], bench: [1.8, 0.5, 0.45, true],
  plant: [0.6, 0.6, 1.2], seatrow: [10, 0.85, 0.85], pinboard: [1.5, 0.08, 1.9], board: [3.5, 0.1, 2.1], bigboard: [8, 0.12, 2.6],
};

export function interiorTestRoutes(plans) {
  return plans.flatMap(p => p.tests);
}

// Which plan (and floor) contains point (x,z) at height y
export function planAt(plans, x, z, y) {
  for (const P of plans) {
    if (y > P.topY + 0.5) continue;
    if (pointInPoly(x, z, P.poly)) return { plan: P, level: Math.max(0, Math.min(P.levels - 1, Math.floor((y + 0.6) / P.lh))) };
  }
  return null;
}
