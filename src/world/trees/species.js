// Tree species used on the campus and in the surrounding forest. Pure data (also used by the
// collider builder and the walk test in Node).
//
// Heights are metres at instance scale 1. Crown envelopes are fractions of the height:
// ell = [centreY, horizontalRadius, verticalRadius], cone = [baseY, baseRadius].
// Palettes run from "still green" to "late autumn" (sRGB); each tree picks a point on it.
import { hash2 } from '../../shared/geom.js';

export const SPECIES = {
  // Winterlinde / Sommerlinde – the most common street and campus tree in Erlangen
  linden: {
    h: 15, r0: 0.23, base: 0.3, leader: 0.75, br: 9, angle: 58, spread: 12, up: 0.25, droop: 0.06,
    kids: 4, kidAngle: 45, env: ['ell', 0.62, 0.34, 0.37], irr: 0.15, cards: 340, card: 1.45, tiles: [0, 1],
    bark: 'grey', twig: '#4a4037', barkCol: '#78726a',
    pal: ['#5f7d33', '#8f9a38', '#c7b03c', '#d9b33a', '#a88532'], stage: 0,
  },
  // Spitzahorn / Bergahorn
  maple: {
    h: 13, r0: 0.21, base: 0.28, leader: 0.7, br: 8, angle: 60, spread: 14, up: 0.2, droop: 0.07,
    kids: 4, kidAngle: 48, env: ['ell', 0.6, 0.38, 0.37], irr: 0.18, cards: 320, card: 1.5, tiles: [2, 3],
    bark: 'grey', twig: '#4b3e33', barkCol: '#77716a',
    pal: ['#6a8634', '#b9a93a', '#e0a632', '#d9772c', '#b8452a'], stage: 0.1,
  },
  // Stieleiche – turns late, keeps brown leaves
  oak: {
    h: 16, r0: 0.3, base: 0.25, leader: 0.62, br: 7, angle: 70, spread: 18, up: 0.06, droop: 0.02,
    kids: 4, kidAngle: 55, env: ['ell', 0.58, 0.44, 0.36], irr: 0.25, kink: 0.28, cards: 340, card: 1.5, tiles: [4, 5],
    bark: 'oak', twig: '#463a30', barkCol: '#5e554b',
    pal: ['#56722f', '#7e8a35', '#a3893a', '#94672f', '#6f4d2c'], stage: -0.15,
  },
  // Hängebirke
  birch: {
    h: 15, r0: 0.14, base: 0.33, leader: 0.97, exc: true, br: 12, angle: 44, spread: 12, up: 0.12, droop: 0.5,
    kids: 3, kidAngle: 40, env: ['ell', 0.6, 0.22, 0.38], irr: 0.2, cards: 270, card: 1.1, tiles: [6, 7],
    bark: 'birch', twig: '#3b2d26', barkCol: '#d6d2c8',
    pal: ['#6f8a36', '#b7b23d', '#e3c84a', '#dcb23a', '#b08d3a'], stage: 0.12,
  },
  // Rosskastanie – browns early (leaf miner)
  chestnut: {
    h: 14, r0: 0.27, base: 0.28, leader: 0.7, br: 8, angle: 62, spread: 14, up: 0.15, droop: 0.15,
    kids: 4, kidAngle: 50, env: ['ell', 0.57, 0.38, 0.39], irr: 0.12, cards: 300, card: 1.6, tiles: [8, 9],
    bark: 'grey', twig: '#4d3f33', barkCol: '#6e655b',
    pal: ['#5b7a32', '#8e8e37', '#b3833a', '#94572c', '#6a4027'], stage: 0.15,
  },
  // Rotbuche
  beech: {
    h: 18, r0: 0.26, base: 0.3, leader: 0.8, br: 9, angle: 50, spread: 12, up: 0.3, droop: 0.06,
    kids: 4, kidAngle: 45, env: ['ell', 0.6, 0.32, 0.4], irr: 0.15, cards: 340, card: 1.45, tiles: [10, 11],
    bark: 'beech', twig: '#4a4540', barkCol: '#8e8e88',
    pal: ['#5f8034', '#a39a3a', '#c98e34', '#b8672b', '#8e4a27'], stage: 0,
  },
  // mixed shrubs (hazel, dogwood, hornbeam …)
  shrub: {
    h: 2.8, r0: 0.045, base: 0.04, leader: 0.12, br: 7, angle: 30, spread: 16, up: 0.35, droop: 0.2,
    kids: 3, kidAngle: 40, env: ['ell', 0.5, 0.5, 0.5], irr: 0.2, cards: 130, card: 0.8, tiles: [12, 13],
    bark: 'grey', twig: '#4a3c30', barkCol: '#5e5448',
    pal: ['#557533', '#7e8a36', '#a8913a', '#b35a2e', '#8c3a2a'], stage: 0,
  },
  // Waldkiefer – the Reichswald and Brucker Lache are pine forest; orange upper trunk
  pine: {
    h: 20, r0: 0.22, base: 0.66, leader: 0.97, exc: true, whorl: 3, br: 12, angle: 72, spread: 15, up: 0.35, droop: 0,
    kids: 3, kidAngle: 45, env: ['ell', 0.83, 0.2, 0.15], irr: 0.3, cards: 300, card: 1.55, tiles: [14, 14], tuft: true,
    bark: 'pine', twig: '#6b4a33', barkCol: '#9a6548',
    pal: ['#2b4629', '#314d2d', '#375431', '#3e5a34', '#476038'], stage: 0, evergreen: true,
  },
  // Fichte
  spruce: {
    h: 20, r0: 0.22, base: 0.06, leader: 1.0, exc: true, whorl: 5, br: 45, angle: 100, spread: 8, up: -0.05, droop: 0.3,
    kids: 2, kidAngle: 50, env: ['cone', 0.06, 0.2], irr: 0.1, cards: 340, card: 1.25, tiles: [15, 15], spray: true,
    bark: 'spruce', twig: '#5a4234', barkCol: '#6a5446',
    pal: ['#2c4a2e', '#315033', '#365636', '#3b5b38', '#40603b'], stage: 0, evergreen: true,
  },
};
export const SPECIES_KEYS = Object.keys(SPECIES);
export const HEDGE_PAL = ['#3f6130', '#4c6e34', '#6c8038', '#8f8a3a', '#9a7a34'];

