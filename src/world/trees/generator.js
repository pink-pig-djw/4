// Procedural tree models: a branch skeleton (tapered tubes with bark UVs) plus leaf cards placed on
// the outer twigs, built for two levels of detail. The crown grows into a species envelope
// (ellipsoid or cone, made lumpy), which gives recognisable silhouettes: round lindens, wide oaks,
// narrow weeping birches, umbrella-topped pines, conical spruces.
import * as THREE from 'three';
import { SPECIES } from './species.js';
import { tileRect } from './textures.js';
import { rng } from '../../shared/geom.js';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);

class Buf {
  constructor(leaf) { this.leaf = leaf; this.pos = []; this.nor = []; this.uv = []; this.col = []; this.wind = []; this.card = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 2));
    if (this.leaf) g.setAttribute('aCard', new THREE.Float32BufferAttribute(this.card, 4));
    else g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------
// crown envelope

function envelope(sp, H, R) {
  const bumps = [];
  for (let i = 0; i < 8; i++) {
    const v = new V(R() - 0.5, (R() - 0.5) * 0.8, R() - 0.5).normalize();
    bumps.push([v, (R() - 0.5) * 2 * sp.irr]);
  }
  const irr = d => { let f = 1; for (const [v, a] of bumps) f += a * Math.pow(Math.max(0, d.dot(v)), 3); return Math.max(0.55, f); };
  if (sp.env[0] === 'ell') {
    const [, cyf, rhf, rvf] = sp.env;
    const c = new V(0, cyf * H, 0), rh = rhf * H, rv = rvf * H;
    return {
      c, rh, rv, bottom: c.y - rv, top: c.y + rv,
      ray(o, d) {
        const ox = (o.x - c.x) / rh, oy = (o.y - c.y) / rv, oz = (o.z - c.z) / rh, dx = d.x / rh, dy = d.y / rv, dz = d.z / rh;
        const A = dx * dx + dy * dy + dz * dz, B = 2 * (ox * dx + oy * dy + oz * dz), C = ox * ox + oy * oy + oz * oz - 1;
        const disc = B * B - 4 * A * C;
        if (disc < 0) return 0.4;
        const t = (-B + Math.sqrt(disc)) / (2 * A);
        const hit = o.clone().addScaledVector(d, t).sub(c).normalize();
        return Math.max(0.4, t * irr(hit));
      },
      // normalised "radius" of a point inside the crown (0 centre … 1 surface)
      e(p) { return Math.hypot(p.x / rh, (p.y - c.y) / rv, p.z / rh); },
    };
  }
  const [, ybf, rbf] = sp.env;
  const yb = ybf * H, rb = rbf * H;
  const rc = y => rb * Math.min(1, Math.max(0, (H - y) / (H - yb)));
  const c = new V(0, yb + (H - yb) * 0.33, 0);
  return {
    c, rh: rb, rv: (H - yb) / 2, bottom: yb, top: H,
    ray(o, d) {
      let t = 0;
      const p = new V();
      while (t < rb * 3) {
        t += 0.1; p.copy(o).addScaledVector(d, t);
        if (Math.hypot(p.x, p.z) > rc(p.y) * irr(d)) break;
      }
      return Math.max(0.3, t);
    },
    e(p) { return Math.min(1.2, Math.hypot(p.x, p.z) / Math.max(0.3, rc(p.y)) * 0.8 + 0.2); },
  };
}

// ---------------------------------------------------------------------------------------------
// tube along a polyline with parallel-transport frames

