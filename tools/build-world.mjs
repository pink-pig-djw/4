// Converts raw OpenStreetMap data (data/raw/<region>.osm.json) into a compact scene description
// (data/world/<region>.json) in local metres: x = east, z = south, y = up.
// Usage: node tools/build-world.mjs [region]
// Map data © OpenStreetMap contributors, ODbL 1.0.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { REGIONS } from './regions.mjs';
import { buildHeightmap, encodeHeightmap } from './dem.mjs';
import { Terrain } from '../src/world/terrain.js';
import {
  signedArea, area, orient, centroid, pointInPoly, distSegSq, closestOnSeg, polyBounds, cleanRing,
  labelPoint, rng, obb,
} from '../src/shared/geom.js';

const regionId = process.argv[2] || 'suedgelaende';
const region = REGIONS[regionId];
const raw = JSON.parse(readFileSync(`data/raw/${regionId}.osm.json`, 'utf8'));

// ---------- projection ----------
const [lat0, lon0] = region.origin;
const phi = lat0 * Math.PI / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const M_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
const proj = (lat, lon) => [(lon - lon0) * M_LON, -(lat - lat0) * M_LAT];
const r2 = v => Math.round(v * 100) / 100;
const rp = p => [r2(p[0]), r2(p[1])];

const [S, W, N, E] = region.bbox;
const [bx0, bz1] = proj(S, W), [bx1, bz0] = proj(N, E);
const BOUNDS = [bx0, bz0, bx1, bz1]; // x0,z0,x1,z1
const PAD = 60;
const inBounds = (x, z, pad = 0) => x >= bx0 - pad && x <= bx1 + pad && z >= bz0 - pad && z <= bz1 + pad;

// ---------- index ----------
const nodes = new Map(), ways = new Map(), rels = [];
for (const e of raw.elements) {
  if (e.type === 'node') { e.p = proj(e.lat, e.lon); nodes.set(e.id, e); }
  else if (e.type === 'way') ways.set(e.id, e);
  else rels.push(e);
}
const wayPts = w => w.nodes.map(id => nodes.get(id)).filter(Boolean).map(n => n.p);
const wayTouches = w => w.nodes.some(id => { const n = nodes.get(id); return n && inBounds(n.p[0], n.p[1]); });

// Assemble closed rings from a list of ways (for multipolygon relations).
function assembleRings(wayList) {
  const segs = wayList.map(w => w.nodes.slice());
  const rings = [];
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (ring[0] !== ring[ring.length - 1] && guard++ < 1000) {
      const end = ring[ring.length - 1];
      let idx = segs.findIndex(s => s[0] === end || s[s.length - 1] === end);
      if (idx < 0) break;
      let s = segs.splice(idx, 1)[0];
      if (s[0] !== end) s = s.slice().reverse();
      ring = ring.concat(s.slice(1));
    }
    if (ring.length >= 4 && ring[0] === ring[ring.length - 1]) {
      rings.push(ring.map(id => nodes.get(id)).filter(Boolean).map(n => n.p));
    }
  }
  return rings;
}

// Polygon sources: closed ways + multipolygon relations -> { tags, outer, holes, id }
const polys = [];
for (const w of ways.values()) {
  if (!w.tags) continue;
  if (w.nodes.length < 4 || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  if (!wayTouches(w)) continue;
  polys.push({ id: 'w' + w.id, tags: w.tags, outer: wayPts(w), holes: [], nodeIds: w.nodes });
}
for (const r of rels) {
  if (!r.tags || r.tags.type !== 'multipolygon') continue;
  const outers = [], inners = [];
  for (const m of r.members || []) {
    if (m.type !== 'way') continue;
    const w = ways.get(m.ref); if (!w) continue;
    (m.role === 'inner' ? inners : outers).push(w);
  }
  if (!outers.some(wayTouches)) continue;
  const oRings = assembleRings(outers), iRings = assembleRings(inners);
  for (const o of oRings) {
    const holes = iRings.filter(h => pointInPoly(h[0][0], h[0][1], o));
    polys.push({ id: 'r' + r.id, tags: r.tags, outer: o, holes, nodeIds: [] });
  }
}

// Clip polygon to an axis-aligned rectangle (Sutherland–Hodgman).
function clipRect(pts, x0, z0, x1, z1) {
  const clip = (pts, inside, inter) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(inter(a, b));
    }
    return out;
  };
  const lerpX = (a, b, x) => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])];
  const lerpZ = (a, b, z) => [a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]), z];
  pts = clip(pts, p => p[0] >= x0, (a, b) => lerpX(a, b, x0)); if (pts.length < 3) return [];
  pts = clip(pts, p => p[0] <= x1, (a, b) => lerpX(a, b, x1)); if (pts.length < 3) return [];
  pts = clip(pts, p => p[1] >= z0, (a, b) => lerpZ(a, b, z0)); if (pts.length < 3) return [];
  pts = clip(pts, p => p[1] <= z1, (a, b) => lerpZ(a, b, z1));
  return pts;
}
const clipToWorld = pts => clipRect(pts, bx0 - PAD, bz0 - PAD, bx1 + PAD, bz1 + PAD);

// Clip polyline to padded bounds, returns list of pieces.
function clipLine(pts) {
  const pieces = []; let cur = [];
  const x0 = bx0 - PAD, z0 = bz0 - PAD, x1 = bx1 + PAD, z1 = bz1 + PAD;
  const inside = p => p[0] >= x0 && p[0] <= x1 && p[1] >= z0 && p[1] <= z1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (inside(p)) { cur.push(p); }
    else {
      if (cur.length) { cur.push(p); pieces.push(cur); cur = []; }
      else if (i + 1 < pts.length && inside(pts[i + 1])) cur.push(p);
    }
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces.filter(pc => pc.length > 1);
}

