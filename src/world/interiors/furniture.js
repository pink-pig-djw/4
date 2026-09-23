// Low-poly interior furniture. Every piece faces +x (its front) with its width along z; y = 0 is the floor.
import * as THREE from 'three';
import { Shape } from '../shapes.js';

const WOOD = '#b98f5e', WOOD_D = '#7d5a3a', LAM = '#e8e2d4', GREY = '#8d9195', DARKG = '#3a3d41', BLACK = '#1d1f22';
const WHITE = '#f1f0ec', STEEL = '#b9bcbf', GREEN_BOARD = '#2f4f3c';

function legs(s, w, d, h, color = GREY, r = 0.025) {
  for (const x of [-d / 2 + 0.05, d / 2 - 0.05]) for (const z of [-w / 2 + 0.05, w / 2 - 0.05]) s.cyl(r, r, h, x, h / 2, z, color, 5);
}

export const FURNITURE = {
  table: () => { const s = new Shape(); s.box(0.7, 0.04, 1.4, 0, 0.73, 0, LAM); legs(s, 1.4, 0.7, 0.72); return s.build(); },
  chair: () => {
    const s = new Shape();
    s.box(0.42, 0.04, 0.42, 0, 0.46, 0, '#2d4f7c', 1); s.box(0.04, 0.38, 0.4, -0.2, 0.68, 0, '#2d4f7c', 1);
    s.box(0.34, 0.44, 0.04, 0, 0.22, 0, STEEL);
    return s.build();
  },
  desk: () => {
    const s = new Shape(); s.box(0.8, 0.04, 1.6, 0, 0.73, 0, LAM); s.box(0.6, 0.6, 0.45, 0, 0.36, 0.55, GREY); legs(s, 1.6, 0.8, 0.72);
    s.box(0.04, 0.32, 0.5, -0.2, 0.93, -0.2, BLACK); s.box(0.03, 0.28, 0.46, -0.18, 0.93, -0.2, '#9fc4e8', 0, 0, 0.35); // monitor
    return s.build();
  },
  // electronics workbench: oscilloscope, power supply, function generator, breadboard, monitor
  labbench: () => {
    const s = new Shape(); s.box(0.8, 0.05, 1.8, 0, 0.9, 0, '#c9c2b0'); legs(s, 1.8, 0.8, 0.88, GREY, 0.03);
    s.box(0.3, 0.02, 1.7, -0.25, 1.45, 0, '#9da3a8'); s.box(0.04, 0.55, 0.04, -0.37, 1.18, -0.85, GREY); s.box(0.04, 0.55, 0.04, -0.37, 1.18, 0.85, GREY);
    s.box(0.3, 0.2, 0.35, -0.2, 1.03, -0.55, '#4a4f55'); s.box(0.02, 0.13, 0.2, -0.05, 1.05, -0.58, '#7fd6ff', 0, 0, 0.6);       // oscilloscope
    s.box(0.28, 0.14, 0.26, -0.22, 1.54, -0.5, '#e4e2dc'); s.box(0.02, 0.05, 0.1, -0.075, 1.56, -0.54, '#ff5a3c', 0, 0, 0.6);  // power supply
    s.box(0.28, 0.12, 0.3, -0.22, 1.53, 0.1, '#3f4449'); s.box(0.02, 0.04, 0.14, -0.075, 1.55, 0.08, '#8cff9a', 0, 0, 0.6);    // function generator
    s.box(0.18, 0.015, 0.28, 0.1, 0.93, 0.05, '#f2f0e8'); for (let i = 0; i < 5; i++) s.box(0.005, 0.01, 0.2, 0.05 + i * 0.025, 0.94, 0.05, ['#d22', '#22d', '#2a2', '#dd2', '#222'][i]); // breadboard + wires
    s.box(0.04, 0.32, 0.52, -0.22, 1.1, 0.6, BLACK); s.box(0.02, 0.28, 0.48, -0.195, 1.1, 0.6, '#a9d2f5', 0, 0, 0.4);         // monitor
    return s.build();
  },
  pcdesk: () => {
    const s = new Shape(); s.box(0.75, 0.04, 1.4, 0, 0.73, 0, LAM); legs(s, 1.4, 0.75, 0.72);
    for (const z of [-0.35, 0.35]) { s.box(0.04, 0.34, 0.54, -0.18, 0.96, z, BLACK); s.box(0.02, 0.3, 0.5, -0.155, 0.96, z, '#a9d2f5', 0, 0, 0.45); s.box(0.18, 0.02, 0.42, 0.12, 0.76, z, '#2a2c2f'); }
    s.box(0.45, 0.42, 0.2, -0.1, 0.21, 0.55, '#2a2c2f');
    return s.build();
  },
  // Mensa table: 1.6 m long along +x (facing), 0.8 m wide, four chairs
  mtable: () => {
    const s = new Shape(); s.box(1.6, 0.04, 0.8, 0, 0.74, 0, '#e9e4d8');
    s.box(0.08, 0.72, 0.08, -0.5, 0.36, 0, GREY).box(0.08, 0.72, 0.08, 0.5, 0.36, 0, GREY);
    for (const x of [-0.42, 0.42]) for (const z of [-0.62, 0.62]) {
      s.box(0.42, 0.04, 0.4, x, 0.46, z, '#c0582f'); s.box(0.42, 0.36, 0.04, x, 0.66, z + Math.sign(z) * 0.2, '#c0582f');
      s.box(0.04, 0.44, 0.04, x, 0.22, z, STEEL);
    }
    s.box(0.34, 0.02, 0.26, -0.4, 0.77, -0.18, '#d8d2c2'); s.box(0.2, 0.03, 0.2, -0.4, 0.8, -0.18, '#c98a3a');
    return s.build();
  },
  bigtable: () => { const s = new Shape(); s.box(1.4, 0.05, 3.6, 0, 0.74, 0, WOOD); legs(s, 3.4, 1.2, 0.72, DARKG, 0.03); for (let z = -1.4; z <= 1.4; z += 0.9) for (const x of [-0.95, 0.95]) s.box(0.42, 0.45, 0.42, x, 0.23, z, '#40474f'); return s.build(); },
  studytable: () => { const s = new Shape(); s.box(1.0, 0.04, 1.8, 0, 0.73, 0, WOOD); legs(s, 1.8, 1.0, 0.72, DARKG); for (const z of [-0.5, 0.5]) for (const x of [-0.72, 0.72]) s.box(0.42, 0.45, 0.42, x, 0.23, z, '#c65f3f'); return s.build(); },
  smalltable: () => { const s = new Shape(); s.cyl(0.4, 0.4, 0.04, 0, 0.73, 0, LAM, 12); s.cyl(0.04, 0.04, 0.72, 0, 0.36, 0, GREY, 6); return s.build(); },
  shelf: () => { const s = new Shape(); s.box(0.4, 2.0, 1.0, 0, 1.0, 0, '#d9d3c6'); for (let y = 0.4; y < 2; y += 0.4) s.box(0.34, 0.26, 0.9, 0.02, y + 0.14, 0, ['#2f5d8a', '#8a3f2f', '#3f7a52', '#c9a33c'][Math.round(y * 5) % 4]); return s.build(); },
  bookshelf: () => {
    const s = new Shape(); s.box(0.5, 2.1, 3.0, 0, 1.05, 0, '#d6cfbf');
    const cols = ['#2f5d8a', '#8a3f2f', '#3f7a52', '#c9a33c', '#5d4a8a', '#2a2a2a', '#b85c38'];
    let k = 0;
    for (const side of [-0.13, 0.13]) for (let y = 0.1; y < 2.0; y += 0.38) for (let z = -1.4; z < 1.4; z += 0.2) { s.box(0.2, 0.28 + (k % 3) * 0.02, 0.17, side, y + 0.15, z + 0.1, cols[k % 7]); k++; }
    return s.build();
  },
  rack: () => { const s = new Shape(); s.box(1.1, 2.1, 0.7, 0, 1.05, 0, '#1c1e21'); for (let y = 0.2; y < 2; y += 0.12) s.box(0.02, 0.05, 0.5, 0.56, y, 0, (y * 10 | 0) % 3 ? '#3be26b' : '#3aa0ff', 0, 0, 1); return s.build(); },
  counter: () => {
    const s = new Shape();
    s.box(0.9, 0.9, 2.5, 0, 0.45, 0, '#c9ccce'); s.box(0.95, 0.04, 2.55, 0, 0.92, 0, STEEL);
    s.box(0.02, 0.4, 2.45, 0.18, 1.2, 0, '#dff0f5'); s.box(0.3, 0.02, 2.45, 0.05, 1.42, 0, '#dff0f5');
    const food = ['#c9772f', '#e8d6a1', '#7a9b3a', '#b83b2a', '#f0e8d0', '#8a5a2b'];
    for (let i = 0; i < 4; i++) s.box(0.32, 0.06, 0.5, -0.08, 0.96, -0.9 + i * 0.6, food[i % 6]);
    return s.build();
  },
  kasse: () => { const s = new Shape(); s.box(0.8, 1.0, 1.4, 0, 0.5, 0, '#d8d6d0'); s.box(0.1, 0.25, 0.35, -0.1, 1.12, 0.3, BLACK); s.box(0.02, 0.2, 0.3, -0.04, 1.12, 0.3, '#9fd0ff', 0, 0, 0.5); return s.build(); },
  trayreturn: () => { const s = new Shape(); s.box(0.9, 1.4, 3.0, 0, 0.7, 0, '#a9adb0'); s.box(0.05, 0.5, 2.6, 0.44, 0.95, 0, '#1b1c1e'); for (let z = -1.1; z <= 1.1; z += 0.55) s.box(0.3, 0.02, 0.4, 0.3, 0.72, z, '#e9e5da'); return s.build(); },
  aufwerter: () => { const s = new Shape(); s.box(0.5, 1.8, 0.7, 0, 0.9, 0, '#2c5e8f'); s.box(0.02, 0.3, 0.4, 0.26, 1.35, 0, '#bfe3ff', 0, 0, 0.7); s.box(0.03, 0.08, 0.2, 0.26, 1.05, 0, BLACK); return s.build(); },
  cafebar: () => { const s = new Shape(); s.box(1.0, 1.05, 5.0, 0, 0.52, 0, WOOD_D); s.box(1.05, 0.05, 5.05, 0, 1.07, 0, '#2a2a2a'); s.box(0.4, 0.5, 0.5, -0.1, 1.35, 1.6, '#3a3a3a'); s.box(0.4, 0.45, 0.4, -0.1, 1.32, -1.5, STEEL); return s.build(); },
  kitchen: () => { const s = new Shape(); s.box(0.62, 0.9, 2.4, 0, 0.45, 0, WHITE); s.box(0.65, 0.04, 2.42, 0, 0.92, 0, '#555'); s.box(0.35, 0.6, 2.4, -0.13, 1.8, 0, WHITE); s.box(0.3, 0.3, 0.3, 0.05, 1.08, 0.7, '#222'); return s.build(); },
  column: () => { const s = new Shape(); s.box(0.6, 1, 0.6, 0, 0.5, 0, '#d9d5cc'); return s.build(); }, // scaled in y
  lectern: () => { const s = new Shape(); s.box(0.6, 1.05, 0.9, 0, 0.52, 0, WOOD_D); s.box(0.55, 0.04, 0.85, -0.05, 1.08, 0, '#3a3a3a'); s.box(0.02, 0.18, 0.3, -0.1, 1.2, 0.2, BLACK); return s.build(); },
  elevator: () => { const s = new Shape(); s.box(2.2, 3.4, 2.2, 0, 1.7, 0, '#cfcbc2'); s.box(0.02, 2.1, 1.1, 1.11, 1.05, 0, STEEL); s.box(0.03, 2.1, 0.02, 1.12, 1.05, 0, '#777'); s.box(0.02, 0.1, 0.08, 1.12, 1.2, 0.75, '#222', 0, 0, 0.4); return s.build(); },
  bench: () => { const s = new Shape(); s.box(0.5, 0.06, 1.8, 0, 0.43, 0, WOOD); s.box(0.45, 0.4, 0.06, 0, 0.2, -0.8, GREY); s.box(0.45, 0.4, 0.06, 0, 0.2, 0.8, GREY); return s.build(); },
  plant: () => { const s = new Shape(); s.cyl(0.25, 0.2, 0.45, 0, 0.22, 0, '#8a5a3b', 8); s.sphere(0.45, 0, 0.85, 0, '#3f7a3a', 0, 0, 1.1); s.sphere(0.3, 0.15, 1.2, 0.1, '#4d8a44'); return s.build(); },
  // seat row: unit length 1 along z (scaled per instance), desk in front (+x side is where the audience looks)
  seatrow: () => {
    const s = new Shape();
    s.box(0.35, 0.05, 1, 0.25, 0.78, 0, WOOD);                // continuous desk
    s.box(0.04, 0.72, 1, 0.42, 0.4, 0, '#8b6a47');           // desk front panel
    for (let z = -0.4; z <= 0.41; z += 0.2) { s.box(0.4, 0.05, 0.16, -0.15, 0.46, z, '#2f4f7a'); s.box(0.05, 0.4, 0.16, -0.36, 0.68, z, '#2f4f7a'); }
    return s.build();
  },
  pinboard: () => { const s = new Shape(); s.box(0.03, 1.0, 1.5, 0, 1.45, 0, '#b58c5a'); const c = ['#fff', '#ffe98a', '#bde0ff', '#ffc9c9', '#d9f7c8']; for (let i = 0; i < 9; i++) s.box(0.01, 0.2, 0.16, 0.02, 1.2 + (i % 3) * 0.28, -0.55 + Math.floor(i / 3) * 0.5 + (i % 2) * 0.05, c[i % 5]); return s.build(); },
  board: () => { const s = new Shape(); s.box(0.05, 1.2, 3.5, 0, 1.55, 0, GREEN_BOARD); s.box(0.08, 0.05, 3.6, 0.03, 0.93, 0, '#777'); s.box(0.06, 0.05, 3.6, 0, 2.18, 0, '#777');
    for (let i = 0; i < 7; i++) s.box(0.01, 0.015, 0.4 + (i % 3) * 0.3, 0.03, 1.95 - i * 0.12, -1.2 + (i % 2) * 0.4, '#e9eee9'); return s.build(); },
  bigboard: () => { const s = new Shape(); s.box(0.06, 1.4, 1, 0, 1.6, 0, GREEN_BOARD); s.box(0.1, 0.05, 1.02, 0.03, 0.88, 0, '#777');
    for (let i = 0; i < 8; i++) s.box(0.012, 0.015, 0.06 + (i % 4) * 0.05, 0.035, 2.1 - i * 0.12, -0.35 + (i % 3) * 0.2, '#e9eee9'); return s.build(); },
  screen: () => { const s = new Shape(); s.box(0.02, 3.4, 1, 0, 0, 0, '#f4f4f2', 0, 0, 0.25); s.box(0.12, 0.1, 1.04, 0, 1.75, 0, '#333'); return s.build(); },
  light: () => { const s = new Shape(); s.box(1, 0.04, 1, 0, 0, 0, '#fffdf5', 0, 0, 1); return s.build(); },
};
