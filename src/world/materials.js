// Shared materials. Facade windows are generated in the fragment shader from per-vertex
// metric coordinates, so buildings need no textures and stay crisp at any distance.
import * as THREE from 'three';
import * as T from './textures.js';
import { FACADE_PARS, FACADE_MAIN, FACADE_NORMAL } from './facade.js';

export const STYLE_ID = { ribbon: 0, lab: 1, panel: 2, glass: 3, brick: 4, plaster: 5, hall: 6, deck: 7, plain: 8, church: 9, gable: 10, interior: 11, deckmesh: 12, door: 13, baroque: 14, ashlar: 15 };

// Global uniforms shared by many materials (weather / time of day).
export const globalUniforms = {
  uNight: { value: 0 },   // 0 day … 1 night (window lights, lamps)
  uWet: { value: 0 },     // 0 dry … 1 soaked (rain)
  uTime: { value: 0 },
  uWind: { value: 0.8 },  // tree sway strength
  uSunVis: { value: 0.55 }, // how visible direct sun shadows are (weather)
  uInnerDim: { value: 0.42 }, // interiors seen from outside are darker (eye adaptation)
  uLeafTint: { value: 1 },
};

export function createFacadeMaterial(cutout = false) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0, side: cutout ? THREE.FrontSide : THREE.FrontSide });
  if (cutout) m.defines = { CUTOUT: 1 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = globalUniforms.uNight;
    sh.uniforms.uWet = globalUniforms.uWet;
    sh.uniforms.uSunVis = globalUniforms.uSunVis;
    sh.uniforms.uInnerDim = globalUniforms.uInnerDim;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aF;\nattribute vec4 aS;\nvarying vec4 vF;\nvarying vec4 vS;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvF = aF; vS = aS;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FACADE_MAIN)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FACADE_NORMAL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmis;');
  };
  m.customProgramCacheKey = () => 'facade-v2' + (cutout ? '-cut' : '');
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
    bridge: wetify(new THREE.MeshStandardMaterial({ color: 0xa3a19b, roughness: 0.85 }), 0.8, 'bridge'),
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
  A.flowerbed = lay(wetify(new THREE.MeshStandardMaterial({ map: tiled(T.flowerBedTexture(), 2), roughness: 1 }), 0.5, 'flower'), 2);
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
