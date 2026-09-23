// Mobile controls: floating joystick (left), look drag (right), action buttons.
import { t } from '../core/i18n.js';

export class TouchControls {
  constructor(root, input, onAction) {
    this.input = input;
    const el = this.el = document.createElement('div');
    el.className = 'touch';
    el.innerHTML = `
      <div class="t-left"><div class="joy hidden"><div class="joy-knob"></div></div></div>
      <div class="t-right"></div>
      <div class="t-btns">
        <button class="tb tb-act" data-a="interact"></button>
        <button class="tb tb-jump" data-a="jump"></button>
        <button class="tb tb-run" data-a="run"></button>
      </div>`;
    root.appendChild(el);
    this.joy = el.querySelector('.joy');
    this.knob = el.querySelector('.joy-knob');
    const left = el.querySelector('.t-left'), right = el.querySelector('.t-right');
    let joyId = null, cx = 0, cy = 0;
    const R = 56;
    left.addEventListener('pointerdown', e => {
      if (joyId !== null) return;
      joyId = e.pointerId; left.setPointerCapture(e.pointerId);
      cx = e.clientX; cy = e.clientY;
      this.joy.style.left = cx + 'px'; this.joy.style.top = cy + 'px';
      this.joy.classList.remove('hidden');
      input.joy.active = true; input.joy.x = 0; input.joy.y = 0;
    });
    left.addEventListener('pointermove', e => {
      if (e.pointerId !== joyId) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.joy.x = dx / R; input.joy.y = -dy / R;
    });
    const endJoy = e => {
      if (e.pointerId !== joyId) return;
      joyId = null; input.joy.active = false; input.joy.x = input.joy.y = 0;
      this.knob.style.transform = ''; this.joy.classList.add('hidden');
    };
    left.addEventListener('pointerup', endJoy); left.addEventListener('pointercancel', endJoy);

    let lookId = null, lx = 0, ly = 0;
    right.addEventListener('pointerdown', e => { if (lookId !== null) return; lookId = e.pointerId; right.setPointerCapture(e.pointerId); lx = e.clientX; ly = e.clientY; });
    right.addEventListener('pointermove', e => {
      if (e.pointerId !== lookId) return;
      input.addLook((e.clientX - lx) * 1.6, (e.clientY - ly) * 1.6);
      lx = e.clientX; ly = e.clientY;
    });
    const endLook = e => { if (e.pointerId === lookId) lookId = null; };
    right.addEventListener('pointerup', endLook); right.addEventListener('pointercancel', endLook);

    el.querySelectorAll('.tb').forEach(b => {
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const a = b.dataset.a;
        if (a === 'jump') input.jumpQueued = true;
        else if (a === 'run') { input.runToggle = !input.runToggle; b.classList.toggle('on', input.runToggle); }
        else onAction(a);
      });
    });
    this.refresh();
  }
  refresh() {
    this.el.querySelector('.tb-act').textContent = t('act');
    this.el.querySelector('.tb-jump').textContent = t('jump');
    this.el.querySelector('.tb-run').textContent = t('run');
  }
  setVisible(v) { this.el.classList.toggle('hidden', !v); }
}
