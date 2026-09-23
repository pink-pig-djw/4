// Materials for procedural trees: bark, leaf cards (with autumn palette, wind, translucency),
// alpha-tested shadow casters, and the far-distance impostor billboards.
import * as THREE from 'three';
import { globalUniforms } from '../materials.js';

// Tree sway (whole tree, grows with height) plus leaf/twig flutter. inst = instance position.
const WIND = /* glsl */`
uniform float uTime;
uniform float uWind;
attribute vec2 aWind;
vec3 treeWind(vec3 pos, vec3 inst) {
  float ph = dot(inst.xz, vec2(0.071, 0.113));
  float gust = 0.55 + 0.45 * sin(uTime * 0.31 + inst.x * 0.013) * sin(uTime * 0.19 + inst.z * 0.011 + 1.3);
  float w = uWind * gust;
  vec2 sway = vec2(sin(uTime * 0.83 + ph), cos(uTime * 0.67 + ph * 1.7)) * aWind.x * w * 0.25;
  float fl = sin(uTime * 3.3 + dot(pos, vec3(1.7, 1.1, 1.3)) + ph * 3.0) * aWind.y * w * 0.045;
  pos.xz += sway + vec2(fl, fl * 0.7);
  pos.y += fl * 0.6;
  return pos;
}
`;
const INST = /* glsl */`
vec3 inst = vec3(0.0);
#ifdef USE_INSTANCING
  inst = instanceMatrix[3].xyz;
#endif
`;
const DITHER = /* glsl */`
float treeIgn(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
`;
// Alpha of a leaf texel, boosted in smaller mip levels so distant crowns don't thin out.
const LEAF_ALPHA = /* glsl */`
float leafAlpha(float a, vec2 uv, float size) {
  vec2 dx = dFdx(uv * size), dy = dFdy(uv * size);
  float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
  return a * (1.0 + max(lod, 0.0) * 0.3);
}
`;

// Shared fade parameters (LOD1 → impostor cross-fade band): x = start distance, y = length.
export const fadeUniform = { value: new THREE.Vector2(100, 12) };

export function barkMaterial(tex, fade) {
  const m = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, vertexColors: true, roughness: 0.93, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = globalUniforms.uTime; sh.uniforms.uWind = globalUniforms.uWind; sh.uniforms.uWet = globalUniforms.uWet;
    sh.uniforms.uFade = fadeUniform;
    if (fade) sh.defines.TREE_FADE = '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND}\nuniform vec2 uFade;\nvarying float vFade;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${INST}\ntransformed = treeWind(transformed, inst);\nvFade = clamp((distance(cameraPosition.xz, inst.xz) - uFade.x) / uFade.y, 0.0, 1.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${DITHER}\nuniform float uWet;\nvarying float vFade;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n#ifdef TREE_FADE\nif (treeIgn(gl_FragCoord.xy) < vFade) discard;\n#endif`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.4 * uWet;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.45, uWet);');
  };
  m.customProgramCacheKey = () => 'tree-bark-v1' + (fade ? 'f' : '');
  return m;
}

