// Downloads the digital terrain model (bare earth, 1 m grid) for a region from the open data of the
// Bayerische Vermessungsverwaltung (DGM1, CC BY 4.0, www.geodaten.bayern.de). Tiles are 1 km × 1 km
// GeoTIFFs in ETRS89 / UTM zone 32N, named by their lower-left corner in km.
// Usage: node tools/fetch-dem.mjs [region]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { REGIONS, regionBBox } from './regions.mjs';
import { toUTM32 } from './utm.mjs';

const regionId = process.argv[2] || 'suedgelaende';
const region = REGIONS[regionId];
const [s, w, n, e] = regionBBox(region, 'fetchBbox');
let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
for (const [lat, lon] of [[s, w], [s, e], [n, w], [n, e]]) {
  const [E, N] = toUTM32(lat, lon);
  e0 = Math.min(e0, Math.floor(E / 1000)); e1 = Math.max(e1, Math.floor(E / 1000));
  n0 = Math.min(n0, Math.floor(N / 1000)); n1 = Math.max(n1, Math.floor(N / 1000));
}
mkdirSync('data/raw/dgm1', { recursive: true });
let got = 0;
for (let E = e0; E <= e1; E++) for (let N = n0; N <= n1; N++) {
  const name = `${E}_${N}.tif`, out = `data/raw/dgm1/${name}`;
  if (existsSync(out)) { got++; continue; }
  const url = `https://download1.bayernwolke.de/a/dgm/dgm1/${name}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'fau-campus-3d/0.1 (terrain build tool)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      console.log('got', name);
      got++;
      break;
    } catch (err) {
      console.warn(name, err.message);
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
}
console.log(`${got} of ${(e1 - e0 + 1) * (n1 - n0 + 1)} tiles in data/raw/dgm1 (E ${e0}-${e1} km, N ${n0}-${n1} km)`);