function tube(buf, pts, rad, radial, o) {
  const n = pts.length;
  const T = pts.map((p, i) => new V().subVectors(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]).normalize());
  const N = Math.abs(T[0].y) < 0.9 ? new V().crossVectors(UP, T[0]).normalize() : new V(1, 0, 0).cross(T[0]).normalize();
  const B = new V(), d = new V(), p = new V();
  const circ = 2 * Math.PI * rad[0];
  const uRep = Math.max(1, Math.round(circ / 0.9));
  let vAcc = o.v0 || 0;
  const base = buf.n;
  for (let i = 0; i < n; i++) {
    if (i > 0) { N.addScaledVector(T[i], -N.dot(T[i])).normalize(); vAcc += pts[i].distanceTo(pts[i - 1]); }
    B.crossVectors(T[i], N);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      d.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      const r = rad[i] * (o.radMod ? o.radMod(pts[i], a, i) : 1);
      p.copy(pts[i]).addScaledVector(d, r);
      buf.pos.push(p.x, p.y, p.z);
      buf.nor.push(d.x, d.y, d.z);
      buf.uv.push(j / radial * uRep, vAcc / 2);
      const c = o.tint(p, d, i / (n - 1));
      buf.col.push(c[0], c[1], c[2]);
      const w = o.wind(p, i / (n - 1));
      buf.wind.push(w[0], w[1]);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = base + i * (radial + 1) + j, b = a + radial + 1;
    buf.idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
}

const samplePoly = (pts, s) => {
  const f = Math.min(Math.max(s, 0), 1) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), t = f - i;
  return { p: pts[i].clone().lerp(pts[i + 1], t), d: new V().subVectors(pts[i + 1], pts[i]).normalize(), i, t };
};
const sampleRad = (rad, s) => { const f = Math.min(Math.max(s, 0), 1) * (rad.length - 1), i = Math.min(rad.length - 2, Math.floor(f)); return rad[i] + (rad[i + 1] - rad[i]) * (f - i); };

function perpendicular(d, R) {
  const t = Math.abs(d.y) < 0.95 ? new V().crossVectors(d, UP) : new V().crossVectors(d, new V(1, 0, 0));
  t.normalize();
  const b = new V().crossVectors(d, t).normalize();
  const a = R() * Math.PI * 2;
  return t.multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
}

// ---------------------------------------------------------------------------------------------

export const VARIANTS = { linden: 2, maple: 2, oak: 2, birch: 2, chestnut: 1, beech: 1, shrub: 1, pine: 2, spruce: 1 };

