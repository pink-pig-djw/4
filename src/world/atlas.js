// Text atlas: many small sign images packed into one canvas texture (one draw call for all signs).
import * as THREE from 'three';

export const SIGN_FONT = '"Bahnschrift", "DIN Alternate", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

export class TextAtlas {
  constructor(size = 2048) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.x = 0; this.y = 0; this.rowH = 0;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.full = false;
  }
  // draw(ctx, w, h) paints into a local box; returns uv rect [u0, v0, u1, v1] (v flipped for three.js)
  add(w, h, draw) {
    if (this.x + w + 2 > this.size) { this.x = 0; this.y += this.rowH + 2; this.rowH = 0; }
    if (this.y + h + 2 > this.size) { this.full = true; return [0, 0, 0.001, 0.001]; }
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.x + 1, this.y + 1);
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    draw(ctx, w, h);
    ctx.restore();
    const S = this.size;
    const uv = [(this.x + 1) / S, 1 - (this.y + 1 + h) / S, (this.x + 1 + w) / S, 1 - (this.y + 1) / S];
    this.x += w + 2; this.rowH = Math.max(this.rowH, h);
    return uv;
  }
  done() { this.texture.needsUpdate = true; }
}

// Fit text into width by reducing font size; returns used size
export function fitText(ctx, text, maxW, size, weight = '600', family = SIGN_FONT) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}`; if (ctx.measureText(text).width <= maxW) break; s -= 1; } while (s > 8);
  return s;
}

export function wrapText(ctx, text, maxW) {
  const words = text.split(/(\s+|(?<=-)|(?<=\/))/).filter(w => w && !/^\s+$/.test(w));
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? (cur.endsWith('-') || cur.endsWith('/') ? cur + w : cur + ' ' + w) : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Quad (plane) facing +x after rotation, uv mapped to rect. Adds to arrays.
export function pushQuad(buf, cx, cy, cz, yaw, w, h, uv, offset = 0) {
  // local plane in (z,y) facing +x; rotate by -yaw about y
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const fx = c, fz = s;            // facing direction (world)
  const rx = -s, rz = c;           // right vector when looking at the sign from the front is -r
  const hw = w / 2, hh = h / 2;
  const ox = cx + fx * offset, oz = cz + fz * offset;
  // corners (looking at the front: left = +r? choose so text reads correctly)
  const L = [ox + rx * hw, oz + rz * hw], R = [ox - rx * hw, oz - rz * hw];
  const p = [
    [L[0], cy - hh, L[1], uv[0], uv[1]], [R[0], cy - hh, R[1], uv[2], uv[1]], [R[0], cy + hh, R[1], uv[2], uv[3]],
    [L[0], cy - hh, L[1], uv[0], uv[1]], [R[0], cy + hh, R[1], uv[2], uv[3]], [L[0], cy + hh, L[1], uv[0], uv[3]],
  ];
  for (const q of p) { buf.pos.push(q[0], q[1], q[2]); buf.nor.push(fx, 0, fz); buf.uv.push(q[3], q[4]); }
}
