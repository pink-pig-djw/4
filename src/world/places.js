// Teleport destinations derived from the real map data (named buildings, bus stops, streets).
import { labelPoint, pointInPoly, distToPolyEdge } from '../shared/geom.js';
import { PLACE_ZH } from '../core/i18n.js';
import { PLAYER } from '../physics/controller.js';
import { groundY } from './terrain.js';

// Buildings that are key for students get a higher rank in the list.
const RANK = {
  'MHB-Mensagebäude/Hörsaal/Bibliothek/Tiefgarage': 100, 'Felix-Klein-Gebäude': 90,
  'Informatik und Regionales Rechenzentrum (RRZE)': 95, 'Chemikum': 80, 'Physikum': 80, 'Biologikum': 78,
  'Hörsäle': 85, 'Werkstoffwissenschaften': 70, 'Elektrotechnik': 75, 'Hörsaalgebäude Biologikum / Physikum': 72,
};

function findFreeNear(cw, x, z, nx, nz, dists = [3.5, 5, 7, 9, 12, 16]) {
  for (const d of dists) {
    for (const rot of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3]) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const dx = nx * c - nz * s, dz = nx * s + nz * c;
      const px = x + dx * d, pz = z + dz * d;
      const g = groundY(px, pz);
      if (cw.isFree(px, pz, PLAYER.radius + 0.25, g, g + PLAYER.height) && !cw.solidAt(px, pz, g, g + PLAYER.height)) return { x: px, z: pz, yaw: Math.atan2(dx, dz) };
    }
  }
  return null;
}

export function computePlaces(game) {
  const w = game.world, cw = game.cw;
  const places = [];
  w.outlines.forEach((o, i) => {
    if (!o.n) return;
    const lp = labelPoint(o.p);
    let spawn = null;
    const ents = o.ents.map(k => w.entrances[k]).sort((a, b) => (b.k === 'main') - (a.k === 'main'));
    for (const e of ents) { spawn = findFreeNear(cw, e.x, e.z, e.nx, e.nz); if (spawn) break; }
    if (!spawn) {
      // walk outward from the label point toward the nearest edge
      let best = null;
      for (let k = 0; k < 16 && !spawn; k++) {
        const a = k / 16 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
        let d = 0; while (d < 150 && pointInPoly(lp[0] + dx * d, lp[1] + dz * d, o.p)) d += 1;
        const ex = lp[0] + dx * d, ez = lp[1] + dz * d;
        if (!best || d < best.d) best = { d, ex, ez, dx, dz };
      }
      if (best) spawn = findFreeNear(cw, best.ex, best.ez, best.dx, best.dz, [2, 4, 6, 9, 13, 18]);
    }
    if (!spawn) return;
    places.push({
      id: 'o' + i, cat: /Wohnheim|Kirche|Apotheke|Sparkasse|Kinder|Schule|Holist|Turnhalle|Gästehaus|Familien|Shop|Diepgen|Gemeinde|Förderzentrum|Parkhaus|TS |Umspann|Pinzer|Halle$/.test(o.n) ? 'other' : 'uni',
      name: o.n, zh: PLACE_ZH[o.n] || null, addr: o.a, x: lp[0], z: lp[1], spawn, rank: RANK[o.n] || (o.k === 'university' ? 40 : 10), outline: i,
    });
  });
  // named parts (e.g. Mensagebäude, Wolfgang-Händler-Hochhaus)
  for (const b of w.buildings) {
    if (!b.n || places.some(p => p.name === b.n)) continue;
    const lp = labelPoint(b.p);
    const parent = places.find(p => p.outline === b.o);
    places.push({ id: 'p' + b.id, cat: 'uni', name: b.n, zh: PLACE_ZH[b.n] || null, x: lp[0], z: lp[1], spawn: parent ? parent.spawn : null, rank: (RANK[b.n] || 50) - 5 });
  }
  // bus stops (one entry per name)
  const seen = new Set();
  for (const s of w.stops) {
    if (!s.n || seen.has(s.n)) continue;
    seen.add(s.n);
    const sp = findFreeNear(cw, s.x, s.z, Math.cos(s.yaw + Math.PI), Math.sin(s.yaw + Math.PI), [1.5, 2.5, 4, 6]);
    if (!sp) continue;
    places.push({ id: 's' + s.n, cat: 'stop', name: s.n, zh: '公交站', x: s.x, z: s.z, spawn: { x: sp.x, z: sp.z, yaw: Math.atan2(-Math.cos(s.along), -Math.sin(s.along)) }, rank: s.n === 'Technische Fakultät' ? 60 : 20 });
  }
  // walk-in destinations for the enterable buildings (just inside the main entrance)
  for (const P of game.plans || []) {
    const d = P.extDoors.find(x => x.main) || P.extDoors[0];
    if (!d) continue;
    let done = false;
    for (const dist of [3.5, 2.5, 4.5, 5.5, 7]) for (const lat of [0, 1.2, -1.2, 2.4, -2.4]) {
      if (done) break;
      const x = d.x - d.nx * dist - d.nz * lat, z = d.z - d.nz * dist + d.nx * lat;
      if (!cw.isFree(x, z, PLAYER.radius + 0.15, P.base, P.base + PLAYER.height)) continue;
      if (Math.abs(cw.groundHeight(x, z, P.base + 0.3) - P.base) > 0.05) continue;
      places.push({ id: 'in' + P.key, cat: 'uni', name: P.title.de, zh: P.title.zh + '（室内）', x, z, spawn: { x, z, yaw: Math.atan2(d.nx, d.nz), y: P.base }, rank: 99, enterable: true, plan: P.key });
      done = true;
    }
  }
  places.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, 'de'));
  return places.filter(p => p.spawn);
}

export function setupSpawn(game) {
  game.places = computePlaces(game);
  // Default start: arriving by bus at "Technische Fakultät", looking toward the Mensa plaza.
  const stop = game.places.find(p => p.id === 'sTechnische Fakultät');
  const mensa = game.places.find(p => p.name.startsWith('MHB'));
  let sx = 0, sz = 0, yaw = 0;
  if (stop) { sx = stop.spawn.x; sz = stop.spawn.z; }
  else if (mensa) { sx = mensa.spawn.x; sz = mensa.spawn.z; }
  if (mensa) yaw = Math.atan2(-(mensa.x - sx), -(mensa.z - sz));
  let q = null;
  try { q = new URLSearchParams(location.search).get('at'); } catch (e) { /* file:// */ }
  let sy = null;
  // ?at=x,z[,yaw[,y]] (debugging / screenshots)
  if (q) { const [x, z, a, y] = q.split(',').map(Number); if (Number.isFinite(x) && Number.isFinite(z)) { sx = x; sz = z; yaw = Number.isFinite(a) ? a : yaw; sy = Number.isFinite(y) ? y : null; } }
  game.spawn(sx, sz, yaw, sy);
}

export function teleportTo(game, place) {
  const s = place.spawn;
  game.spawn(s.x, s.z, s.yaw, s.y ?? null);
}
