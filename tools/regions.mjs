// Region definitions. bbox = [south, west, north, east] in WGS84 degrees.
// origin = local (0,0) of the scene, chosen near the middle of the campus.
export const REGIONS = {
  // Südgelände (Technische Fakultät) and, 3.5 km further south, Tennenlohe (EEI chairs at
  // Wetterkreuz / Am Weichselgarten, Fraunhofer IIS at Am Wolfsmantel), with everything between.
  suedgelaende: {
    name: { de: 'Erlangen Südgelände · Tennenlohe', zh: '埃尔朗根 南校区 · Tennenlohe' },
    bbox: [49.5395, 11.0110, 49.5850, 11.0420],
    fetchBbox: [49.5385, 11.0090, 49.5860, 11.0440],
    origin: [49.5770, 11.0260],
    dem: 'dgm1',
  },
};
