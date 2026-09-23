// Procedural soundscape (Web Audio, no sample files): wind, distant traffic, birds, voices,
// bike bells, rain, surface-dependent footsteps, Mensa clatter, indoor muffling + reverb.
import { settings, onSettingChange } from '../core/settings.js';

function noiseBuffer(ctx, seconds = 2, color = 'white') {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    else if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w;
  }
  return buf;
}

function impulse(ctx, seconds = 1.4, decay = 3.2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return buf;
}

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.stepPhase = 0;
    this.lastStepSign = 1;
    this.birdT = 1; this.clatterT = 0; this.dripT = 0;
    this.indoorMix = 0;
    onSettingChange((k, v) => { if (k === 'volume' && this.master) this.master.gain.setTargetAtTime(v * 0.9, this.ctx.currentTime, 0.1); });
    const unlock = () => this.start();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = settings.volume * 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    // outdoor bus: muffled when indoors
    this.outLP = ctx.createBiquadFilter(); this.outLP.type = 'lowpass'; this.outLP.frequency.value = 18000;
    this.outGain = ctx.createGain(); this.outGain.gain.value = 1;
    this.outLP.connect(this.outGain).connect(this.master);
    // indoor bus with reverb
    this.inGain = ctx.createGain(); this.inGain.gain.value = 0;
    this.reverb = ctx.createConvolver(); this.reverb.buffer = impulse(ctx, 1.6, 3);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.0;
    this.inGain.connect(this.master);
    this.reverb.connect(this.revGain).connect(this.master);
    this.white = noiseBuffer(ctx, 2, 'white');
    this.pink = noiseBuffer(ctx, 3, 'pink');
    this.brown = noiseBuffer(ctx, 3, 'brown');
    // --- continuous beds ---
    this.wind = this._loop(this.pink, 'lowpass', 520, 0.0, this.outLP);
    this.traffic = this._loop(this.brown, 'lowpass', 180, 0.0, this.outLP);
    this.rain = this._loop(this.white, 'bandpass', 3200, 0.0, this.outLP, 0.5);
    this.rainIn = this._loop(this.pink, 'lowpass', 700, 0.0, this.inGain);
    this.room = this._loop(this.brown, 'bandpass', 110, 0.0, this.inGain, 2);
    this.vent = this._loop(this.pink, 'bandpass', 1800, 0.0, this.inGain, 0.7);
    // babble: three formant bands with syllable-rate modulation
    this.babble = [];
    for (const [f, q] of [[480, 3], [1250, 4], [2600, 5]]) {
      const src = ctx.createBufferSource(); src.buffer = this.pink; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const am = ctx.createGain(); am.gain.value = 0;
      const lvl = ctx.createGain(); lvl.gain.value = 0;
      src.connect(bp).connect(am).connect(lvl);
      lvl.connect(this.outLP); lvl.connect(this.reverb);
      src.start(0, Math.random() * 2);
      this.babble.push({ am, lvl, t: Math.random() });
    }
  }

  _loop(buffer, type, freq, gain, dest, q = 0.7) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(dest);
    src.start(0, Math.random() * buffer.duration);
    return { src, f, g };
  }

  _panner(x, y, z) {
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.1; p.maxDistance = 200;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    return p;
  }

  // ---- one-shots ----
  bird(x, y, z) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
    const pan = this._panner(x, y, z);
    const g = ctx.createGain(); g.gain.value = 0;
    g.connect(pan).connect(this.outLP);
    const type = Math.random();
    const notes = type < 0.4 ? 3 + Math.floor(Math.random() * 5) : type < 0.75 ? 2 : 6 + Math.floor(Math.random() * 6);
    const base = 2600 + Math.random() * 2400;
    let t = t0;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const d = type < 0.4 ? 0.07 + Math.random() * 0.05 : type < 0.75 ? 0.18 : 0.035;
      const f0 = base * (0.85 + Math.random() * 0.3), f1 = f0 * (type < 0.75 ? 1.25 + Math.random() * 0.3 : 0.8);
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
      const og = ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.09, t + 0.01); og.gain.exponentialRampToValueAtTime(0.0008, t + d);
      o.connect(og).connect(g);
      o.start(t); o.stop(t + d + 0.02);
      t += d + (type < 0.75 ? 0.04 + Math.random() * 0.08 : 0.02);
    }
    g.gain.setValueAtTime(1, t0);
    setTimeout(() => { g.disconnect(); pan.disconnect(); }, (t - t0 + 0.5) * 1000);
  }

  bell(x, z) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.01;
    const pan = this._panner(x, 1.1, z);
    const out = ctx.createGain(); out.gain.value = 0.55;
    out.connect(pan).connect(this.outLP);
    for (const start of [0, 0.22]) {
      for (const [f, a, d] of [[2380, 0.4, 0.9], [3190, 0.22, 0.6], [5650, 0.1, 0.3]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t0 + start); g.gain.linearRampToValueAtTime(a, t0 + start + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t0 + start + d);
        o.connect(g).connect(out); o.start(t0 + start); o.stop(t0 + start + d + 0.05);
      }
    }
    setTimeout(() => { out.disconnect(); pan.disconnect(); }, 1600);
  }

  step(surface, run, indoor) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    const wet = this.game.weather.current.wet || 0;
    let freq = 1400, q = 0.9, dur = 0.07, vol = 0.12;
    if (surface === 'grass') { freq = 700; q = 0.5; dur = 0.11; vol = 0.07; }
    else if (surface === 'gravel' || surface === 'dirt') { freq = 2600; q = 0.4; dur = 0.12; vol = 0.1; }
    else if (surface === 'leaves') { freq = 3300; q = 0.3; dur = 0.14; vol = 0.08; }
    else if (indoor) { freq = 1900; q = 1.2; dur = 0.05; vol = 0.1; }
    if (wet > 0.5 && !indoor) { freq *= 1.3; dur *= 1.3; vol *= 1.1; }
    if (run) { vol *= 1.35; dur *= 0.85; }
    f.type = 'bandpass'; f.frequency.value = freq * (0.9 + Math.random() * 0.2); f.Q.value = q;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g);
    g.connect(this.master);
    if (indoor) g.connect(this.reverb);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  clatter(x, y, z) {
    const ctx = this.ctx, t = ctx.currentTime;
    const pan = this._panner(x, y, z);
    const g = ctx.createGain(); g.gain.value = 0.35;
    g.connect(pan); pan.connect(this.inGain); pan.connect(this.reverb);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1800 + Math.random() * 3200;
      const og = ctx.createGain(), st = t + i * (0.05 + Math.random() * 0.1);
      og.gain.setValueAtTime(0, st); og.gain.linearRampToValueAtTime(0.06, st + 0.003); og.gain.exponentialRampToValueAtTime(0.0005, st + 0.12);
      o.connect(og).connect(g); o.start(st); o.stop(st + 0.15);
    }
    setTimeout(() => { g.disconnect(); pan.disconnect(); }, 800);
  }

  door() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.pink;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.8);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 0.9);
  }

  ui(kind) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = kind === 'talk' ? 660 : 990;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.04, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.15);
  }

  // ---- per frame ----
  update(dt, game) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const cam = game.camera, p = game.player, W = game.weather.current;
    // listener
    const L = ctx.listener;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    if (L.positionX) {
      L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
      L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
    // indoor / outdoor mix
    const indoor = !!game.indoor;
    this.indoorMix += ((indoor ? 1 : 0) - this.indoorMix) * Math.min(1, dt * 2.5);
    const im = this.indoorMix;
    this.outLP.frequency.setTargetAtTime(18000 - 17300 * im, now, 0.1);
    this.outGain.gain.setTargetAtTime(1 - 0.72 * im, now, 0.1);
    this.inGain.gain.setTargetAtTime(im, now, 0.1);
    this.revGain.gain.setTargetAtTime(0.35 * im, now, 0.1);
    // beds
    const rain = W.rain || 0, night = W.night || 0;
    this.wind.g.gain.setTargetAtTime(0.05 + 0.04 * Math.sin(now * 0.13) + rain * 0.03, now, 0.5);
    this.traffic.g.gain.setTargetAtTime(0.1 + night * 0.04, now, 0.5);
    this.rain.g.gain.setTargetAtTime(rain * 0.16, now, 0.4);
    this.rainIn.g.gain.setTargetAtTime(rain * 0.12 * im, now, 0.4);
    const prog = indoor ? game.indoor.plan.program : null;
    this.room.g.gain.setTargetAtTime(0.25, now, 0.3);
    this.vent.g.gain.setTargetAtTime(prog === 'lecture' ? 0.02 : 0.035, now, 0.3);
    // voices: level from people nearby
    let near = 0;
    const cr = game.crowd;
    if (cr) {
      for (const w of cr.walkers) { const d = Math.hypot(w.x - p.x, w.z - p.z); if (d < 30) near += 1 - d / 30; }
      for (const s of cr.statics.values()) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < 22 && Math.abs(s.y - p.y) < 3) near += (1 - d / 22) * 0.7; }
    }
    const babbleLvl = Math.min(0.5, near * 0.03) * (prog === 'lecture' ? 0.4 : 1);
    for (const b of this.babble) {
      b.t -= dt;
      if (b.t <= 0) { b.t = 0.08 + Math.random() * 0.25; b.am.gain.setTargetAtTime(Math.random() < 0.3 ? 0.05 : 0.4 + Math.random() * 0.6, now, 0.03); }
      b.lvl.gain.setTargetAtTime(babbleLvl, now, 0.3);
    }
    // birds (outdoors, from trees near the player)
    this.birdT -= dt * (W.birds ?? 1);
    if (this.birdT <= 0 && !indoor) {
      this.birdT = 1.5 + Math.random() * 4;
      const trees = game.layout.trees;
      for (let k = 0; k < 12; k++) {
        const tr = trees[Math.floor(Math.random() * trees.length)];
        const d = Math.hypot(tr.x - p.x, tr.z - p.z);
        if (d > 8 && d < 55) { this.bird(tr.x, 5 + Math.random() * 3, tr.z); break; }
      }
    }
    // Mensa clatter
    if (prog === 'mensa') {
      this.clatterT -= dt;
      if (this.clatterT <= 0) { this.clatterT = 0.15 + Math.random() * 0.6; this.clatter(p.x + (Math.random() - 0.5) * 30, 1, p.z + (Math.random() - 0.5) * 30); }
    }
    // bike bells from the crowd
    if (cr) { for (const e of cr.events) if (e.type === 'bell') this.bell(e.x, e.z); cr.events.length = 0; }
    // footsteps from the head-bob phase
    if (p.onGround && p.speed > 0.6) {
      const s = Math.sin(game.headBob * 2);
      const sign = s > 0 ? 1 : -1;
      if (sign !== this.lastStepSign && sign < 0) this.step(this.surfaceAt(game), p.speed > 3.5, indoor);
      this.lastStepSign = sign;
    }
    // doors
    if (game.interiors) {
      for (const d of game.interiors.doors) {
        const opening = d.open > 0.05 && d.open < 0.2 && (d._lastOpen ?? 0) < d.open;
        if (opening && Math.hypot(d.x - p.x, d.z - p.z) < 6 && !d._snd) { this.door(); d._snd = true; }
        if (d.open < 0.02) d._snd = false;
        d._lastOpen = d.open;
      }
    }
  }

  surfaceAt(game) {
    if (game.indoor) return 'hard';
    const p = game.player, L = game.layout;
    const hit = L.roadIndex.intrusion(p.x, p.z, 0.2);
    if (hit) return /gravel|dirt/.test(hit.r.s) ? 'gravel' : 'paved';
    const k = L.areaIndex.kindAt(p.x, p.z);
    if (k === 'paved' || k === 'parking' || k === 'road' || k === 'court') return 'paved';
    if (k === 'forest') return 'leaves';
    if (k === 'sand' || k === 'playground' || k === 'construction') return 'gravel';
    return game.weather.current.leaves > 0.7 && Math.random() < 0.35 ? 'leaves' : 'grass';
  }
}
