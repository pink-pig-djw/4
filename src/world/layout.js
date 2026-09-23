// Deterministic placement of street furniture, trees, parked cars … from the OSM-derived data.
// Pure JS: used by the renderer (props/vegetation) AND by the collision builder / Node walk test,
// so every collider corresponds to a visible object and vice versa.
import { rng, pointInPoly, obb, polyBounds, distSegSq, area as polyArea } from '../shared/geom.js';
import { RoadIndex } from '../shared/roadindex.js';
import { SPECIES, assignSpecies, MAX_SCALE } from './trees/species.js';

const MOTOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
export const CAR_COLORS = ['#b8babc', '#1d1e21', '#e8e8e5', '#4b4e53', '#22324f', '#8c2323', '#40608f', '#6f7275', '#c9c7c0', '#2d3b2f'];
export const BIKE_COLORS = ['#1d1e21', '#2c4f8c', '#8c2a2a', '#d9d9d6', '#3f6b45', '#6d6f73', '#c7962f', '#5b3f7a', '#20646b', '#b6b8ba'];

class BuildingIndex {
  constructor(buildings, cell = 25) {
    this.cell = cell; this.grid = new Map(); this.b = buildings;
    buildings.forEach((b, i) => {
      if (b.mh > 2.3) return;
      const [x0, z0, x1, z1] = polyBounds(b.p);
      b._bb = [x0, z0, x1, z1];
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++)
        for (let gz = Math.floor(z0 / cell); gz <= Math.floor(z1 / cell); gz++) {
          const k = gx * 100003 + gz; let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(i);
        }
    });
  }
  // distance from point to nearest building wall (negative if inside), searched within R
  clearance(x, z, R = 6) {
    let best = R;
    const c = this.cell;
    for (let gx = Math.floor((x - R) / c); gx <= Math.floor((x + R) / c); gx++)
      for (let gz = Math.floor((z - R) / c); gz <= Math.floor((z + R) / c); gz++) {
        const a = this.grid.get(gx * 100003 + gz); if (!a) continue;
        for (const i of a) {
          const b = this.b[i]; if (b.k === 'roof') continue;
          const bb = b._bb;
          if (x < bb[0] - R || x > bb[2] + R || z < bb[1] - R || z > bb[3] + R) continue;
          if (pointInPoly(x, z, b.p)) return -1;
          for (let k = 0; k < b.p.length; k++) {
            const p = b.p[k], q = b.p[(k + 1) % b.p.length];
            const d = Math.sqrt(distSegSq(x, z, p[0], p[1], q[0], q[1]));
            if (d < best) best = d;
          }
        }
      }
    return best;
  }
}

class AreaIndex {
  constructor(areas, cell = 40) {
    this.cell = cell; this.grid = new Map(); this.a = areas;
    areas.forEach((a, i) => {
      const [x0, z0, x1, z1] = polyBounds(a.p); a._bb = [x0, z0, x1, z1];
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++)
        for (let gz = Math.floor(z0 / cell); gz <= Math.floor(z1 / cell); gz++) {
          const k = gx * 100003 + gz; let arr = this.grid.get(k); if (!arr) this.grid.set(k, arr = []); arr.push(i);
        }
    });
  }
  kindAt(x, z) {
    const arr = this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    let best = null;
    if (!arr) return null;
    for (const i of arr) {
      const a = this.a[i], bb = a._bb;
      if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
      if (!pointInPoly(x, z, a.p)) continue;
      if (a.hl && a.hl.some(h => pointInPoly(x, z, h))) continue;
      if (!best || a.o > best.o) best = a;
    }
    return best ? best.k : null;
  }
  hasKind(x, z, kind) {
    const arr = this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    if (!arr) return false;
    for (const i of arr) {
      const a = this.a[i], bb = a._bb;
      if (a.k !== kind || x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
      if (pointInPoly(x, z, a.p) && !(a.hl && a.hl.some(h => pointInPoly(x, z, h)))) return true;
    }
    return false;
  }
}

// x-intervals where the horizontal line z lies inside the polygon (+ holes, even-odd rule)
function rowIntervals(rings, z) {
  const xs = [];
  for (const ring of rings) for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
  }
  xs.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