// ---------- helpers for tags ----------
const num = v => { if (v == null) return NaN; const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
const COLORS = {
  white: 0xf2f0ea, grey: 0x9a9a9a, gray: 0x9a9a9a, lightgrey: 0xc8c8c8, darkgrey: 0x555555, black: 0x2b2b2b,
  red: 0xa04030, maroon: 0x7a3328, brown: 0x7a5238, orange: 0xd08a4a, yellow: 0xe8d38a, beige: 0xe0d2b0,
  cream: 0xefe6cc, green: 0x5f8a5a, blue: 0x4a6a9a, teal: 0x3f8f8a, silver: 0xb8bcc0, tan: 0xc9ad84, pink: 0xe2b8b0,
};
function parseColor(v) {
  if (!v) return null;
  v = String(v).trim().toLowerCase();
  if (v[0] === '#') {
    let h = v.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return Number.isFinite(n) ? n : null;
  }
  return COLORS[v] ?? null;
}

// ---------- buildings ----------
const BUILDING_KIND = t => t.building || t['building:part'] || 'yes';
const RESIDENTIAL = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'apartments', 'residential', 'dormitory', 'bungalow', 'farm']);
const SMALL = new Set(['garage', 'garages', 'shed', 'carport', 'service', 'hut', 'kiosk', 'container', 'static_caravan', 'transformer_tower', 'storage_tank']);
function levelHeight(kind, tags) {
  if (RESIDENTIAL.has(kind)) return 2.95;
  if (kind === 'parking') return 2.9;
  if (SMALL.has(kind)) return 2.7;
  if (kind === 'church' || kind === 'religious' || kind === 'chapel') return 4.5;
  if (kind === 'sports_centre' || kind === 'sports_hall' || kind === 'warehouse' || kind === 'industrial') return 5.5;
  return 3.75; // university / office / public
}
function defaultLevels(kind, a) {
  if (kind === 'house' || kind === 'detached' || kind === 'semidetached_house' || kind === 'terrace') return 2;
  if (kind === 'apartments' || kind === 'residential' || kind === 'dormitory') return a > 600 ? 5 : 4;
  if (SMALL.has(kind)) return 1;
  if (kind === 'roof') return 0;
  if (kind === 'university' || kind === 'office' || kind === 'college' || kind === 'public') return a > 1500 ? 3 : 2;
  if (kind === 'church') return 2;
  return a > 1200 ? 2 : a > 200 ? 2 : 1;
}

// Facade style keys (interpreted in the renderer):
//  ribbon   – 1960/70s concrete with continuous window bands (typical Südgelände)
//  lab      – concrete with punched window grid
//  panel    – modern dark or coloured panel facade (mdf / fibre cement)
//  glass    – glass curtain wall
//  brick    – clinker / brick facade
//  plaster  – rendered residential facade with punched windows
//  hall     – industrial / sports hall with top clerestory
//  deck     – parking deck, open bands
//  plain    – small blind structures
//  church   – plain plaster with tall narrow windows
function facadeStyle(kind, tags, a, levels) {
  const mat = (tags['building:material'] || tags['building:facade:material'] || '').toLowerCase();
  if (mat === 'glass') return 'glass';
  if (mat === 'brick') return 'brick';
  if (mat === 'mdf' || mat === 'metal' || mat === 'panel' || mat === 'wood') return 'panel';
  if (kind === 'parking') return 'deck';
  if (kind === 'church' || kind === 'chapel' || kind === 'religious') return 'church';
  if (SMALL.has(kind) || kind === 'roof') return 'plain';
  if (kind === 'sports_centre' || kind === 'sports_hall' || kind === 'warehouse' || kind === 'industrial' || kind === 'hangar') return 'hall';
  if (RESIDENTIAL.has(kind) || kind === 'house' || kind === 'school' || kind === 'kindergarten') return 'plaster';
  if (kind === 'university' || kind === 'college' || kind === 'office' || kind === 'public' || kind === 'research') {
    if (levels <= 1 && a > 500) return 'hall';
    return levels >= 3 ? 'ribbon' : 'lab';
  }
  if (kind === 'retail' || kind === 'commercial') return a > 400 ? 'hall' : 'plaster';
  return levels >= 3 ? 'plaster' : 'plaster';
}

const outlineRecs = [], partRecs = [];
for (const pl of polys) {
  const t = pl.tags;
  const isPart = !!t['building:part'] && !t.building;
  if (!t.building && !isPart) continue;
  if (t.building === 'no' || t['building:part'] === 'no') continue;
  if (t.location === 'underground' || t.layer && num(t.layer) < 0 && !isPart) continue;
  if (t.building === 'construction' && !t['building:levels']) continue;
  let outer = cleanRing(pl.outer);
  if (outer.length < 3) continue;
  outer = orient(outer, true);
  const c = centroid(outer);
  if (!inBounds(c[0], c[1], PAD)) continue;
  const holes = pl.holes.map(h => orient(cleanRing(h), false)).filter(h => h.length >= 3);
  const rec = { id: pl.id, tags: t, outer, holes, a: area(outer), c, isPart, nodeIds: pl.nodeIds };
  (isPart ? partRecs : outlineRecs).push(rec);
}

// Assign parts to outlines: part centroid inside outline.
for (const p of partRecs) {
  let best = null;
  for (const o of outlineRecs) {
    if (p.a > o.a * 1.05) continue;
    if (pointInPoly(p.c[0], p.c[1], o.outer) && (!best || o.a < best.a)) best = o;
  }
  p.parent = best;
  if (best) (best.parts ||= []).push(p);
}

const buildings = [];
const outlines = []; // named / relevant outlines used for labels, entrances, interiors
function heightInfo(rec, parentTags) {
  const t = rec.tags;
  const kindTag = t.building && t.building !== 'yes' ? t.building : (parentTags && parentTags.building) || t.building || 'yes';
  let kind = kindTag;
  if (kind === 'yes' && parentTags?.building) kind = parentTags.building;
  if (t.building === 'yes' && (t.amenity === 'university' || t.amenity === 'research_institute')) kind = 'university';
  const lh = levelHeight(kind, t);
  let levels = num(t['building:levels']);
  const minLevel = num(t['building:min_level']) || 0;
  if (!Number.isFinite(levels)) levels = defaultLevels(kind, rec.a);
  let roofShape = (t['roof:shape'] || '').toLowerCase();
  if (!roofShape) {
    if (RESIDENTIAL.has(kind) && rec.a < 400 && kind !== 'apartments' && kind !== 'dormitory') roofShape = 'gabled';
    else if ((kind === 'apartments' || kind === 'residential') && rec.a < 700) roofShape = 'gabled';
    else if (kind === 'garage' || kind === 'garages' || kind === 'carport') roofShape = 'flat';
    else roofShape = 'flat';
  }
  if (roofShape === 'many' || roofShape === 'yes') roofShape = 'flat';
  let roofH = num(t['roof:height']);
  const roofLevels = num(t['roof:levels']);
  if (!Number.isFinite(roofH)) {
    if (roofShape === 'flat') roofH = 0;
    else if (Number.isFinite(roofLevels) && roofLevels > 0) roofH = roofLevels * 2.6;
    else roofH = -1; // compute from footprint later
  }
  let h = num(t.height);
  let minH = num(t.min_height);
  if (!Number.isFinite(minH)) minH = minLevel * lh;
  let wallH;
  if (kind === 'roof' || t.building === 'roof' || t['building:part'] === 'roof') {
    // canopy
    if (!Number.isFinite(h)) h = Math.max(3.2, minH + 0.4);
    if (!Number.isFinite(num(t.min_height)) && !minLevel) minH = Math.max(2.6, h - 0.5);
    wallH = h; roofShape = 'flat'; roofH = 0;
  } else if (Number.isFinite(h)) {
    if (roofH < 0) roofH = Math.min(h * 0.35, 4.5);
    wallH = h - roofH;
  } else {
    wallH = Math.max(levels, 0.6) * lh + (roofShape === 'flat' ? 0.9 : 0.4); // parapet / plinth
    if (levels === 0) wallH = 3;
    if (roofH < 0) {
      const b = obb(rec.outer);
      const span = Math.min(b.hd * 2, 16);
      roofH = roofShape === 'skillion' ? Math.min(2, span * 0.15) : Math.min(span * 0.42, 6);
      if (roofShape === 'round' || roofShape === 'dome') roofH = Math.min(span * 0.3, 5);
    }
    h = wallH + roofH;
  }
  if (minH >= wallH) minH = Math.max(0, wallH - 1);
  return { kind, lh, levels, minLevel, roofShape, roofH, h, wallH, minH };
}

