// Entry point: start screen → build world → run.
// both maps are embedded (packed); the start screen picks one
import erlangenData from '../data/world/suedgelaende.json';
import nuernbergData from '../data/world/nuernberg.json';
import { unpackWorld } from './core/unpack.js';
import { Game } from './game.js';
import { UI } from './ui/ui.js';
import { settings, setSetting } from './core/settings.js';
import { t } from './core/i18n.js';
import { setupSpawn } from './world/places.js';
import { installSystems } from './systems.js';

const app = document.getElementById('app');
let ui = null, world = null;

let params = null;
try { params = new URLSearchParams(location.search); } catch (e) { /* file:// */ }

const REGION_DATA = { suedgelaende: erlangenData, nuernberg: nuernbergData };

async function boot() {
  ui = new UI(app, null);
  let region = (params && params.get('region')) || settings.region;
  if (!REGION_DATA[region]) region = 'suedgelaende';
  if (!(params && params.has('autostart'))) region = await ui.showStart(region);
  setSetting('region', region);
  world = await unpackWorld(REGION_DATA[region]);
  ui.world = world;
  ui.showLoading(t('loading'));
  const frame = () => new Promise(r => setTimeout(r, 16));
  // load timing: work per step, excluding the waits for the progress bar to paint
  const t0 = performance.now(), marks = {};
  let last = t0, work = 0;
  const step = async (name, p) => {
    const d = performance.now() - last; work += d; marks[name] = Math.round(d);
    ui.setProgress(p); await frame(); last = performance.now();
  };
  const game = new Game(app, world, ui);
  await game.init(p => step('init' + Math.round(p * 100), p));
  await installSystems(game, p => step('sys' + Math.round(p * 100), 0.55 + p * 0.45));
  setupSpawn(game);
  const w = params && params.get('w');
  if (w && ['autumn', 'sunny', 'overcast', 'rain', 'night'].includes(w)) game.weather.set(w, true);
  ui.attach(game);
  if (ui.startedByClick) game.audio?.start();
  ui.hideLoading();
  game.start();
  work += performance.now() - last;
  game.loadTimes = { work: Math.round(work), total: Math.round(performance.now() - t0), marks, parts: game.prof };
  console.info('[FAU] ready: ' + JSON.stringify(game.loadTimes));
  if (typeof window !== 'undefined') window.__game = game;
}

boot().catch(err => {
  console.error(err);
  if (ui) ui.fatal(String(err && err.stack || err));
  else document.body.textContent = String(err && err.stack || err);
});
