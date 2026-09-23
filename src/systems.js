// Installs the optional world systems (vegetation, props, interiors, people, sound …) after the core world exists.
import { Vegetation } from './world/vegetation.js';
import { Props } from './world/props.js';
import { DistanceCuller } from './world/shapes.js';
import { Interiors } from './world/interiors/render.js';

export async function installSystems(game, progress) {
  const veg = new Vegetation(game);
  game.updaters.push(veg);
  game.vegetation = veg;
  await progress(0.3);
  const props = new Props(game);
  game.updaters.push(props);
  game.props = props;
  await progress(0.6);
  const interiors = new Interiors(game, game.plans);
  game.updaters.push(interiors);
  game.interiors = interiors;
  const culler = new DistanceCuller(game.scene);
  culler.setQuality = q => { culler.scale = q === 'low' ? 0.65 : q === 'high' ? 1.25 : 1; };
  culler.setQuality(game.quality);
  game.updaters.push(culler);
  game.culler = culler;
  await progress(1);
}
