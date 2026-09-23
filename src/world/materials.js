// Shared materials. Facade windows are generated in the fragment shader from per-vertex
// metric coordinates, so buildings need no textures and stay crisp at any distance.
import * as THREE from 'three';
import * as T from './textures.js';

export const STYLE_ID = { ribbon: 0, lab: 1, panel: 2, glass: 3, brick: 4, plaster: 5, hall: 6, deck: 7, plain: 8, church: 9, gable: 10, interior: 11 };

// Global uniforms shared by many materials (weather / time of day).
export const globalUniforms = {
  uNight: { value: 0 },   // 0 day … 1 night (window lights, lamps)
  uWet: { value: 0 },     // 0 dry … 1 soaked (rain)
  uTime: { value: 0 },
  uLeafTint: { value: 1 },
};

const FACADE_PARS = /* glsl */`
uniform float uNight;
uniform float uWet;
varying vec4 vF;   // u along edge (m), height (m), edge length (m), wall top (m)
varying vec4 vS;   // style id, level height, seed, levels
float fHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float box1(float x, float a, float b) { return step(a, x) * step(x, b); }
`;

// Computes facade appearance. Writes: fCol (albedo), fGlass (0..1), fEmis (rgb), fRough, fMetal
const FACADE_MAIN = /* glsl */`
vec3 fCol = diffuseColor.rgb;
float fGlass = 0.0; vec3 fEmis = vec3(0.0); float fRough = 0.88; float fMetal = 0.0;
{
  float u = vF.x, h = vF.y, L = vF.z, top = vF.w;
  bool inner = vS.x > 19.5;            // interior face of an exterior wall
  int st = int(vS.x - (inner ? 20.0 : 0.0) + 0.5);
  // seed is interpolated per pixel; round it so the hash is identical across a whole wall
  float lh = max(vS.y, 2.0), seed = floor(vS.z * 8.0 + 0.5), levels = floor(vS.w + 0.5);
  float fl = floor(h / lh), fy = h - fl * lh;
  float aa = max(fwidth(u), fwidth(h));               // metres per pixel → fade fine detail
  float fine = 1.0 - smoothstep(0.012, 0.05, aa);
  float fine2 = 1.0 - smoothstep(0.006, 0.02, aa);  // for very fine stripes (blind slats, bricks)
  // surface grain / exposed aggregate
  if (!inner && st != 11) {
    float grain = fHash(vec3(floor(u * 18.0), floor(h * 18.0), seed)) - 0.5;
    fCol *= 1.0 + grain * 0.10 * fine;
    // weathering streaks below windows, darker near ground
    fCol *= mix(0.86, 1.0, smoothstep(0.0, 0.6, h));
    float streak = fHash(vec3(floor(u * 1.3), 7.0, seed));
    fCol *= 1.0 - 0.05 * streak * smoothstep(top, top - 6.0, h);
    // metal flashing at the roof edge
    if (st != 10 && h > top - 0.14) { fCol = vec3(0.32, 0.33, 0.34); fMetal = 0.4; fRough = 0.5; }
  } else if (inner && fy < 0.08) { fCol = vec3(0.36, 0.35, 0.34); }

  bool upper = fl < levels && h < top - 0.3;
  float win = 0.0, frame = 0.0, cellId = 0.0;
  float wy0 = 0.0, wy1 = 0.0; // window vertical extent in floor-local metres
  if (st == 0) { // ribbon windows
    wy0 = 1.05; wy1 = lh - 0.5;
    float m = 0.45;
    if (upper && u > m && u < L - m && fy > wy0 && fy < wy1) {
      win = 1.0;
      float mod1 = mod(u - m, 1.25);
      cellId = floor((u - m) / 1.25);
      frame = max(step(mod1, 0.07), max(step(fy, wy0 + 0.06), step(wy1 - 0.06, fy)));
      frame = max(frame, step(abs(fy - (wy0 + (wy1 - wy0) * 0.72)), 0.03));
    }
    // horizontal board-form lines on the concrete spandrel
    fCol *= 1.0 - 0.05 * fine * step(0.9, fract(h * 4.0));
  } else if (st == 1 || st == 4 || st == 5 || st == 9) {
    float sp = st == 5 ? 2.9 : st == 9 ? 4.2 : 2.7;
    float ww = st == 5 ? 1.25 : st == 9 ? 1.1 : 1.7;
    wy0 = st == 5 ? 0.9 : 0.95; wy1 = st == 5 ? 2.25 : lh - 0.65;
    if (st == 9) { wy0 = 2.0; wy1 = top - 1.6; upper = h < top - 1.0; fl = 0.0; fy = h; }
    float n = floor((L - 0.8) / sp);
    if (upper && n >= 1.0) {
      float start = (L - n * sp) * 0.5;
      float c = (u - start) / sp; float ci = floor(c);
      float cx = (fract(c) - 0.5) * sp;
      if (ci >= 0.0 && ci < n && abs(cx) < ww * 0.5 && fy > wy0 && fy < wy1) {
        win = 1.0; cellId = ci;
        float fx = ww * 0.5 - abs(cx);
        frame = max(step(fx, 0.07), max(step(fy, wy0 + 0.07), step(wy1 - 0.07, fy)));
        if (st != 9) frame = max(frame, step(abs(cx), 0.035));
      }
      // window reveal shadow / sill
      if (ci >= 0.0 && ci < n && abs(cx) < ww * 0.5 + 0.08 && fy > wy0 - 0.08 && fy < wy1 + 0.05 && win < 0.5) fCol *= 0.72;
      if (st == 5 && ci >= 0.0 && ci < n && abs(cx) < ww * 0.5 + 0.06 && fy > wy1 + 0.02 && fy < wy1 + 0.24) fCol = mix(fCol, vec3(0.78), 0.6); // roller shutter box
    }
    if (st == 4) { // brick bond
      float row = floor(h / 0.0775);
      float bu = u / 0.25 + mod(row, 2.0) * 0.5;
      float mort = max(step(fract(h / 0.0775), 0.13), step(fract(bu), 0.05));
      float bv = fHash(vec3(floor(bu), row, seed)) - 0.5;
      vec3 brick = fCol * (1.0 + bv * 0.22);
      fCol = mix(fCol * 0.93, mix(brick, vec3(0.62, 0.6, 0.56), mort), fine2);
    }
  } else if (st == 2) { // modern panels with irregular tall windows
    float sp = 1.25;
    float ci = floor(u / sp); float cx = fract(u / sp) * sp;
    float joint = max(step(cx, 0.02), step(abs(fy - 0.02), 0.02));
    fCol *= 1.0 - 0.25 * joint * fine;
    fCol *= 0.92 + 0.16 * fHash(vec3(ci, fl, seed));
    wy0 = 0.55; wy1 = lh - 0.35;
    if (upper && u > 0.6 && u < L - 0.6 && fHash(vec3(ci, fl, seed + 3.0)) > 0.42 && cx > 0.12 && cx < sp - 0.12 && fy > wy0 && fy < wy1) {
      win = 1.0; cellId = ci;
      frame = max(step(cx, 0.17), max(step(sp - 0.17, cx), max(step(fy, wy0 + 0.05), step(wy1 - 0.05, fy))));
    }
  } else if (st == 3) { // curtain wall
    float sp = 1.5;
    float cx = fract(u / sp) * sp; cellId = floor(u / sp);
    wy0 = 0.0; wy1 = lh;
    if (h < top - 0.3) {
      bool slab = fy > lh - 0.45;
      win = slab ? 0.0 : 1.0;
      frame = max(step(cx, 0.06), step(abs(fy - 1.1), 0.03));
      if (slab) { fCol = vec3(0.2, 0.22, 0.24); fMetal = 0.5; fRough = 0.4; }
    }
  } else if (st == 6) { // hall: corrugated cladding + clerestory
    float cor = sin(u * 31.4159);
    fCol *= 1.0 + 0.06 * cor * fine;
    fMetal = 0.15; fRough = 0.55;
    wy0 = top - 2.2; wy1 = top - 0.9;
    if (h > wy0 && h < wy1 && u > 1.0 && u < L - 1.0) {
      win = 1.0; cellId = floor(u / 2.0);
      frame = max(step(mod(u, 2.0), 0.08), max(step(h, wy0 + 0.07), step(wy1 - 0.07, h)));
      fy = h - wy0 + 1.0; wy0 = 1.0; wy1 = 1.0 + 1.3;
    }
    if (h < 0.6) fCol = vec3(0.55, 0.54, 0.52);
  } else if (st == 7) { // parking deck
    wy0 = 1.05; wy1 = lh - 0.35;
    float col = step(mod(u, 5.4), 0.4);
    if (upper && fy > wy0 && fy < wy1 && col < 0.5 && u > 0.5 && u < L - 0.5) {
      fCol = vec3(0.06, 0.06, 0.065); fRough = 1.0;
      fEmis = vec3(1.0, 0.95, 0.85) * 0.12 * uNight * step(0.4, fHash(vec3(floor(u / 5.4), fl, seed)));
    }
  } else if (st == 10) { // gable end (plaster)
    fCol *= 0.97;
  } else if (st == 11) { // interior walls: plain paint with skirting
    if (fy < 0.1) fCol = vec3(0.35, 0.34, 0.33);
  }

  if (win > 0.5) {
    // thin frames/mullions alias at distance: fade them out when a pixel covers more than a few cm
    frame *= 1.0 - smoothstep(0.025, 0.07, aa);
    float hsh = fHash(vec3(cellId, fl, seed + 11.0));
    vec3 frameCol = st == 5 ? vec3(0.92) : st == 2 ? vec3(0.16) : st == 9 ? vec3(0.3, 0.3, 0.32) : vec3(0.42, 0.43, 0.44);
    // venetian blinds / roller shutters partly lowered
    float blind = hsh < 0.52 ? 0.0 : hsh < 0.85 ? (hsh - 0.52) * 2.4 : 1.0;
    if (st == 3 || st == 9) blind = 0.0;
    float wfrac = (fy - wy0) / max(wy1 - wy0, 0.01);
    bool inBlind = wfrac > 1.0 - blind;
    vec3 glassCol = vec3(0.05, 0.07, 0.085) * (0.8 + 0.5 * fHash(vec3(cellId, fl, seed + 5.0)));
    float lit = inner ? 0.0 : step(fHash(vec3(cellId, fl, seed + 23.0)), (st == 5 ? 0.45 : 0.3)) * uNight;
    if (inner) frameCol = vec3(0.9, 0.9, 0.88);
    vec3 warm = mix(vec3(1.0, 0.78, 0.5), vec3(0.85, 0.9, 1.0), step(0.7, fHash(vec3(cellId, fl, seed + 29.0))));
    if (frame > 0.5) { fCol = frameCol; fRough = 0.5; fMetal = 0.2; }
    else if (inBlind) {
      float slat = 0.8 + 0.2 * smoothstep(0.35, 0.65, fract(fy * 12.5));
      fCol = (st == 5 ? vec3(0.8, 0.79, 0.76) : vec3(0.62, 0.63, 0.64)) * mix(0.9, slat, fine2);
      fRough = 0.55; fMetal = st == 5 ? 0.0 : 0.3;
      fEmis = warm * lit * 0.35;
    } else {
      fCol = glassCol; fGlass = 1.0; fRough = 0.12; fMetal = 0.5;
      fEmis = warm * lit * 1.1;
    }
  }
}
#ifdef CUTOUT
if (fGlass > 0.5) discard;
#endif
diffuseColor.rgb = fCol;
`;

