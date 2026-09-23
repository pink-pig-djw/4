// Small 2D geometry helpers shared by the build tools (Node) and the game (browser).
// Points are [x, z] arrays in metres. x = east, z = south.

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function area(pts) { return Math.abs(signedArea(pts)); }

// Positive signed area is our canonical orientation for outer rings.
export function orient(pts, positive = true) {
  const s = signedArea(pts);
  if ((s > 0) !== positive) return pts.slice().reverse();
  return pts;
}

export function centroid(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cz += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (const p of pts) { sx += p[0]; sz += p[1]; }
    return [sx / pts.length, sz / pts.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolyWithHoles(x, z, poly, holes) {
  if (!pointInPoly(x, z, poly)) return false;
  if (holes) for (const h of holes) if (pointInPoly(x, z, h)) return false;
  return true;
}

// Squared distance from point to segment, plus the closest point parameter.
export function distSegSq(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px, cz = az + t * dz - pz;
  return cx * cx + cz * cz;
}

export function closestOnSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + t * dx, az + t * dz, t];
}

export function distToPolyEdge(x, z, pts) {
  let best = Infinity;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const d = distSegSq(x, z, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function polyBounds(pts) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
  }
  return [x0, z0, x1, z1];
}

// Minimum-area oriented bounding box, testing each edge direction.
// Returns { cx, cz, ux, uz, hw, hd, angle } where (ux,uz) is the long axis, hw half length along it, hd half width.
export function obb(pts) {
  let best = null;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    let ux = b[0] - a[0], uz = b[1] - a[1];
    const l = Math.hypot(ux, uz);
    if (l < 0.5) continue;
    ux /= l; uz /= l;
    let min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity;
    for (const p of pts) {
      const s = p[0] * ux + p[1] * uz, t = -p[0] * uz + p[1] * ux;
      if (s < min1) min1 = s; if (s > max1) max1 = s;
      if (t < min2) min2 = t; if (t > max2) max2 = t;
    }
    const ar = (max1 - min1) * (max2 - min2);
    if (!best || ar < best.ar - 1e-6) best = { ar, ux, uz, min1, max1, min2, max2 };
  }
  if (!best) {
    const [x0, z0, x1, z1] = polyBounds(pts);
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, ux: 1, uz: 0, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, angle: 0 };
  }
  let { ux, uz, min1, max1, min2, max2 } = best;
  // make u the long axis
  if (max2 - min2 > max1 - min1) {
    const nux = -uz, nuz = ux; // rotate +90
    // s' = p·(nux,nuz) = -p.x*uz + p.z*ux = t ; t' = -p.x*nuz + p.z*nux = -p.x*ux - p.z*uz = -s
    [min1, max1, min2, max2] = [min2, max2, -max1, -min1];
    ux = nux; uz = nuz;
  }
  const s = (min1 + max1) / 2, t = (min2 + max2) / 2;
  return {
    cx: s * ux - t * uz, cz: s * uz + t * ux,
    ux, uz, hw: (max1 - min1) / 2, hd: (max2 - min2) / 2,
    angle: Math.atan2(uz, ux),
  };
}

// Remove duplicate & nearly collinear vertices from a closed ring (no repeated closing point).
export function cleanRing(pts, eps = 0.05) {
  let out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop();
  }
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 1e-6 || Math.abs(cross) / len < eps * 0.5) { out.splice(i, 1); changed = true; i--; }
    }
  }
  return out;
}

// Pole of inaccessibility (approximate): best interior point for labels.
export function labelPoint(pts) {
  const [x0, z0, x1, z1] = polyBounds(pts);
  let best = centroid(pts), bestD = pointInPoly(best[0], best[1], pts) ? distToPolyEdge(best[0], best[1], pts) : -1;
  const steps = 14;
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
    const x = x0 + (x1 - x0) * i / steps, z = z0 + (z1 - z0) * j / steps;
    if (!pointInPoly(x, z, pts)) continue;
    const d = distToPolyEdge(x, z, pts);
    if (d > bestD) { bestD = d; best = [x, z]; }
  }
  return best;
}

// Deterministic PRNG (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [ax + t * rx, az + t * rz, t, u];
}

// Clip a segment against a polygon: returns list of [t0,t1] parameter intervals inside the polygon.
export function clipSegToPoly(ax, az, bx, bz, poly) {
  const ts = [0, 1];
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const hit = segIntersect(ax, az, bx, bz, p[0], p[1], q[0], q[1]);
    if (hit) ts.push(hit[2]);
  }
  ts.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const tm = (t0 + t1) / 2;
    if (pointInPoly(ax + (bx - ax) * tm, az + (bz - az) * tm, poly)) {
      if (out.length && Math.abs(out[out.length - 1][1] - t0) < 1e-6) out[out.length - 1][1] = t1;
      else out.push([t0, t1]);
    }
  }
  return out;
}