const PALETTE_PLASTER = [0xefe7d6, 0xf2ecdf, 0xe8dcc2, 0xe9e2d3, 0xf0e3c8, 0xe6d8c0, 0xdcd6c8, 0xf3efe6, 0xe9d7c3, 0xd9cfbd, 0xe7e0cf, 0xeadfcb];
const PALETTE_CONCRETE = [0xa8a49c, 0xb2aea5, 0x9f9b93, 0xb8b3a8, 0xaaa69d, 0xbdb8ad];
const PALETTE_ROOF_TILE = [0x9a4a36, 0x8c3f30, 0xa55a3f, 0x7c3b2e, 0x6e5a52, 0x94503c, 0x5d4c46];

function styleColor(style, tags, seed) {
  const c = parseColor(tags['building:colour']);
  if (c != null) return c;
  const r = rng(seed)();
  switch (style) {
    case 'plaster': case 'church': return PALETTE_PLASTER[Math.floor(r * PALETTE_PLASTER.length)];
    case 'brick': return 0x9a4e3a;
    case 'panel': return 0x3a3d40;
    case 'glass': return 0x6f8391;
    case 'hall': return [0xb9bcbd, 0xc8c6c0, 0xa9adb0, 0xd2cfc6][Math.floor(r * 4)];
    case 'deck': return 0xa9a69f;
    case 'plain': return [0xc9c4b8, 0xb9b5ac, 0xd8d2c4, 0xa8a49a][Math.floor(r * 4)];
    default: return PALETTE_CONCRETE[Math.floor(r * PALETTE_CONCRETE.length)];
  }
}
function roofColor(tags, roofShape, seed) {
  const c = parseColor(tags['roof:colour']);
  if (c != null) return c;
  if (roofShape === 'flat') return 0x8a8781;
  const r = rng(seed * 7 + 3)();
  return PALETTE_ROOF_TILE[Math.floor(r * PALETTE_ROOF_TILE.length)];
}
const idSeed = id => { let s = 0; for (const ch of id) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return s; };

function pushBuilding(rec, parentRec, outlineIndex) {
  const hi = heightInfo(rec, parentRec?.tags);
  const t = rec.tags;
  const seed = idSeed(rec.id);
  const style = facadeStyle(hi.kind, { ...(parentRec?.tags || {}), ...t }, (parentRec || rec).a, hi.levels);
  const colTags = { 'building:colour': t['building:colour'] || parentRec?.tags['building:colour'] };
  const b = {
    id: rec.id,
    p: rec.outer.map(rp),
    h: r2(hi.h), wh: r2(hi.wallH), mh: r2(hi.minH),
    lv: hi.levels, lh: hi.lh,
    rs: hi.roofShape, st: style,
    c: styleColor(style, colTags, seed),
    rc: roofColor({ 'roof:colour': t['roof:colour'] || parentRec?.tags['roof:colour'] }, hi.roofShape, seed),
    k: hi.kind,
    o: outlineIndex,
  };
  if (rec.holes.length) b.hl = rec.holes.map(h => h.map(rp));
  if (t['building:part'] && t.name) b.n = t.name;
  buildings.push(b);
  return b;
}

for (const o of outlineRecs) {
  const t = o.tags;
  const partsArea = (o.parts || []).reduce((s, p) => s + p.a, 0);
  let outlineIndex = -1;
  const relevant = t.name || t['addr:housenumber'] || (o.parts && o.parts.length) || /university|college|school|public|office|church|sports_centre|dormitory|parking/.test(t.building || '');
  if (relevant) {
    outlineIndex = outlines.length;
    outlines.push({
      id: o.id, p: o.outer.map(rp), n: t.name || null,
      a: t['addr:street'] ? `${t['addr:street']} ${t['addr:housenumber'] || ''}`.trim() : null,
      k: t.building, lv: num(t['building:levels']) || null, parts: [], ents: [],
    });
  }
  const bIdx = [];
  if (o.parts && partsArea > o.a * 0.6) {
    for (const p of o.parts) { buildings.length; bIdx.push(buildings.length); pushBuilding(p, o, outlineIndex); }
    // if parts cover the outline only partly, keep outline as a low filler below parts
    if (partsArea < o.a * 0.92) {
      const fill = pushBuilding(o, null, outlineIndex);
      fill.filler = 1;
      bIdx.push(buildings.length - 1);
    }
  } else {
    bIdx.push(buildings.length);
    pushBuilding(o, null, outlineIndex);
  }
  if (outlineIndex >= 0) outlines[outlineIndex].parts = bIdx;
}
// orphan parts (no outline)
for (const p of partRecs) if (!p.parent) pushBuilding(p, null, -1);