// Leaf cards. sp: {pal:[5 hex], twig: hex}. ic: default (progress, brightness, loss) for
// non-instanced meshes (hedges).
export function leafMaterial(atlas, sp, fade, antialias, ic = [0.3, 1, 0]) {
  // the atlas is also set as .map: the shadow pass copies .map onto the depth material (which
  // needs it for the cut-out); the colour pass samples it itself, so the map chunk is skipped
  const m = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  m.alphaToCoverage = !!antialias;
  const u = {
    uLeafTex: { value: atlas.texture }, uTexSize: { value: atlas.size },
    uPal: { value: sp.pal.map(c => new THREE.Color(c)) }, uTwig: { value: new THREE.Color(sp.twig) },
    uIC: { value: new THREE.Vector3(...ic) }, uTrans: { value: 0.85 },
  };
  m.userData.u = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.uniforms.uTime = globalUniforms.uTime; sh.uniforms.uWind = globalUniforms.uWind; sh.uniforms.uWet = globalUniforms.uWet;
    sh.uniforms.uFade = fadeUniform;
    if (fade) sh.defines.TREE_FADE = '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND}\nattribute vec4 aCard;\nuniform vec2 uFade;\nuniform vec3 uIC;\nvarying vec2 vLeafUv;\nvarying vec3 vLeaf;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
${INST}
vec3 ic = uIC;
#ifdef USE_INSTANCING_COLOR
  ic = instanceColor;
#endif
transformed = treeWind(transformed, inst);
if (aCard.x < ic.z) transformed = vec3(0.0);   // leaves already fallen
vLeafUv = uv;
vLeaf = vec3(ic.x + (aCard.y - 0.5) * 0.5, aCard.w * ic.y, clamp((distance(cameraPosition.xz, inst.xz) - uFade.x) / uFade.y, 0.0, 1.0));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${DITHER}
${LEAF_ALPHA}
uniform sampler2D uLeafTex; uniform float uTexSize; uniform vec3 uPal[5]; uniform vec3 uTwig; uniform float uWet; uniform float uTrans;
varying vec2 vLeafUv; varying vec3 vLeaf;
vec3 leafPal(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  vec3 a = uPal[0], b = uPal[1]; float f = t;
  if (t > 3.0) { a = uPal[3]; b = uPal[4]; f = t - 3.0; }
  else if (t > 2.0) { a = uPal[2]; b = uPal[3]; f = t - 2.0; }
  else if (t > 1.0) { a = uPal[1]; b = uPal[2]; f = t - 1.0; }
  return mix(a, b, f);
}`)
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', `
vec4 lt = texture2D(uLeafTex, vLeafUv);
#ifdef TREE_FADE
if (treeIgn(gl_FragCoord.xy) < vLeaf.z) discard;
#endif
vec3 lc = mix(leafPal(vLeaf.x + (lt.g - 0.5) * 0.8), uTwig, lt.b);
float shade = mix(lt.r * 1.3, lt.r * 2.4, lt.b) * vLeaf.y;
diffuseColor.rgb = lc * shade * (1.0 - 0.28 * uWet);
float cardFacing = abs(dot(normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))), normalize(vViewPosition)));
if (cardFacing < 0.12) discard;   // edge-on cards read as flat planes
diffuseColor.a = leafAlpha(lt.a, vLeafUv, uTexSize);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.4, uWet);')
      // spherical crown normals must not flip on back faces
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      // light shining through the leaves
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
void RE_Direct_Leaf(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  float fwd = pow(saturate(dot(-geometryViewDir, directLight.direction)), 4.0);
  float back = saturate(dot(-geometryNormal, directLight.direction));
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * (0.3 * back + 0.9 * fwd) * uTrans;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf`);
  };
  m.customProgramCacheKey = () => 'tree-leaf-v2' + (fade ? 'f' : '') + (antialias ? 'a' : '');
  return m;
}

// Shadow caster for leaf cards: same wind and fallen leaves, alpha-tested cut-out.
export function leafDepthMaterial(atlas) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas.texture, alphaTest: 0.5 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = globalUniforms.uTime; sh.uniforms.uWind = globalUniforms.uWind; sh.uniforms.uTexSize = { value: atlas.size };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND}\nattribute vec4 aCard;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
${INST}
float loss = 0.0;
#ifdef USE_INSTANCING_COLOR
  loss = instanceColor.z;
#endif
transformed = treeWind(transformed, inst);
if (aCard.x < loss) transformed = vec3(0.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTexSize;\n${LEAF_ALPHA}`)
      .replace('#include <alphatest_fragment>', 'if (leafAlpha(diffuseColor.a, vMapUv, uTexSize) < alphaTest) discard;');
  };
  m.customProgramCacheKey = () => 'tree-leaf-depth-v1';
  return m;
}

// ---------------------------------------------------------------------------------------------
// Impostors: camera-facing billboards (rotating about the vertical axis) that show a baked view
// of each tree model. Data texture: R = sqrt(shade/2), G = colour offset, B = foliage, A = alpha.
// Normal texture: view-space normal at bake time (x right, y up, z toward the viewer).

export function impostorMaterial(bake, palettes, barkCols) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, alphaTest: 0.5 });
  const u = {
    uImpData: { value: bake.data.texture }, uImpNorm: { value: bake.norm.texture },
    uGrid: { value: new THREE.Vector2(bake.cols, bake.rows) }, uImpSize: { value: new THREE.Vector2(bake.width, bake.height) },
    uTile: { value: bake.tiles.map(t => new THREE.Vector4(t[0], t[1], t[2], 0)) },
    uPalAll: { value: palettes.flat().map(c => new THREE.Color(c)) },
    uBarkAll: { value: barkCols.map(c => new THREE.Color(c)) },
  };
  const NT = bake.tiles.length, NS = barkCols.length;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.uniforms.uFade = fadeUniform; sh.uniforms.uWet = globalUniforms.uWet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aImp;   // tile, species, flip (±1)
uniform vec4 uTile[${NT}];
uniform vec2 uGrid;
uniform vec2 uFade;
varying vec2 vImpUv; varying float vImpFade; varying vec3 vImpInfo; varying vec3 vRightW; varying vec3 vFwdW;`)
      .replace('#include <begin_vertex>', `
vec3 inst = instanceMatrix[3].xyz;
float isx = length(instanceMatrix[0].xyz), isy = length(instanceMatrix[1].xyz);
vec4 tl = uTile[int(aImp.x + 0.5)];
vec3 toCam = cameraPosition - inst; toCam.y = 0.0;
vec3 fwd = normalize(toCam + vec3(1e-4, 0.0, 0.0));
vec3 right = vec3(fwd.z, 0.0, -fwd.x);
vec3 transformed = inst + right * position.x * tl.x * isx + vec3(0.0, (tl.z + position.y * tl.y) * isy, 0.0);
vImpFade = clamp((length(toCam) - uFade.x) / uFade.y, 0.0, 1.0);
vec2 cell = vec2(mod(aImp.x, uGrid.x), floor(aImp.x / uGrid.x + 0.001));
vImpUv = (cell + vec2(position.x * aImp.z + 0.5, position.y)) / uGrid;
vImpInfo = vec3(instanceColor.x, instanceColor.y, aImp.y);
vRightW = right * aImp.z; vFwdW = fwd;`)
      .replace('#include <project_vertex>', `vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
