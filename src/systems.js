// Installs the optional world systems (vegetation, props, interiors, people, sound …) after the core world exists.
import { Vegetation } from './world/vegetation.js';
import { Grass } from './world/grass.js';
import { Barriers } from './world/barriers.js';
import { Props } from './world/props.js';
import { DistanceCuller } from './world/shapes.js';
import { Interiors } from './world/interiors/render.js';
import { Crowd } from './npc/crowd.js';
import { AudioEngine } from './audio/audio.js';
import { Effects } from './world/effects.js';

export async function installSystems(game, progress) {
  const veg = new Vegetation(game);
  game.updaters.push(veg);
  game.vegetation = veg;
  game.barriers = new Barriers(game);
  const grass = new Grass(game);
  game.updaters.push(grass);
  game.grass = grass;
  await progress(0.3);
  const props = new Props(game);
  game.updaters.push(props);
  game.props = props;
  await progress(0.6);
  const interiors = new Interiors(game, game.plans);
  game.updaters.push(interiors);
  game.interiors = interiors;
  await progress(0.8);
  const crowd = new Crowd(game);
  game.updaters.push(crowd);
  game.crowd = crowd;
  const fx = new Effects(game);
  game.updaters.push(fx);
  game.effects = fx;
  const audio = new AudioEngine(game);
  game.updaters.push(audio);
  game.audio = audio;
  const culler = new DistanceCuller(game.scene);
  culler.setQuality = q => { culler.scale = q === 'low' ? 0.65 : q === 'high' ? 1.25 : 1; };
  culler.setQuality(game.quality);
  game.updaters.push(culler);
  game.culler = culler;
  await progress(1);
}
