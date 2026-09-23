// Spatial index over road centre-lines (pure JS).
export class RoadIndex {
  constructor(roads, cell = 20) {
    this.cell = cell;
    this.grid = new Map();
    for (const r of roads) for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1];
      const cx0 = Math.floor(Math.min(a[0], b[0]) / cell), cx1 = Math.floor(Math.max(a[0], b[0]) / cell);
      const cz0 = Math.floor(Math.min(a[1], b[1]) / cell), cz1 = Math.floor(Math.max(a[1], b[1]) / cell);
      for (let gx = cx0; gx <= cx1; gx++) for (let gz = cz0; gz <= cz1; gz++) {
        const k = gx * 100003 + gz; let arr = this.grid.get(k); if (!arr) this.grid.set(k, arr = []); arr.push([r, a, b]);
      }
    }
  }
  // Nearest road segment; returns {r, ux, uz, d, cx, cz} or null
  nearest(x, z, maxD, filter) {
    let best = null, bd = maxD * maxD;
    const c = this.cell;
    for (let gx = Math.floor((x - maxD) / c); gx <= Math.floor((x + maxD) / c); gx++)
      for (let gz = Math.floor((z - maxD) / c); gz <= Math.floor((z + maxD) / c); gz++) {
        const arr = this.grid.get(gx * 100003 + gz); if (!arr) continue;
        for (const [r, a, b] of arr) {
          if (filter && !filter(r)) continue;
          const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz; if (l2 < 1e-6) continue;
          let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = Math.max(0, Math.min(1, t));
          const px = a[0] + t * dx - x, pz = a[1] + t * dz - z, d = px * px + pz * pz;
          if (d < bd) { bd = d; const l = Math.sqrt(l2); best = { r, ux: dx / l, uz: dz / l, d: Math.sqrt(d), cx: a[0] + t * dx, cz: a[1] + t * dz }; }
        }
      }
    return best;
  }
  // How far (x,z) intrudes into any road surface (half width + margin). Returns the worst {road, push:[nx,nz], depth}.
  intrusion(x, z, margin = 0.3, filter) {
    let worst = null;
    const c = this.cell;
    const R = 14;
    for (let gx = Math.floor((x - R) / c); gx <= Math.floor((x + R) / c); gx++)
      for (let gz = Math.floor((z - R) / c); gz <= Math.floor((z + R) / c); gz++) {
        const arr = this.grid.get(gx * 100003 + gz); if (!arr) continue;
        for (const [r, a, b] of arr) {
          if (filter && !filter(r)) continue;
          const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz; if (l2 < 1e-6) continue;
          let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = Math.max(0, Math.min(1, t));
          const px = x - (a[0] + t * dx), pz = z - (a[1] + t * dz), d = Math.hypot(px, pz);
          const need = r.w / 2 + margin;
          if (d < need) {
            const depth = need - d;
            if (!worst || depth > worst.depth) {
              let nx, nz;
              if (d > 1e-4) { nx = px / d; nz = pz / d; } else { const l = Math.sqrt(l2); nx = -dz / l; nz = dx / l; }
              worst = { r, depth, nx, nz };
            }
          }
        }
      }
    return worst;
  }
}
