/**
 * THE IRON TANKARD — entry point for the pub social scene.
 *
 * A 10–12 player VR local: low steel ceiling, diamond-plate underfoot, pints
 * you can stack (or lob at your mates, who can catch them), communal darts
 * with a live leaderboard, and the IRON SNAKE arcade cabinet in the corner.
 * Same iron-boxer avatars as FIRE FIGHT — this is where the fighters drink.
 *
 * Run `npm run dev` and open /pub.html; for company also run
 * `npm run server:pub` and join from other headsets/tabs.
 * `?name=YourCallsign` sets your name; `?server=wss://host:8788` picks a relay.
 */

import { EnvironmentType, LocomotionEnvironment, SessionMode, World } from '@iwsdk/core';
import { PUB, pubServerUrl } from './config.js';
import { buildPub } from './environment.js';
import { pubConnect } from './net.js';
import { pub } from './state.js';
import { buildProps, PropSystem } from './systems/PropSystem.js';
import { DartsSystem } from './systems/DartsSystem.js';
import { PubPlayerSystem } from './systems/PubPlayerSystem.js';
import { SnakeSystem } from './systems/SnakeSystem.js';

const container = document.getElementById('scene-container') as HTMLDivElement;

function resolveName(): string {
  const param = new URLSearchParams(location.search).get('name');
  if (param) {
    localStorage.setItem('ibb-pub-name', param.slice(0, 14));
    return param.slice(0, 14);
  }
  const stored = localStorage.getItem('ibb-pub-name');
  if (stored) return stored;
  const generated = `PUNTER-${Math.floor(100 + Math.random() * 900)}`;
  localStorage.setItem('ibb-pub-name', generated);
  return generated;
}

World.create(container, {
  // A fully virtual interior — no passthrough; the pub IS the room.
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: 'always',
  },
  features: {
    // You walk the pub floor and pick things up — the opposite feature set
    // to the stationary, grab-free arena.
    locomotion: { useWorker: true, initialPlayerPosition: [PUB.spawn.x, 0, PUB.spawn.z] },
    grabbing: true,
    spatialUI: false,
  },
  render: {
    defaultLighting: false,
    camera: { position: [PUB.spawn.x, 1.6, PUB.spawn.z] },
  },
}).then((world) => {
  pub.myName = resolveName();
  pub.refs = buildPub(world);

  // The whole interior is walkable static geometry for the locomotor.
  const envEntity = world.createTransformEntity(pub.refs.root);
  envEntity.addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

  buildProps(world);

  world.registerSystem(PubPlayerSystem);
  world.registerSystem(PropSystem);
  world.registerSystem(DartsSystem);
  world.registerSystem(SnakeSystem);

  pubConnect(pubServerUrl(), pub.myName);

  // eslint-disable-next-line no-console
  console.info('[IRON TANKARD] Doors open. Mind the low beams.');
});
