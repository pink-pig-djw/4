// 2D map rendering from the same OSM-derived data: minimap (rotating, follows player) and full-screen map.
import { settings } from '../core/settings.js';
import { t, PLACE_ZH } from '../core/i18n.js';

const AREA_COL = {
  grass: '#cfe3b4', meadow: '#dbe6b8', farmland: '#e6e2b6', forest: '#a8cb91', wetland: '#b5d3c2', scrub: '#bcd6a0',
  construction: '#dccfb4', pitchgrass: '#b3dc9c', turf: '#9fd18c', tartan: '#e2a58b', clay: '#e3ae8d', court: '#c9d3c4',
  sand: '#efe3bb', playground: '#e9dcb4', parking: '#dedcd6', paved: '#ebe7df', road: '#ffffff', island: '#cfe3b4', water: '#a7d2ec',
};
const MOTOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'primary_link', 'secondary_link', 'tertiary_link']);

function polyPath(path, p) {
  path.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) path.lineTo(p[i][0], p[i][1]);
  path.closePath();
}
function linePath(path, p) {
  path.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) path.lineTo(p[i][0], p[i][1]);
}

export class MapRenderer {
  constructor(world, enterable = new Set()) {
    this.world = world;
    this.areas = new Map();
    for (const a of world.areas) {
      const col = AREA_COL[a.k]; if (!col) continue;
      let p = this.areas.get(col); if (!p) this.areas.set(col, p = new Path2D());
      polyPath(p, a.p); for (const h of a.hl || []) polyPath(p, h);
    }
    // roads by width class
    this.roads = [];
    const groups = new Map();
    for (const r of world.roads) {
      const motor = MOTOR.has(r.k);
      const key = (motor ? (MAJOR.has(r.k) ? 'M' : 'm') : 'f') + Math.round(r.w * 2) / 2;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { path: new Path2D(), w: r.w, motor, major: MAJOR.has(r.k), foot: !motor });
      linePath(g.path, r.p);
    }
    this.roads = [...groups.values()].sort((a, b) => (a.motor - b.motor) || (a.w - b.w));
    this.water = new Path2D();
    for (const w of world.waterways) linePath(this.water, w.p);
    this.buildings = { uni: new Path2D(), other: new Path2D(), enter: new Path2D() };
    world.buildings.forEach((b, i) => {
      const o = b.o >= 0 ? world.outlines[b.o] : null;
      const key = enterable.has(b.o) ? 'enter' : (b.k === 'university' || (o && o.k === 'university')) ? 'uni' : 'other';
      polyPath(this.buildings[key], b.p);
    });
  }

  // Draw with a transform: world (x,z) → screen = (x - cx) * s rotated by rot, centred at (w/2,h/2)
  draw(ctx, w, h, cx, cz, s, rot = 0, opts = {}) {
    ctx.save();
    ctx.fillStyle = '#dfe9d2';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rot);
    ctx.scale(s, s);
    ctx.translate(-cx, -cz);
    for (const [col, p] of this.areas) { ctx.fillStyle = col; ctx.fill(p, 'evenodd'); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#a7d2ec'; ctx.lineWidth = 2; ctx.stroke(this.water);
    // casing then fill
    for (const g of this.roads) {
      if (!g.motor) continue;
      ctx.strokeStyle = '#b8b4ab'; ctx.lineWidth = g.w + Math.max(1.2, 1.6 / s); ctx.stroke(g.path);
    }
    for (const g of this.roads) {
      if (g.motor) { ctx.strokeStyle = g.major ? '#fdf1c6' : '#ffffff'; ctx.lineWidth = g.w; }
      else { ctx.strokeStyle = '#f7f3ea'; ctx.lineWidth = Math.max(g.w, 1.2 / s); }
      ctx.stroke(g.path);
    }
    ctx.lineWidth = Math.max(0.3, 0.8 / s);
    ctx.fillStyle = '#d6cfc6'; ctx.strokeStyle = '#b3aaa0'; ctx.fill(this.buildings.other); ctx.stroke(this.buildings.other);
    ctx.fillStyle = '#c3b6a6'; ctx.strokeStyle = '#9e9182'; ctx.fill(this.buildings.uni); ctx.stroke(this.buildings.uni);
    ctx.fillStyle = '#e9b97f'; ctx.strokeStyle = '#b8864d'; ctx.fill(this.buildings.enter); ctx.stroke(this.buildings.enter);
    ctx.restore();
  }
}