export function createFacadeMaterial(cutout = false) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0, side: cutout ? THREE.FrontSide : THREE.FrontSide });
  if (cutout) m.defines = { CUTOUT: 1 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = globalUniforms.uNight;
    sh.uniforms.uWet = globalUniforms.uWet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aF;\nattribute vec4 aS;\nvarying vec4 vF;\nvarying vec4 vS;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvF = aF; vS = aS;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FACADE_MAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmis;');
  };
  m.customProgramCacheKey = () => 'facade-v1' + (cutout ? '-cut' : '');
  return m;
}

// Ground materials get a wetness response (darker + glossier in rain) and large-scale colour
// variation (macro > 0) that hides texture tiling on lawns.
const MACRO = /* glsl */`
float gN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = fract(sin(dot(i, vec2(127.1,311.7)))*43758.5), b = fract(sin(dot(i+vec2(1,0), vec2(127.1,311.7)))*43758.5);
  float c = fract(sin(dot(i+vec2(0,1), vec2(127.1,311.7)))*43758.5), d = fract(sin(dot(i+vec2(1,1), vec2(127.1,311.7)))*43758.5);
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
`;
function wetify(m, wetStrength = 1, key = 'g', macro = 0) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = globalUniforms.uWet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec2 vGXZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGXZ = (modelMatrix * vec4(position, 1.0)).xz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWet;
varying vec2 vGXZ;
` + MACRO)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float mA = gN(vGXZ / 37.0) * 0.6 + gN(vGXZ / 9.0) * 0.4;
        vec3 dry = diffuseColor.rgb * vec3(1.18, 1.05, 0.78);
        diffuseColor.rgb = mix(diffuseColor.rgb * (0.9 + 0.2 * mA), mix(diffuseColor.rgb, dry, smoothstep(0.45, 0.85, mA)), ${macro.toFixed(2)});
        diffuseColor.rgb *= 1.0 - 0.42 * uWet * ${wetStrength.toFixed(2)};
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.22, uWet * ${wetStrength.toFixed(2)});`);
  };
  m.customProgramCacheKey = () => 'wet-' + key + wetStrength + '-' + macro;
  return m;
}

