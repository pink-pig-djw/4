// Automated walkability test ("walk bot"), runs the game's real collision + controller code in Node.
//  1. every teleport destination must be free and on the ground
//  2. a bot runs along every pedestrian path segment of the map (OSM footways/streets):
//     it must never fall through the ground, end up inside a building, or get stuck
//  3. random wanderers with jumps: no falling, no entering solids, no NaN
//  4. (interiors) every staircase is walked up and down
// Usage: node tools/walk-test.mjs [--quick]
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { Terrain, setTerrain, gradeSite, bridgeDecks } from '../src/world/terrain.js';
import { CollisionWorld } from '../src/physics/collision.js';
import { Controller, PLAYER } from '../src/physics/controller.js';
import { computeLayout } from '../src/world/layout.js';
import { addWorldColliders } from '../src/physics/colliders.js';
import { computePlaces } from '../src/world/places.js';
import { rng } from '../src/shared/geom.js';
import { buildInteriorColliders, ENTERABLE, interiorTestRoutes } from '../src/world/interiors/plan.js';

const quick = process.argv.includes('--quick');
const world = JSON.parse(readFileSync('data/world/suedgelaende.json', 'utf8'));
{ const T = await Terrain.fromWorld(world.terrain, inflateSync); gradeSite(world, T); setTerrain(T); }
const t0 = Date.now();
const layout = computeLayout(world);
const cw = new CollisionWorld(8);
const plans = buildInteriorColliders(world, cw);
const skip = new Set(plans.flatMap(p => p.buildingIdx));
addWorldColliders(world, layout, cw, skip);
cw.bounds = world.meta.bounds;
console.log(`colliders: ${cw.obstacles.length} obstacles, ${cw.surfaces.length} surfaces, ${cw.solids.length} solids  (${Date.now() - t0} ms)`);

const failures = [];
const fail = (kind, x, z, info = '') => failures.push({ kind, x: +x.toFixed(1), z: +z.toFixed(1), info });
const H = 1 / 120;

function nearbyTags(x, z) {
  const out = new Set();
  for (const o of cw._gather(x, z, 1.2, [])) if (o.tag) out.add(String(o.tag).replace(/^b\d+$/, 'building'));
  return [...out].join(',');
}

function checkState(c, label) {
  if (!Number.isFinite(c.x + c.y + c.z)) { fail('nan', 0, 0, label); return false; }
  if (c.y < cw.terrainAt(c.x, c.z) - 0.05) { fail('below-ground', c.x, c.z, label + ` y=${c.y.toFixed(2)}`); return false; }
  if (cw.solidAt(c.x, c.z, c.y, c.y + PLAYER.height)) { fail('inside-solid', c.x, c.z, label); return false; }
  return true;
}

// ---------- 1. teleport destinations ----------
const game = { world, cw, layout, plans };
const places = computePlaces(game);
let placeFails = 0;
for (const p of places) {
  const s = p.spawn;
  const c = new Controller(cw, s.x, s.z, 0);
  c.teleport(s.x, s.z, s.y ?? null, s.yaw);
  if (!cw.isFree(c.x, c.z, PLAYER.radius, c.y, c.y + PLAYER.height)) { fail('spawn-blocked', c.x, c.z, p.name); placeFails++; }
  // stand still one second: must stay put and grounded
  for (let i = 0; i < 120; i++) c.step(H, { fx: 0, fz: 0 });
  if (!c.onGround || Math.hypot(c.x - s.x, c.z - s.z) > 0.6) { fail('spawn-unstable', c.x, c.z, p.name); placeFails++; }
  checkState(c, 'spawn ' + p.name);
}
console.log(`1. teleport targets: ${places.length} checked, ${placeFails} problems`);

// ---------- 2. path walking ----------
function walkTo(c, tx, tz, maxT, label) {
  let t = 0, stuckT = 0, detour = 0, detourDir = 1, attempts = 0, bestD = Infinity;
  let lastX = c.x, lastZ = c.z;
  while (t < maxT) {
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    if (d < 0.7) return true;
    c.yaw = Math.atan2(-dx, -dz);
    const inp = detour > 0 ? { fx: detourDir, fz: 0.3, run: true } : { fx: 0, fz: 1, run: true };
    c.step(H, inp); t += H;
    if (detour > 0) detour -= H;
    if (!checkState(c, label)) return false;
    if ((Math.round(t / H) % 12) === 0) {
      const moved = Math.hypot(c.x - lastX, c.z - lastZ);
      lastX = c.x; lastZ = c.z;
      if (d < bestD - 0.05) { bestD = d; stuckT = 0; } else stuckT += H * 12;
      if (moved < 0.02 * 12 * H * 60 && detour <= 0) stuckT += 0;
      if (stuckT > 0.8 && detour <= 0) {
        attempts++;
        if (attempts > 6) return false;
        detourDir = attempts % 2 ? 1 : -1;
        detour = 0.35 + attempts * 0.25; stuckT = 0;
      }
    }
  }
  return false;
}

