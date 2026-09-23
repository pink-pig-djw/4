// Static collision world for a walking character (vertical cylinder).
// Pure JS (no three.js) so the same code runs in the browser and in the Node walk test.
//
// Obstacles are vertical prisms with a y-range. Something blocks horizontal movement only when its
// top is higher than the step height above the feet and its bottom is below the head.
// Walkable surfaces (terrain y=0, floors, ramps, box tops) are queried by groundHeight().
import { pointInPoly, distSegSq } from '../shared/geom.js';

const SEG = 0, CIRCLE = 1, BOX = 2;

export class CollisionWorld {
  constructor(cell = 8) {
    this.cell = cell;
    this.obstacles = [];   // {type, ..., y0, y1, stamp}
    this.surfaces = [];    // {kind:'floor'|'ramp'|'box', ..., stamp}
    this.solids = [];      // {poly, y0, y1, bb} – building footprints that must never contain the player
    this.grid = new Map(); // key -> {o:[], s:[], d:[]}
    this.stamp = 1;
    this.bounds = null;    // [x0,z0,x1,z1] soft play-area bounds
  }

  _cellsFor(x0, z0, x1, z1, fn) {
    const c = this.cell;
    const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c), j0 = Math.floor(z0 / c), j1 = Math.floor(z1 / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = i * 73856093 ^ j * 19349663;
      let b = this.grid.get(k);
      if (!b) { b = { o: [], s: [], d: [] }; this.grid.set(k, b); }
      fn(b);
    }
  }

  _addObstacle(o, x0, z0, x1, z1) {
    o.stamp = 0;
    this.obstacles.push(o);
    this._cellsFor(x0, z0, x1, z1, b => b.o.push(o));
    return o;
  }

  addSegment(ax, az, bx, bz, y0, y1, thick = 0, tag = null) {
    const t = thick / 2;
    return this._addObstacle({ type: SEG, ax, az, bx, bz, t, y0, y1, tag },
      Math.min(ax, bx) - t, Math.min(az, bz) - t, Math.max(ax, bx) + t, Math.max(az, bz) + t);
  }

  addPolyline(pts, y0, y1, thick = 0, closed = false, tag = null) {
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      this.addSegment(a[0], a[1], b[0], b[1], y0, y1, thick, tag);
    }
  }

  addCircle(x, z, r, y0, y1, tag = null) {
    return this._addObstacle({ type: CIRCLE, x, z, r, y0, y1, tag }, x - r, z - r, x + r, z + r);
  }

  // Oriented box. angle = rotation of local +x axis (atan2(dz,dx)). walkable → its top is also a floor.
  addBox(cx, cz, hx, hz, angle, y0, y1, walkable = false, tag = null) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const ex = Math.abs(c * hx) + Math.abs(s * hz), ez = Math.abs(s * hx) + Math.abs(c * hz);
    const o = this._addObstacle({ type: BOX, cx, cz, hx, hz, c, s, y0, y1, walkable, tag }, cx - ex, cz - ez, cx + ex, cz + ez);
    if (walkable) this._addSurface({ kind: 'box', box: o, y: y1, bottom: y0 }, cx - ex, cz - ez, cx + ex, cz + ez);
    return o;
  }

  _addSurface(s, x0, z0, x1, z1) {
    s.stamp = 0;
    this.surfaces.push(s);
    this._cellsFor(x0, z0, x1, z1, b => b.s.push(s));
    return s;
  }

  // Horizontal floor slab: top at y, bottom at y - thickness. holes = array of polygons.
  addFloor(poly, y, thickness = 0.3, holes = null, tag = null) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return this._addSurface({ kind: 'floor', poly, holes, y, bottom: y - thickness, tag }, x0, z0, x1, z1);
  }

  // Inclined walkable rectangle (stairs/ramps). Rises from y0 at s=-hl to y1 at s=+hl along (ux,uz).
  addRamp(cx, cz, ux, uz, hl, hw, y0, y1, tag = null) {
    const ex = Math.abs(ux * hl) + Math.abs(uz * hw), ez = Math.abs(uz * hl) + Math.abs(ux * hw);
    return this._addSurface({ kind: 'ramp', cx, cz, ux, uz, hl, hw, y0, y1, bottom: Math.min(y0, y1) - 0.25, tag }, cx - ex, cz - ez, cx + ex, cz + ez);
  }

  addSolid(poly, y0, y1, tag = null) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const d = { poly, y0, y1, bb: [x0, z0, x1, z1], tag, stamp: 0 };
    this.solids.push(d);
    this._cellsFor(x0, z0, x1, z1, b => b.d.push(d));
    return d;
  }

  _bucket(x, z) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    return this.grid.get(i * 73856093 ^ j * 19349663);
  }

  // Candidate obstacles around (x,z) within radius r.
  _gather(x, z, r, out) {
    const st = ++this.stamp;
    out.length = 0;
    const c = this.cell;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const b = this.grid.get(i * 73856093 ^ j * 19349663);
      if (!b) continue;
      for (const o of b.o) if (o.stamp !== st) { o.stamp = st; out.push(o); }
    }
    return out;
  }

  _surfaceTop(s, x, z) {
    if (s.kind === 'floor') {
      if (!pointInPoly(x, z, s.poly)) return null;
      if (s.holes) for (const h of s.holes) if (pointInPoly(x, z, h)) return null;
      return s.y;
    }
    if (s.kind === 'ramp') {
      const dx = x - s.cx, dz = z - s.cz;
      const a = dx * s.ux + dz * s.uz, b = -dx * s.uz + dz * s.ux;
      if (a < -s.hl || a > s.hl || b < -s.hw || b > s.hw) return null;
      return s.y0 + (s.y1 - s.y0) * (a + s.hl) / (2 * s.hl);
    }
    if (s.kind === 'box') {
      const o = s.box;
      const dx = x - o.cx, dz = z - o.cz;
      const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
      if (Math.abs(lx) > o.hx || Math.abs(lz) > o.hz) return null;
      return s.y;
    }
    return null;
  }

  // Highest walkable surface at (x,z) whose top is <= maxY. Terrain is y = 0.
  groundHeight(x, z, maxY) {
    let best = maxY >= 0 ? 0 : -Infinity;
    const b = this._bucket(x, z);
    if (!b) return best;
    for (const s of b.s) {
      const y = this._surfaceTop(s, x, z);
      if (y != null && y <= maxY && y > best) best = y;
    }
    return best;
  }

  // Lowest surface bottom above minY (for head collisions under floors / stairs).
  ceilingHeight(x, z, minY) {
    let best = Infinity;
    const b = this._bucket(x, z);
    if (!b) return best;
    for (const s of b.s) {
      const y = this._surfaceTop(s, x, z);
      if (y == null) continue;
      const bottom = s.kind === 'ramp' ? y - 0.3 : s.bottom;
      if (bottom >= minY && bottom < best) best = bottom;
    }
    return best;
  }

  // Push a cylinder (center x,z radius r, vertical span [feet, head]) out of obstacles.
  // stepUp: obstacles with top <= feet + stepUp don't block. Returns {x, z, hits}.
  resolve(x, z, r, feet, head, stepUp, iterations = 4) {
    const cand = this._cand || (this._cand = []);
    this._gather(x, z, r + 0.6, cand);
    let hits = 0;
    const lowY = feet + stepUp;
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      for (const o of cand) {
        if (o.y1 <= lowY || o.y0 >= head) continue;
        let px = 0, pz = 0, pen = 0;
        if (o.type === SEG) {
          const dx = o.bx - o.ax, dz = o.bz - o.az;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 0 ? ((x - o.ax) * dx + (z - o.az) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = o.ax + t * dx, cz = o.az + t * dz;
          let nx = x - cx, nz = z - cz;
          const d = Math.hypot(nx, nz), minD = r + o.t;
          if (d >= minD) continue;
          if (d > 1e-6) { nx /= d; nz /= d; } else { const l = Math.sqrt(l2) || 1; nx = -dz / l; nz = dx / l; }
          pen = minD - d; px = nx; pz = nz;
        } else if (o.type === CIRCLE) {
          let nx = x - o.x, nz = z - o.z;
          const d = Math.hypot(nx, nz), minD = r + o.r;
          if (d >= minD) continue;
          if (d > 1e-6) { nx /= d; nz /= d; } else { nx = 1; nz = 0; }
          pen = minD - d; px = nx; pz = nz;
        } else {
          const dx = x - o.cx, dz = z - o.cz;
          const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
          const qx = Math.max(-o.hx, Math.min(o.hx, lx)), qz = Math.max(-o.hz, Math.min(o.hz, lz));
          let nlx = lx - qx, nlz = lz - qz;
          const d = Math.hypot(nlx, nlz);
          if (d >= r) continue;
          if (d > 1e-6) { nlx /= d; nlz /= d; pen = r - d; }
          else {
            // centre inside the box: push out along the axis of least penetration
            const ox = o.hx - Math.abs(lx), oz = o.hz - Math.abs(lz);
            if (ox < oz) { nlx = Math.sign(lx) || 1; nlz = 0; pen = ox + r; }
            else { nlx = 0; nlz = Math.sign(lz) || 1; pen = oz + r; }
          }
          px = nlx * o.c - nlz * o.s; pz = nlx * o.s + nlz * o.c;
        }
        x += px * pen; z += pz * pen;
        hits++; moved = true;
      }
      if (!moved) break;
    }
    // Never end up inside a solid footprint (e.g. after a teleport or a numerical slip).
    const out = this.pushOutOfSolids(x, z, r, feet, head);
    return { x: out[0], z: out[1], hits };
  }

  solidAt(x, z, feet, head) {
    const b = this._bucket(x, z);
    if (!b) return null;
    for (const d of b.d) {
      if (d.y1 <= feet + 0.05 || d.y0 >= head) continue;
      if (x < d.bb[0] || x > d.bb[2] || z < d.bb[1] || z > d.bb[3]) continue;
      if (pointInPoly(x, z, d.poly)) return d;
    }
    return null;
  }

  pushOutOfSolids(x, z, r, feet, head) {
    for (let guard = 0; guard < 3; guard++) {
      const d = this.solidAt(x, z, feet, head);
      if (!d) break;
      let best = Infinity, bx = x, bz = z, nx = 0, nz = 0;
      const p = d.poly;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], c = p[(i + 1) % p.length];
        const dx = c[0] - a[0], dz = c[1] - a[1];
        const l2 = dx * dx + dz * dz; if (l2 < 1e-9) continue;
        let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = a[0] + t * dx, qz = a[1] + t * dz;
        const dd = (qx - x) * (qx - x) + (qz - z) * (qz - z);
        if (dd < best) { best = dd; bx = qx; bz = qz; const l = Math.sqrt(l2); nx = dz / l; nz = -dx / l; }
      }
      // outward normal for positive-area polygons is (dz,-dx)/l; verify by testing
      if (pointInPoly(bx + nx * 0.05, bz + nz * 0.05, p)) { nx = -nx; nz = -nz; }
      x = bx + nx * (r + 0.02); z = bz + nz * (r + 0.02);
    }
    return [x, z];
  }

  // Ray march along the ground plane: first obstacle hit distance (for camera/teleport checks). Coarse.
  isFree(x, z, r, feet, head, stepUp = 0.4) {
    if (this.solidAt(x, z, feet, head)) return false;
    const cand = this._gather(x, z, r + 0.6, this._cand2 || (this._cand2 = []));
    const lowY = feet + stepUp;
    for (const o of cand) {
      if (o.y1 <= lowY || o.y0 >= head) continue;
      if (o.type === SEG) {
        if (distSegSq(x, z, o.ax, o.az, o.bx, o.bz) < (r + o.t) * (r + o.t)) return false;
      } else if (o.type === CIRCLE) {
        if (Math.hypot(x - o.x, z - o.z) < r + o.r) return false;
      } else {
        const dx = x - o.cx, dz = z - o.cz;
        const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
        const qx = Math.max(-o.hx, Math.min(o.hx, lx)), qz = Math.max(-o.hz, Math.min(o.hz, lz));
        if (Math.hypot(lx - qx, lz - qz) < r) return false;
      }
    }
    return true;
  }
}