// ---------- highways ----------
const ROAD_W = {
  motorway: 11, trunk: 9, primary: 8, secondary: 7.5, tertiary: 7, unclassified: 5.5, residential: 5.5,
  living_street: 5, service: 3.6, track: 3, pedestrian: 4, footway: 2.2, cycleway: 2.3, path: 1.8, steps: 2.2,
  bridleway: 2, platform: 2, bus_stop: 0, motorway_link: 6, trunk_link: 6, primary_link: 6, secondary_link: 6, tertiary_link: 5.5,
};
const MOTOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
function surfaceKey(s, hw) {
  s = (s || '').toLowerCase();
  if (/^asphalt|chipseal/.test(s)) return 'asphalt';
  if (/paving_stones|paved|concrete:plates|concrete:lanes|interlock/.test(s)) return 'pavers';
  if (s === 'concrete') return 'concrete';
  if (/sett|cobble|pebblestone/.test(s)) return 'sett';
  if (/compacted|fine_gravel|gravel|woodchips/.test(s)) return 'gravel';
  if (/dirt|ground|earth|mud|unpaved|sand/.test(s)) return 'dirt';
  if (/grass/.test(s)) return 'grasspave';
  if (/wood|metal/.test(s)) return 'wood';
  if (/rubber|tartan|acrylic/.test(s)) return 'tartan';
  if (MOTOR.has(hw) || hw === 'cycleway') return 'asphalt';
  if (hw === 'footway' || hw === 'pedestrian' || hw === 'platform') return 'pavers';
  if (hw === 'steps') return 'concrete';
  if (hw === 'track') return 'gravel';
  if (hw === 'path') return 'gravel';
  return 'asphalt';
}
function sidewalks(t) {
  const v = s => s === 'yes' || s === 'both';
  let l = false, r = false;
  const sw = t.sidewalk || t['sidewalk:both'];
  if (sw === 'both' || sw === 'yes') { l = r = true; }
  else if (sw === 'left') l = true;
  else if (sw === 'right') r = true;
  if (t['sidewalk:left'] === 'yes') l = true;
  if (t['sidewalk:right'] === 'yes') r = true;
  if (v(t['sidewalk:both'])) l = r = true;
  return [l ? 2 : 0, r ? 2 : 0];
}

const roads = [];
const navWays = [];
const crossingsNodes = new Set();
for (const w of ways.values()) {
  const t = w.tags; if (!t || !t.highway) continue;
  const hw = t.highway;
  if (!(hw in ROAD_W) || hw === 'bus_stop') continue;
  if (t.area === 'yes') continue;
  if (t.indoor === 'yes' || hw === 'corridor') continue;
  if (t.level && num(t.level) !== 0 && !t.layer) continue;
  if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') continue;
  if (t.access === 'no' && hw === 'service' && false) continue;
  if (!wayTouches(w)) continue;
  const all = wayPts(w);
  let width = num(t.width);
  if (!Number.isFinite(width) || width < 0.8 || width > 25) {
    width = ROAD_W[hw];
    const lanes = num(t.lanes);
    if (MOTOR.has(hw) && Number.isFinite(lanes) && lanes >= 1 && hw !== 'service') width = Math.max(width, lanes * 3.1);
    if (hw === 'service' && t.service === 'parking_aisle') width = 5;
    if (hw === 'service' && (t.service === 'driveway')) width = 3;
  }
  if (t.footway === 'sidewalk' || t.footway === 'crossing') width = Math.min(width, 2.2);
  const surf = surfaceKey(t.surface, hw);
  const sw = MOTOR.has(hw) ? sidewalks(t) : [0, 0];
  for (const pc of clipLine(all)) {
    const rec = { p: pc.map(rp), w: r2(width), k: hw, s: surf };
    if (t.name) rec.n = t.name;
    if (sw[0] || sw[1]) rec.sw = sw;
    if (t.oneway === 'yes') rec.ow = 1;
    if (t.bridge && t.bridge !== 'no') rec.br = 1;
    if (t.service) rec.sv = t.service;
    if (t.footway) rec.fw = t.footway;
    if (t.lit === 'yes' || t.lit === 'automatic') rec.lit = 1;
    if (t.cycleway === 'lane' || t['cycleway:both'] === 'lane' || t['cycleway:right'] === 'lane' || t['cycleway:left'] === 'lane') rec.cl = 1;
    roads.push(rec);
  }
  navWays.push(w);
}

// ---------- areas ----------
const areas = [];
function areaKind(t) {
  if (t.building || t['building:part']) return null;
  if (t['area:highway']) {
    const ah = t['area:highway'];
    if (ah === 'traffic_island') return 'island';
    if (ah === 'footway' || ah === 'pedestrian' || ah === 'path' || ah === 'platform') return 'paved';
    if (ah === 'cycleway') return 'road';
    return 'road';
  }
  if (t.highway === 'pedestrian' && (t.area === 'yes' || t.type === 'multipolygon')) return 'paved';
  if ((t.highway === 'footway' || t.highway === 'platform' || t.highway === 'service' || t.highway === 'path') && t.area === 'yes') return 'paved';
  if (t.public_transport === 'platform' && t.area === 'yes') return 'paved';
  if (t.amenity === 'parking' && (!t.parking || t.parking === 'surface' || t.parking === 'lane')) return 'parking';
  if (t.amenity === 'bicycle_parking' && t.area !== 'no') return 'paved';
  if (t.natural === 'water' || t.landuse === 'basin' || t.landuse === 'reservoir' || t.waterway === 'riverbank') return 'water';
  if (t.natural === 'wetland') return 'wetland';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.natural === 'scrub' || t.natural === 'heath') return 'scrub';
  if (t.leisure === 'pitch') {
    const s = (t.surface || '').toLowerCase(), sp = (t.sport || '').toLowerCase();
    if (/tartan|rubber|acrylic/.test(s)) return 'tartan';
    if (/artificial_turf/.test(s)) return 'turf';
    if (/clay/.test(s) || sp === 'tennis') return 'clay';
    if (/asphalt|concrete|paved/.test(s) || /basketball|streetball/.test(sp)) return 'court';
    if (/sand/.test(s) || /beachvolleyball/.test(sp)) return 'sand';
    return 'pitchgrass';
  }
  if (t.leisure === 'track') return 'tartan';
  if (t.leisure === 'playground') return 'playground';
  if (t.landuse === 'grass' || t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'recreation_ground' || t.landuse === 'village_green' || t.leisure === 'common') return 'grass';
  if (t.landuse === 'meadow' || t.natural === 'grassland' || t.landuse === 'greenfield') return 'meadow';
  if (t.landuse === 'farmland' || t.landuse === 'allotments' || t.landuse === 'orchard') return 'farmland';
  if (t.landuse === 'construction' || t.landuse === 'brownfield') return 'construction';
  if (t.natural === 'sand' || t.natural === 'bare_rock') return 'sand';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'grass';
  if (t.leisure === 'sports_centre' && !t.building) return null;
  return null;
}
const AREA_ORDER = { farmland: 0, meadow: 1, grass: 2, forest: 2, wetland: 2, scrub: 3, construction: 3, pitchgrass: 4, turf: 4, clay: 4, court: 4, tartan: 4, sand: 4, playground: 4, parking: 5, paved: 6, island: 7, road: 7, water: 8 };
for (const pl of polys) {
  const k = areaKind(pl.tags);
  if (!k) continue;
  let outer = clipToWorld(orient(cleanRing(pl.outer), true));
  if (outer.length < 3 || area(outer) < 4) continue;
  const holes = pl.holes.map(h => orient(cleanRing(h), false)).filter(h => h.length >= 3);
  const rec = { p: outer.map(rp), k, o: AREA_ORDER[k] ?? 3 };
  if (holes.length) rec.hl = holes.map(h => h.map(rp));
  if (k === 'parking') { rec.cap = num(pl.tags.capacity) || null; if (pl.tags.name) rec.n = pl.tags.name; }
  if (pl.tags.sport) rec.sp = pl.tags.sport;
  areas.push(rec);
}
areas.sort((a, b) => a.o - b.o);