// Trees scattered through mapped forest (9 m) and scrub (12 m), clear of roads and buildings.
// Deterministic per area, so the renderer and the Node walk test agree. → [x, z, type, h]
function scatterForest(world, ri, bi) {
  const out = [];
  world.areas.forEach((ar, ai) => {
    if (ar.k !== 'forest' && ar.k !== 'scrub') return;
    const R = rng(12345 + ai * 7919);
    const sp = ar.k === 'forest' ? 9 : 12;
    const rings = [ar.p, ...(ar.hl || [])];
    let z0 = Infinity, z1 = -Infinity;
    for (const p of ar.p) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    for (let z = Math.ceil(z0 / sp) * sp; z < z1; z += sp) {
      for (const [xa, xb] of rowIntervals(rings, z + sp * 0.5)) {
        for (let x = Math.ceil(xa / sp) * sp; x < xb; x += sp) {
          const px = x + (R() - 0.5) * sp * 0.9, pz = z + sp * 0.5 + (R() - 0.5) * sp * 0.9, t = R();
          if (px < xa + 0.5 || px > xb - 0.5) continue;
          if (ri.intrusion(px, pz, 1.5)) continue;
          if (bi.clearance(px, pz, 2) < 0.8) continue;
          out.push([px, pz, ar.k === 'forest' ? (t < 0.35 ? 1 : 0) : 3, 0, 1]);
        }
      }
    }
  });
  return out;
}

// Move a point off road surfaces (so furniture never blocks a path). Returns [x,z] or null if impossible.
function nudgeOffRoads(ri, bi, x, z, margin, minBuilding = 0.4) {
  for (let it = 0; it < 4; it++) {
    const hit = ri.intrusion(x, z, margin);
    if (!hit) break;
    x += hit.nx * (hit.depth + 0.02); z += hit.nz * (hit.depth + 0.02);
  }
  if (ri.intrusion(x, z, margin * 0.8)) return null;
  if (bi.clearance(x, z, 3) < minBuilding) return null;
  return [x, z];
}

