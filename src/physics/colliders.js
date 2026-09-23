// Builds all static colliders from world data + layout. Pure JS (shared by game and Node walk test).
// Rule: only things that are rendered get a collider, with the same footprint.
import { trunkRadius } from '../world/trees/species.js';
import { groundY as g, bridgeDecks, bridgeRailings, fitSlab, deckRamp } from '../world/terrain.js';

// segment collider following the terrain: long pieces are split so the y-range stays tight
function groundSegment(cw, ax, az, bx, bz, h, thick, tag, below = 0.3) {
  const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 10));
  for (let i = 0; i < n; i++) {
    const x0 = ax + (bx - ax) * i / n, z0 = az + (bz - az) * i / n, x1 = ax + (bx - ax) * (i + 1) / n, z1 = az + (bz - az) * (i + 1) / n;
    const y0 = g(x0, z0), y1 = g(x1, z1), ym = g((x0 + x1) / 2, (z0 + z1) / 2);
    cw.addSegment(x0, z0, x1, z1, Math.min(y0, y1, ym) - below, Math.max(y0, y1, ym) + h, thick, tag);
  }
}

export function addBuildingColliders(world, cw, skip = new Set()) {
  world.buildings.forEach((b, idx) => {
    if (skip.has(idx)) return;
    if (b.mh > 2.3) return;     // overhang / bridge: walk underneath
    if (b.k === 'roof') return; // canopy with unmapped supports: open underneath
    // walls stand on the building's floor level and reach below the lowest ground around it
    const y0 = b.y0 ?? 0, yb = b.yb ?? y0;
    const bottom = b.mh > 0.05 ? y0 + b.mh : Math.min(y0, yb) - 0.5;
    const top = y0 + b.h + 50;
    cw.addPolyline(b.p, bottom, top, 0, true, 'b' + idx);
    for (const h of b.hl || []) cw.addPolyline(h, bottom, top, 0, true, 'b' + idx);
    cw.addSolid(b.p, bottom, top, idx);
  });
}