// ---------- waterways (lines) ----------
const waterways = [];
for (const w of ways.values()) {
  const t = w.tags; if (!t || !t.waterway) continue;
  if (!['stream', 'ditch', 'drain', 'river', 'canal'].includes(t.waterway)) continue;
  if (t.tunnel && t.tunnel !== 'no') continue;
  if (t.layer && num(t.layer) < 0) continue;
  if (!wayTouches(w)) continue;
  for (const pc of clipLine(wayPts(w))) waterways.push({ p: pc.map(rp), w: t.waterway === 'river' ? 12 : t.waterway === 'stream' ? 2 : 1.2, k: t.waterway });
}

// ---------- barriers ----------
const barriers = [];
for (const w of ways.values()) {
  const t = w.tags; if (!t || !t.barrier) continue;
  const k = t.barrier;
  if (!['fence', 'hedge', 'wall', 'retaining_wall', 'guard_rail', 'city_wall', 'handrail'].includes(k)) continue;
  if (!wayTouches(w)) continue;
  let h = num(t.height);
  if (!Number.isFinite(h)) h = k === 'hedge' ? 1.3 : k === 'wall' ? 1.6 : k === 'retaining_wall' ? 0.6 : k === 'guard_rail' ? 0.75 : k === 'handrail' ? 1.0 : 1.5;
  // split at gate nodes (leave 3.2 m openings)
  const gates = new Set(w.nodes.filter(id => { const n = nodes.get(id); return n?.tags && (n.tags.barrier === 'gate' || n.tags.barrier === 'swing_gate' || n.tags.barrier === 'lift_gate' || n.tags.barrier === 'entrance' || n.tags.entrance); }));
  const pts = w.nodes.map(id => nodes.get(id)).filter(Boolean);
  for (const pc of clipLine(pts.map(n => n.p))) {
    const rec = { p: pc.map(rp), k, h: r2(h) };
    const gIdx = [];
    pc.forEach((p, i) => { const n = pts.find(n => n.p === p); if (n && gates.has(n.id)) gIdx.push(i); });
    if (gIdx.length) rec.g = gIdx;
    barriers.push(rec);
  }
}

// ---------- points ----------
const trees = [], benches = [], bikes = [], lamps = [], stops = [], bins = [], misc = [], entrances = [], crossings = [], bollards = [], signals = [];
// Road segment index for orientation queries
const CELL = 25;
const segGrid = new Map();
function addSeg(x0, z0, x1, z1, rec) {
  const cx0 = Math.floor(Math.min(x0, x1) / CELL), cx1 = Math.floor(Math.max(x0, x1) / CELL);
  const cz0 = Math.floor(Math.min(z0, z1) / CELL), cz1 = Math.floor(Math.max(z0, z1) / CELL);
  for (let i = cx0; i <= cx1; i++) for (let j = cz0; j <= cz1; j++) {
    const key = i + ',' + j; let a = segGrid.get(key); if (!a) segGrid.set(key, a = []);
    a.push([x0, z0, x1, z1, rec]);
  }
}
for (const r of roads) for (let i = 0; i < r.p.length - 1; i++) addSeg(r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], r);
function nearestSeg(x, z, maxD, filter) {
  let best = null, bd = maxD * maxD;
  const c0 = Math.floor((x - maxD) / CELL), c1 = Math.floor((x + maxD) / CELL);
  const d0 = Math.floor((z - maxD) / CELL), d1 = Math.floor((z + maxD) / CELL);
  const seen = new Set();
  for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
    const a = segGrid.get(i + ',' + j); if (!a) continue;
    for (const s of a) {
      if (seen.has(s)) continue; seen.add(s);
      if (filter && !filter(s[4])) continue;
      const d = distSegSq(x, z, s[0], s[1], s[2], s[3]);
      if (d < bd) { bd = d; best = s; }
    }
  }
  return best ? { seg: best, d: Math.sqrt(bd) } : null;
}
// Direction a point-object should face: toward the nearest walkable line.
function faceToward(x, z, maxD = 12, filter) {
  const ns = nearestSeg(x, z, maxD, filter);
  if (!ns) return null;
  const [ax, az, bx, bz] = ns.seg;
  const [cx, cz] = closestOnSeg(x, z, ax, az, bx, bz);
  let dx = cx - x, dz = cz - z;
  const l = Math.hypot(dx, dz);
  const along = Math.atan2(bz - az, bx - ax);
  if (l < 0.05) return { yaw: along + Math.PI / 2, d: 0, along };
  return { yaw: Math.atan2(dz, dx), d: l, along };
}
const dirTag = v => { const d = num(v); return Number.isFinite(d) ? d : null; };
// OSM direction = compass degrees (0 = north, clockwise). Our yaw = atan2(dz, dx) with z south.
const compassToYaw = deg => (deg - 90) * Math.PI / 180;

// building rendered polygons for point-in-building tests
const bGrid = new Map();
buildings.forEach((b, i) => {
  const [x0, z0, x1, z1] = polyBounds(b.p);
  for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
    for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
      const k = gx + ',' + gz; let a = bGrid.get(k); if (!a) bGrid.set(k, a = []); a.push(i);
    }
});
function buildingAt(x, z, maxMinH = 2.2) {
  const a = bGrid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
  if (!a) return -1;
  for (const i of a) { const b = buildings[i]; if (b.mh <= maxMinH && pointInPoly(x, z, b.p)) return i; }
  return -1;
}

const wayNodeSet = new Set();
for (const w of ways.values()) if (w.tags?.building || w.tags?.['building:part']) for (const id of w.nodes) wayNodeSet.add(id);

