// Entry point: start screen → build world → run.
import world from '../data/world/suedgelaende.json';
import { Game } from './game.js';
import { UI } from './ui/ui.js';
import { settings } from './core/settings.js';
import { t } from './core/i18n.js';
import { setupSpawn } from './world/places.js';
import { installSystems } from './systems.js';

const app = document.getElementById('app');
const ui = new UI(app, world);

let params = null;
try { params = new URLSearchParams(location.search); } catch (e) { /* file:// */ }

async function boot() {
  if (!(params && params.has('autostart'))) await ui.showStart();
  ui.showLoading(t('loading'));
  const frame = () => new Promise(r => setTimeout(r, 16));
  const game = new Game(app, world, ui);
  await game.init(async (p) => { ui.setProgress(p); await frame(); });
  await installSystems(game, async (p) => { ui.setProgress(0.55 + p * 0.45); await frame(); });
  setupSpawn(game);
  const w = params && params.get('w');
  if (w && ['autumn', 'sunny', 'overcast', 'rain', 'night'].includes(w)) game.weather.set(w, true);
  ui.attach(game);
  if (ui.startedByClick) game.audio?.start();
  ui.hideLoading();
  game.start();
  if (typeof window !== 'undefined') window.__game = game;
}

boot().catch(err => {
  console.error(err);
  ui.fatal(String(err && err.stack || err));
});