const N = world.nav.n, E = world.nav.e;
let walked = 0, blocked = 0, metres = 0;
const rnd = rng(7);
// an edge that runs along a bridge starts on the deck (not on the ground underneath)
const DECKS = bridgeDecks(world);
function deckStart(x, z, dx, dz) {
  for (const d of DECKS) {
    const a = (x - d.cx) * d.ux + (z - d.cz) * d.uz, b = -(x - d.cx) * d.uz + (z - d.cz) * d.ux;
    if (Math.abs(a) > d.hl + 0.5 || Math.abs(b) > d.hw || Math.abs(dx * d.ux + dz * d.uz) < 0.85) continue;
    return d.y0 + (d.y1 - d.y0) * Math.min(1, Math.max(0, (a + d.hl) / (2 * d.hl))) + 0.05;
  }
  return null;
}
const edges = E.filter(e => (e[2] & 1) && !(e[2] & 16));
const sample = quick ? edges.filter(() => rnd() < 0.15) : edges;
for (const [a, b, f, w] of sample) {
  const A = N[a], B = N[b];
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (len < 0.5) continue;
  // start slightly into the segment so we don't begin inside junction furniture
  const c = new Controller(cw, A[0], A[1], 0);
  c.teleport(A[0], A[1], deckStart(A[0], A[1], (B[0] - A[0]) / len, (B[1] - A[1]) / len));
  if (!cw.isFree(c.x, c.z, PLAYER.radius, c.y, c.y + PLAYER.height)) {
    // start blocked (e.g. node exactly at a lamp post): nudge
    let ok = false;
    for (let k = 0; k < 8 && !ok; k++) { const an = k / 8 * Math.PI * 2; c.teleport(A[0] + Math.cos(an) * 0.8, A[1] + Math.sin(an) * 0.8); ok = cw.isFree(c.x, c.z, PLAYER.radius, c.y, c.y + PLAYER.height); }
  }
  const ok = walkTo(c, B[0], B[1], len / 2 + 6, `edge ${a}-${b}`);
  walked++; metres += len;
  if (!ok) { blocked++; fail('path-blocked', c.x, c.z, `edge ${a}->${b} len ${len.toFixed(1)} near: ${nearbyTags(c.x, c.z)}`); }
}
console.log(`2. paths: ${walked} segments (${(metres / 1000).toFixed(1)} km) walked, ${blocked} blocked`);

// ---------- 3. random wanderers ----------
const [x0, z0, x1, z1] = world.meta.bounds;
const bots = quick ? 60 : 300;
let wanderSteps = 0;
for (let i = 0; i < bots; i++) {
  const n = N[Math.floor(rnd() * N.length)];
  const c = new Controller(cw, n[0], n[1], 0);
  c.teleport(n[0], n[1]);
  c.boundsSoft = [x0 + 2, z0 + 2, x1 - 2, z1 - 2];
  let fx = 0, fz = 1;
  for (let s = 0; s < 120 * 40; s++) {
    if (s % 90 === 0) { c.yaw += (rnd() - 0.5) * 2.5; fx = rnd() < 0.2 ? (rnd() - 0.5) * 2 : 0; }
    c.step(H, { fx, fz, run: rnd() < 0.5, jump: rnd() < 0.004 });
    wanderSteps++;
    if (!checkState(c, `wander ${i}`)) break;
  }
}
console.log(`3. wanderers: ${bots} bots, ${(wanderSteps / 120 / 60).toFixed(0)} min simulated`);

// ---------- 4. interiors (stairs, doors) ----------
let stairRoutes = 0, stairFails = 0;
for (const route of interiorTestRoutes(plans)) {
  stairRoutes++;
  const c = new Controller(cw, route.from.x, route.from.z, route.from.y);
  c.teleport(route.from.x, route.from.z, route.from.y);
  let ok = true;
  for (const wp of route.points) {
    if (!walkTo(c, wp.x, wp.z, 25, route.name)) { ok = false; break; }
    if (wp.y != null && Math.abs(c.y - wp.y) > 0.25) { ok = false; fail('wrong-level', c.x, c.z, `${route.name}: at y=${c.y.toFixed(2)} expected ${wp.y}`); break; }
  }
  if (!ok) { stairFails++; fail('interior-route', c.x, c.z, `${route.name} near: ${nearbyTags(c.x, c.z)} y=${c.y.toFixed(2)}`); }
}
console.log(`4. interior routes: ${stairRoutes} walked, ${stairFails} failed`);

// ---------- report ----------
const byKind = {};
for (const f of failures) (byKind[f.kind] ||= []).push(f);
console.log('\nsummary:', Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.length])));
for (const [k, v] of Object.entries(byKind)) {
  console.log(`\n${k}:`);
  for (const f of v.slice(0, 25)) console.log(`  (${f.x}, ${f.z}) ${f.info}`);
}
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures.length ? 1 : 0);