for (const n of nodes.values()) {
  const t = n.tags; if (!t) continue;
  const [x, z] = n.p;
  if (!inBounds(x, z)) continue;
  const inB = buildingAt(x, z) >= 0 && !wayNodeSet.has(n.id);
  if (t.natural === 'tree') {
    if (inB) continue;
    const h = num(t.height);
    const leaf = t.leaf_type === 'needleleaved' ? 1 : 0;
    trees.push([r2(x), r2(z), leaf, Number.isFinite(h) ? h : 0]);
  } else if (t.amenity === 'bench' || t.leisure === 'picnic_table' || t.amenity === 'lounger') {
    if (inB) continue;
    let yaw = dirTag(t.direction) != null ? compassToYaw(dirTag(t.direction)) : null;
    if (yaw == null) { const f = faceToward(x, z, 12, r => !MOTOR.has(r.k) || r.k === 'service' || r.k === 'living_street'); yaw = f ? f.yaw : 0; }
    benches.push([r2(x), r2(z), r2(yaw), t.leisure === 'picnic_table' ? 1 : t.amenity === 'lounger' ? 2 : 0, t.backrest === 'no' ? 0 : 1]);
  } else if (t.amenity === 'bicycle_parking') {
    if (inB) continue;
    const cap = Math.min(num(t.capacity) || 10, 60);
    const f = faceToward(x, z, 15);
    bikes.push([r2(x), r2(z), r2(f ? f.along : 0), cap, t.covered === 'yes' || t.bicycle_parking === 'shed' ? 1 : 0]);
  } else if (t.highway === 'street_lamp' || t.man_made === 'lamp') {
    if (inB) continue;
    lamps.push([r2(x), r2(z), 0]);
  } else if (t.highway === 'bus_stop' || (t.public_transport === 'platform' && t.bus === 'yes')) {
    const f = faceToward(x, z, 25, r => MOTOR.has(r.k) && r.k !== 'service');
    stops.push({ x: r2(x), z: r2(z), n: t.name || null, sh: t.shelter === 'yes' ? 1 : 0, bn: t.bench === 'yes' ? 1 : 0, yaw: r2(f ? f.yaw : 0), along: r2(f ? f.along : 0) });
  } else if (t.amenity === 'waste_basket') {
    if (!inB) bins.push([r2(x), r2(z)]);
  } else if (t.amenity === 'vending_machine' || t.amenity === 'post_box' || t.amenity === 'bicycle_repair_station' || t.amenity === 'recycling' || t.amenity === 'charging_station' || t.amenity === 'grit_bin' || t.man_made === 'street_cabinet') {
    if (inB) continue;
    const k = t.amenity || t.man_made;
    const f = faceToward(x, z, 10);
    misc.push([r2(x), r2(z), k, r2(f ? f.yaw : 0)]);
  } else if (t.highway === 'crossing' || t.crossing) {
    crossings.push([r2(x), r2(z), (t.crossing === 'zebra' || t.crossing_ref === 'zebra' || t.crossing === 'marked' || t['crossing:markings'] === 'zebra') ? 1 : t.crossing === 'traffic_signals' ? 2 : 0]);
  } else if (t.barrier === 'bollard') {
    if (!inB) bollards.push([r2(x), r2(z)]);
  } else if (t.highway === 'traffic_signals') {
    signals.push([r2(x), r2(z)]);
  }
}

// tree rows
for (const w of ways.values()) {
  const t = w.tags; if (!t || t.natural !== 'tree_row' || !wayTouches(w)) continue;
  const pts = wayPts(w);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 9));
    for (let k = 0; k < n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
      if (inBounds(x, z) && buildingAt(x, z) < 0) trees.push([r2(x), r2(z), 0, 0]);
    }
  }
}
// bicycle parking mapped as ways/areas → represent by centroid + orientation along long axis
for (const w of ways.values()) {
  const t = w.tags; if (!t || t.amenity !== 'bicycle_parking' || !wayTouches(w)) continue;
  const pts = wayPts(w);
  const closed = w.nodes[0] === w.nodes[w.nodes.length - 1];
  const ring = closed ? pts.slice(0, -1) : pts;
  if (ring.length < 2) continue;
  let c, along, len;
  if (closed && ring.length >= 3) { const b = obb(ring); c = [b.cx, b.cz]; along = b.angle; len = b.hw * 2; }
  else { const a = ring[0], b = ring[ring.length - 1]; c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; along = Math.atan2(b[1] - a[1], b[0] - a[0]); len = Math.hypot(b[0] - a[0], b[1] - a[1]); }
  if (!inBounds(c[0], c[1])) continue;
  const cap = Math.min(num(t.capacity) || Math.max(4, Math.round(len / 0.9) * 2), 80);
  bikes.push([r2(c[0]), r2(c[1]), r2(along), cap, t.covered === 'yes' || t.bicycle_parking === 'shed' ? 1 : 0, r2(len)]);
}

// ---------- entrances ----------
// entrance nodes on building outlines: attach to the nearest rendered wall edge
for (const n of nodes.values()) {
  const t = n.tags; if (!t || !t.entrance) continue;
  if (t.entrance === 'emergency' && Math.random() < 0) continue;
  const [x, z] = n.p;
  if (!inBounds(x, z)) continue;
  let best = null, bd = 0.8 * 0.8;
  const cands = bGrid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) || [];
  for (const i of cands) {
    const b = buildings[i];
    if (b.mh > 0.5 || b.filler) continue;
    for (let k = 0; k < b.p.length; k++) {
      const a = b.p[k], c = b.p[(k + 1) % b.p.length];
      const d = distSegSq(x, z, a[0], a[1], c[0], c[1]);
      if (d < bd) { bd = d; best = { i, k, a, c }; }
    }
  }
  if (!best) continue;
  const { i, a, c } = best;
  const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 1.2) continue;
  const [px, pz] = closestOnSeg(x, z, a[0], a[1], c[0], c[1]);
  const e = { x: r2(px), z: r2(pz), nx: r2(dz / L), nz: r2(-dx / L), b: i, k: t.entrance, w: t.entrance === 'main' ? 2.4 : t.entrance === 'service' ? 3 : 1.6 };
  if (t.name || t.ref) e.n = t.name || t.ref;
  entrances.push(e);
  const oi = buildings[i].o;
  if (oi >= 0) outlines[oi].ents.push(entrances.length - 1);
}

// forest trees are scattered at load time from the forest areas (see src/world/layout.js)
const forestTrees = 0;

