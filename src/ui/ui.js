// HTML overlay UI: start screen, loading, HUD (minimap, location, prompts), menus, full-screen map.
import { settings, setSetting } from '../core/settings.js';
import { t, toggleLang, onLangChange, PLACE_ZH } from '../core/i18n.js';
import { MapRenderer, Minimap, BigMap, esc } from './map.js';
import { TouchControls } from './touch.js';
import { teleportTo } from '../world/places.js';
import { pointInPoly, distSegSq } from '../shared/geom.js';

const WEATHERS = ['autumn', 'sunny', 'overcast', 'rain', 'night'];
const WEATHER_ICON = { autumn: '🍂', sunny: '☀️', overcast: '☁️', rain: '🌧️', night: '🌙' };

export class UI {
  constructor(app, world) {
    this.app = app;
    this.world = world;
    this.root = document.createElement('div');
    this.root.className = 'ui-root';
    app.appendChild(this.root);
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.documentElement.classList.toggle('touch', this.isTouch);
    document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : 'de';
    onLangChange(() => { document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : 'de'; this.refreshTexts(); });
  }

  // ---------- start / loading ----------
  showStart() {
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.className = 'screen start';
      const render = () => {
        el.innerHTML = `
          <div class="start-card">
            <div class="start-top">
              <div class="brand"><span class="brand-mark">FAU</span><span class="brand-sub">Campus 3D</span></div>
              <div class="seg lang-seg">
                <button data-lang="zh" class="${settings.lang === 'zh' ? 'on' : ''}">中文</button>
                <button data-lang="de" class="${settings.lang === 'de' ? 'on' : ''}">Deutsch</button>
              </div>
            </div>
            <h1>${t('title')}</h1>
            <p class="sub">${t('subtitle')}</p>
            <div class="regions">
              <div class="region on"><b>Südgelände</b><span>${t('regionSued')}</span></div>
              <div class="region off"><b>Innenstadt · Nürnberg</b><span>${t('comingSoon')}</span></div>
            </div>
            <div class="start-row">
              <label>${t('quality')}</label>
              <div class="seg q-seg">${['auto', 'low', 'medium', 'high'].map(q => `<button data-q="${q}" class="${settings.quality === q ? 'on' : ''}">${t('q_' + q)}</button>`).join('')}</div>
            </div>
            <button class="btn primary big go">${t('start')}</button>
            <p class="hint">${this.isTouch ? t('controlsTouch') : t('controlsDesktop')}</p>
            <p class="fine">${t('disclaimer')}<br>${t('attribution')}</p>
          </div>`;
        el.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setSetting('lang', b.dataset.lang); render(); });
        el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { setSetting('quality', b.dataset.q); render(); });
        el.querySelector('.go').onclick = () => {
          if (this.isTouch) this.requestFullscreen();
          this.audioUnlock?.();
          el.remove(); resolve();
        };
      };
      render();
      this.root.appendChild(el);
    });
  }

  requestFullscreen() {
    const d = document.documentElement;
    try { const p = (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not allowed */ }
    try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (e) { /* ignore */ }
  }

  showLoading(text) {
    const el = this.loading = document.createElement('div');
    el.className = 'screen loading';
    el.innerHTML = `<div class="load-card"><div class="load-title">${esc(text)}</div><div class="bar"><i></i></div><div class="load-sub">${t('attribution')}</div></div>`;
    this.root.appendChild(el);
  }
  setProgress(p) { if (this.loading) this.loading.querySelector('.bar i').style.width = Math.round(p * 100) + '%'; }
  hideLoading() { if (this.loading) { this.loading.remove(); this.loading = null; } }
  fatal(msg) {
    this.hideLoading();
    const el = document.createElement('div');
    el.className = 'screen fatal';
    el.innerHTML = `<div class="load-card"><div class="load-title">⚠ WebGL / 3D 启动失败 · Start fehlgeschlagen</div><pre>${esc(msg).slice(0, 1200)}</pre></div>`;
    this.root.appendChild(el);
  }

  // ---------- HUD ----------
  attach(game) {
    this.game = game;
    const hud = this.hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
      <div class="hud-tl">
        <div class="loc"><div class="loc-name"></div><div class="loc-sub"></div></div>
      </div>
      <div class="hud-tr">
        <div class="mm-slot"></div>
        <div class="hud-btns">
          <button class="btn-icon" data-act="map" title="M">🗺️</button>
          <button class="btn-icon" data-act="weather" title="T">${WEATHER_ICON[game.weather.name]}</button>
          <button class="btn-icon lang" data-act="lang" title="L">${settings.lang === 'zh' ? 'DE' : '中'}</button>
          <button class="btn-icon" data-act="menu" title="Esc">☰</button>
        </div>
        <div class="weather-pop hidden"></div>
      </div>
      <div class="crosshair"></div>
      <div class="prompt hidden"></div>
      <div class="toasts"></div>
      <div class="fps hidden"></div>
      <div class="lock-hint hidden"></div>
      <div class="floor-ind hidden"></div>`;
    this.root.appendChild(hud);
    const enterable = new Set(game.enterableOutlines || []);
    this.mapRenderer = new MapRenderer(this.world, enterable);
    this.minimap = new Minimap(hud.querySelector('.mm-slot'), this.mapRenderer, this.world);
    for (const p of game.places) if (enterable.has(p.outline)) p.enterable = true;
    this.bigmap = new BigMap(this.root, this.mapRenderer, this.world, game.places, (p) => { teleportTo(game, p); this.toast(p.name); });
    this.bigmap.onClose = () => this.resumeFromOverlay();
    this.promptEl = hud.querySelector('.prompt');
    this.toastsEl = hud.querySelector('.toasts');
    this.fpsEl = hud.querySelector('.fps');
    this.lockHint = hud.querySelector('.lock-hint');
    this.locName = hud.querySelector('.loc-name');
    this.locSub = hud.querySelector('.loc-sub');
    this.floorInd = hud.querySelector('.floor-ind');
    this.weatherPop = hud.querySelector('.weather-pop');
    this._buildMenu();
    hud.querySelectorAll('[data-act]').forEach(b => b.onclick = (e) => { e.stopPropagation(); this.action(b.dataset.act); });

    const inp = game.input;
    inp.on('map', () => this.action('map'));
    inp.on('escape', () => this.action('escape'));
    inp.on('lang', () => this.action('lang'));
    inp.on('weather', () => this.cycleWeather());
    inp.on('help', () => this.action('menu'));
    inp.on('debug', () => { setSetting('showFps', !settings.showFps); });
    inp.on('locked', () => this.updateLockHint());
    inp.on('unlocked', () => {
      if (!this.overlayOpen() && !this.isTouch && !this.suppressUnlockMenu) this.openMenu();
      this.suppressUnlockMenu = false;
      this.updateLockHint();
    });
    if (this.isTouch) this.touch = new TouchControls(this.root, inp, (a) => this.action(a));
    game.updaters.push({ update: (dt) => this.update(dt) });
    this.locTimer = 0;
    this.refreshTexts();
    this.updateLockHint();
    window.addEventListener('resize', () => { this.minimap.resize(); if (this.bigmap.visible) this.bigmap.redraw(); });
  }

  overlayOpen() { return this.bigmap.visible || !this.menu.classList.contains('hidden') || !!this.dialogueOpen; }

  pauseForOverlay() {
    this.game.input.enabled = false;
    this.suppressUnlockMenu = true;
    this.game.input.exitLock();
    this.hud.classList.add('dim');
  }
  resumeFromOverlay() {
    if (this.overlayOpen()) return;
    this.game.input.enabled = true;
    this.hud.classList.remove('dim');
    this.updateLockHint();
  }

  action(a) {
    const g = this.game;
    if (a === 'map') {
      if (this.bigmap.visible) { this.bigmap.hide(); return; }
      this.closeMenu(true);
      this.pauseForOverlay();
      this.bigmap.show(g.player.x, g.player.z, g.player.yaw);
    } else if (a === 'menu') {
      if (!this.menu.classList.contains('hidden')) this.closeMenu(); else this.openMenu();
    } else if (a === 'escape') {
      if (this.dialogueOpen && this.onDialogueEscape) this.onDialogueEscape();
      else if (this.bigmap.visible) this.bigmap.hide();
      else if (!this.menu.classList.contains('hidden')) this.closeMenu();
      else this.openMenu();
    } else if (a === 'lang') {
      toggleLang();
    } else if (a === 'weather') {
      this.weatherPop.classList.toggle('hidden');
      this.renderWeatherPop();
    } else if (a === 'interact') {
      g.input.interactQueued = true;
      g.onInteract?.();
    } else if (a === 'fullscreen') {
      this.requestFullscreen();
    }
  }

  cycleWeather() {
    const i = WEATHERS.indexOf(this.game.weather.name);
    const next = WEATHERS[(i + 1) % WEATHERS.length];
    setSetting('weather', next);
    this.toast(t('w_' + next));
    this.refreshTexts();
  }

  renderWeatherPop() {
    this.weatherPop.innerHTML = WEATHERS.map(w => `<button class="${this.game.weather.name === w ? 'on' : ''}" data-w="${w}">${WEATHER_ICON[w]} ${t('w_' + w)}</button>`).join('');
    this.weatherPop.querySelectorAll('[data-w]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      setSetting('weather', b.dataset.w);
      this.weatherPop.classList.add('hidden');
      this.refreshTexts();
    });
  }

  _buildMenu() {
    const m = this.menu = document.createElement('div');
    m.className = 'menu hidden';
    this.root.appendChild(m);
  }
  renderMenu() {
    const s = settings;
    this.menu.innerHTML = `
      <div class="menu-card">
        <div class="menu-head"><h2>${t('menu')}</h2><button class="btn-icon m-close">✕</button></div>
        <button class="btn primary big m-resume">${t('resume')}</button>
        <div class="m-grid">
          <label>${t('language')}</label>
          <div class="seg"><button data-lang="zh" class="${s.lang === 'zh' ? 'on' : ''}">中文</button><button data-lang="de" class="${s.lang === 'de' ? 'on' : ''}">Deutsch</button></div>
          <label>${t('weather')}</label>
          <div class="seg wrap">${WEATHERS.map(w => `<button data-w="${w}" class="${this.game.weather.name === w ? 'on' : ''}">${WEATHER_ICON[w]} ${t('w_' + w)}</button>`).join('')}</div>
          <label>${t('quality')}</label>
          <div class="seg">${['auto', 'low', 'medium', 'high'].map(q => `<button data-q="${q}" class="${s.quality === q ? 'on' : ''}">${t('q_' + q)}</button>`).join('')}</div>
          <label>${t('sensitivity')}</label>
          <input type="range" min="0.3" max="2.5" step="0.05" value="${s.sensitivity}" data-set="sensitivity">
          <label>${t('volume')}</label>
          <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-set="volume">
          <label>${t('invertY')}</label>
          <input type="checkbox" ${s.invertY ? 'checked' : ''} data-chk="invertY">
          <label>${t('subtitlesDe')}</label>
          <input type="checkbox" ${s.subtitlesDe ? 'checked' : ''} data-chk="subtitlesDe">
          <label>${t('showFps')}</label>
          <input type="checkbox" ${s.showFps ? 'checked' : ''} data-chk="showFps">
        </div>
        <p class="hint">${this.isTouch ? t('controlsTouch') : t('controlsDesktop')}</p>
        <p class="fine">${t('disclaimer')}<br>${t('attribution')}${this.game.world.meta.osmBase ? ' · OSM ' + this.game.world.meta.osmBase.slice(0, 10) : ''}</p>
      </div>`;
    const m = this.menu;
    m.querySelector('.m-close').onclick = () => this.closeMenu();
    m.querySelector('.m-resume').onclick = () => this.closeMenu();
    m.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setSetting('lang', b.dataset.lang); this.renderMenu(); });
    m.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { setSetting('weather', b.dataset.w); this.renderMenu(); this.refreshTexts(); });
    m.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { setSetting('quality', b.dataset.q); this.renderMenu(); });
    m.querySelectorAll('[data-set]').forEach(i => i.oninput = () => setSetting(i.dataset.set, parseFloat(i.value)));
    m.querySelectorAll('[data-chk]').forEach(i => i.onchange = () => setSetting(i.dataset.chk, i.checked));
  }
  openMenu() {
    this.renderMenu();
    this.menu.classList.remove('hidden');
    this.pauseForOverlay();
  }
  closeMenu(keepPaused = false) {
    this.menu.classList.add('hidden');
    if (!keepPaused) this.resumeFromOverlay();
  }

  updateLockHint() {
    if (!this.lockHint || this.isTouch) return;
    const show = !this.game.input.locked && !this.overlayOpen();
    this.lockHint.classList.toggle('hidden', !show);
    this.lockHint.textContent = t('clickToLook');
  }

  refreshTexts() {
    if (!this.hud) return;
    this.hud.querySelector('.lang').textContent = settings.lang === 'zh' ? 'DE' : '中';
    this.hud.querySelector('[data-act="weather"]').textContent = WEATHER_ICON[this.game.weather.name];
    this.updateLockHint();
    if (!this.menu.classList.contains('hidden')) this.renderMenu();
    if (this.bigmap.visible) this.bigmap.show(this.game.player.x, this.game.player.z, this.game.player.yaw);
    this.touch?.refresh();
    this.locTimer = 99;
  }

  toast(keyOrText, ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = t(keyOrText);
    this.toastsEl.appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  setPrompt(text) {
    if (!text) { this.promptEl.classList.add('hidden'); return; }
    this.promptEl.classList.remove('hidden');
    const key = this.isTouch ? '' : '<kbd>E</kbd> ';
    if (this._lastPrompt !== text) { this.promptEl.innerHTML = key + esc(text); this._lastPrompt = text; }
  }

  setFloor(text) {
    if (!text) { this.floorInd.classList.add('hidden'); return; }
    this.floorInd.classList.remove('hidden');
    this.floorInd.textContent = text;
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.mmTimer = (this.mmTimer || 0) + dt;
    if (this.mmTimer > 1 / 30) {
      this.mmTimer = 0;
      this.minimap.draw(p.x, p.z, p.yaw, g.npcDots ? g.npcDots() : null);
    }
    this.locTimer += dt;
    if (this.locTimer > 0.5) { this.locTimer = 0; this.updateLocation(); }
    if (settings.showFps) {
      this.fpsEl.classList.remove('hidden');
      const info = g.renderer.info;
      this.fpsEl.textContent = `${Math.round(g.fps || 0)} fps · ${g.quality} · ${info.render.calls} dc · ${(info.render.triangles / 1000).toFixed(0)}k tri · ${p.x.toFixed(0)},${p.z.toFixed(0)}`;
    } else this.fpsEl.classList.add('hidden');
    if (this.edgeCooldown > 0) this.edgeCooldown -= dt;
    const [x0, z0, x1, z1] = this.world.meta.bounds;
    const edge = Math.min(p.x - x0, x1 - p.x, p.z - z0, z1 - p.z);
    if (edge < 6 && !(this.edgeCooldown > 0)) { this.toast('edgeOfMap', 3200); this.edgeCooldown = 8; }
  }

  updateLocation() {
    const g = this.game, p = g.player, w = this.world;
    if (g.indoor) {
      const lv = g.indoor.level;
      const fl = lv === 0 ? 'EG' : `${lv}. OG`;
      this.locName.textContent = g.indoor.name;
      this.locSub.textContent = settings.lang === 'zh' ? `${g.indoor.sub} · ${fl}（${lv + 1} 楼）` : (lv === 0 ? 'Erdgeschoss' : `${lv}. Obergeschoss`);
      this.setFloor(fl);
      return;
    }
    this.setFloor(null);
    // inside/near a named building outline?
    let best = null, bd = 22;
    for (const pl of g.places) {
      if (pl.cat === 'stop') { const d = Math.hypot(pl.x - p.x, pl.z - p.z); if (d < 14 && d < bd) { bd = d; best = pl; } continue; }
      if (pl.outline == null) continue;
      const o = w.outlines[pl.outline];
      const dx = pl.x - p.x, dz = pl.z - p.z;
      if (dx * dx + dz * dz > 200 * 200) continue;
      let d = Infinity;
      if (pointInPoly(p.x, p.z, o.p)) d = 0;
      else for (let i = 0; i < o.p.length; i++) { const a = o.p[i], b = o.p[(i + 1) % o.p.length]; d = Math.min(d, Math.sqrt(distSegSq(p.x, p.z, a[0], a[1], b[0], b[1]))); }
      if (d < bd) { bd = d; best = pl; }
    }
    // nearest named street
    let street = null, sd = 30 * 30;
    for (const r of w.roads) {
      if (!r.n) continue;
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], b = r.p[i + 1];
        if (Math.abs(a[0] - p.x) > 120 && Math.abs(b[0] - p.x) > 120) continue;
        const d = distSegSq(p.x, p.z, a[0], a[1], b[0], b[1]);
        if (d < sd) { sd = d; street = r.n; }
      }
    }
    if (best) {
      this.locName.textContent = best.cat === 'stop' ? `🚏 ${best.name}` : shortTitle(best.name);
      const zh = settings.lang === 'zh' ? (best.zh || PLACE_ZH[best.name]) : null;
      this.locSub.textContent = [zh, street].filter(Boolean).join(' · ');
    } else if (street) {
      this.locName.textContent = street;
      this.locSub.textContent = 'Erlangen · Südgelände';
    } else {
      this.locName.textContent = 'Erlangen';
      this.locSub.textContent = 'Südgelände';
    }
  }
}

function shortTitle(n) {
  if (n.startsWith('MHB-')) return 'Mensa · Hörsaal · Bibliothek';
  return n.length > 42 ? n.slice(0, 40) + '…' : n;
}
