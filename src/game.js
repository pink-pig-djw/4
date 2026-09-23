// Game orchestrator: renderer, scene, world content, player, UI glue and the main loop.
import * as THREE from 'three';
import { settings, setSetting, onSettingChange } from './core/settings.js';
import { Input } from './core/input.js';
import { createMaterials, globalUniforms } from './world/materials.js';
import { buildGround } from './world/ground.js';
import { buildBuildings } from './world/buildings.js';
import { computeLayout } from './world/layout.js';
import { addWorldColliders } from './physics/colliders.js';
import { buildPlans, buildInteriorColliders, planAt } from './world/interiors/plan.js';
import { Sky } from './world/sky.js';
import { Weather } from './world/weather.js';
import { CollisionWorld } from './physics/collision.js';
import { Controller, PLAYER } from './physics/controller.js';

export class Game {
  constructor(container, world, ui) {
    this.container = container;
    this.world = world;
    this.ui = ui;
    this.timer = new THREE.Timer();
    this.frame = 0;
    this.paused = true;
    this.updaters = [];      // systems with update(dt, game)
    this.interactables = []; // {x,z,y,r, label(), action()}
  }

  async init(progress = () => {}) {
    const touch = matchMedia('(pointer: coarse)').matches;
    this.quality = settings.quality === 'auto' ? (touch ? 'low' : 'medium') : settings.quality;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: this.quality !== 'low', powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(this.pixelRatioFor(this.quality));
    r.setSize(this.container.clientWidth, this.container.clientHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.container.insertBefore(r.domElement, this.container.firstChild);
    r.domElement.id = 'game-canvas';

    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, this.container.clientWidth / this.container.clientHeight, 0.15, 1500);
    scene.add(this.camera);
    await progress(0.1);

    this.mats = createMaterials(Math.min(8, r.capabilities.getMaxAnisotropy()));
    this.sky = new Sky(scene, r);
    this.sky.setShadowQuality(this.quality);
    this.weather = new Weather(this.sky);
    this.weather.set(settings.weather in { autumn: 1, sunny: 1, overcast: 1, rain: 1, night: 1 } ? settings.weather : 'autumn', true);
    await progress(0.2);

    this.cw = new CollisionWorld(8);
    const [bx0, bz0, bx1, bz1] = this.world.meta.bounds;
    this.cw.bounds = [bx0, bz0, bx1, bz1];

    this.skipBuildings = new Set();
    this.plans = buildPlans(this.world);
    for (const P of this.plans) for (const i of P.buildingIdx) this.skipBuildings.add(i);
    this.enterableOutlines = [...new Set(this.plans.map(P => P.b.o).filter(o => o >= 0))];
    this.ground = buildGround(this.world, this.mats);
    scene.add(this.ground);
    await progress(0.35);

    const bld = buildBuildings(this.world, this.mats, { skip: this.skipBuildings });
    this.buildingsGroup = bld.group;
    scene.add(bld.group);
    await progress(0.5);
    this.layout = computeLayout(this.world);
    buildInteriorColliders(this.world, this.cw, this.plans);
    addWorldColliders(this.world, this.layout, this.cw, this.skipBuildings);
    await progress(0.55);

    // extra systems are registered by main.js (vegetation, props, npcs, audio, …)
    this.input = new Input(r.domElement);
    this.player = new Controller(this.cw, 0, 0, 0);
    this.player.boundsSoft = [bx0 + 2, bz0 + 2, bx1 - 2, bz1 - 2];

    window.addEventListener('resize', () => this.onResize());
    onSettingChange((k, v) => {
      if (k === 'quality') this.setQuality(v === 'auto' ? this.quality : v);
      if (k === 'weather') this.weather.set(v);
    });
    this.headBob = 0;
    // soft fill light that fades in indoors (stand-in for bounced light and ceiling lamps)
    this.indoorLight = new THREE.AmbientLight(0xfff4e6, 0);
    scene.add(this.indoorLight);
    return this;
  }

  pixelRatioFor(q) {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(dpr, q === 'high' ? 2 : q === 'medium' ? 1.25 : 0.85);
  }

  setQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(this.pixelRatioFor(q));
    this.sky.setShadowQuality(q);
    this.onResize();
    for (const u of this.updaters) if (u.setQuality) u.setQuality(q);
  }

  onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  spawn(x, z, yaw = 0, y = null) {
    this.player.teleport(x, z, y, yaw);
    this.player.pitch = 0;
  }

  start() {
    this.paused = false;
    this.timer.connect?.(document);
    this.timer.update();
    const loop = () => {
      requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  tick() {
    this.timer.update();
    let dt = this.timer.getDelta();
    if (dt > 0.1) dt = 0.1;
    this.frame++;
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this.autoQuality(); }
    globalUniforms.uTime.value += dt;
    const inp = this.input.poll();
    const p = this.player;
    if (!this.paused) {
      p.yaw -= inp.lookDX * 0.0022;
      p.pitch -= inp.lookDY * 0.0022;
      p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
      // fixed sub-steps for stable collision
      this.acc = (this.acc || 0) + dt;
      const h = 1 / 120;
      let n = 0;
      while (this.acc >= h && n < 12) {
        p.step(h, n === 0 ? inp : { ...inp, jump: false });
        this.acc -= h; n++;
      }
      if (n >= 12) this.acc = 0;
    }
    // camera
    const moving = p.onGround && p.speed > 0.5;
    this.headBob += moving ? dt * (p.speed > 3.5 ? 11 : 7.5) : 0;
    const bobAmp = moving ? (p.speed > 3.5 ? 0.045 : 0.025) : 0;
    const eyeY = p.y + PLAYER.eye + Math.sin(this.headBob * 2) * bobAmp;
    // smooth vertical camera on stairs
    this.camY = this.camY == null ? eyeY : this.camY + (eyeY - this.camY) * Math.min(1, dt * 18);
    if (Math.abs(this.camY - eyeY) > 1.5) this.camY = eyeY;
    this.camera.position.set(p.x, this.camY, p.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');

    // indoor state (location label, floor indicator, audio)
    const pa = planAt(this.plans, p.x, p.z, p.y);
    this.indoor = pa ? { plan: pa.plan, level: pa.level, name: pa.plan.title.de, sub: pa.plan.title.zh } : null;
    this.indoorLight.intensity += ((this.indoor ? 1.1 : 0) - this.indoorLight.intensity) * Math.min(1, dt * 3);
    this.weather.update(dt);
    this.sky.update(dt, this.camera.position);
    for (const u of this.updaters) u.update(dt, this);
    for (const e of p.events) if (e === 'respawn') this.ui?.toast?.('respawned');
    p.events.length = 0;
    this.renderer.render(this.scene, this.camera);
  }

  autoQuality() {
    if (settings.quality !== 'auto' || this.paused) return;
    this.qTimer = (this.qTimer || 0) + 1;
    if (this.qTimer < 6) return; // wait ~3 s after start / last change
    const order = ['low', 'medium', 'high'];
    const i = order.indexOf(this.quality);
    if (this.fps < 28 && i > 0) { this.setQuality(order[i - 1]); this.qTimer = 0; }
    else if (this.fps > 58 && i < 2 && this.qTimer > 20 && !this.qCapped) { this.setQuality(order[i + 1]); this.qTimer = 0; this.qTried = (this.qTried || 0) + 1; if (this.qTried > 2) this.qCapped = true; }
  }
}