// ---------- extra lamps along lit roads where no lamp is mapped nearby ----------
const lampGrid = new Map();
const lampKey = (x, z) => Math.floor(x / 20) + ',' + Math.floor(z / 20);
for (const l of lamps) { const k = lampKey(l[0], l[1]); (lampGrid.get(k) || lampGrid.set(k, []).get(k)).push(l); }
function lampNear(x, z, d) {
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const a = lampGrid.get((Math.floor(x / 20) + i) + ',' + (Math.floor(z / 20) + j)); if (!a) continue;
    for (const l of a) if (Math.hypot(l[0] - x, l[1] - z) < d) return true;
  }
  return false;
}
let genLamps = 0;
for (const r of roads) {
  if (!r.lit || !MOTOR.has(r.k) || r.k === 'service' && r.w < 4) continue;
  let acc = 12, side = 1;
  for (let i = 0; i < r.p.length - 1; i++) {
    const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1];
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    let s = acc;
    while (s < L) {
      const off = r.w / 2 + (r.sw ? 1.6 : 0.7);
      const x = ax + ux * s + (-uz) * off * side, z = az + uz * s + ux * off * side;
      if (inBounds(x, z) && !lampNear(x, z, 22) && buildingAt(x, z) < 0) {
        const l = [r2(x), r2(z), 1]; lamps.push(l);
        const k = lampKey(x, z); (lampGrid.get(k) || lampGrid.set(k, []).get(k)).push(l);
        genLamps++;
      }
      s += 32; side = -side;
    }
    acc = s - L;
  }
}

// ---------- navigation graph for NPCs ----------
const WALK = new Set(['footway', 'path', 'pedestrian', 'living_street', 'residential', 'service', 'cycleway', 'track', 'unclassified', 'tertiary', 'secondary', 'primary', 'steps', 'platform', 'bridleway']);
const navIndex = new Map(); const navNodes = []; const navEdges = [];
function navNode(id) {
  let i = navIndex.get(id);
  if (i == null) { const n = nodes.get(id); i = navNodes.length; navIndex.set(id, i); navNodes.push(rp(n.p)); }
  return i;
}
for (const w of navWays) {
  const t = w.tags; const hw = t.highway;
  if (!WALK.has(hw)) continue;
  if (t.access === 'private' || t.foot === 'no') continue;
  const ids = w.nodes.filter(id => nodes.get(id));
  const width = roads.find(r => false);
  for (let i = 0; i < ids.length - 1; i++) {
    const a = nodes.get(ids[i]).p, b = nodes.get(ids[i + 1]).p;
    if (!inBounds(a[0], a[1], -5) || !inBounds(b[0], b[1], -5)) continue;
    // drop segments that pass through a building anywhere along their length
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let through = false;
    for (let d = 0; d <= segLen && !through; d += 0.8) {
      const f = segLen > 0 ? d / segLen : 0;
      if (buildingAt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 3) >= 0) through = true;
    }
    if (through || buildingAt(b[0], b[1], 3) >= 0) continue;
    // flags: 1 pedestrian ok, 2 bike ok, 4 has sidewalk (walk offset outside), 8 motor road, 16 steps
    let f = 0;
    const motor = MOTOR.has(hw);
    if (hw !== 'cycleway' || t.foot === 'designated' || t.foot === 'yes' || t.segregated) f |= 1;
    if (hw === 'cycleway' || motor || t.bicycle === 'designated' || t.bicycle === 'yes' || hw === 'track' || (hw === 'path' && t.bicycle !== 'no') || (hw === 'footway' && t.bicycle === 'yes')) f |= 2;
    if (hw === 'steps') { f = 1 | 16; }
    if (motor) f |= 8;
    const sw = motor ? sidewalks(t) : [0, 0];
    if (sw[0] || sw[1]) f |= 4;
    let wdt = num(t.width); if (!Number.isFinite(wdt)) wdt = ROAD_W[hw] || 2;
    if (hw === 'footway' && t.footway === 'sidewalk') wdt = 2;
    navEdges.push([navNode(ids[i]), navNode(ids[i + 1]), f, r2(wdt)]);
  }
}

// ---------- labels & places ----------
const labels = [];
for (const [i, o] of outlines.entries()) {
  if (!o.n) continue;
  const lp = labelPoint(o.p);
  labels.push({ t: 'b', n: o.n, x: r2(lp[0]), z: r2(lp[1]), o: i, a: o.a });
}
for (const b of buildings) if (b.n) {
  const lp = labelPoint(b.p);
  labels.push({ t: 'p', n: b.n, x: r2(lp[0]), z: r2(lp[1]) });
}
// named POIs from nodes (cafes, library …)
for (const n of nodes.values()) {
  const t = n.tags; if (!t || !t.name) continue;
  if (!inBounds(n.p[0], n.p[1])) continue;
  if (['cafe', 'fast_food', 'restaurant', 'library', 'pharmacy', 'bank', 'kindergarten'].includes(t.amenity) || t.shop) {
    labels.push({ t: 'poi', n: t.name, x: r2(n.p[0]), z: r2(n.p[1]), k: t.amenity || 'shop' });
  }
}
// street names: longest named road segment middle
const streetBest = new Map();
for (const r of roads) {
  if (!r.n || !MOTOR.has(r.k) && r.k !== 'pedestrian' && r.k !== 'cycleway') continue;
  let L = 0; for (let i = 0; i < r.p.length - 1; i++) L += Math.hypot(r.p[i + 1][0] - r.p[i][0], r.p[i + 1][1] - r.p[i][1]);
  const cur = streetBest.get(r.n);
  if (!cur || L > cur.L) streetBest.set(r.n, { L, r });
}
for (const [name, { r }] of streetBest) {
  // midpoint along polyline
  let L = 0; const seg = [];
  for (let i = 0; i < r.p.length - 1; i++) { const l = Math.hypot(r.p[i + 1][0] - r.p[i][0], r.p[i + 1][1] - r.p[i][1]); seg.push(l); L += l; }
  let acc = 0, x = r.p[0][0], z = r.p[0][1], ang = 0;
  for (let i = 0; i < seg.length; i++) {
    if (acc + seg[i] >= L / 2) {
      const t = (L / 2 - acc) / seg[i];
      x = r.p[i][0] + (r.p[i + 1][0] - r.p[i][0]) * t; z = r.p[i][1] + (r.p[i + 1][1] - r.p[i][1]) * t;
      ang = Math.atan2(r.p[i + 1][1] - r.p[i][1], r.p[i + 1][0] - r.p[i][0]);
      break;
    }
    acc += seg[i];
  }
  if (inBounds(x, z)) labels.push({ t: 's', n: name, x: r2(x), z: r2(z), r: r2(ang) });
}