// Build one species variant. atlasSize: leaf atlas size in px (for tile UVs).
export function generateTree(key, variant, atlasSize) {
  const sp = SPECIES[key];
  const R = rng(1000 + key.length * 131 + key.charCodeAt(0) * 17 + variant * 7919);
  const H = sp.h;
  const env = envelope(sp, H, R);
  const exc = !!sp.exc;
  const moss = sp.bark === 'birch' || sp.bark === 'pine' || sp.bark === 'spruce' ? 0 : 0.3 + R() * 0.5;

  // ---- colours of the bark (vertex tint over the bark texture) ----
  const tintFor = level => (p, d, s) => {
    let r = 1, g = 1, b = 1;
    if (sp.bark === 'pine') {
      // Scots pine: grey-brown plates low down, thin orange bark higher up and on branches
      const k = level > 0 ? 1 : Math.min(1, Math.max(0, (p.y - 0.42 * H) / (0.2 * H)));
      r = 1 + 0.42 * k; g = 1 - 0.08 * k; b = 1 - 0.3 * k;
    } else if (sp.bark === 'birch') {
      if (level === 0) { const k = Math.min(1, Math.max(0, (p.y - 0.4) / 2.2)); r = g = b = 0.42 + 0.58 * k; }
      else if (level === 1) { r = 0.78; g = 0.75; b = 0.72; }
      else { r = 0.36; g = 0.31; b = 0.28; }
    } else if (level >= 2) { r = 0.8; g = 0.76; b = 0.72; }
    // moss on the weather (north, −z) side of the lower trunk
    if (moss && level === 0) {
      const m = moss * Math.max(0, -d.z) * (1 - Math.min(1, Math.max(0, (p.y - 0.4) / 2.5)));
      r *= 1 - 0.22 * m; g *= 1 + 0.02 * m; b *= 1 - 0.38 * m;
    }
    // darker inside the crown
    const ao = level === 0 ? (p.y > env.bottom ? 0.8 : 1) : 0.62 + 0.38 * Math.min(1, env.e(p));
    return [r * ao, g * ao, b * ao];
  };
  const windFor = level => (p, s) => {
    const sway = Math.pow(Math.max(0, p.y) / H, 1.5);
    const fl = level === 0 ? 0 : level === 1 ? 0.25 * s * s : 0.3 + 0.5 * s;
    return [sway, fl];
  };

  // ---- trunk / leader ----
  const leaderTop = sp.leader * H;
  const trunkPts = [], trunkRad = [];
  const nT = 11;
  let tx = 0, tz = 0, dx = 0, dz = 0;
  const kink = sp.kink ?? (exc ? 0.02 : 0.08);
  for (let i = 0; i <= nT; i++) {
    const f = i / nT, y = -0.15 + (leaderTop + 0.15) * f;
    if (i > 1) { dx += (R() - 0.5) * kink; dz += (R() - 0.5) * kink; dx *= 0.8; dz *= 0.8; tx += dx; tz += dz; }
    trunkPts.push(new V(tx, y, tz));
    const top = exc ? 0.02 : 0.28;
    let r = sp.r0 * (1 - (1 - top) * Math.pow(f, exc ? 0.9 : 1.1));
    r *= 1 + 0.55 * Math.exp(-Math.max(y, 0) / 0.35);  // root flare
    trunkRad.push(r);
  }
  const flarePh = R() * 6;
  const trunkRadMod = (p, a) => 1 + 0.28 * Math.exp(-Math.max(p.y, 0) / 0.4) * Math.pow(Math.abs(Math.sin(a * 2.5 + flarePh)), 3) + 0.03 * Math.sin(a * 7 + p.y * 3);
  const trunkAt = y => {
    const f = Math.min(1, Math.max(0, (y + 0.15) / (leaderTop + 0.15)));
    return { p: samplePoly(trunkPts, f).p, r: sampleRad(trunkRad, f) };
  };

  // ---- level-1 branches ----
  const branches = [];   // {pts, rad, level, len}
  const crownBase = sp.base * H;
  const n1 = sp.br;
  for (let i = 0; i < n1; i++) {
    let t, az;
    if (sp.whorl) {
      const nW = Math.ceil(n1 / sp.whorl), w = Math.floor(i / sp.whorl);
      t = Math.min(0.98, (w + 0.35 + R() * 0.3) / nW);
      az = w * 0.9 + (i % sp.whorl) / sp.whorl * Math.PI * 2 + (R() - 0.5) * 0.5;
    } else {
      t = (i + 0.3 + R() * 0.4) / n1;
      az = i * 2.39996 + (R() - 0.5) * 0.6;
    }
    const y = crownBase + t * (leaderTop * (exc ? 0.97 : 0.95) - crownBase);
    const at = trunkAt(y);
    let th = (sp.angle + (R() - 0.5) * 2 * sp.spread) * Math.PI / 180;
    if (!exc) th *= 1 - 0.45 * t;
    const d0 = new V(Math.sin(th) * Math.cos(az), Math.cos(th), Math.sin(th) * Math.sin(az));
    let L = env.ray(at.p, d0) * (0.78 + 0.22 * R()) * (exc ? 1 : 0.9);
    if (sp.whorl && !sp.spray) L *= 0.9;
    L = Math.max(0.35, L);
    const nS = 6;
    const pts = [at.p.clone().addScaledVector(d0, -at.r * 0.6)];
    const dir = d0.clone(), p = at.p.clone();
    for (let k = 1; k <= nS; k++) {
      const f = k / nS;
      dir.y += sp.up * 0.22 - sp.droop * 0.55 * f;
      dir.x += (R() - 0.5) * 0.18; dir.z += (R() - 0.5) * 0.18;
      dir.normalize();
      p.addScaledVector(dir, L / nS);
      pts.push(p.clone());
    }
    const rB = Math.min(at.r * 0.72, sp.r0 * 0.5 * Math.pow(L / (0.35 * H), 0.8));
    const rad = pts.map((_, k) => rB + (0.012 - rB) * Math.pow(k / nS, 0.85));
    branches.push({ pts, rad, level: 1, len: L });
  }

  // ---- level-2 branches ----
  const l1 = branches.slice();
  for (const b of l1) {
    const n2 = Math.max(1, Math.min(7, Math.round(sp.kids * b.len / (0.3 * H) + R() * 0.8)));
    for (let k = 0; k < n2; k++) {
      const s = 0.25 + 0.7 * (k + 0.2 + R() * 0.6) / n2;
      const { p, d } = samplePoly(b.pts, s);
      const side = new V().crossVectors(d, UP);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize().multiplyScalar(k % 2 ? 1 : -1);
      const upv = new V().crossVectors(side, d).normalize();
      if (upv.y < 0) upv.negate();
      const beta = -0.35 + R() * 1.3;
      const perp = side.clone().multiplyScalar(Math.cos(beta)).addScaledVector(upv, Math.sin(beta)).normalize();
      const ka = (sp.kidAngle + (R() - 0.5) * 24) * Math.PI / 180;
      const dir = d.clone().multiplyScalar(Math.cos(ka)).addScaledVector(perp, Math.sin(ka)).normalize();
      let L = Math.min(env.ray(p, dir) * (0.85 + 0.3 * R()), b.len * (0.62 - 0.32 * s));
      L = Math.max(0.25, L);
      const nS = 3, pts = [p.clone()];
      const q = p.clone();
      for (let j = 1; j <= nS; j++) {
        const f = j / nS;
        dir.y += sp.up * 0.15 - sp.droop * 0.7 * f;
        dir.x += (R() - 0.5) * 0.2; dir.z += (R() - 0.5) * 0.2;
        dir.normalize();
        q.addScaledVector(dir, L / nS);
        pts.push(q.clone());
      }
      const rB = Math.max(0.008, sampleRad(b.rad, s) * 0.6);
      const rad = pts.map((_, j) => rB + (0.005 - rB) * (j / nS));
      branches.push({ pts, rad, level: 2, len: L, parent: b });
    }
  }

  // ---- leaf cards ----
  const sites = [];   // [branch, s0, s1, weight]
  for (const b of branches) {
    if (b.level === 2) sites.push([b, 0.12, 1, b.len]);
    else sites.push([b, sp.spray ? 0.15 : 0.55, 1, b.len * (sp.spray ? 0.8 : 0.45)]);
  }
  if (exc && !sp.spray) {
    // top of the leader carries foliage too
    sites.push([{ pts: trunkPts, rad: trunkRad, level: 1, len: leaderTop }, 0.9, 1, leaderTop * 0.1]);
  }
  let wsum = 0; for (const s of sites) wsum += s[3];
  const cards = [];
  const tiles = sp.tiles;
  let grp = 0;
  for (let c = 0; c < sp.cards; c++) {
    let v = R() * wsum, site = sites[0];
    for (const s of sites) { v -= s[3]; if (v <= 0) { site = s; break; } }
    const [b, s0, s1] = site;
    const s = sp.tuft ? Math.max(s0, 1 - Math.pow(R(), 2) * (1 - s0)) : s0 + (s1 - s0) * R();
    const { p, d } = samplePoly(b.pts, s);
    const size = sp.card * (0.75 + 0.5 * R());
    const out = new V(p.x, 0, p.z); if (out.lengthSq() < 1e-4) out.set(R() - 0.5, 0, R() - 0.5); out.normalize();
    const tile = tiles[Math.floor(R() * tiles.length)];
    if (sp.spray) {
      // spruce: sprays lie along the branch, facing up, with some tilt
      const up = d.clone().addScaledVector(UP, -0.15).normalize();
      const right = new V().crossVectors(up, UP).normalize();
      const roll = (R() - 0.5) * 1.0;
      const nrm = new V().crossVectors(right, up).normalize();
      right.multiplyScalar(Math.cos(roll)).addScaledVector(nrm, Math.sin(roll)).normalize();
      cards.push({ p: p.clone().addScaledVector(up, -size * 0.1), up, right, size, tile, grp: grp++ });
    } else if (sp.tuft) {
      // pine: crossed pairs of needle brushes pointing outward and up
      const up = d.clone().addScaledVector(UP, 0.7).addScaledVector(out, 0.3).normalize();
      const r1 = perpendicular(up, R), r2 = new V().crossVectors(up, r1).normalize();
      cards.push({ p: p.clone(), up, right: r1, size, tile, grp });
      cards.push({ p: p.clone(), up: up.clone(), right: r2, size: size * 0.9, tile, grp: grp++ });
      c++;
    } else {
      const up = d.clone().addScaledVector(out, 0.4).addScaledVector(UP, 0.3)
        .add(new V(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(0.7)).normalize();
      const right = perpendicular(up, R);
      cards.push({ p: p.clone().addScaledVector(up, -size * 0.08), up, right, size, tile, grp: grp++ });
    }
  }

  // ---- write geometry for both LODs ----
  const crownC = new V(0, env.c.y - env.rv * 0.15, 0);
  const lods = [];
  for (let lod = 0; lod < 2; lod++) {
    const bark = new Buf(false), leaves = new Buf(true);
    tube(bark, trunkPts, trunkRad, lod === 0 ? 12 : 6, { tint: tintFor(0), wind: windFor(0), radMod: lod === 0 ? trunkRadMod : null });
    for (const b of branches) {
      if (lod === 1 && b.level === 2) continue;
      if (lod === 1 && b.level === 1 && b.rad[0] < 0.025) continue;
      const radial = b.level === 1 ? (lod === 0 ? (b.rad[0] > 0.06 ? 7 : 5) : 4) : 4;
      const pts = lod === 0 ? b.pts : b.pts.filter((_, i) => i % 2 === 0 || i === b.pts.length - 1);
      const rad = lod === 0 ? b.rad : b.rad.filter((_, i) => i % 2 === 0 || i === b.rad.length - 1);
      tube(bark, pts, rad, radial, { tint: tintFor(b.level), wind: windFor(b.level) });
    }
    cards.forEach((cd, i) => {
      if (lod === 1 && cd.grp % 2 === 1) return;
      const size = cd.size * (lod === 1 ? 1.38 : 1);
      const centre = cd.p.clone().addScaledVector(cd.up, cd.size * 0.5);
      const base = lod === 1 ? centre.clone().addScaledVector(cd.up, -size * 0.5) : cd.p;
      const tr = tileRect(cd.tile, atlasSize);
      const rnd = [R(), R(), R()];
      const corners = [[-0.5, 0, tr.u0, tr.vBot], [0.5, 0, tr.u1, tr.vBot], [0.5, 1, tr.u1, tr.vTop], [-0.5, 1, tr.u0, tr.vTop]];
      const cn = new V().crossVectors(cd.right, cd.up).normalize();
      const b0 = leaves.n;
      for (const [a, h, u, v] of corners) {
        const q = base.clone().addScaledVector(cd.right, a * size).addScaledVector(cd.up, h * size);
        const ns = q.clone().sub(crownC).normalize();
        const n = (cn.dot(ns) < 0 ? cn.clone().negate() : cn.clone()).multiplyScalar(0.25).addScaledVector(ns, 0.85).addScaledVector(UP, 0.18).normalize();
        leaves.pos.push(q.x, q.y, q.z);
        leaves.nor.push(n.x, n.y, n.z);
        leaves.uv.push(u, v);
        const e = env.e(q);
        let ao = 0.42 + 0.58 * Math.min(1, Math.max(0, (e - 0.15) / 0.85));
        ao *= 0.78 + 0.22 * Math.min(1, Math.max(0, (q.y - env.bottom) / (env.top - env.bottom)));
        leaves.card.push(rnd[0], rnd[1], rnd[2], ao);
        const sway = Math.pow(Math.max(0, q.y) / H, 1.5);
        leaves.wind.push(sway, 0.7 + 0.3 * h);
      }
      leaves.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    });
    lods.push({ bark: bark.geometry(), leaves: leaves.geometry() });
  }
  // extents for the impostor
  const bb = lods[0].leaves.boundingBox.clone().union(lods[0].bark.boundingBox);
  const W = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z));
  return { key, variant, lods, H: bb.max.y, W, crownC, stats: { barkTris: lods.map(l => l.bark.index.count / 3), leafTris: lods.map(l => l.leaves.index.count / 3) } };
}
