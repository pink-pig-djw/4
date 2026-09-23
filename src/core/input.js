// Unified input: keyboard + mouse (pointer lock) + touch (virtual joystick & look pad).
import { settings } from './settings.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookDX = 0; this.lookDY = 0;
    this.joy = { x: 0, y: 0, active: false };
    this.runToggle = false;       // mobile run toggle
    this.jumpQueued = false;
    this.interactQueued = false;
    this.enabled = true;          // false while menus/dialogue are open
    this.locked = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.handlers = {};           // key actions: map, menu, …
    this._bind();
  }

  on(action, fn) { this.handlers[action] = fn; }
  _emit(action) { const f = this.handlers[action]; if (f) f(); }

  _bind() {
    const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
    window.addEventListener('keydown', e => {
      if (typing(e)) return;
      const k = e.code;
      if (k === 'KeyM') { this._emit('map'); e.preventDefault(); return; }
      if (k === 'Escape') { this._emit('escape'); return; }
      if (k === 'KeyE' || k === 'KeyF' || k === 'Enter') { if (!e.repeat) { this.interactQueued = true; this._emit('interact'); } }
      if (k === 'Space') { if (!e.repeat) this.jumpQueued = true; e.preventDefault(); }
      if (k === 'KeyL') this._emit('lang');
      if (k === 'KeyT') this._emit('weather');
      if (k === 'KeyH') this._emit('help');
      if (k === 'F3') { this._emit('debug'); e.preventDefault(); }
      if (k === 'F4') { this._emit('colliders'); e.preventDefault(); }
      if (/^Digit[1-9]$/.test(k)) this._emit('choice' + k.slice(5));
      this.keys.add(k);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // mouse look with pointer lock
    this.canvas.addEventListener('click', () => {
      if (this.isTouch || !this.enabled) return;
      if (document.pointerLockElement !== this.canvas) {
        try { const p = this.canvas.requestPointerLock({ unadjustedMovement: false }); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this._emit(this.locked ? 'locked' : 'unlocked');
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked || !this.enabled) return;
      // ignore occasional huge spikes some browsers produce on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.lookDX += e.movementX; this.lookDY += e.movementY;
    });
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // Touch look (called by the touch UI)
  addLook(dx, dy) { if (this.enabled) { this.lookDX += dx; this.lookDY += dy; } }

  // Returns movement state for this frame and clears edge-triggered flags.
  poll() {
    const k = this.keys;
    let fx = 0, fz = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
      if (this.joy.active) { fx += this.joy.x; fz += this.joy.y; }
    }
    const run = this.enabled && (k.has('ShiftLeft') || k.has('ShiftRight') || this.runToggle || (this.joy.active && Math.hypot(this.joy.x, this.joy.y) > 0.97 && this.runToggle));
    const out = {
      fx, fz, run,
      jump: this.enabled && this.jumpQueued,
      lookDX: this.lookDX * settings.sensitivity, lookDY: this.lookDY * settings.sensitivity * (settings.invertY ? -1 : 1),
    };
    this.jumpQueued = false; this.interactQueued = false;
    this.lookDX = 0; this.lookDY = 0;
    return out;
  }
}
