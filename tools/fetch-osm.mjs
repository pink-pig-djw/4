// Downloads all OpenStreetMap data for a region via the Overpass API.
// Usage: node tools/fetch-osm.mjs [region]
// Data © OpenStreetMap contributors, ODbL 1.0.
import { writeFileSync, mkdirSync } from 'node:fs';
import { REGIONS } from './regions.mjs';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Usage: node tools/fetch-osm.mjs [region] [rawName]   (rawName: fetch only that rectangle)
const regionId = process.argv[2] || 'suedgelaende';
const only = process.argv[3] || null;
const region = REGIONS[regionId];
if (!region) throw new Error(`unknown region ${regionId}`);
let query = '';

async function tryFetch(url) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': 'fau-campus-3d/0.1 (offline campus walkthrough build tool)', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  const text = await res.text();
  if (!res.ok || !text.trimStart().startsWith('{')) throw new Error(`${url}: HTTP ${res.status} ${text.slice(0, 120)}`);
  return JSON.parse(text);
}

for (const rect of region.rects) {
  if (only && rect.raw !== only) continue;
  const bb = (rect.fetchBbox || rect.bbox).join(',');
  query = `[out:json][timeout:600];(nwr(${bb}););(._;>;);out body;`;
  let data;
  for (let attempt = 0; attempt < 9 && !data; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      console.log(`fetching ${rect.raw} from ${url} ...`);
      data = await tryFetch(url);
    } catch (e) {
      console.warn(String(e.message || e));
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  if (!data) throw new Error('all Overpass endpoints failed');
  mkdirSync('data/raw', { recursive: true });
  const out = `data/raw/${rect.raw}.osm.json`;
  writeFileSync(out, JSON.stringify(data));
  console.log(`wrote ${out}: ${data.elements.length} elements, osm_base ${data.osm3s?.timestamp_osm_base}`);
}