function tiled(tex, size) {
  const t = tex; t.repeat.set(1 / size, 1 / size); return t;
}

export function createMaterials(maxAniso = 8) {
  const lay = (m, layer) => { m.polygonOffset = true; m.polygonOffsetFactor = -layer; m.polygonOffsetUnits = -layer * 2; return m; };
  const grassTex = tiled(T.grassTexture(), 7);
  const mats = {
    facade: createFacadeMaterial(),
    facadeCut: createFacadeMaterial(true),
    roofFlat: new THREE.MeshStandardMaterial({ map: tiled(T.flatRoofTexture(), 4), vertexColors: true, roughness: 0.95 }),
    roofTile: new THREE.MeshStandardMaterial({ map: T.roofTileTexture(), vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
    ground: wetify(new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }), 0.5, 'base', 1),
    area: {},
    road: {},
    marking: lay(wetify(new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7 }), 0.6, 'mk'), 6),
    water: new THREE.MeshStandardMaterial({ color: 0x2c4a4c, roughness: 0.08, metalness: 0.6 }),
  };
  mats.roofTile.map.repeat.set(0.5, 0.5);
  const A = mats.area;
  A.grass = lay(wetify(new THREE.MeshStandardMaterial({ map: grassTex, color: 0xf2f6ea, roughness: 1 }), 0.5, 'grass', 1), 1);
  A.meadow = lay(wetify(new THREE.MeshStandardMaterial({ map: grassTex, color: 0xe8e2b8, roughness: 1 }), 0.5, 'meadow', 1), 1);
  A.farmland = A.meadow;
  A.forest = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.forestFloorTexture(), 5), roughness: 1 }), 0.5, 'forest', 0.6), 1);
  A.wetland = A.forest;
  A.scrub = lay(wetify(new THREE.MeshStandardMaterial({ map: grassTex, color: 0xc9cfae, roughness: 1 }), 0.5, 'scrub'), 1);
  A.construction = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.dirtTexture(), 5), roughness: 1 }), 0.7, 'cons'), 2);
  A.pitchgrass = lay(wetify(new THREE.MeshStandardMaterial({ map: grassTex, color: 0xd8f0c8, roughness: 1 }), 0.5, 'pg'), 2);
  A.turf = lay(wetify(new THREE.MeshStandardMaterial({ color: 0x3f8a3c, roughness: 0.9 }), 0.4, 'turf'), 2);
  A.tartan = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.tartanTexture(), 3), roughness: 0.85 }), 0.7, 'tartan'), 2);
  A.clay = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.tartanTexture([184, 104, 70]), 3), roughness: 1 }), 0.6, 'clay'), 2);
  A.court = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.asphaltTexture(), 6), color: 0xb8c4b0, roughness: 0.9 }), 0.9, 'court'), 2);
  A.sand = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.gravelTexture(), 3), color: 0xf8ecc8, roughness: 1 }), 0.6, 'sand'), 2);
  A.playground = A.sand;
  const asph = tiled(T.asphaltTexture(), 6);
  const pav = tiled(T.paversTexture(), 2.4);
  A.parking = lay(wetify(new THREE.MeshStandardMaterial({ map: asph, color: 0xd8d8d8, roughness: 0.92 }), 1, 'park'), 3);
  A.paved = lay(wetify(new THREE.MeshStandardMaterial({ map: pav, roughness: 0.9 }), 1, 'paved'), 3);
  A.road = lay(wetify(new THREE.MeshStandardMaterial({ map: asph, roughness: 0.92 }), 1, 'aroad'), 4);
  A.island = A.grass;
  A.water = mats.water;
  const R = mats.road;
  R.asphalt = lay(wetify(new THREE.MeshStandardMaterial({ map: asph, roughness: 0.92 }), 1, 'r-asph', 0.25), 4);
  R.pavers = lay(wetify(new THREE.MeshStandardMaterial({ map: pav, roughness: 0.9 }), 1, 'r-pav'), 4);
  R.concrete = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.slabsTexture(), 2), roughness: 0.9 }), 1, 'r-conc'), 4);
  R.sett = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.settTexture(), 1.6), roughness: 0.85 }), 1, 'r-sett'), 4);
  R.gravel = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.gravelTexture(), 3), roughness: 1 }), 0.8, 'r-grav'), 4);
  R.dirt = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.dirtTexture(), 4), roughness: 1 }), 0.7, 'r-dirt'), 4);
  R.grasspave = lay(wetify(new THREE.MeshStandardMaterial({ map: grassTex, color: 0xd0d6c0, roughness: 1 }), 0.6, 'r-gp'), 4);
  R.wood = lay(wetify(new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 }), 0.8, 'r-wood'), 4);
  R.tartan = A.tartan;
  R.sidewalk = lay(wetify(new THREE.MeshStandardMaterial({ map: pav, roughness: 0.9 }), 1, 'r-sw'), 5);
  R.curb = lay(wetify(new THREE.MeshStandardMaterial({ color: 0xb8b6b0, roughness: 0.8 }), 1, 'r-curb'), 5);
  for (const m of [...Object.values(A), ...Object.values(R), mats.ground]) {
    if (m.map) m.map.anisotropy = maxAniso;
  }
  return mats;
}