// ---------------- Minimap ----------------
export class Minimap {
  constructor(parent, renderer, world) {
    this.world = world;
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    const n = document.createElement('div'); n.className = 'mm-north'; n.textContent = 'N'; this.el.appendChild(n);
    this.north = n;
    parent.appendChild(this.el);
    // map is pre-rendered lazily in small tiles (robust on devices with canvas size limits)
    this.renderer = renderer;
    this.ppm = 1.25;
    this.tilePx = 512;
    this.tiles = new Map();
    this.size = 0;
    this.scale = 1.6; // screen px per metre
  }
  _tile(i, j) {
    const key = i + ',' + j;
    let t = this.tiles.get(key);
    if (t) return t;
    t = document.createElement('canvas');
    t.width = t.height = this.tilePx;
    const m = this.tilePx / this.ppm; // metres per tile
    this.renderer.draw(t.getContext('2d'), this.tilePx, this.tilePx, (i + 0.5) * m, (j + 0.5) * m, this.ppm, 0);
    this.tiles.set(key, t);
    if (this.tiles.size > 64) this.tiles.delete(this.tiles.keys().next().value);
    return t;
  }
  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = r.width; this.dpr = dpr;
    this.canvas.width = r.width * dpr; this.canvas.height = r.height * dpr;
  }
  draw(px, pz, yaw, npcs = null) {
    if (!this.size) this.resize();
    const ctx = this.canvas.getContext('2d');
    const S = this.canvas.width;
    const s = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#dfe9d2'; ctx.fillRect(0, 0, S, S);
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(yaw); // heading up
    ctx.scale(s / this.ppm, s / this.ppm);
    ctx.translate(-px * this.ppm, -pz * this.ppm);
    ctx.imageSmoothingEnabled = true;
    const m = this.tilePx / this.ppm, R = (S / s) * 0.75 + 2;
    for (let i = Math.floor((px - R) / m); i <= Math.floor((px + R) / m); i++)
      for (let j = Math.floor((pz - R) / m); j <= Math.floor((pz + R) / m); j++)
        ctx.drawImage(this._tile(i, j), i * this.tilePx, j * this.tilePx);
    ctx.restore();
    // npc dots
    if (npcs) {
      ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(yaw);
      ctx.fillStyle = 'rgba(40,90,170,0.8)';
      for (const n of npcs) {
        const dx = (n.x - px) * s, dz = (n.z - pz) * s;
        if (Math.abs(dx) > S || Math.abs(dz) > S) continue;
        ctx.beginPath(); ctx.arc(dx, dz, 1.6 * this.dpr, 0, 6.283); ctx.fill();
      }
      ctx.restore();
    }
    // player arrow
    ctx.save(); ctx.translate(S / 2, S / 2);
    ctx.fillStyle = '#e8412c'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * this.dpr;
    const a = 7 * this.dpr;
    ctx.beginPath(); ctx.moveTo(0, -a * 1.2); ctx.lineTo(a * 0.8, a); ctx.lineTo(0, a * 0.45); ctx.lineTo(-a * 0.8, a); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // north indicator position on the ring
    const r = this.size / 2 - 11;
    this.north.style.transform = `translate(${Math.sin(yaw) * r}px, ${-Math.cos(yaw) * r}px)`;
  }
}

// ---------------- Full-screen map ----------------
export class BigMap {
  constructor(parent, renderer, world, places, onTeleport) {
    this.world = world; this.renderer = renderer; this.places = places; this.onTeleport = onTeleport;
    const el = this.el = document.createElement('div');
    el.className = 'bigmap hidden';
    el.innerHTML = `
      <div class="bm-canvas-wrap"><canvas></canvas><div class="bm-labels"></div></div>
      <div class="bm-side">
        <div class="bm-head"><span class="bm-title"></span><button class="btn-icon bm-close" aria-label="close">✕</button></div>
        <input class="bm-search" type="search">
        <div class="bm-list"></div>
        <div class="bm-foot"></div>
      </div>
      <div class="bm-pop hidden"><div class="bm-pop-name"></div><div class="bm-pop-sub"></div><button class="btn primary bm-go"></button></div>`;
    parent.appendChild(el);
    this.canvas = el.querySelector('canvas');
    this.labelsEl = el.querySelector('.bm-labels');
    this.listEl = el.querySelector('.bm-list');
    this.search = el.querySelector('.bm-search');
    this.pop = el.querySelector('.bm-pop');
    el.querySelector('.bm-close').onclick = () => this.hide();
    this.search.oninput = () => this.renderList();
    el.querySelector('.bm-go').onclick = () => { if (this.sel) { this.onTeleport(this.sel); this.hide(); } };
    this.view = { cx: 0, cz: 0, s: 0.6 };
    this.player = { x: 0, z: 0, yaw: 0 };
    this._bindPanZoom();
  }

