// Unified input: keyboard + mouse (pointer lock, or drag-to-look as fallback) + touch (joystick & look pad).
import { settings } from './settings.js';

// Phone/tablet UI only when the *primary* pointer is a finger. Laptops with a touchscreen keep the
// mouse controls (they expose ontouchstart but also have a fine pointer).
export function isTouchDevice() {
  try { return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches; } catch (e) { return false; }
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookDX = 0; this.lookDY = 0;
    this.wheel = 0;
    this.joy = { x: 0, y: 0, active: false };
    this.runToggle = false;       // mobile run toggle
    this.jumpQueued = false;
    this.interactQueued = false;
    this.enabled = true;          // false while menus/dialogue are open
    this.locked = false;
    this.lockFailed = false;      // pointer lock refused → drag-to-look
    this.drag = null;             // active mouse drag {id, x, y}
    this.isTouch = isTouchDevice();
    this.handlers = {};           // key actions: map, menu, …
    this._bind();
  }

  on(action, fn) { this.handlers[action] = fn; }
  _emit(action) { const f = this.handlers[action]; if (f) f(); }

  requestLock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockFailed = true; this._emit('lockfailed'); });
    } catch (e) { this.lockFailed = true; this._emit('lockfailed'); }
  }

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
      if (k === 'KeyV' && !e.repeat) this._emit('view');
      if (k === 'KeyH') this._emit('help');
      if (k === 'F3') { this._emit('debug'); e.preventDefault(); }
      if (/^Digit[1-9]$/.test(k)) this._emit('choice' + k.slice(5));
      this.keys.add(k);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.drag = null; });

    // Mouse: every press tries to lock the pointer; while not locked, dragging with a held button
    // turns the view as well (works even where pointer lock is unavailable or refused).
    this.canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' || !this.enabled) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.requestLock();
    });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || !this.enabled) return;
      if (this.locked) return; // handled by mousemove (movementX/Y)
      if (this.drag && e.pointerId === this.drag.id && e.buttons) {
        this.lookDX += (e.clientX - this.drag.x) * 1.4; this.lookDY += (e.clientY - this.drag.y) * 1.4;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
      }
    });
    const endDrag = e => { if (this.drag && e.pointerId === this.drag.id) this.drag = null; };
    window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', endDrag);
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) { this.lockFailed = false; this.drag = null; }
      this._emit(this.locked ? 'locked' : 'unlocked');
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; this._emit('lockfailed'); });
    document.addEventListener('mousemove', e => {
      if (!this.locked || !this.enabled) return;
      // ignore occasional huge spikes some browsers produce on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.lookDX += e.movementX; this.lookDY += e.movementY;
    });
    this.canvas.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // Touch look (called by the touch UI)
  addLook(dx, dy) { if (this.enabled) { this.lookDX += dx; this.lookDY += dy; } }

  // Returns movement state for this frame and clears edge-triggered flags.
  poll() {
    const k = this.keys;
    let fx = 0, fz = 0, turn = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
      if (k.has('KeyD')) fx += 1;
      if (k.has('KeyA')) fx -= 1;
      if (k.has('ArrowRight')) turn += 1;   // arrow keys turn the view
      if (k.has('ArrowLeft')) turn -= 1;
      if (this.joy.active) { fx += this.joy.x; fz += this.joy.y; }
    }
    const run = this.enabled && (k.has('ShiftLeft') || k.has('ShiftRight') || this.runToggle);
    const out = {
      fx, fz, run, turn,
      jump: this.enabled && this.jumpQueued,
      lookDX: this.lookDX * settings.sensitivity, lookDY: this.lookDY * settings.sensitivity * (settings.invertY ? -1 : 1),
      wheel: this.wheel,
    };
    this.jumpQueued = false; this.interactQueued = false;
    this.lookDX = 0; this.lookDY = 0; this.wheel = 0;
    return out;
  }
}
