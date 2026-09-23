// Renders data/world/<region>.json to an SVG overview for visual sanity checks (.cache/<region>.svg).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const region = process.argv[2] || 'suedgelaende';
const w = JSON.parse(readFileSync(`data/world/${region}.json`, 'utf8'));
const [x0, z0, x1, z1] = w.meta.bounds;
const path = (p, close) => 'M' + p.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + (close ? 'Z' : '');
const AC = { grass: '#b9d59a', meadow: '#cfe0a4', forest: '#7fae6a', scrub: '#a7c486', water: '#8ec5e8', parking: '#c7c7c7', paved: '#dcd6cc', road: '#9d9d9d', island: '#b9d59a', pitchgrass: '#8fcf7a', turf: '#6fbf6a', tartan: '#c86a4a', clay: '#d08a5a', court: '#a9b3a0', sand: '#eadcae', playground: '#e8d7a8', construction: '#c9b48f', farmland: '#e8e2b0', wetland: '#a9cbb0' };
const RC = { asphalt: '#6d6d6d', pavers: '#bdb6aa', concrete: '#c4c1ba', sett: '#8e8474', gravel: '#d2c19a', dirt: '#b39b76', grasspave: '#a8c48e', wood: '#a57c52', tartan: '#c86a4a' };
let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${z0} ${x1 - x0} ${z1 - z0}" width="${((x1 - x0) * 1.2).toFixed(0)}" height="${((z1 - z0) * 1.2).toFixed(0)}" style="background:#d9e8c4">`;
for (const a of w.areas) s += `<path d="${path(a.p, 1)}${(a.hl || []).map(h => path(h, 1)).join('')}" fill="${AC[a.k] || '#f0f'}" fill-rule="evenodd"/>`;
for (const r of w.roads) {
  s += `<path d="${path(r.p)}" stroke="${RC[r.s] || '#f0f'}" stroke-width="${r.w + (r.sw ? (r.sw[0] + r.sw[1]) : 0)}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`;
}
for (const b of w.buildings) {
  const hue = { ribbon: '#9a968e', lab: '#a8a39a', panel: '#444', glass: '#6f8391', brick: '#9a4e3a', plaster: '#e3d6bd', hall: '#b9bcbd', deck: '#888', plain: '#c9c4b8', church: '#eee' }[b.st];
  s += `<path d="${path(b.p, 1)}" fill="${hue}" stroke="#333" stroke-width="0.3" opacity="${b.mh > 2 ? 0.5 : 1}"><title>${b.id} ${b.st} h=${b.h}</title></path>`;
}
for (const t of w.trees) if (t[2] !== 1 && t[2] !== 3) s += `<circle cx="${t[0]}" cy="${t[1]}" r="2.5" fill="#3f7a35" opacity="0.8"/>`;
for (const e of w.entrances) s += `<circle cx="${e.x}" cy="${e.z}" r="1.5" fill="${e.k === 'main' ? '#e33' : '#f90'}"/>`;
for (const b of w.benches) s += `<rect x="${b[0] - 0.8}" y="${b[1] - 0.8}" width="1.6" height="1.6" fill="#7a4a1a"/>`;
for (const b of w.bikes) s += `<circle cx="${b[0]}" cy="${b[1]}" r="2" fill="#15c"/>`;
for (const l of w.lamps) s += `<circle cx="${l[0]}" cy="${l[1]}" r="0.9" fill="${l[2] ? '#fb0' : '#f60'}"/>`;
for (const st of w.stops) s += `<circle cx="${st.x}" cy="${st.z}" r="3" fill="#fd0" stroke="#083" stroke-width="1.2"/>`;
for (const l of w.labels) if (l.t === 'b' || l.t === 's') s += `<text x="${l.x}" y="${l.z}" font-size="${l.t === 's' ? 7 : 6}" text-anchor="middle" fill="${l.t === 's' ? '#225' : '#000'}" font-family="Arial">${l.n.replace(/&/g, '&amp;').slice(0, 40)}</text>`;
s += '</svg>';
mkdirSync('.cache', { recursive: true });
writeFileSync(`.cache/${region}.svg`, s);
console.log('ok', s.length);
