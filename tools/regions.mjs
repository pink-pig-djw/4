// Region definitions. A region is a union of rectangles (bbox = [south, west, north, east], WGS84);
// each rectangle has its own raw OSM file. origin = local (0,0) of the scene.
export const REGIONS = {
  // Südgelände (Technische Fakultät), 3.5 km south of it Tennenlohe (EEI chairs at Wetterkreuz /
  // Am Weichselgarten, Fraunhofer IIS), and north-west through Röthelheimpark to the old town
  // (Schloss, Schlossgarten, Kollegienhaus, Botanischer Garten) — one continuous walkable map.
  suedgelaende: {
    name: { de: 'Erlangen · Südgelände · Tennenlohe · Altstadt', zh: '埃尔朗根 南校区 · Tennenlohe · 老城区' },
    rects: [
      { raw: 'suedgelaende', bbox: [49.5395, 11.0110, 49.5850, 11.0420], fetchBbox: [49.5385, 11.0090, 49.5860, 11.0440] },
      { raw: 'altstadt', bbox: [49.5800, 10.9960, 49.6045, 11.0360], fetchBbox: [49.5790, 10.9945, 49.6055, 11.0375] },
    ],
    origin: [49.5770, 11.0260],
    dem: 'dgm1',
    // full detail here; ordinary buildings in the corridors between them are built simpler
    focus: [
      { name: 'Südgelände', bbox: [49.5690, 11.0170, 49.5850, 11.0370] },
      { name: 'Tennenlohe', bbox: [49.5395, 11.0110, 49.5570, 11.0420] },
      { name: 'Altstadt', bbox: [49.5915, 10.9985, 49.6045, 11.0140] },
    ],
  },
};

// helpers
export function regionBBox(region, key = 'bbox') {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const r of region.rects) { const b = r[key] || r.bbox; s = Math.min(s, b[0]); w = Math.min(w, b[1]); n = Math.max(n, b[2]); e = Math.max(e, b[3]); }
  return [s, w, n, e];
}
