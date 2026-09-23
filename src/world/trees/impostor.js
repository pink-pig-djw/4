// Bakes every tree model into an impostor atlas (one 256×512 tile per model, side view):
// a data texture (shade, autumn offset, foliage mask, alpha) and a normal texture.
import * as THREE from 'three';
import { bakeMaterials } from './materials.js';

const TW = 256, TH = 512;

export function bakeImpostors(renderer, models, atlas, barks, barkLum) {
  const cols = Math.min(6, models.length), rows = Math.ceil(models.length / cols);
  const width = cols * TW, height = rows * TH;
  const mkRT = () => {
    const rt = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  };
  const data = mkRT(), norm = mkRT();
  const mats = bakeMaterials(atlas);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  cam.position.set(0, 0, 150); cam.lookAt(0, 0, 0);
  const barkMesh = new THREE.Mesh(undefined, mats.barkData), leafMesh = new THREE.Mesh(undefined, mats.leafData);
  barkMesh.frustumCulled = leafMesh.frustumCulled = false;
  scene.add(barkMesh, leafMesh);

  const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  const tiles = [];
  models.forEach((m, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    let fw = m.W * 2 * 1.04, fh = m.H * 1.02 + 0.25;
    if (fw / fh > TW / TH) fh = fw * TH / TW; else fw = fh * TW / TH;
    const y0 = -0.25;
    cam.left = -fw / 2; cam.right = fw / 2; cam.bottom = y0; cam.top = y0 + fh; cam.updateProjectionMatrix();
    tiles.push([fw, fh, y0]);
    barkMesh.geometry = m.lods[0].bark; leafMesh.geometry = m.lods[0].leaves;
    mats.barkData.uniforms.map.value = barks[m.bark].map;
    mats.barkData.uniforms.uBarkLum.value = barkLum[m.key];
    for (const [rt, bm, lm, clear] of [[data, mats.barkData, mats.leafData, [0.62, 0.5, 0.9]], [norm, mats.barkNorm, mats.leafNorm, [0.5, 0.6, 0.9]]]) {
      rt.viewport.set(c * TW, r * TH, TW, TH);
      rt.scissor.set(c * TW, r * TH, TW, TH);
      rt.scissorTest = true;
      barkMesh.material = bm; leafMesh.material = lm;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(new THREE.Color().setRGB(clear[0], clear[1], clear[2], THREE.LinearSRGBColorSpace), 0);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
    }
  });
  for (const rt of [data, norm]) { rt.scissorTest = false; rt.viewport.set(0, 0, width, height); rt.scissor.set(0, 0, width, height); }
  renderer.setRenderTarget(prevRT);
  renderer.autoClear = prevAuto;
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.shadowMap.autoUpdate = prevShadow;
  for (const k in mats) mats[k].dispose();
  return { data, norm, tiles, cols, rows, width, height };
}
