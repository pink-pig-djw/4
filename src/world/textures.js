// Procedural canvas textures (no image files needed → works fully offline).
import * as THREE from 'three';

function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise on a size×size grid with given period (cells).
function noiseField(size, period, seed) {
  const r = rand(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(size * size);
  const f = t => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = x / size * period, gy = y / size * period;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = f(gx - x0), ty = f(gy - y0);
    const a = g[(y0 % period) * period + (x0 % period)], b = g[(y0 % period) * period + ((x0 + 1) % period)];
    const c = g[((y0 + 1) % period) * period + (x0 % period)], d = g[((y0 + 1) % period) * period + ((x0 + 1) % period)];
    out[y * size + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  }
  return out;
}
function fbm(size, seed, octaves = [[4, 0.5], [8, 0.25], [16, 0.15], [32, 0.1]]) {
  const out = new Float32Array(size * size);
  let k = 0;
  for (const [p, w] of octaves) {
    const n = noiseField(size, p, seed + (k++) * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * w;
  }
  let tot = octaves.reduce((s, o) => s + o[1], 0);
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function finish(c, srgb = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// Paint per-pixel from fbm with a colour function.
function paint(size, seed, colorAt, octaves) {
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = fbm(size, seed, octaves);
  const r = rand(seed * 3 + 1);
  for (let i = 0; i < size * size; i++) {
    const [R, G, B] = colorAt(n[i], r(), i % size, (i / size) | 0);
    img.data[i * 4] = R; img.data[i * 4 + 1] = G; img.data[i * 4 + 2] = B; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { c, ctx };
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 255) => Math.max(a, Math.min(b, v));

export function grassTexture() {
  const { c, ctx } = paint(512, 11, (n, r) => {
    // autumn lawn: green with yellowed patches
    const dry = Math.max(0, n - 0.5) * 2.2;
    const base = [mix(88, 138, dry), mix(108, 122, dry), mix(58, 66, dry)];
    const s = 0.78 + r * 0.38;
    return [clamp(base[0] * s), clamp(base[1] * s), clamp(base[2] * s)];
  });
  // blade strokes
  const r = rand(77);
  for (let i = 0; i < 9000; i++) {
    const x = r() * 512, y = r() * 512, l = 2 + r() * 5, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
    const g = r();
    ctx.strokeStyle = g < 0.5 ? `rgba(${60 + r() * 30},${100 + r() * 40},${40 + r() * 20},0.55)` : g < 0.85 ? `rgba(${120 + r() * 40},${135 + r() * 30},${60 + r() * 20},0.45)` : `rgba(${150 + r() * 40},${125 + r() * 30},${60},0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  return finish(c);
}

export function asphaltTexture() {
  const { c, ctx } = paint(512, 21, (n, r) => {
    const v = 72 + n * 26 + (r - 0.5) * 34;
    return [clamp(v), clamp(v), clamp(v + 3)];
  }, [[8, 0.5], [32, 0.3], [128, 0.2]]);
  const r = rand(5);
  for (let i = 0; i < 2500; i++) {
    const v = r() < 0.5 ? 120 + r() * 60 : 30 + r() * 20;
    ctx.fillStyle = `rgba(${v},${v},${v},0.6)`;
    ctx.fillRect(r() * 512, r() * 512, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  // a few repair patches / cracks
  ctx.strokeStyle = 'rgba(30,30,32,0.35)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    let x = r() * 512, y = r() * 512; ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return finish(c);
}

// Rectangular concrete pavers (Betonpflaster), running bond. Tile = 2.4 m.
export function paversTexture(tint = [168, 166, 160]) {
  const size = 512, c = canvas(size), ctx = c.getContext('2d');
  const r = rand(31);
  ctx.fillStyle = 'rgb(95,93,90)'; ctx.fillRect(0, 0, size, size);
  const pw = size / 12, ph = size / 24; // 20 x 10 cm at 2.4 m tile
  for (let row = 0; row < 24; row++) {
    const off = (row % 2) * pw / 2;
    for (let col = -1; col < 13; col++) {
      const x = col * pw + off, y = row * ph;
      const v = 0.86 + r() * 0.2;
      ctx.fillStyle = `rgb(${clamp(tint[0] * v)},${clamp(tint[1] * v)},${clamp(tint[2] * v)})`;
      ctx.fillRect(x + 1.2, y + 1.2, pw - 2.4, ph - 2.4);
    }
  }
  const img = ctx.getImageData(0, 0, size, size), n = fbm(size, 7, [[16, 0.6], [64, 0.4]]);
  for (let i = 0; i < size * size; i++) {
    const k = 0.9 + n[i] * 0.2 + (r() - 0.5) * 0.08;
    img.data[i * 4] = clamp(img.data[i * 4] * k); img.data[i * 4 + 1] = clamp(img.data[i * 4 + 1] * k); img.data[i * 4 + 2] = clamp(img.data[i * 4 + 2] * k);
  }
  ctx.putImageData(img, 0, 0);
  return finish(c);
}

// Large concrete slabs 50x50 cm; tile = 2 m
export function slabsTexture() {
  const size = 512, c = canvas(size), ctx = c.getContext('2d');
  const r = rand(41);
  ctx.fillStyle = 'rgb(120,118,114)'; ctx.fillRect(0, 0, size, size);
  const s = size / 4;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const v = 172 + r() * 22;
    ctx.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
    ctx.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3);
  }
  const img = ctx.getImageData(0, 0, size, size), n = fbm(size, 9, [[8, 0.5], [64, 0.5]]);
  for (let i = 0; i < size * size; i++) {
    const k = 0.9 + n[i] * 0.18 + (r() - 0.5) * 0.1;
    img.data[i * 4] = clamp(img.data[i * 4] * k); img.data[i * 4 + 1] = clamp(img.data[i * 4 + 1] * k); img.data[i * 4 + 2] = clamp(img.data[i * 4 + 2] * k);
  }
  ctx.putImageData(img, 0, 0);
  return finish(c);
}

export function settTexture() {
  const size = 512, c = canvas(size), ctx = c.getContext('2d');
  const r = rand(51);
  ctx.fillStyle = 'rgb(70,66,60)'; ctx.fillRect(0, 0, size, size);
  const s = size / 16;
  for (let j = 0; j < 16; j++) for (let i = -1; i < 17; i++) {
    const x = i * s + (j % 2) * s * 0.5 + (r() - 0.5) * 3, y = j * s + (r() - 0.5) * 3;
    const v = 105 + r() * 55, w = r() * 20;
    ctx.fillStyle = `rgb(${v + w * 0.3},${v},${v - 8})`;
    ctx.beginPath(); ctx.roundRect(x + 2, y + 2, s - 4, s - 4, 5); ctx.fill();
  }
  return finish(c);
}

export function gravelTexture() {
  const { c } = paint(512, 61, (n, r) => {
    const v = 0.85 + n * 0.25 + (r - 0.5) * 0.3;
    return [clamp(196 * v), clamp(176 * v), clamp(138 * v)];
  }, [[8, 0.4], [32, 0.3], [128, 0.3]]);
  return finish(c);
}

export function dirtTexture() {
  const { c, ctx } = paint(512, 71, (n, r) => {
    const v = 0.75 + n * 0.4 + (r - 0.5) * 0.2;
    return [clamp(112 * v), clamp(88 * v), clamp(62 * v)];
  });
  return finish(c);
}

// Forest floor with leaf litter
export function forestFloorTexture() {
  const { c, ctx } = paint(512, 81, (n, r) => {
    const v = 0.7 + n * 0.45 + (r - 0.5) * 0.2;
    return [clamp(98 * v), clamp(80 * v), clamp(52 * v)];
  });
  const r = rand(82);
  for (let i = 0; i < 2600; i++) {
    const x = r() * 512, y = r() * 512, s = 2 + r() * 4;
    const k = r();
    ctx.fillStyle = k < 0.4 ? `rgba(${150 + r() * 60},${90 + r() * 40},${30},0.8)` : k < 0.7 ? `rgba(${120 + r() * 40},${60 + r() * 30},${25},0.8)` : `rgba(${70},${90 + r() * 30},${40},0.7)`;
    ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.55, r() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  return finish(c);
}

export function tartanTexture(rgb = [176, 78, 58]) {
  const { c } = paint(256, 91, (n, r) => {
    const v = 0.88 + n * 0.14 + (r - 0.5) * 0.12;
    return [clamp(rgb[0] * v), clamp(rgb[1] * v), clamp(rgb[2] * v)];
  }, [[8, 0.5], [64, 0.5]]);
  return finish(c);
}

export function flatRoofTexture() {
  const { c } = paint(256, 101, (n, r) => {
    const v = 0.8 + n * 0.3 + (r - 0.5) * 0.25;
    return [clamp(150 * v), clamp(147 * v), clamp(140 * v)];
  }, [[8, 0.5], [64, 0.5]]);
  return finish(c);
}

// Clay roof tiles; one texture tile = 2 m (along eaves) x 2 m (along slope)
export function roofTileTexture() {
  const size = 256, c = canvas(size), ctx = c.getContext('2d');
  const r = rand(111);
  ctx.fillStyle = '#6a6a6a'; ctx.fillRect(0, 0, size, size);
  const cols = 8, rows = 6, w = size / cols, h = size / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const v = 190 + r() * 50;
    const g = ctx.createLinearGradient(0, j * h, 0, j * h + h);
    g.addColorStop(0, `rgb(${v * 0.75},${v * 0.75},${v * 0.75})`);
    g.addColorStop(0.85, `rgb(${v},${v},${v})`);
    g.addColorStop(1, `rgb(${v * 0.55},${v * 0.55},${v * 0.55})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(i * w + 1, j * h, w - 2, h - 1, [0, 0, w / 2, w / 2]); ctx.fill();
  }
  return finish(c, true);
}

// Soft radial spot used for lamp light pools, blob shadows etc.
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const size = 128, c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Leaf sprite atlas: 4 leaf shapes in a 2x2 grid (alpha-tested)
export function leafAtlas() {
  const size = 256, c = canvas(size), ctx = c.getContext('2d');
  const cells = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const r = rand(121);
  cells.forEach(([i, j], k) => {
    ctx.save();
    ctx.translate(i * 128 + 64, j * 128 + 64);
    ctx.fillStyle = '#fff';
    if (k === 0) { // maple-ish
      ctx.beginPath();
      for (let a = 0; a < 5; a++) {
        const an = -Math.PI / 2 + a * (Math.PI * 2 / 5);
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(Math.cos(an - 0.35) * 40, Math.sin(an - 0.35) * 40, Math.cos(an) * 56, Math.sin(an) * 56);
        ctx.quadraticCurveTo(Math.cos(an + 0.35) * 40, Math.sin(an + 0.35) * 40, 0, 0);
      }
      ctx.fill();
    } else if (k === 1) { // oval (linden/beech)
      ctx.beginPath(); ctx.ellipse(0, 0, 34, 52, 0.2, 0, Math.PI * 2); ctx.fill();
    } else if (k === 2) { // oak-ish lobed
      ctx.beginPath();
      for (let s = 0; s < 6; s++) { const y = -48 + s * 18; ctx.ellipse(0, y, 26 - Math.abs(s - 2.5) * 3, 12, 0, 0, Math.PI * 2); }
      ctx.fill();
    } else { // narrow
      ctx.beginPath(); ctx.ellipse(0, 0, 18, 56, -0.3, 0, Math.PI * 2); ctx.fill();
    }
    // vein
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 54); ctx.lineTo(0, -40); ctx.stroke();
    ctx.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