export function computeLayout(world) {
  const ri = new RoadIndex(world.roads.filter(r => r.k !== 'steps'));
  const bi = new BuildingIndex(world.buildings);
  const ai = new AreaIndex(world.areas);
  const r = rng(20240917);
  const L = {
    trees: [], benches: [], racks: [], lamps: [], stops: [], bins: [], misc: [], bollards: [], cars: [], stallLines: [],
    streetSigns: [], buildingSigns: [], signals: [], seats: [], lawnSpots: [], roadIndex: ri, buildingIndex: bi, areaIndex: ai,
  };

  // ---- trees ----
  // k: 0 broadleaf, 1 conifer, 2 shrub (walk-through); sp: species (see trees/species.js)
  for (const t of world.trees.concat(scatterForest(world, ri, bi))) {
    let [x, z, type, h, scattered] = t;
    const forest = scattered ? type !== 3 : ai.hasKind(x, z, 'forest');
    const sp = assignSpecies(x, z, type, forest, r());
    const S = SPECIES[sp];
    const k = sp === 'shrub' ? 2 : S.evergreen ? 1 : 0;
    let s;
    if (k === 2) s = 0.6 + r() * 0.7;
    else if (h > 0) s = h / S.h;
    else s = forest ? 0.8 + r() * 0.4 : 0.62 + r() * 0.5;
    s = Math.min(Math.max(s, 0.45), MAX_SCALE[sp]);
    const rot = r() * Math.PI * 2, sy = 0.92 + r() * 0.16, ci = r();
    if (k !== 2 && !scattered) {
      const p = nudgeOffRoads(ri, bi, x, z, 0.45, 0.3);
      if (!p) continue;
      [x, z] = p;
    }
    L.trees.push({ x, z, k, sp, s, rot, sy, ci, v: r() < 0.5 ? 0 : 1 });
  }

  // ---- barriers (hedges, fences, walls) ----
  // Pieces between gates and wherever a mapped path or road crosses (there is always an opening
  // in reality). Shared by the renderer and the colliders.
  L.barrierPieces = [];
  for (const b of world.barriers) {
    if (b.k === 'retaining_wall') continue;
    const gates = new Set(b.g || []);
    for (let i = 0; i < b.p.length - 1; i++) {
      const [ax, az] = b.p[i], [bx, bz] = b.p[i + 1];
      const Ls = Math.hypot(bx - ax, bz - az); if (Ls < 0.05) continue;
      const ux = (bx - ax) / Ls, uz = (bz - az) / Ls;
      let s0 = 0, s1 = Ls;
      if (gates.has(i)) s0 = Math.min(Ls, 1.6);
      if (gates.has(i + 1)) s1 = Math.max(s0, Ls - 1.6);
      if (s1 - s0 < 0.05) continue;
      const n = Math.max(1, Math.ceil((s1 - s0) / 0.4));
      let start = null;
      for (let k = 0; k <= n; k++) {
        const s = s0 + (s1 - s0) * k / n;
        const hit = ri.intrusion(ax + ux * s, az + uz * s, -0.2);
        if (!hit && start == null) start = s;
        if ((hit || k === n) && start != null) {
          const end = hit ? Math.max(start, s - (s1 - s0) / n) : s;
          if (end - start > 0.3) L.barrierPieces.push({ k: b.k, h: b.h, id: L.barrierPieces.length, a: [ax + ux * start, az + uz * start], b: [ax + ux * end, az + uz * end] });
          start = null;
        }
      }
    }
  }

  // ---- benches ----
  for (const [bx, bz, yaw, type, back] of world.benches) {
    const p = nudgeOffRoads(ri, bi, bx, bz, 0.5, 0.2);
    if (!p) continue;
    const b = { x: p[0], z: p[1], yaw, type, back };
    L.benches.push(b);
    if (type === 0) {
      // seats for NPCs: bench faces +yaw direction; seats along the bench axis
      const fx = Math.cos(yaw), fz = Math.sin(yaw), ax = -fz, az = fx;
      for (const o of [-0.55, 0.55]) L.seats.push({ x: p[0] + ax * o - fx * 0.05, z: p[1] + az * o - fz * 0.05, yaw, y: 0.45, bench: L.benches.length - 1 });
    }
  }

  // ---- bicycle racks ----
  // Each stand is checked individually (stand + bikes reach ~1 m to both sides); stands that would
  // reach into a path or wall are dropped, the rest form contiguous rack rows.
  for (const [x0, z0, along, cap, covered] of world.bikes) {
    const n = Math.max(1, Math.min(24, Math.ceil(cap / 2)));
    const ux = Math.cos(along), uz = Math.sin(along);
    const vx = -uz, vz = ux;
    // nudge the whole row off the nearest path first
    let x = x0, z = z0;
    for (let it = 0; it < 4; it++) {
      const hit = ri.intrusion(x, z, 1.35);
      if (!hit) break;
      x += hit.nx * (hit.depth + 0.05); z += hit.nz * (hit.depth + 0.05);
    }
    const standOk = (sx, sz) => {
      for (const t of [-1.05, 0, 1.05]) for (const e of [-0.55, 0.55]) {
        const px = sx + vx * t + ux * e, pz = sz + vz * t + uz * e;
        if (ri.intrusion(px, pz, 0.35) || bi.clearance(px, pz, 1.5) < 0.35) return false;
      }
      return true;
    };
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const cx = run.reduce((a, p) => a + p[0], 0) / run.length, cz = run.reduce((a, p) => a + p[1], 0) / run.length;
      const rack = { x: cx, z: cz, along, n: run.length, covered, bikes: [] };
      for (const [sx, sz] of run) for (const side of [-0.33, 0.33]) {
        if (r() < 0.62) {
          const flip = r() < 0.5 ? 0 : Math.PI;
          rack.bikes.push({ x: sx + ux * side, z: sz + uz * side, yaw: Math.atan2(vz, vx) + flip, c: Math.floor(r() * BIKE_COLORS.length), lean: (r() - 0.5) * 0.06 });
        }
      }
      L.racks.push(rack);
      run = [];
    };
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 1.0;
      const sx = x + ux * o, sz = z + uz * o;
      if (standOk(sx, sz)) run.push([sx, sz]); else flush();
    }
    flush();
  }

  // ---- lamps ----
  for (const [lx, lz, gen] of world.lamps) {
    const p = nudgeOffRoads(ri, bi, lx, lz, 0.35, 0.3);
    if (!p) continue;
    const nr = ri.nearest(p[0], p[1], 20);
    const yaw = nr ? Math.atan2(nr.cz - p[1], nr.cx - p[0]) : 0;
    const major = nr && MOTOR.has(nr.r.k) && nr.r.k !== 'service' && nr.r.k !== 'living_street';
    L.lamps.push({ x: p[0], z: p[1], yaw, h: major ? 8 : 4.5, gen });
  }

  // ---- bus stops ----
  const stopSeen = new Map();
  for (const s of world.stops) {
    const key = (s.n || '') + Math.round(s.x / 15) + ',' + Math.round(s.z / 15);
    if (stopSeen.has(key)) continue;
    stopSeen.set(key, 1);
    const nr = ri.nearest(s.x, s.z, 30, rr => MOTOR.has(rr.k) && rr.k !== 'service');
    let x = s.x, z = s.z, faceYaw = s.yaw;
    if (nr) {
      // pole 0.5 m behind the kerb, facing the road
      let nx = s.x - nr.cx, nz = s.z - nr.cz; const d = Math.hypot(nx, nz) || 1; nx /= d; nz /= d;
      const off = nr.r.w / 2 + (nr.r.sw ? 0.6 : 1.0);
      x = nr.cx + nx * off; z = nr.cz + nz * off;
      faceYaw = Math.atan2(-nz, -nx);
      const stop = { x, z, yaw: faceYaw, along: Math.atan2(nr.uz, nr.ux), name: s.n, shelter: s.sh, nx, nz };
      if (s.sh) {
        // shelter 2.4 m behind the pole line, back wall away from road
        const cx = x + nx * 1.9, cz = z + nz * 1.9;
        if (bi.clearance(cx, cz, 4) > 1.2 && !ri.intrusion(cx, cz, 1.0)) stop.sh = { x: cx, z: cz };
      }
      L.stops.push(stop);
    }
  }

  // ---- bins, misc, bollards ----
  for (const [x, z] of world.bins) { const p = nudgeOffRoads(ri, bi, x, z, 0.3, 0.15); if (p) L.bins.push({ x: p[0], z: p[1] }); }
  for (const [x, z, k, yaw] of world.misc) {
    const p = nudgeOffRoads(ri, bi, x, z, 0.6, 0.2); if (!p) continue;
    L.misc.push({ x: p[0], z: p[1], k, yaw });
  }
  for (const [x, z] of world.bollards) L.bollards.push({ x, z }); // bollards stand on paths by design (gaps between them)

  // ---- street name signs ----
  for (const s of world.streetSigns) {
    const p = nudgeOffRoads(ri, bi, s.x, s.z, 0.4, 0.3); if (!p) continue;
    L.streetSigns.push({ x: p[0], z: p[1], names: s.n, dirs: s.d });
  }

  // ---- traffic lights ----
  for (const [x, z] of world.signals) {
    const nr = ri.nearest(x, z, 8, rr => MOTOR.has(rr.k));
    if (!nr) continue;
    for (const side of [1, -1]) {
      const vx = -nr.uz * side, vz = nr.ux * side;
      const px = nr.cx + vx * (nr.r.w / 2 + 0.7), pz = nr.cz + vz * (nr.r.w / 2 + 0.7);
      if (bi.clearance(px, pz, 2) < 0.5) continue;
      L.signals.push({ x: px, z: pz, yaw: Math.atan2(-vz, -vx) });
      break;
    }
  }

  // ---- building name signs (Uni) next to the main entrance ----
  world.outlines.forEach((o, oi) => {
    if (!o.n || !(o.k === 'university' || /Institut|Zentrum|Lehrstuhl|Department|Gebäude|Hörs|Informatik|Chemikum|Physikum|Biologikum/.test(o.n))) return;
    const ents = o.ents.map(k => world.entrances[k]).sort((a, b) => (b.k === 'main') - (a.k === 'main'));
    const e = ents[0];
    if (!e) return;
    const tx = -e.nz, tz = e.nx;
    for (const side of [1, -1]) {
      const x = e.x + e.nx * 2.2 + tx * 2.6 * side, z = e.z + e.nz * 2.2 + tz * 2.6 * side;
      if (bi.clearance(x, z, 3) < 1.0 || ri.intrusion(x, z, 0.4)) continue;
      L.buildingSigns.push({ x, z, yaw: Math.atan2(e.nz, e.nx), name: o.n, addr: o.a, outline: oi });
      break;
    }
  });

  // ---- parked cars on surface parking ----
  for (const a of world.areas) {
    if (a.k !== 'parking') continue;
    const A = polyArea(a.p);
    if (A < 120) continue;
    const b = obb(a.p);
    const ux = b.ux, uz = b.uz, vx = -uz, vz = ux;
    const pattern = [2.5, 8.5, 13.5]; // row centres within a 16 m period across the short axis (5 m row, 6 m aisle, 5 m row → rows at 2.5 and 13.5)
    const period = 16;
    for (let t0 = -b.hd; t0 < b.hd; t0 += period) {
      for (const rowOff of [2.5, 13.5]) {
        const t = t0 + rowOff;
        if (t > b.hd - 2.4) continue;
        const facing = rowOff < 8 ? 1 : -1;
        for (let s = -b.hw + 1.25; s <= b.hw - 1.25; s += 2.5) {
          const cx = b.cx + ux * s + vx * t, cz = b.cz + uz * s + vz * t;
          // all four corners inside the lot
          let inside = true;
          for (const [ds, dt] of [[-1.2, -2.4], [1.2, -2.4], [1.2, 2.4], [-1.2, 2.4]]) {
            if (!pointInPoly(cx + ux * ds + vx * dt, cz + uz * ds + vz * dt, a.p)) { inside = false; break; }
          }
          if (!inside) continue;
          if (a.hl && a.hl.some(h => pointInPoly(cx, cz, h))) continue;
          if (ri.intrusion(cx, cz, 2.6, rr => rr.k !== 'service' || rr.sv !== 'parking_aisle')) continue;
          if (ri.intrusion(cx, cz, 2.2, rr => rr.sv === 'parking_aisle')) continue;
          if (bi.clearance(cx, cz, 4) < 2.8) continue;
          // stall line on one side
          L.stallLines.push([cx + ux * 1.25 - vx * 2.5, cz + uz * 1.25 - vz * 2.5, cx + ux * 1.25 + vx * 2.5, cz + uz * 1.25 + vz * 2.5]);
          if (r() < 0.66) {
            const type = r() < 0.12 ? 2 : r() < 0.55 ? 0 : 1;
            L.cars.push({ x: cx + (r() - 0.5) * 0.2, z: cz + (r() - 0.5) * 0.2, yaw: Math.atan2(vz * facing, vx * facing) + (r() - 0.5) * 0.06, type, c: Math.floor(r() * CAR_COLORS.length) });
          }
        }
      }
    }
  }

  // ---- lawn spots for sitting students (near university buildings) ----
  const uniCentres = world.outlines.filter(o => o.k === 'university').map(o => o.p[0]);
  const cand = [];
  for (const c of uniCentres) {
    for (let k = 0; k < 10; k++) {
      const x = c[0] + (r() - 0.5) * 80, z = c[1] + (r() - 0.5) * 80;
      cand.push([x, z]);
    }
  }
  const treeGrid = new Map();
  for (const t of L.trees) { const k = Math.floor(t.x / 5) * 100003 + Math.floor(t.z / 5); let a = treeGrid.get(k); if (!a) treeGrid.set(k, a = []); a.push(t); }
  const nearTree = (x, z, d) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = treeGrid.get((Math.floor(x / 5) + i) * 100003 + Math.floor(z / 5) + j); if (!a) continue;
      for (const t of a) if (Math.hypot(t.x - x, t.z - z) < d) return true;
    }
    return false;
  };
  for (const [x, z] of cand) {
    const kind = ai.kindAt(x, z);
    if (kind && kind !== 'grass' && kind !== 'meadow') continue;
    if (ri.intrusion(x, z, 3.0)) continue;
    if (bi.clearance(x, z, 6) < 4) continue;
    if (nearTree(x, z, 2.0)) continue;
    if (L.lawnSpots.some(s => Math.hypot(s.x - x, s.z - z) < 14)) continue;
    L.lawnSpots.push({ x, z, yaw: r() * Math.PI * 2 });
    if (L.lawnSpots.length > 60) break;
  }
  return L;
}