// ---------- street name signs at junctions ----------
const nodeUse = new Map();
for (const w of navWays) {
  const t = w.tags; if (!t.name || !MOTOR.has(t.highway) || t.highway === 'service') continue;
  for (const id of w.nodes) { let s = nodeUse.get(id); if (!s) nodeUse.set(id, s = new Map()); s.set(t.name, w); }
}
const streetSigns = [];
for (const [id, m] of nodeUse) {
  if (m.size < 2) continue;
  const n = nodes.get(id); if (!n || !inBounds(n.p[0], n.p[1])) continue;
  const names = [...m.keys()].slice(0, 2);
  // place pole at a corner: offset diagonally between the two road directions
  const dirs = names.map(nm => {
    const w = m.get(nm); const k = w.nodes.indexOf(id);
    const nb = nodes.get(w.nodes[k + 1] ?? w.nodes[k - 1]);
    return Math.atan2(nb.p[1] - n.p[1], nb.p[0] - n.p[0]);
  });
  const mid = Math.atan2(Math.sin(dirs[0]) + Math.sin(dirs[1]), Math.cos(dirs[0]) + Math.cos(dirs[1]));
  const wmax = Math.max(...names.map(nm => ROAD_W[m.get(nm).tags.highway] || 6));
  const off = wmax / 2 + 2.2;
  const x = n.p[0] + Math.cos(mid) * off * 1.2, z = n.p[1] + Math.sin(mid) * off * 1.2;
  if (buildingAt(x, z) >= 0) continue;
  streetSigns.push({ x: r2(x), z: r2(z), n: names, d: dirs.map(r2) });
}

// ---------- terrain (DGM1) ----------
let terrain = null;
if (region.dem) {
  const CELL = 3, Q = 0.05;
  const unproj = (x, z) => [lat0 - z / M_LAT, lon0 + x / M_LON];
  const pad = 150;
  const H = await buildHeightmap('data/raw/dgm1', [BOUNDS[0] - pad, BOUNDS[1] - pad, BOUNDS[2] + pad, BOUNDS[3] + pad], unproj, CELL);
  if (H) {
    const rel = new Float32Array(H.hm.length);
    const T0 = new Terrain({ x0: H.x0, z0: H.z0, cell: H.cell, nx: H.nx, nz: H.nz, ref: 0 }, H.hm);
    const ref = T0.height(0, 0);
    for (let k = 0; k < rel.length; k++) rel[k] = H.hm[k] - ref;
    const T = new Terrain({ x0: H.x0, z0: H.z0, cell: H.cell, nx: H.nx, nz: H.nz, ref }, rel);
    terrain = { x0: r2(H.x0), z0: r2(H.z0), cell: H.cell, nx: H.nx, nz: H.nz, ref: r2(ref), q: Q, data: encodeHeightmap(H, ref, Q) };
    // make the stored origin exact (x0/z0 rounded above)
    terrain.x0 = H.x0; terrain.z0 = H.z0;
    // building bases: all parts of one building complex share a floor level (terrain at the
    // complex's label point); walls reach down to the lowest ground under the part
    // The floor level is set by the ground in front of the entrances (buildings are entered at
    // grade); without mapped entrances the ground at the label point is used.
    const entsOf = new Map();
    entrances.forEach(e => { if (!entsOf.has(e.b)) entsOf.set(e.b, []); entsOf.get(e.b).push(e); });
    const doorLevel = (ents, poly) => {
      if (ents.length) return ents.reduce((s, e) => s + T.height(e.x + e.nx * 1.2, e.z + e.nz * 1.2), 0) / ents.length;
      const lp = labelPoint(poly); return T.height(lp[0], lp[1]);
    };
    const baseOf = new Map();
    for (const o of outlines) {
      const ents = (o.parts || []).flatMap(i => entsOf.get(i) || []);
      const y0 = doorLevel(ents, o.p);
      for (const i of o.parts || []) baseOf.set(i, y0);
    }
    buildings.forEach((b, i) => {
      const y0 = baseOf.has(i) ? baseOf.get(i) : doorLevel(entsOf.get(i) || [], b.p);
      const [lo] = T.range(b.p);
      b.y0 = r2(y0); b.yb = r2(Math.min(lo, y0));
    });
    // bridge decks run straight between the ground at their two ends
    for (const r of roads) if (r.br) r.by = [r2(T.height(r.p[0][0], r.p[0][1])), r2(T.height(r.p[r.p.length - 1][0], r.p[r.p.length - 1][1]))];
    const [lo, hi] = T.range([[BOUNDS[0], BOUNDS[1]], [BOUNDS[2], BOUNDS[3]], [BOUNDS[0], BOUNDS[3]], [BOUNDS[2], BOUNDS[1]]]);
    let mn = Infinity, mx = -Infinity; for (const v of rel) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    console.log(`terrain ${H.nx}×${H.nz} @ ${CELL} m from ${H.tiles} DGM1 tiles, origin ${ref.toFixed(1)} m a.s.l., range ${mn.toFixed(1)}..${mx.toFixed(1)} m, ${H.missing} samples filled, ${(terrain.data.length / 1024).toFixed(0)} KB`);
  } else console.warn('no DGM tiles found – flat terrain');
}

// ---------- output ----------
const world = {
  meta: {
    region: regionId, name: region.name, origin: region.origin, bounds: BOUNDS.map(r2),
    osmBase: raw.osm3s?.timestamp_osm_base || null,
    attribution: '© OpenStreetMap contributors (ODbL)' + (terrain ? ' · Gelände: Bayerische Vermessungsverwaltung, DGM1 (CC BY 4.0)' : ''),
  },
  terrain,
  buildings, outlines, roads, areas, waterways, barriers,
  trees, benches, bikes, lamps, stops, bins, misc, entrances, crossings, bollards, signals,
  nav: { n: navNodes, e: navEdges },
  labels, streetSigns,
};
mkdirSync('data/world', { recursive: true });
const out = `data/world/${regionId}.json`;
writeFileSync(out, JSON.stringify(world));
console.log(`wrote ${out} (${(JSON.stringify(world).length / 1024).toFixed(0)} KB)`);
console.log(`bounds x ${BOUNDS[0].toFixed(0)}..${BOUNDS[2].toFixed(0)}  z ${BOUNDS[1].toFixed(0)}..${BOUNDS[3].toFixed(0)}`);
console.log(`buildings ${buildings.length} (outlines ${outlines.length}), roads ${roads.length}, areas ${areas.length}, barriers ${barriers.length}, waterways ${waterways.length}`);
console.log(`trees ${trees.length} (forest ${forestTrees}), benches ${benches.length}, bikes ${bikes.length}, lamps ${lamps.length} (+${genLamps} generated), stops ${stops.length}, entrances ${entrances.length}`);
console.log(`nav nodes ${navNodes.length} edges ${navEdges.length}, labels ${labels.length}, street signs ${streetSigns.length}`);