export function addWorldColliders(world, layout, cw, skipBuildings = new Set()) {
  addBuildingColliders(world, cw, skipBuildings);

  // trees (trunks)
  for (const t of layout.trees) {
    if (t.k === 2) continue; // shrubs are walk-through
    const y = g(t.x, t.z);
    cw.addCircle(t.x, t.z, trunkRadius(t.sp, t.s), y - 0.3, y + 4, 'tree');
  }
  // barriers (hedges, fences, walls) — gaps at gates
  // bridge decks (walkable, a ceiling for whoever passes underneath) with railings
  for (let d of bridgeDecks(world)) {
    if (d.slab && !(d = fitSlab(d))) continue;
    d = deckRamp(d);
    cw.addRamp(d.cx, d.cz, d.ux, d.uz, d.hl, d.hw, d.y0 + (d.slab ? 0 : 0.05), d.y1 + (d.slab ? 0 : 0.05), 'bridge');
  }
  for (const q of bridgeRailings(world)) cw.addSegment(q.ax, q.az, q.bx, q.bz, Math.min(q.ya, q.yb) - 0.5, Math.max(q.ya, q.yb) + 1.15, 0.1, 'railing');
  // fountains (basin rim), statues and monuments (pedestal)
  for (const m of world.monuments || []) {
    const y = g(m.x, m.z);
    if (m.k === 'fountain' && m.c) {
      cw.addCircle(m.x, m.z, Math.max(1.0, Math.min(m.r || 2, 8) * 0.75), y - 0.3, y + 6, 'fountain');
    } else if (m.k === 'fountain') {
      const r = Math.max(1.2, Math.min(m.r || 1.6, 12)), seg = r > 4 ? 16 : 8;
      for (let i = 0; i < seg; i++) {
        const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
        cw.addSegment(m.x + Math.cos(a0) * r, m.z + Math.sin(a0) * r, m.x + Math.cos(a1) * r, m.z + Math.sin(a1) * r, y - 0.3, y + 0.62, 0.45, 'fountain');
      }
      cw.addCircle(m.x, m.z, r > 4 ? r * 0.32 : Math.min(0.62, r * 0.22), y - 0.3, y + 6, 'fountain');
    } else {
      const h = { statue: 0.55, bust: 0.35, sculpture: 0.75, stone: 0.6, monument: 0.6 }[m.k] || 0.6;
      cw.addBox(m.x, m.z, h, h, 0, y - 0.3, y + 2.5, false, m.k);
    }
  }
  for (const pc of layout.barrierPieces) {
    const thick = pc.t ?? (pc.k === 'hedge' ? 0.9 : pc.k === 'wall' || pc.k === 'city_wall' ? 0.3 : 0.08);
    groundSegment(cw, pc.a[0], pc.a[1], pc.b[0], pc.b[1], pc.h, thick, pc.k);
  }
  // ponds: visible water edge, with gaps where a mapped path/bridge crosses the water
  const ri = layout.roadIndex;
  for (const a of world.areas) {
    if (a.k !== 'water') continue;
    const p = a.p;
    for (let i = 0; i < p.length; i++) {
      const A = p[i], B = p[(i + 1) % p.length];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 0.05) continue;
      const n = Math.max(1, Math.ceil(L / 0.4));
      let start = null;
      for (let k = 0; k <= n; k++) {
        const f = k / n, x = A[0] + (B[0] - A[0]) * f, z = A[1] + (B[1] - A[1]) * f;
        const onPath = ri && ri.intrusion(x, z, 0.5);
        if (!onPath && start == null) start = f;
        if ((onPath || k === n) && start != null) {
          const end = onPath ? Math.max(start, f - 1 / n) : f;
          if (end > start) groundSegment(cw, A[0] + (B[0] - A[0]) * start, A[1] + (B[1] - A[1]) * start, A[0] + (B[0] - A[0]) * end, A[1] + (B[1] - A[1]) * end, 1.2, 0, 'water');
          start = null;
        }
      }
    }
  }
  // benches: seat is a walkable box, backrest blocks
  for (const b of layout.benches) {
    const fx = Math.cos(b.yaw), fz = Math.sin(b.yaw);
    const ang = Math.atan2(-fx, fz); // bench long axis perpendicular to facing
    const y = g(b.x, b.z);
    if (b.type === 1) { cw.addBox(b.x, b.z, 0.9, 0.8, ang, y - 0.2, y + 0.75, true, 'table'); continue; }
    if (b.type === 2) { cw.addBox(b.x, b.z, 0.35, 1.0, ang, y - 0.2, y + 0.4, true, 'lounger'); continue; }
    cw.addBox(b.x, b.z, 0.9, 0.27, ang, y - 0.2, y + 0.46, true, 'bench');
    if (b.back) cw.addBox(b.x - fx * 0.24, b.z - fz * 0.24, 0.9, 0.05, ang, y + 0.46, y + 0.9, false, 'bench');
  }
  // bike racks: whole row incl. parked bikes
  for (const r of layout.racks) {
    const hx = r.n * 0.5 + 0.2, y = g(r.x, r.z);
    cw.addBox(r.x, r.z, hx, 0.95, r.along, y - 0.3, y + 1.1, false, 'bikes');
  }
  const circ = (x, z, r, h, tag) => { const y = g(x, z); cw.addCircle(x, z, r, y - 0.3, y + h, tag); };
  for (const l of layout.lamps) circ(l.x, l.z, 0.14, l.h, 'lamp');
  for (const b of layout.bins) circ(b.x, b.z, 0.22, 0.9, 'bin');
  for (const b of layout.bollards) circ(b.x, b.z, 0.1, 0.9, 'bollard');
  for (const s of layout.streetSigns) circ(s.x, s.z, 0.07, 3, 'sign');
  for (const s of layout.signals) circ(s.x, s.z, 0.1, 3.5, 'signal');
  for (const s of layout.buildingSigns) { const y = g(s.x, s.z); cw.addBox(s.x, s.z, 0.9, 0.12, Math.atan2(-Math.cos(s.yaw), Math.sin(s.yaw)), y - 0.3, y + 2.3, false, 'bsign'); }
  for (const m of layout.misc) {
    const sz = MISC_SIZE[m.k];
    if (!sz) continue;
    const y = g(m.x, m.z);
    cw.addBox(m.x, m.z, sz[0] / 2, sz[1] / 2, m.yaw + Math.PI / 2, y - 0.3, y + sz[2], false, m.k);
  }
  for (const s of layout.stops) {
    circ(s.x, s.z, 0.07, 3, 'stop');
    if (s.sh) {
      const y = g(s.sh.x, s.sh.z);
      // shelter: back wall (away from road) + two short side walls, open to the road
      const nx = s.nx, nz = s.nz, tx = -nz, tz = nx;
      const bx = s.sh.x + nx * 0.7, bz = s.sh.z + nz * 0.7;
      cw.addSegment(bx - tx * 1.8, bz - tz * 1.8, bx + tx * 1.8, bz + tz * 1.8, y - 0.3, y + 2.4, 0.06, 'shelter');
      for (const sgn of [-1, 1]) {
        const ex = s.sh.x + tx * 1.8 * sgn, ez = s.sh.z + tz * 1.8 * sgn;
        cw.addSegment(ex + nx * 0.7, ez + nz * 0.7, ex - nx * 0.3, ez - nz * 0.3, y - 0.3, y + 2.4, 0.06, 'shelter');
      }
    }
  }
  for (const c of layout.cars) {
    const d = CAR_DIMS[c.type], y = g(c.x, c.z);
    cw.addBox(c.x, c.z, d[0] / 2, d[1] / 2, c.yaw, y - 0.3, y + d[2], false, 'car');
  }
}

// width (along facing-perpendicular), depth, height
export const MISC_SIZE = {
  vending_machine: [1.0, 0.8, 1.9], post_box: [0.55, 0.45, 1.3], recycling: [4.2, 1.7, 1.7], bicycle_repair_station: [0.3, 0.3, 1.5],
  charging_station: [0.5, 0.4, 1.6], grit_bin: [1.0, 0.7, 0.8], street_cabinet: [0.9, 0.4, 1.3],
};
// car dims: length, width, height  (collider box: along yaw = length)
export const CAR_DIMS = [[4.3, 1.8, 1.48], [4.7, 1.85, 1.46], [5.2, 2.0, 2.1]];