  label(p) {
    const zh = settings.lang === 'zh' && (p.zh || PLACE_ZH[p.name]);
    return zh ? `${p.name}` : p.name;
  }

  show(px, pz, yaw) {
    this.el.classList.remove('hidden');
    this.player = { x: px, z: pz, yaw };
    this.view.cx = px; this.view.cz = pz;
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.view.s = Math.min(r.width, r.height) / 520;
    this.el.querySelector('.bm-title').textContent = t('map') + ' · ' + t('regionSued');
    this.el.querySelector('.bm-foot').textContent = t('comingSoon') + ' · ' + t('attribution');
    this.search.placeholder = t('search');
    this.el.querySelector('.bm-go').textContent = t('teleport');
    this.pop.classList.add('hidden');
    this.sel = null;
    this.renderList();
    this.redraw();
  }
  hide() { this.el.classList.add('hidden'); if (this.onClose) this.onClose(); }
  get visible() { return !this.el.classList.contains('hidden'); }

  renderList() {
    const q = this.search.value.trim().toLowerCase();
    const cats = [['uni', t('cat_uni')], ['stop', t('cat_stop')], ['other', t('cat_other')]];
    let html = '';
    for (const [cat, title] of cats) {
      const items = this.places.filter(p => p.cat === cat && (!q || p.name.toLowerCase().includes(q) || (p.zh || '').includes(q)));
      if (!items.length) continue;
      html += `<div class="bm-cat">${title}</div>`;
      for (const p of items) {
        const zh = settings.lang === 'zh' ? (p.zh || '') : '';
        html += `<button class="bm-item" data-id="${encodeURIComponent(p.id)}"><span class="n">${esc(p.name)}</span>${zh ? `<span class="z">${esc(zh)}</span>` : ''}${p.enterable ? `<span class="tag">${t('enterable')}</span>` : ''}</button>`;
      }
    }
    this.listEl.innerHTML = html;
    this.listEl.querySelectorAll('.bm-item').forEach(b => b.onclick = () => {
      const p = this.places.find(p => p.id === decodeURIComponent(b.dataset.id));
      if (!p) return;
      this.view.cx = p.x; this.view.cz = p.z; this.view.s = Math.max(this.view.s, 1.4);
      this.select(p); this.redraw();
    });
  }

  select(p) {
    this.sel = p;
    this.pop.classList.remove('hidden');
    this.pop.querySelector('.bm-pop-name').textContent = p.name;
    const sub = [settings.lang === 'zh' ? p.zh : null, p.addr].filter(Boolean).join(' · ');
    this.pop.querySelector('.bm-pop-sub').textContent = sub;
  }

