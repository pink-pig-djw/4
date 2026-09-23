// Campus life: walking students & staff on the real footpath network, cyclists on roads,
// people on benches and lawns, diners/queues/staff in the Mensa, students in lecture halls & rooms.
import * as THREE from 'three';
import { PeopleRenderer, randomLook, walkPose, standPose, sitPose, groundPose, cyclePose } from './people.js';
import { FIRST_NAMES, ROLES, pickDialogue } from './dialogues.js';
import { rng, hash2, pointInPoly } from '../shared/geom.js';
import { bikeGeometry } from '../world/props.js';
import { propMaterial } from '../world/shapes.js';
import { globalUniforms } from '../world/materials.js';
import { BIKE_COLORS } from '../world/layout.js';
import { PLAYER } from '../physics/controller.js';
import { groundY } from '../world/terrain.js';

const TAU = Math.PI * 2;
let NEXT_ID = 1;

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
}

export class Crowd {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.r = rng(9001);
    this.renderer = new PeopleRenderer(game.scene, 420);
    this.walkers = []; this.cyclists = []; this.statics = new Map(); // key → person (sitters, indoor)
    this.events = [];
    this._buildNav();
    this._bikes();
    this.setQuality(game.quality);
    this.t = 0;
    this.used = new Set();
    this.target = null;
    // the player's own body (visible in third-person view)
    const look = randomLook(rng(4711), 'student');
    look.backpack = true; look.longHair = false;
    look.colors.top = [0.07, 0.2, 0.42]; look.colors.pants = [0.12, 0.17, 0.27]; look.colors.shoes = [0.92, 0.92, 0.9];
    this.avatar = { id: 0, kind: 'player', ...look, pose: {}, t: 0, phase: 0, umbrella: false, x: 0, y: 0, z: 0, yaw: 0 };
  }

  _avatar(game, dt) {
    const p = game.player, a = this.avatar;
    a.x = p.x; a.y = p.y; a.z = p.z;
    a.yaw = Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw));
    a.t += dt;
    a.umbrella = (game.weather.current.rain || 0) > 0.5 && !game.indoor;
    if (!p.onGround) { walkPose(a.pose, 1.2, 0.6); a.pose.shinL = -0.9; a.pose.shinR = -0.5; }
    else if (p.speed > 0.3) { a.phase += p.speed * dt / 1.32 * TAU; walkPose(a.pose, a.phase, Math.min(1, p.speed / 2.2)); a.pose.lean = p.speed > 3.5 ? 0.22 : 0.05; }
    else standPose(a.pose, a.t, 0);
    return a;
  }

  setQuality(q) {
    this.maxWalkers = q === 'high' ? 110 : q === 'medium' ? 75 : 40;
    this.maxCyclists = q === 'high' ? 22 : q === 'medium' ? 14 : 8;
    this.drawDist = q === 'high' ? 130 : q === 'medium' ? 105 : 75;
    this.renderer.setShadows(q === 'high');
  }

  // ---------- navigation graph ----------
  _buildNav() {
    const N = this.world.nav.n, E = this.world.nav.e;
    this.nodes = N;
    this.adj = N.map(() => []);
    for (const [a, b, f, w] of E) {
      this.adj[a].push({ to: b, f, w });
      this.adj[b].push({ to: a, f, w });
    }
    // spatial grid of nodes for spawning
    this.grid = new Map();
    N.forEach((p, i) => {
      if (!this.adj[i].length) return;
      const k = Math.floor(p[0] / 40) * 1000 + Math.floor(p[1] / 40);
      let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(i);
    });
    // weight nodes near university buildings (campus life happens there)
    const uni = this.world.outlines.filter(o => o.k === 'university').map(o => o.p[0]);
    this.nodeW = N.map(p => {
      let w = 0.25;
      for (const c of uni) if (Math.abs(c[0] - p[0]) < 90 && Math.abs(c[1] - p[1]) < 90) { w = 1; break; }
      return w;
    });
    // entrances used as origins/destinations
    this.doors = this.world.entrances.filter(e => e.k === 'main' || e.k === 'yes').map(e => ({ x: e.x + e.nx * 1.2, z: e.z + e.nz * 1.2, nx: e.nx, nz: e.nz, b: e.b }));
    const mhb = this.game.plans?.find(p => p.key === 'mensa');
    this.mensaDoor = mhb && (mhb.extDoors.find(d => d.main) || mhb.extDoors[0]);
  }

  _nodesNear(x, z, rMin, rMax, filterFlag) {
    const out = [];
    const c0 = Math.floor((x - rMax) / 40), c1 = Math.floor((x + rMax) / 40), d0 = Math.floor((z - rMax) / 40), d1 = Math.floor((z + rMax) / 40);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
      const a = this.grid.get(i * 1000 + j); if (!a) continue;
      for (const n of a) {
        const p = this.nodes[n], d = Math.hypot(p[0] - x, p[1] - z);
        if (d < rMin || d > rMax) continue;
        if (filterFlag && !this.adj[n].some(e => e.f & filterFlag)) continue;
        out.push(n);
      }
    }
    return out;
  }

  _bikes() {
    const geo = bikeGeometry();
    this.bikeMesh = new THREE.InstancedMesh(geo, propMaterial(globalUniforms), 40);
    this.bikeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(40 * 3), 3);
    this.bikeMesh.frustumCulled = false; this.bikeMesh.castShadow = true; this.bikeMesh.count = 0;
    this.game.scene.add(this.bikeMesh);
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color();
  }

  // height of the walkable surface under (x, z), continuing from the previous height
  _gy(x, z, prev = null) {
    const t = groundY(x, z);
    const h = this.game.cw.groundHeight(x, z, (prev ?? t) + 0.5);
    return Number.isFinite(h) ? h : t;
  }

  // ---------- people factory ----------
  _person(kind, role = 'student') {
    const r = this.r;
    const look = randomLook(r, role);
    const female = r() < 0.5;
    return {
      id: NEXT_ID++, kind, role, female, x: 0, y: 0, z: 0, yaw: 0, speed: 1.2 + r() * 0.35, phase: r() * TAU,
      pose: {}, t: r() * 100, talk: false, ...look, umbrella: false,
    };
  }

  // environment factors from weather
  _factors() {
    const w = this.game.weather.current;
    const night = w.night, rain = w.rain;
    return {
      people: Math.max(0.2, (w.crowd ?? 1)) * (1 - night * 0.55),
      sit: Math.max(0, 1 - rain * 1.5) * (1 - night * 0.85),
      lawn: Math.max(0, 1 - rain * 2 - (w.wet || 0)) * (1 - night) * (this.game.weather.name === 'overcast' ? 0.5 : 1),
      umbrella: rain > 0.5 ? 0.6 : 0,
      night,
    };
  }

  // ---------- walkers ----------
  _spawnWalker(nearSpawn) {
    const g = this.game, p = g.player, r = this.r;
    const w = this._person('walk', r() < 0.82 ? 'student' : 'staff');
    const F = this._factors();
    w.umbrella = r() < F.umbrella;
    // 30 %: come out of a building door nearby, else start on a path node
    const fromDoor = r() < 0.3 ? this.doors.filter(d => { const dd = Math.hypot(d.x - p.x, d.z - p.z); return dd > 25 && dd < 110; }) : [];
    if (fromDoor.length) {
      const d = fromDoor[Math.floor(r() * fromDoor.length)];
      w.x = d.x; w.z = d.z; w.y = this._gy(w.x, w.z); w.yaw = Math.atan2(d.nz, d.nx);
      // join the nearest path node
      const cand = this._nodesNear(d.x, d.z, 0, 30, 1);
      if (!cand.length) return null;
      cand.sort((a, b) => Math.hypot(this.nodes[a][0] - d.x, this.nodes[a][1] - d.z) - Math.hypot(this.nodes[b][0] - d.x, this.nodes[b][1] - d.z));
      w.from = -1; w.to = cand[0]; w.direct = { x: this.nodes[cand[0]][0], z: this.nodes[cand[0]][1] };
    } else {
      const cand = this._nodesNear(p.x, p.z, nearSpawn ? 12 : 45, nearSpawn ? 90 : 150, 1);
      if (!cand.length) return null;
      // weighted pick favouring the campus
      let tot = 0; for (const n of cand) tot += this.nodeW[n];
      let v = r() * tot, pick = cand[0];
      for (const n of cand) { v -= this.nodeW[n]; if (v <= 0) { pick = n; break; } }
      const opts = this.adj[pick].filter(e => e.f & 1);
      if (!opts.length) return null;
      const e = opts[Math.floor(r() * opts.length)];
      w.from = pick; w.to = e.to; w.edge = e;
      const a = this.nodes[pick], b = this.nodes[e.to];
      const f = r();
      w.x = a[0] + (b[0] - a[0]) * f; w.z = a[1] + (b[1] - a[1]) * f; w.y = this._gy(w.x, w.z);
      w.yaw = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
    // some walkers head for the Mensa (daytime)
    if (this.mensaDoor && F.night < 0.5 && r() < 0.28) w.goal = { x: this.mensaDoor.x + this.mensaDoor.nx * 1.6, z: this.mensaDoor.z + this.mensaDoor.nz * 1.6, enter: true };
    w.side = r() < 0.85 ? 1 : -1; // mostly keep right
    w.lateral = 0.3 + r() * 0.5;
    return w;
  }

  _nextEdge(w) {
    const r = this.r;
    const at = w.to;
    const opts = this.adj[at].filter(e => (e.f & 1) && e.to !== w.from);
    const all = opts.length ? opts : this.adj[at].filter(e => e.f & 1);
    if (!all.length) return false;
    const cur = this.nodes[at];
    const dx = cur[0] - w.x, dz = cur[1] - w.z;
    let best = null;
    if (w.goal && r() < 0.75) {
      let bd = Infinity;
      for (const e of all) { const q = this.nodes[e.to]; const d = Math.hypot(q[0] - w.goal.x, q[1] - w.goal.z); if (d < bd) { bd = d; best = e; } }
      // don't wander away if the goal is behind
      if (best && Math.hypot(cur[0] - w.goal.x, cur[1] - w.goal.z) < bd - 1) best = null;
    }
    if (!best) {
      let tot = 0; const ws = [];
      for (const e of all) {
        const q = this.nodes[e.to];
        const ex = q[0] - cur[0], ez = q[1] - cur[1], l = Math.hypot(ex, ez) || 1, dl = Math.hypot(dx, dz) || 1;
        const straight = (ex * dx + ez * dz) / (l * dl);
        const wt = (1 + 2.2 * Math.max(0, straight)) * (0.3 + this.nodeW[e.to]);
        ws.push(wt); tot += wt;
      }
      let v = r() * tot; best = all[0];
      for (let i = 0; i < all.length; i++) { v -= ws[i]; if (v <= 0) { best = all[i]; break; } }
    }
    w.from = at; w.to = best.to; w.edge = best;
    return true;
  }

  _targetOf(w) {
    if (w.direct) return w.direct;
    const a = this.nodes[w.from], b = this.nodes[w.to];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const rx = -dz / l, rz = dx / l; // right-hand side
    const e = w.edge;
    let off;
    if (e.f & 8) off = (e.f & 4) ? e.w / 2 + 1.0 : Math.max(0.5, e.w / 2 - 0.6);
    else off = Math.min(w.lateral, e.w / 3);
    off *= w.side;
    return { x: b[0] + rx * off, z: b[1] + rz * off };
  }

  _updateWalker(w, dt, near) {
    const g = this.game, p = g.player;
    if (w.talk) {
      w.yaw = angleLerp(w.yaw, Math.atan2(p.z - w.z, p.x - w.x), Math.min(1, dt * 6));
      standPose(w.pose, w.t += dt, 1);
      return true;
    }
    // goal reached → enter building
    if (w.goal && Math.hypot(w.goal.x - w.x, w.goal.z - w.z) < 7) w.direct = { x: w.goal.x, z: w.goal.z, final: true };
    const tg = this._targetOf(w);
    let dx = tg.x - w.x, dz = tg.z - w.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.7) {
      if (w.direct && w.direct.final) return false; // went inside
      w.direct = null;
      if (w.from === -1) { w.from = w.to; const ok = this._nextEdge(w); if (!ok) return false; }
      else if (!this._nextEdge(w)) return false;
      return true;
    }
    let ux = dx / d, uz = dz / d;
    // avoid the player: slow down and step aside
    let speed = w.speed;
    const pdx = p.x - w.x, pdz = p.z - w.z, pd = Math.hypot(pdx, pdz);
    if (pd < 2.2 && Math.abs(p.y - w.y) < 1.5) {
      const ahead = (pdx * ux + pdz * uz) / (pd || 1);
      if (ahead > 0.3) { speed *= Math.max(0.2, (pd - 0.8) / 1.4); ux += -uz * 0.6; uz += ux * 0.6; }
    }
    // separation from other walkers
    if (near) for (const o of this.walkers) {
      if (o === w) continue;
      const ox = w.x - o.x, oz = w.z - o.z, od = ox * ox + oz * oz;
      if (od < 0.64 && od > 1e-4) { const k = (0.8 - Math.sqrt(od)) * 0.8; ux += ox * k; uz += oz * k; }
    }
    const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    let nx = w.x + ux * speed * dt, nz = w.z + uz * speed * dt;
    if (near) {
      const res = g.cw.resolve(nx, nz, 0.26, w.y, w.y + 1.7, PLAYER.stepUp);
      const moved = Math.hypot(res.x - w.x, res.z - w.z);
      if (moved < speed * dt * 0.25) { w.stuck = (w.stuck || 0) + dt; } else w.stuck = 0;
      nx = res.x; nz = res.z;
      if (w.stuck > 1.2) { w.stuck = 0; w.direct = null; const t = w.to; w.to = w.from >= 0 ? w.from : w.to; w.from = t; }
    }
    const moveD = Math.hypot(nx - w.x, nz - w.z);
    w.x = nx; w.z = nz; w.y = this._gy(nx, nz, w.y);
    w.yaw = angleLerp(w.yaw, Math.atan2(uz, ux), Math.min(1, dt * 5));
    w.phase += moveD / 1.32 * TAU;
    walkPose(w.pose, w.phase, Math.min(1, moveD / (dt * 1.1 + 1e-6)));
    return true;
  }

  // ---------- cyclists ----------
  _spawnCyclist() {
    const g = this.game, p = g.player, r = this.r;
    const cand = this._nodesNear(p.x, p.z, 60, 170, 2);
    if (!cand.length) return null;
    const n0 = cand[Math.floor(r() * cand.length)];
    const opts = this.adj[n0].filter(e => e.f & 2);
    if (!opts.length) return null;
    const e = opts[Math.floor(r() * opts.length)];
    const c = this._person('cycle', 'student');
    c.backpack = r() < 0.5;
    c.umbrella = false;
    c.from = n0; c.to = e.to; c.edge = e;
    const a = this.nodes[n0];
    c.x = a[0]; c.z = a[1]; c.y = this._gy(c.x, c.z); c.speed = 3.8 + r() * 1.8; c.crank = 0;
    c.bikeColor = BIKE_COLORS[Math.floor(r() * BIKE_COLORS.length)];
    c.rang = 0;
    return c;
  }
  _nextBikeEdge(c) {
    const r = this.r;
    const opts = this.adj[c.to].filter(e => (e.f & 2) && e.to !== c.from);
    const all = opts.length ? opts : this.adj[c.to].filter(e => e.f & 2);
    if (!all.length) return false;
    const cur = this.nodes[c.to], prev = this.nodes[c.from];
    const dx = cur[0] - prev[0], dz = cur[1] - prev[1], dl = Math.hypot(dx, dz) || 1;
    let best = all[0], bs = -Infinity;
    for (const e of all) {
      const q = this.nodes[e.to]; const ex = q[0] - cur[0], ez = q[1] - cur[1], l = Math.hypot(ex, ez) || 1;
      const s = (ex * dx + ez * dz) / (l * dl) + r() * 0.9 + ((e.f & 8) || e.w > 2 ? 0.2 : 0);
      if (s > bs) { bs = s; best = e; }
    }
    c.from = c.to; c.to = best.to; c.edge = best;
    return true;
  }
  _updateCyclist(c, dt) {
    const p = this.game.player;
    const a = this.nodes[c.from], b = this.nodes[c.to];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const rx = -dz / l, rz = dx / l;
    const e = c.edge;
    const off = (e.f & 8) ? Math.max(0.6, e.w / 2 - 0.9) : Math.min(0.5, e.w / 4);
    const tx = b[0] + rx * off, tz = b[1] + rz * off;
    let vx = tx - c.x, vz = tz - c.z, d = Math.hypot(vx, vz);
    if (d < 1.2) { if (!this._nextBikeEdge(c)) return false; return true; }
    vx /= d; vz /= d;
    let speed = c.speed;
    // brake for the player / ring the bell
    const pdx = p.x - c.x, pdz = p.z - c.z, pd = Math.hypot(pdx, pdz);
    if (pd < 16 && Math.abs(p.y - c.y) < 1.5) {
      const ahead = (pdx * vx + pdz * vz) / (pd || 1);
      const lat = Math.abs(pdx * -vz + pdz * vx);
      if (ahead > 0.6 && lat < 1.6) {
        if (!c.rang && pd < 13) { c.rang = 1; this.events.push({ type: 'bell', x: c.x, z: c.z }); }
        if (pd < 5) speed *= Math.max(0, (pd - 1.6) / 3.4);
      }
    }
    if (pd > 30) c.rang = 0;
    const mv = speed * dt;
    c.x += vx * mv; c.z += vz * mv; c.y = this._gy(c.x, c.z, c.y);
    c.yaw = angleLerp(c.yaw, Math.atan2(vz, vx), Math.min(1, dt * 4));
    c.crank += mv / 2.1 * TAU;
    cyclePose(c.pose, c.crank);
    return true;
  }

  // ---------- static people: benches, lawns, indoors ----------
  _syncStatics() {
    const g = this.game, p = g.player, F = this._factors();
    const want = new Map();
    const R = 95;
    // benches
    for (const [i, s] of g.layout.seats.entries()) {
      if (Math.abs(s.x - p.x) > R || Math.abs(s.z - p.z) > R) continue;
      if (hash2(i * 7 + 1, 3) > 0.38 * F.sit) continue;
      want.set('seat' + i, { kind: 'sit', x: s.x, z: s.z, y: groundY(s.x, s.z), yaw: s.yaw, h: 0.46, tags: ['any'] });
    }
    // lawn groups
    for (const [i, s] of g.layout.lawnSpots.entries()) {
      if (Math.abs(s.x - p.x) > R || Math.abs(s.z - p.z) > R) continue;
      if (hash2(i * 13 + 5, 9) > 0.8 * F.lawn) continue;
      const n = 2 + Math.floor(hash2(i, 77) * 3);
      for (let k = 0; k < n; k++) {
        const a = s.yaw + k / n * TAU;
        want.set(`lawn${i}_${k}`, { kind: 'ground', x: s.x + Math.cos(a) * 0.85, z: s.z + Math.sin(a) * 0.85, y: groundY(s.x + Math.cos(a) * 0.85, s.z + Math.sin(a) * 0.85), yaw: a + Math.PI, tags: ['any', 'study'] });
      }
    }
    // indoors (plans near the player)
    for (const P of g.plans || []) {
      const d = Math.hypot(P.F.cx - p.x, P.F.cz - p.z);
      if (d > 110) continue;
      const tag = P.program === 'mensa' ? 'mensa' : P.program === 'lecture' ? 'lecture' : P.program === 'math' ? 'math' : 'rrze';
      P.npcSpots.forEach((s, i) => {
        const hsh = hash2(i * 31 + P.bIdx, 17);
        const occ = { eat: 0.62, lecture: 0.55, sitChair: 0.5, sitTable: 0.55, staff: 1, stand: 0.7, corridor: 0.45 }[s.kind] ?? 0.4;
        const nightF = s.kind === 'staff' ? (F.night > 0.5 ? 0 : 1) : (1 - F.night * 0.75);
        if (hsh > occ * nightF) return;
        const base = { x: s.x, z: s.z, y: (s.y || 0) + P.base, yaw: s.yaw || 0, tags: [tag, 'study', 'any'], indoor: P };
        if (s.kind === 'eat') want.set(`${P.key}${i}`, { ...base, kind: 'eat', h: 0.46 });
        else if (s.kind === 'lecture') want.set(`${P.key}${i}`, { ...base, kind: 'sit', h: 0.46 });
        else if (s.kind === 'sitChair' || s.kind === 'sitTable') want.set(`${P.key}${i}`, { ...base, kind: 'sit', h: 0.46 });
        else if (s.kind === 'staff') want.set(`${P.key}${i}`, { ...base, kind: 'stand', role: 'mensa', tags: ['mensastaff'] });
        else want.set(`${P.key}${i}`, { ...base, kind: 'stand', yaw: hsh * TAU });
      });
      // Mensa queue at the cashiers
      if (P.program === 'mensa' && F.night < 0.5) {
        P.furn.filter(f => f.type === 'kasse').forEach((k, ki) => {
          const fx = Math.cos(k.yaw), fz = Math.sin(k.yaw);
          for (let q = 0; q < 3; q++) {
            if (hash2(ki * 5 + q, 41) > 0.8) continue;
            want.set(`q${P.key}${ki}_${q}`, { kind: 'stand', tray: true, indoor: P, x: k.x + fx * (1.3 + q * 0.85) + -fz * 0.9, z: k.z + fz * (1.3 + q * 0.85) + fx * 0.9, y: P.base, yaw: k.yaw + Math.PI, tags: ['mensa'] });
          }
        });
      }
    }
    // add / remove
    for (const [k, person] of this.statics) if (!want.has(k) && !person.talk) this.statics.delete(k);
    for (const [k, spec] of want) {
      if (this.statics.has(k)) continue;
      const rr = rng(Math.floor(hash2(k.length * 131, k.charCodeAt(k.length - 1) * 7 + k.charCodeAt(0)) * 1e9) + k.length);
      const look = randomLook(rr, spec.role || (rr() < 0.85 ? 'student' : 'staff'));
      this.statics.set(k, { id: NEXT_ID++, female: rr() < 0.5, role: spec.role || 'student', pose: {}, t: rr() * 100, talk: false, umbrella: false, ...look, ...spec });
    }
  }

  // ---------- main update ----------
  update(dt, game) {
    this.t += dt;
    const p = game.player;
    const F = this._factors();
    // population control
    const wantW = Math.round(this.maxWalkers * F.people);
    if (this.walkers.length < wantW && (this.walkers.length < wantW * 0.5 || this.r() < 0.25)) {
      const w = this._spawnWalker(this.walkers.length < wantW * 0.4 && this.t < 3);
      if (w) this.walkers.push(w);
    }
    const wantC = Math.round(this.maxCyclists * F.people * (1 - (game.weather.current.rain || 0) * 0.7));
    if (this.cyclists.length < wantC && this.r() < 0.08) { const c = this._spawnCyclist(); if (c) this.cyclists.push(c); }
    this.syncT = (this.syncT || 0) - dt;
    if (this.syncT <= 0) { this.syncT = 0.7; this._syncStatics(); }
    // Mensa door flow: people leaving the Mensa
    if (this.mensaDoor && F.night < 0.5 && this.r() < dt * 0.35 && this.walkers.length < wantW + 6) {
      const d = this.mensaDoor;
      if (Math.hypot(d.x - p.x, d.z - p.z) < 120) {
        const w = this._spawnWalker(false);
        if (w) {
          w.x = d.x + d.nx * 1.2; w.z = d.z + d.nz * 1.2; w.y = this._gy(w.x, w.z); w.yaw = Math.atan2(d.nz, d.nx); w.goal = null;
          const cand = this._nodesNear(w.x, w.z, 0, 35, 1).sort((a, b) => Math.hypot(this.nodes[a][0] - w.x, this.nodes[a][1] - w.z) - Math.hypot(this.nodes[b][0] - w.x, this.nodes[b][1] - w.z));
          if (cand.length) { w.from = -1; w.to = cand[0]; w.direct = { x: this.nodes[cand[0]][0], z: this.nodes[cand[0]][1] }; this.walkers.push(w); }
        }
      }
    }
    // update + cull
    const R2 = 190 * 190;
    this.walkers = this.walkers.filter(w => {
      const dx = w.x - p.x, dz = w.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 > R2 && !w.talk) return false;
      return this._updateWalker(w, dt, d2 < 70 * 70);
    });
    this.cyclists = this.cyclists.filter(c => {
      const dx = c.x - p.x, dz = c.z - p.z;
      if (dx * dx + dz * dz > 230 * 230) return false;
      return this._updateCyclist(c, dt);
    });
    for (const s of this.statics.values()) {
      s.t += dt;
      if (s.talk) s.yaw = angleLerp(s.yaw, Math.atan2(p.z - s.z, p.x - s.x), Math.min(1, dt * 3));
      if (s.kind === 'sit') sitPose(s.pose, s.t, s.h, 0);
      else if (s.kind === 'eat') sitPose(s.pose, s.t, s.h, 1);
      else if (s.kind === 'ground') groundPose(s.pose, s.t);
      else standPose(s.pose, s.t, s.talk ? 1 : (Math.sin(s.t * 0.3 + s.id) > 0.7 ? 1 : 0));
    }
    // player cannot walk through people
    this._pushPlayer(p);
    this._render(game);
    this._interactTarget(game);
  }

  _pushPlayer(p) {
    const push = (q) => {
      if (Math.abs(q.y - p.y) > 1.2) return;
      const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz), min = PLAYER.radius + 0.28;
      if (d < min && d > 1e-4) {
        const nx = p.x + dx / d * (min - d), nz = p.z + dz / d * (min - d);
        if (this.game.cw.isFree(nx, nz, PLAYER.radius * 0.95, p.y, p.y + PLAYER.height)) { p.x = nx; p.z = nz; }
      }
    };
    for (const w of this.walkers) push(w);
    for (const s of this.statics.values()) if (s.kind === 'stand') push(s);
  }

  _render(game) {
    const cam = game.camera.position;
    const fx = -Math.sin(game.player.yaw), fz = -Math.cos(game.player.yaw);
    const R = this.drawDist, R2 = R * R;
    const r = this.renderer;
    r.begin();
    const visible = q => {
      const dx = q.x - cam.x, dz = q.z - cam.z, d2 = dx * dx + dz * dz;
      if (d2 > R2) return false;
      if (d2 > 64 && (dx * fx + dz * fz) / Math.sqrt(d2) < -0.35) return false; // behind the camera
      return true;
    };
    if (game.viewMode === 'third') r.add(this._avatar(game, game._dt || 0.016));
    for (const w of this.walkers) if (visible(w)) r.add(w);
    const inPlan = game.indoor && game.indoor.plan;
    for (const s of this.statics.values()) {
      if (!visible(s)) continue;
      // people inside buildings: when we're outdoors (or in another building) only the ones near the windows matter
      if (s.indoor && s.indoor !== inPlan && !(inPlan && (inPlan.links || []).some(l => l.to === s.indoor.key))) {
        if ((s.x - cam.x) ** 2 + (s.z - cam.z) ** 2 > 30 * 30) continue;
      }
      r.add(s);
    }
    let bi = 0;
    for (const c of this.cyclists) {
      if (!visible(c)) continue;
      // bike under the rider
      const bx = c.x, bz = c.z;
      this._q.setFromAxisAngle(this._v.set(0, 1, 0), -c.yaw);
      this._m4.compose(this._v.set(bx, c.y, bz), this._q, this._s);
      this.bikeMesh.setMatrixAt(bi, this._m4);
      this._c.set(c.bikeColor); this.bikeMesh.setColorAt(bi, this._c);
      bi++;
      // rider sits above the saddle (slightly behind the bike centre)
      const ox = Math.cos(c.yaw) * -0.16, oz = Math.sin(c.yaw) * -0.16;
      const rider = { ...c, x: bx + ox, z: bz + oz };
      r.add(rider);
      if (bi >= 40) break;
    }
    this.bikeMesh.count = bi;
    this.bikeMesh.instanceMatrix.needsUpdate = true;
    if (this.bikeMesh.instanceColor) this.bikeMesh.instanceColor.needsUpdate = true;
    r.end();
  }

  _interactTarget(game) {
    const p = game.player;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let best = null, bs = Infinity;
    const test = q => {
      if (Math.abs(q.y - p.y) > 1.3) return;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > 2.8 || d < 0.1) return;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < 0.8) return;
      const score = d * (2 - dot);
      if (score < bs) { bs = score; best = q; }
    };
    for (const w of this.walkers) test(w);
    for (const s of this.statics.values()) test(s);
    this.target = best;
  }

  // identity used by the dialogue UI
  identity(q) {
    if (!q.name) {
      const rr = rng(q.id * 977 + 13);
      q.name = (q.female ? FIRST_NAMES.f : FIRST_NAMES.m)[Math.floor(rr() * 20)];
      const pool = ROLES[q.role] || ROLES.student;
      q.roleText = pool[Math.floor(rr() * pool.length)];
    }
    return { name: q.name, role: q.roleText };
  }

  dialogueFor(q) {
    const g = this.game;
    const tags = [...(q.tags || ['any'])];
    if (q.role === 'mensa') tags.push('mensastaff');
    // where: focus area (Südgelände / Tennenlohe / Altstadt) and the Schlossgarten
    let area = null;
    for (const f of g.world.meta.focus || []) { const [x0, z0, x1, z1] = f.b; if (q.x >= x0 && q.x <= x1 && q.z >= z0 && q.z <= z1) { area = f.n.toLowerCase(); break; } }
    if (area) tags.push(area);
    if ((g.world.parks || []).some(k => k.n.startsWith('Schlossgarten') && pointInPoly(q.x, q.z, k.p))) tags.push('schlossgarten');
    if (q.role === 'staff') tags.push(area === 'altstadt' ? 'staffalt' : 'staff');
    const w = g.weather.name;
    if (w === 'rain') tags.push('rain'); if (w === 'night') tags.push('night'); if (w === 'autumn') tags.push('autumn');
    const L = g.layout;
    if (L.racks.some(rk => Math.abs(rk.x - q.x) < 25 && Math.abs(rk.z - q.z) < 25)) tags.push('bike');
    if (L.stops.some(s => Math.abs(s.x - q.x) < 20 && Math.abs(s.z - q.z) < 20)) tags.push('bus');
    if (g.indoor) { const pr = g.indoor.plan.program; tags.push(pr === 'mensa' ? 'mensa' : pr === 'lecture' ? 'lecture' : pr === 'math' ? 'math' : pr === 'aula' ? 'aula' : 'rrze', 'study'); }
    if (!q.dialogue) {
      q.dialogue = pickDialogue(tags, rng(q.id * 31 + 7), this.used);
      this.used.add(q.dialogue.id);
      if (this.used.size > 20) this.used.clear();
    }
    return q.dialogue;
  }

  positions() { return this.walkers; }
  dots() {
    const out = [];
    for (const w of this.walkers) out.push(w);
    for (const c of this.cyclists) out.push(c);
    return out;
  }
}
