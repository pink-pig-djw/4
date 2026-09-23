// Builds all static colliders from world data + layout. Pure JS (shared by game and Node walk test).
// Rule: only things that are rendered get a collider, with the same footprint.
import { trunkRadius } from '../world/trees/species.js';

export function addBuildingColliders(world, cw, skip = new Set()) {
  world.buildings.forEach((b, idx) => {
    if (skip.has(idx)) return;
    if (b.mh > 2.3) return;     // overhang / bridge: walk underneath
    if (b.k === 'roof') return; // canopy with unmapped supports: open underneath
    const top = b.h + 50;
    cw.addPolyline(b.p, b.mh, top, 0, true, 'b' + idx);
    for (const h of b.hl || []) cw.addPolyline(h, b.mh, top, 0, true, 'b' + idx);
    cw.addSolid(b.p, b.mh, top, idx);
  });
}

export function addWorldColliders(world, layout, cw, skipBuildings = new Set()) {
  addBuildingColliders(world, cw, skipBuildings);

  // trees (trunks)
  for (const t of layout.trees) {
    if (t.k === 2) continue; // shrubs are walk-through
    cw.addCircle(t.x, t.z, trunkRadius(t.sp, t.s), 0, 4, 'tree');
  }
  // barriers (hedges, fences, walls) — gaps at gates
  for (const b of world.barriers) {
    if (b.k === 'retaining_wall') continue;
    const thick = b.k === 'hedge' ? 0.9 : b.k === 'wall' ? 0.3 : 0.08;
    const gates = new Set(b.g || []);
    for (let i = 0; i < b.p.length - 1; i++) {
      let [ax, az] = b.p[i], [bx, bz] = b.p[i + 1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      let s0 = 0, s1 = L;
      if (gates.has(i)) s0 = Math.min(L, 1.6);
      if (gates.has(i + 1)) s1 = Math.max(s0, L - 1.6);
      if (s1 - s0 < 0.05) continue;
      cw.addSegment(ax + ux * s0, az + uz * s0, ax + ux * s1, az + uz * s1, 0, b.h, thick, b.k);
    }
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
          if (end > start) cw.addSegment(A[0] + (B[0] - A[0]) * start, A[1] + (B[1] - A[1]) * start, A[0] + (B[0] - A[0]) * end, A[1] + (B[1] - A[1]) * end, 0, 1.2, 0, 'water');
          start = null;
        }
      }
    }
  }
  // benches: seat is a walkable box, backrest blocks
  for (const b of layout.benches) {
    const fx = Math.cos(b.yaw), fz = Math.sin(b.yaw);
    const ang = Math.atan2(-fx, fz); // bench long axis perpendicular to facing
    if (b.type === 1) { cw.addBox(b.x, b.z, 0.9, 0.8, ang, 0, 0.75, true, 'table'); continue; }
    if (b.type === 2) { cw.addBox(b.x, b.z, 0.35, 1.0, ang, 0, 0.4, true, 'lounger'); continue; }
    cw.addBox(b.x, b.z, 0.9, 0.27, ang, 0, 0.46, true, 'bench');
    if (b.back) cw.addBox(b.x - fx * 0.24, b.z - fz * 0.24, 0.9, 0.05, ang, 0.46, 0.9, false, 'bench');
  }
  // bike racks: whole row incl. parked bikes
  for (const r of layout.racks) {
    const hx = r.n * 0.5 + 0.2;
    cw.addBox(r.x, r.z, hx, 0.95, r.along, 0, 1.1, false, 'bikes');
  }
  for (const l of layout.lamps) cw.addCircle(l.x, l.z, 0.14, 0, l.h, 'lamp');
  for (const b of layout.bins) cw.addCircle(b.x, b.z, 0.22, 0, 0.9, 'bin');
  for (const b of layout.bollards) cw.addCircle(b.x, b.z, 0.1, 0, 0.9, 'bollard');
  for (const s of layout.streetSigns) cw.addCircle(s.x, s.z, 0.07, 0, 3, 'sign');
  for (const s of layout.signals) cw.addCircle(s.x, s.z, 0.1, 0, 3.5, 'signal');
  for (const s of layout.buildingSigns) cw.addBox(s.x, s.z, 0.9, 0.12, Math.atan2(-Math.cos(s.yaw), Math.sin(s.yaw)) , 0, 2.3, false, 'bsign');
  for (const m of layout.misc) {
    const sz = MISC_SIZE[m.k];
    if (!sz) continue;
    cw.addBox(m.x, m.z, sz[0] / 2, sz[1] / 2, m.yaw + Math.PI / 2, 0, sz[2], false, m.k);
  }
  for (const s of layout.stops) {
    cw.addCircle(s.x, s.z, 0.07, 0, 3, 'stop');
    if (s.sh) {
      // shelter: back wall (away from road) + two short side walls, open to the road
      const nx = s.nx, nz = s.nz, tx = -nz, tz = nx;
      const bx = s.sh.x + nx * 0.7, bz = s.sh.z + nz * 0.7;
      cw.addSegment(bx - tx * 1.8, bz - tz * 1.8, bx + tx * 1.8, bz + tz * 1.8, 0, 2.4, 0.06, 'shelter');
      for (const sgn of [-1, 1]) {
        const ex = s.sh.x + tx * 1.8 * sgn, ez = s.sh.z + tz * 1.8 * sgn;
        cw.addSegment(ex + nx * 0.7, ez + nz * 0.7, ex - nx * 0.3, ez - nz * 0.3, 0, 2.4, 0.06, 'shelter');
      }
    }
  }
  for (const c of layout.cars) {
    const d = CAR_DIMS[c.type];
    cw.addBox(c.x, c.z, d[0] / 2, d[1] / 2, c.yaw, 0, d[2], false, 'car');
  }
}

// width (along facing-perpendicular), depth, height
export const MISC_SIZE = {
  vending_machine: [1.0, 0.8, 1.9], post_box: [0.55, 0.45, 1.3], recycling: [4.2, 1.7, 1.7], bicycle_repair_station: [0.3, 0.3, 1.5],
  charging_station: [0.5, 0.4, 1.6], grit_bin: [1.0, 0.7, 0.8], street_cabinet: [0.9, 0.4, 1.3],
};
// car dims: length, width, height  (collider box: along yaw = length)
export const CAR_DIMS = [[4.3, 1.8, 1.48], [4.7, 1.85, 1.46], [5.2, 2.0, 2.1]];
