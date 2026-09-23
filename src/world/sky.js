// Sky dome with procedural clouds, sun/hemisphere lights, fog and an environment map for reflections.
import * as THREE from 'three';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // at far plane
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uCloudColor, uCloudShade;
uniform float uCloud, uTime, uNight, uSunSize, uEnv;
varying vec3 vDir;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.08, y));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 8.0) * 0.18 + pow(sd, 64.0) * 0.35) * (1.0 - uCloud * 0.7);
  col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.6, sd) * 3.0 * (1.0 - uCloud * 0.85);
  // clouds on a virtual plane
  if (y > 0.0) {
    vec2 uv = d.xz / (y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0017);
    float c = uEnv > 0.5 ? mix(fbm(uv * 0.35), 0.5, 0.35) : fbm(uv);
    float cov = smoothstep(1.0 - uCloud - 0.05, 1.0 - uCloud * 0.55 + 0.25, c);
    float shade = fbm(uv * 1.7 + 3.0);
    vec3 cc = mix(uCloudShade, uCloudColor, shade);
    cc += uSunColor * pow(sd, 6.0) * 0.25;
    col = mix(col, cc, cov * smoothstep(0.0, 0.12, y));
  }
  // stars at night
  if (uNight > 0.01 && y > 0.12 && uEnv < 0.5) {
    vec2 g = floor(d.xz / (y + 0.3) * 260.0);
    float s = step(0.9993, h2(g)) * (1.0 - uCloud) * smoothstep(0.12, 0.5, y);
    col += vec3(s) * uNight * 0.7;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
      uCloudColor: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
      uCloud: { value: 0.5 }, uTime: { value: 0 }, uNight: { value: 0 }, uSunSize: { value: 0.0006 }, uEnv: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 100; // last: only pixels not covered by geometry get the sky shader
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ee, 0x5a5448, 1.0);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xcccccc, 60, 700);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false }));
    this.envScene.add(this.envDome);
    this.envRT = null;
    this.shadowSize = 90;
  }

  setShadowQuality(q) {
    const size = q === 'high' ? 2048 : q === 'medium' ? 1536 : 512;
    this.sun.castShadow = q !== 'low';
    this.shadowSize = q === 'high' ? 110 : 80;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    const c = this.sun.shadow.camera;
    c.left = -this.shadowSize; c.right = this.shadowSize; c.top = this.shadowSize; c.bottom = -this.shadowSize;
    c.near = 1; c.far = 600; c.updateProjectionMatrix();
  }

  // p = weather parameter set (see weather.js)
  apply(p) {
    const u = this.uniforms;
    u.uZenith.value.set(p.zenith); u.uHorizon.value.set(p.horizon); u.uGround.value.set(p.groundSky);
    u.uSunColor.value.set(p.sunColor);
    u.uCloudColor.value.set(p.cloudColor); u.uCloudShade.value.set(p.cloudShade);
    u.uCloud.value = p.cloud; u.uNight.value = p.night;
    const el = p.sunEl * Math.PI / 180, az = p.sunAz * Math.PI / 180;
    u.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunI;
    this.hemi.color.set(p.hemiSky); this.hemi.groundColor.set(p.hemiGround); this.hemi.intensity = p.hemiI;
    this.scene.fog.color.set(p.fog);
    this.scene.fog.near = p.fogNear; this.scene.fog.far = p.fogFar;
    this.renderer.toneMappingExposure = p.exposure;
  }

  updateEnv() {
    if (this.envRT) this.envRT.dispose();
    // reflections use a smooth sky (no stars, soft clouds) to avoid sparkling window glass
    this.uniforms.uEnv.value = 1;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200);
    this.uniforms.uEnv.value = 0;
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.9;
  }

  update(dt, camPos) {
    this.uniforms.uTime.value += dt;
    this.dome.position.copy(camPos);
    // shadow camera follows the player, snapped to texels to avoid shimmering
    const d = this.uniforms.uSunDir.value;
    const s = this.sun.shadow;
    const texel = (this.shadowSize * 2) / s.mapSize.x;
    const tx = Math.round(camPos.x / texel) * texel, tz = Math.round(camPos.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + d.x * 300, Math.max(d.y, 0.08) * 300, tz + d.z * 300);
  }
}