const pick = (r, table) => { let s = 0; for (const [, w] of table) s += w; let v = r * s; for (const [k, w] of table) { v -= w; if (v <= 0) return k; } return table[0][0]; };
const CAMPUS = [['linden', 30], ['maple', 28], ['oak', 14], ['birch', 12], ['chestnut', 8], ['beech', 8]];
const FOREST_BROAD = [['oak', 40], ['birch', 30], ['beech', 22], ['maple', 8]];

// type: 0 broadleaf (or unknown), 1 needleleaved, 3 scrub; forest = inside a mapped forest.
export function assignSpecies(x, z, type, forest, r) {
  if (type === 3) return 'shrub';
  if (forest) {
    // pine-dominated mixed forest; mapped needleleaved trees stay conifers
    if (type === 1) return r < 0.8 ? 'pine' : 'spruce';
    return r < 0.55 ? 'pine' : r < 0.62 ? 'spruce' : pick((r - 0.62) / 0.38, FOREST_BROAD);
  }
  if (type === 1) return r < 0.55 ? 'pine' : 'spruce';
  // neighbouring campus trees (rows, groups) tend to be the same species
  const cell = hash2(Math.floor(x / 28), Math.floor(z / 28));
  return pick(r < 0.7 ? cell : r, CAMPUS);
}

// Largest instance scale per species (keeps trunks from growing into paths).
export const MAX_SCALE = { linden: 1.45, maple: 1.5, oak: 1.3, birch: 1.3, chestnut: 1.35, beech: 1.3, shrub: 1.4, pine: 1.3, spruce: 1.3 };

// Trunk radius at 1 m height, used for the collider (matches the rendered trunk).
export function trunkRadius(sp, scale) { return SPECIES[sp].r0 * scale + 0.02; }