  _bindPanZoom() {
    const c = this.canvas;
    let drag = null, pinch = null, moved = 0;
    const pts = new Map();
    c.addEventListener('pointerdown', e => { try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; if (pts.size === 1) drag = [e.clientX, e.clientY]; else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.view.s }; drag = null; } });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); this.view.s = clamp(pinch.s * d / pinch.d, 0.25, 6); this.redraw(); moved += 10; return; }
      if (drag) { const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; moved += Math.abs(dx) + Math.abs(dy); this.view.cx -= dx / this.view.s; this.view.cz -= dy / this.view.s; drag = [e.clientX, e.clientY]; this.redraw(); }
    });
    const up = e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (drag && moved < 6) this._click(e);
      if (pts.size === 0) drag = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); const k = Math.exp(-e.deltaY * 0.0015); this._zoomAt(e, k); }, { passive: false });
  }
  _zoomAt(e, k) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
    const wx = this.view.cx + mx / this.view.s, wz = this.view.cz + my / this.view.s;
    this.view.s = clamp(this.view.s * k, 0.25, 6);
    this.view.cx = wx - mx / this.view.s; this.view.cz = wz - my / this.view.s;
    this.redraw();
  }
  _click(e) {
    const r = this.canvas.getBoundingClientRect();
    const wx = this.view.cx + (e.clientX - r.left - r.width / 2) / this.view.s;
    const wz = this.view.cz + (e.clientY - r.top - r.height / 2) / this.view.s;
    // nearest place within 25 screen px, else building footprint containing the point
    let best = null, bd = 28 / this.view.s;
    for (const p of this.places) { const d = Math.hypot(p.x - wx, p.z - wz); if (d < bd) { bd = d; best = p; } }
    if (best) this.select(best); else this.pop.classList.add('hidden');
  }

  redraw() {
    const wrap = this.canvas.parentElement;
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = r.width * dpr; this.canvas.height = r.height * dpr;
    const ctx = this.canvas.getContext('2d');
    const { cx, cz, s } = this.view;
    this.renderer.draw(ctx, this.canvas.width, this.canvas.height, cx, cz, s * dpr, 0);
    // bounds outline
    const toS = (x, z) => [(x - cx) * s + r.width / 2, (z - cz) * s + r.height / 2];
    // labels as DOM (crisp, clickable)
    let html = '';
    const W = r.width, H = r.height;
    const shown = [];
    const fits = (x, y, w) => { for (const q of shown) if (Math.abs(q[0] - x) < (q[2] + w) / 2 && Math.abs(q[1] - y) < 16) return false; shown.push([x, y, w]); return true; };
    for (const p of this.places) {
      const [x, y] = toS(p.x, p.z);
      if (x < -50 || y < -20 || x > W + 50 || y > H + 20) continue;
      const minS = p.rank >= 70 ? 0 : p.cat === 'stop' ? 0.9 : p.rank >= 40 ? 0.8 : 1.6;
      if (s < minS) continue;
      const name = p.cat === 'stop' ? p.name : shortName(p.name);
      const zh = settings.lang === 'zh' && p.zh && s > 1.1 ? `<i>${esc(p.zh)}</i>` : '';
      const w = Math.min(name.length * 6.5, 180);
      if (!fits(x, y, w)) continue;
      html += `<div class="bm-label ${p.cat}${this.sel === p ? ' sel' : ''}" style="left:${x}px;top:${y}px" data-id="${encodeURIComponent(p.id)}">${p.cat === 'stop' ? '<b class="h">H</b>' : ''}${esc(name)}${zh}</div>`;
    }
    if (s > 1.2) {
      for (const l of this.world.labels) {
        if (l.t !== 's') continue;
        const [x, y] = toS(l.x, l.z);
        if (x < 0 || y < 0 || x > W || y > H) continue;
        let a = l.r; if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
        html += `<div class="bm-street" style="left:${x}px;top:${y}px;transform:translate(-50%,-50%) rotate(${a}rad)">${esc(l.n)}</div>`;
      }
    }
    const [px, py] = toS(this.player.x, this.player.z);
    html += `<div class="bm-me" style="left:${px}px;top:${py}px;transform:translate(-50%,-50%) rotate(${-this.player.yaw}rad)" title="${t('youAreHere')}"></div>`;
    this.labelsEl.innerHTML = html;
    this.labelsEl.querySelectorAll('.bm-label').forEach(d => d.onclick = (e) => {
      e.stopPropagation();
      const p = this.places.find(p => p.id === decodeURIComponent(d.dataset.id));
      if (p) { this.select(p); this.redraw(); }
    });
  }
}

function shortName(n) {
  if (n.startsWith('MHB-')) return 'Mensa / Hörsaal / Bibliothek';
  if (n.startsWith('Fraunhofer')) return 'Fraunhofer IISB';
  if (n.startsWith('Mechanik- und Elektrowerkstatt')) return 'Werkstatt Techn. Fakultät';
  if (n.startsWith('Dekanat Technische')) return 'Dekanat Techn. Fakultät';
  if (n.startsWith('Informatik und Regionales')) return 'Informatik / RRZE';
  if (n.startsWith('Helmholtz-Institut')) return 'Helmholtz-Institut HI ERN';
  if (n.length > 34) return n.slice(0, 32) + '…';
  return n;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
