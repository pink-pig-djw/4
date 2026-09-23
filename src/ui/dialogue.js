// Dialogue panel: NPC line (UI language + optional German original), numbered reply options.
import { settings } from '../core/settings.js';
import { t } from '../core/i18n.js';
import { esc } from './map.js';

export class DialogueUI {
  constructor(root, ui) {
    this.ui = ui;
    const el = this.el = document.createElement('div');
    el.className = 'dialogue hidden';
    el.innerHTML = `<div class="dlg-card"><div class="dlg-head"><span class="dlg-name"></span><span class="dlg-role"></span><button class="btn-icon dlg-x" aria-label="close">✕</button></div>
      <div class="dlg-text"></div><div class="dlg-orig"></div><div class="dlg-opts"></div></div>`;
    root.appendChild(el);
    el.querySelector('.dlg-x').onclick = () => this.close();
    this.person = null;
  }

  open(person, identity, dialogue, onClose) {
    this.person = person; this.identity = identity; this.dialogue = dialogue; this.onClose = onClose;
    this.node = 'start';
    this.el.classList.remove('hidden');
    this.render();
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  render() {
    const node = this.dialogue.nodes[this.node];
    if (!node) { this.close(); return; }
    const zh = settings.lang === 'zh';
    const id = this.identity;
    this.el.querySelector('.dlg-name').textContent = id.name;
    this.el.querySelector('.dlg-role').textContent = zh ? id.role.zh : id.role.de;
    this.el.querySelector('.dlg-text').textContent = zh ? node.npc.zh : node.npc.de;
    const orig = this.el.querySelector('.dlg-orig');
    if (zh && settings.subtitlesDe) { orig.textContent = node.npc.de; orig.classList.remove('hidden'); } else orig.classList.add('hidden');
    const opts = this.el.querySelector('.dlg-opts');
    opts.innerHTML = node.opts.map((o, i) => `<button class="dlg-opt" data-i="${i}"><kbd>${i + 1}</kbd><span class="main">${esc(zh ? o.zh : o.de)}</span>${zh ? `<span class="sub">${esc(o.de)}</span>` : ''}</button>`).join('');
    opts.querySelectorAll('.dlg-opt').forEach(b => b.onclick = () => this.choose(+b.dataset.i));
  }

  choose(i) {
    const node = this.dialogue.nodes[this.node];
    if (!node) return;
    const o = node.opts[i];
    if (!o) return;
    this.ui.game?.audio?.ui('click');
    if (o.go) { this.node = o.go; this.render(); }
    else this.close();
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.add('hidden');
    const cb = this.onClose; this.onClose = null;
    if (cb) cb();
  }
}