gl_Position = projectionMatrix * mvPosition;
if (vImpFade <= 0.0) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);`)
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${DITHER}
uniform sampler2D uImpData; uniform sampler2D uImpNorm; uniform vec2 uImpSize;
uniform vec3 uPalAll[${NS * 5}]; uniform vec3 uBarkAll[${NS}]; uniform float uWet;
varying vec2 vImpUv; varying float vImpFade; varying vec3 vImpInfo; varying vec3 vRightW; varying vec3 vFwdW;
vec3 impPal(int s, float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  int i = int(min(floor(t), 3.0));
  return mix(uPalAll[s * 5 + i], uPalAll[s * 5 + i + 1], t - float(i));
}`)
      .replace('#include <color_fragment>', `
if (treeIgn(gl_FragCoord.xy) >= vImpFade) discard;
vec4 idt = texture2D(uImpData, vImpUv);
vec2 tdx = dFdx(vImpUv * uImpSize), tdy = dFdy(vImpUv * uImpSize);
float ilod = 0.5 * log2(max(max(dot(tdx, tdx), dot(tdy, tdy)), 1e-8));
diffuseColor.a = idt.a * (1.0 + max(ilod, 0.0) * 0.35);
int isp = int(vImpInfo.z + 0.5);
float ishade = idt.r * idt.r * 2.0;
vec3 ileaf = impPal(isp, vImpInfo.x + (idt.g - 0.5) * 2.0) * ishade * vImpInfo.y;
diffuseColor.rgb = mix(uBarkAll[isp] * ishade, ileaf, idt.b) * (1.0 - 0.28 * uWet);`)
      .replace('#include <normal_fragment_begin>', `
float faceDirection = 1.0;
vec3 inb = texture2D(uImpNorm, vImpUv).xyz * 2.0 - 1.0;
vec3 inw = normalize(vRightW * inb.x + vec3(0.0, 1.0, 0.0) * inb.y + vFwdW * inb.z);
vec3 normal = normalize((viewMatrix * vec4(inw, 0.0)).xyz);
vec3 nonPerturbedNormal = normal;`);
  };
  m.customProgramCacheKey = () => 'tree-impostor-v1';
  return m;
}

// ---------------------------------------------------------------------------------------------
// Bake materials (render the full model into the impostor atlas)

export function bakeMaterials(atlas) {
  const leafVS = `attribute vec4 aCard; varying vec2 vUv; varying vec4 vCard; varying vec3 vN;
void main() { vUv = uv; vCard = aCard; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const leafCommon = `uniform sampler2D uLeafTex; uniform float uTexSize; varying vec2 vUv; varying vec4 vCard; varying vec3 vN;
${LEAF_ALPHA}`;
  const barkVS = `varying vec2 vUv; varying vec3 vCol; varying vec3 vN;
attribute vec3 color;
void main() { vUv = uv; vCol = color; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const lu = () => ({ uLeafTex: { value: atlas.texture }, uTexSize: { value: atlas.size } });
  return {
    leafData: new THREE.ShaderMaterial({ uniforms: lu(), side: THREE.DoubleSide, vertexShader: leafVS, fragmentShader: `${leafCommon}
void main() {
  vec4 lt = texture2D(uLeafTex, vUv);
  if (leafAlpha(lt.a, vUv, uTexSize) < 0.5) discard;
  float off = (vCard.y - 0.5) * 0.5 + (lt.g - 0.5) * 0.8;
  float shade = mix(lt.r * 1.3, lt.r * 2.4, lt.b) * vCard.w;
  gl_FragColor = vec4(sqrt(clamp(shade * 0.5, 0.0, 1.0)), clamp(0.5 + off * 0.5, 0.0, 1.0), 1.0 - lt.b, 1.0);
}` }),
    leafNorm: new THREE.ShaderMaterial({ uniforms: lu(), side: THREE.DoubleSide, vertexShader: leafVS, fragmentShader: `${leafCommon}
void main() {
  vec4 lt = texture2D(uLeafTex, vUv);
  if (leafAlpha(lt.a, vUv, uTexSize) < 0.5) discard;
  gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0);
}` }),
    barkData: new THREE.ShaderMaterial({ uniforms: { map: { value: null }, uBarkLum: { value: 0.1 } }, vertexShader: barkVS, fragmentShader: `uniform sampler2D map; uniform float uBarkLum; varying vec2 vUv; varying vec3 vCol; varying vec3 vN;
void main() {
  vec3 c = texture2D(map, vUv).rgb * vCol;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)) / uBarkLum;
  gl_FragColor = vec4(sqrt(clamp(l * 0.5, 0.0, 1.0)), 0.5, 0.0, 1.0);
}` }),
    barkNorm: new THREE.ShaderMaterial({ vertexShader: barkVS, fragmentShader: `varying vec2 vUv; varying vec3 vCol; varying vec3 vN;
void main() { gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }` }),
  };
}
