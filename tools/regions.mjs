// Region definitions. bbox = [south, west, north, east] in WGS84 degrees.
// origin = local (0,0) of the scene, chosen near the middle of the campus.
export const REGIONS = {
  suedgelaende: {
    name: { de: 'Erlangen Südgelände', zh: '埃尔朗根 南校区 (Südgelände)' },
    bbox: [49.5690, 11.0185, 49.5850, 11.0348],
    fetchBbox: [49.5690, 11.0150, 49.5850, 11.0370],
    origin: [49.5770, 11.0260],
  },
};
