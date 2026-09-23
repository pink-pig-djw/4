// Resamples the DGM1 tiles (UTM32, 1 m) onto the scene's local grid and encodes it compactly.
// Heights in the scene are metres relative to the terrain at the origin (y = 0 there).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fromArrayBuffer } from 'geotiff';
import { toUTM32 } from './utm.mjs';

async function loadTiles(dir) {
  const tiles = new Map();
  if (!existsSync(dir)) return tiles;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.tif')) continue;
    const buf = readFileSync(`${dir}/${f}`);
    const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const img = await tiff.getImage();
    const [minX, minY, maxX, maxY] = img.getBoundingBox();
    const w = img.getWidth(), h = img.getHeight();
    const [r] = await img.readRasters();
    const nodata = img.getGDALNoData();
    tiles.set(`${Math.floor(minX / 1000)}_${Math.floor(minY / 1000)}`, { minX, minY, maxX, maxY, w, h, px: (maxX - minX) / w, py: (maxY - minY) / h, r, nodata });
  }
  return tiles;
}

// height at UTM (E, N); null outside the loaded tiles
function sampleUTM(tiles, E, N) {
  const t = tiles.get(`${Math.floor(E / 1000)}_${Math.floor(N / 1000)}`);
  if (!t) return null;
  // pixel centres; rows run from north to south
  const fx = (E - t.minX) / t.px - 0.5, fy = (t.maxY - N) / t.py - 0.5;
  const x0 = Math.max(0, Math.min(t.w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(t.h - 1, Math.floor(fy)));
  const x1 = Math.min(t.w - 1, x0 + 1), y1 = Math.min(t.h - 1, y0 + 1);
  const ax = Math.min(1, Math.max(0, fx - x0)), ay = Math.min(1, Math.max(0, fy - y0));
  const g = (x, y) => t.r[y * t.w + x];
  const a = g(x0, y0), b = g(x1, y0), c = g(x0, y1), d = g(x1, y1);
  if ([a, b, c, d].some(v => v == null || v === t.nodata || v < -100)) return null;
  return a + (b - a) * ax + (c - a) * ay + (a - b - c + d) * ax * ay;
}

// bounds: [x0, z0, x1, z1] local metres; unproj(x, z) → [lat, lon]
export async function buildHeightmap(dir, bounds, unproj, cell = 2) {
  const tiles = await loadTiles(dir);
  if (!tiles.size) return null;
  const [x0, z0, x1, z1] = bounds;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const hm = new Float32Array(nx * nz);
  let missing = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const [lat, lon] = unproj(x0 + i * cell, z0 + j * cell);
    const [E, N] = toUTM32(lat, lon);
    const v = sampleUTM(tiles, E, N);
    if (v == null) { missing++; hm[j * nx + i] = NaN; } else hm[j * nx + i] = v;
  }
  // fill gaps (outside tiles) from the nearest valid neighbour in the row / column
  if (missing) {
    for (let pass = 0; pass < 2; pass++) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!Number.isNaN(hm[k])) continue;
      const cands = [i > 0 ? hm[k - 1] : NaN, i < nx - 1 ? hm[k + 1] : NaN, j > 0 ? hm[k - nx] : NaN, j < nz - 1 ? hm[k + nx] : NaN].filter(v => !Number.isNaN(v));
      if (cands.length) hm[k] = cands.reduce((s, v) => s + v, 0) / cands.length;
    }
  }
  // light 3×3 smoothing: removes scan noise (and makes walking smoother) but keeps embankments
  const sm = new Float32Array(hm.length);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let s = 0, w = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const v = hm[jj * nx + ii]; if (Number.isNaN(v)) continue;
      const wt = di === 0 && dj === 0 ? 4 : (di === 0 || dj === 0) ? 2 : 1;
      s += v * wt; w += wt;
    }
    sm[j * nx + i] = w ? s / w : hm[j * nx + i];
  }
  return { x0, z0, cell, nx, nz, hm: sm, missing, tiles: tiles.size };
}

// Encode heights (relative to `ref`) in steps of q metres, predicted deltas, zig-zag, 16-bit, deflate, base64.
// Decoder: src/world/terrain.js (same predictor: left + up - up-left).
export function encodeHeightmap(H, ref, q = 0.05) {
  const { nx, nz, hm } = H;
  const cm = new Int32Array(nx * nz);
  for (let k = 0; k < cm.length; k++) cm[k] = Number.isNaN(hm[k]) ? 0 : Math.round((hm[k] - ref) / q);
  const out = new Uint16Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const pred = j === 0 ? (i === 0 ? 0 : cm[k - 1]) : i === 0 ? cm[k - nx] : cm[k - 1] + cm[k - nx] - cm[k - nx - 1];
    const d = cm[k] - pred;
    if (d > 32767 || d < -32768) throw new Error('height step too large at ' + i + ',' + j);
    out[k] = ((d << 1) ^ (d >> 31)) & 0xffff;
  }
  const z = deflateSync(Buffer.from(out.buffer), { level: 9 });
  return z.toString('base64');
}
