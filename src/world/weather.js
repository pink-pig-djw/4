// Weather / time-of-day presets with smooth transitions.
import * as THREE from 'three';
import { globalUniforms } from './materials.js';

export const PRESETS = {
  // Default: grey, soft autumn afternoon in Erlangen (sun low in the south-west)
  autumn: {
    sunEl: 19, sunAz: 228, sunI: 1.35, sunColor: '#ffdcb8',
    hemiSky: '#b9c3cc', hemiGround: '#5e5647', hemiI: 1.15,
    zenith: '#7d8fa2', horizon: '#cfd0cc', groundSky: '#8a8983',
    cloud: 0.74, cloudColor: '#dcdcd8', cloudShade: '#8d949b',
    fog: '#c4c6c3', fogNear: 45, fogFar: 640, exposure: 1.0,
    night: 0, wet: 0, rain: 0, leaves: 1, shadow: 0.55, birds: 1, crowd: 1,
  },
  sunny: {
    sunEl: 34, sunAz: 205, sunI: 2.9, sunColor: '#fff2df',
    hemiSky: '#bcd4f0', hemiGround: '#6b624f', hemiI: 0.95,
    zenith: '#3f79c2', horizon: '#bdd5ea', groundSky: '#8e948a',
    cloud: 0.26, cloudColor: '#ffffff', cloudShade: '#c7ced8',
    fog: '#c9d9e6', fogNear: 90, fogFar: 950, exposure: 1.0,
    night: 0, wet: 0, rain: 0, leaves: 0.8, shadow: 1, birds: 1.3, crowd: 1.25,
  },
  overcast: {
    sunEl: 28, sunAz: 210, sunI: 0.35, sunColor: '#e6e6e4',
    hemiSky: '#c3c7ca', hemiGround: '#58554f', hemiI: 1.55,
    zenith: '#8e959b', horizon: '#babdbe', groundSky: '#7f807d',
    cloud: 0.96, cloudColor: '#b8bbbd', cloudShade: '#7e8387',
    fog: '#afb3b4', fogNear: 30, fogFar: 520, exposure: 1.0,
    night: 0, wet: 0.15, rain: 0, leaves: 1, shadow: 0.15, birds: 0.6, crowd: 0.9,
  },
  rain: {
    sunEl: 28, sunAz: 210, sunI: 0.12, sunColor: '#d4d9dc',
    hemiSky: '#9ea6ab', hemiGround: '#44433e', hemiI: 1.4,
    zenith: '#6a7278', horizon: '#8b9195', groundSky: '#5f6264',
    cloud: 1.0, cloudColor: '#8c9195', cloudShade: '#565b5f',
    fog: '#848a8e', fogNear: 12, fogFar: 330, exposure: 0.98,
    night: 0.08, wet: 1, rain: 1, leaves: 0.6, shadow: 0, birds: 0.05, crowd: 0.45,
  },
  night: {
    sunEl: 38, sunAz: 150, sunI: 0.1, sunColor: '#a8b8ff',
    hemiSky: '#2b3752', hemiGround: '#17171b', hemiI: 0.4,
    zenith: '#050a18', horizon: '#1f2a3c', groundSky: '#0b0d12',
    cloud: 0.35, cloudColor: '#2c3342', cloudShade: '#141924',
    fog: '#161d2a', fogNear: 20, fogFar: 460, exposure: 1.2,
    night: 1, wet: 0, rain: 0, leaves: 0.7, shadow: 0.2, birds: 0, crowd: 0.3,
  },
};

const COLOR_KEYS = ['sunColor', 'hemiSky', 'hemiGround', 'zenith', 'horizon', 'groundSky', 'cloudColor', 'cloudShade', 'fog'];

export class Weather {
  constructor(sky) {
    this.sky = sky;
    this.current = { ...PRESETS.autumn };
    this.from = null; this.to = null; this.t = 1; this.dur = 2.5;
    this.name = 'autumn';
    this.listeners = new Set();
    this._c1 = new THREE.Color(); this._c2 = new THREE.Color();
  }
  onChange(fn) { this.listeners.add(fn); }
  set(name, instant = false) {
    const p = PRESETS[name]; if (!p) return;
    this.name = name;
    if (instant) { this.current = { ...p }; this.t = 1; this._apply(true); }
    else { this.from = { ...this.current }; this.to = p; this.t = 0; }
    for (const fn of this.listeners) fn(name);
  }
  update(dt) {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / this.dur);
    const k = this.t * this.t * (3 - 2 * this.t);
    const out = {};
    for (const key of Object.keys(this.to)) {
      const a = this.from[key], b = this.to[key];
      if (COLOR_KEYS.includes(key)) {
        this._c1.set(a); this._c2.set(b);
        out[key] = '#' + this._c1.lerp(this._c2, k).getHexString();
      } else out[key] = a + (b - a) * k;
    }
    this.current = out;
    this._apply(this.t >= 1);
    return true;
  }
  _apply(final) {
    const p = this.current;
    this.sky.apply(p);
    globalUniforms.uNight.value = p.night;
    globalUniforms.uWet.value = p.wet;
    if (final || this._envTimer === undefined || performance.now() - this._envTimer > 400) {
      this.sky.updateEnv();
      this._envTimer = performance.now();
    }
  }
}
