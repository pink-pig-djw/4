// WGS84/ETRS89 geographic ↔ UTM zone 32N (EPSG:25832), standard Transverse Mercator series
// (sub-millimetre over this area; ETRS89 and WGS84 differ by < 1 m, below the DEM grid).
const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
const lon0 = 9 * Math.PI / 180;

export function toUTM32(lat, lon) {
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180 - lon0;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * lam;
  const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  const No = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  return [E, No];
}
