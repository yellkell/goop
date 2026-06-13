/**
 * IRON BALLS PUB — entry point for the pub social scene.
 *
 * A 10–12 player VR local: low steel ceiling, diamond-plate underfoot, pints
 * you can stack (or lob at your mates, who can catch them), communal darts
 * with a live leaderboard, and the IRON SNAKE arcade cabinet in the corner —
 * steered by its own physical joystick. Same iron-boxer avatars as FIRE
 * FIGHT — this is where the fighters drink.
 *
 * Through the west door: the FIGHT HALL, with the full FIRE FIGHT duel on
 * display (cage pulled in to 5 yards so it fits indoors). Claim a corner at
 * a console, and when both corners fill, the bout starts for all to watch.
 *
 * Movement is teleport-only: deflect a thumbstick, aim the arc, roll the
 * stick to set which way you'll face on the octagon marker, release to go.
 *
 * Run `npm run dev` and open /pub.html; for company also run
 * `npm run server:pub` and join from other headsets/tabs.
 * `?name=YourCallsign` sets your name; `?server=wss://host:8788` picks a relay.
 */

import { SessionMode, World } from '@iwsdk/core';
import { initFirePools } from '../fx/fire.js';
import { customization } from '../menu/customization.js';
import { PUB, pubServerUrl } from './config.js';
import { buildPub } from './environment.js';
import { pubConnect } from './net.js';
import { pub } from './state.js';
import { buildProps, PropSystem } from './systems/PropSystem.js';
import { BartenderSystem } from './systems/BartenderSystem.js';
import { DartsSystem } from './systems/DartsSystem.js';
import { FightSystem } from './systems/FightSystem.js';
import { PubPlayerSystem } from './systems/PubPlayerSystem.js';
import { SnakeSystem } from './systems/SnakeSystem.js';
import { TeleportSystem } from './systems/TeleportSystem.js';

const container = document.getElementById('scene-container') as HTMLDivElement;

function resolveName(): string {
  const param = new URLSearchParams(location.search).get('name');
  if (param) {
    localStorage.setItem('ibb-pub-name', param.slice(0, 14));
    return param.slice(0, 14);
  }
  // The callsign typed in the FIRE FIGHT arena carries over.
  const arena = localStorage.getItem('ff-player-name');
  if (arena) return arena.slice(0, 14);
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
    // Movement is TELEPORT ONLY (our own arc-and-octagon system on the
    // thumbsticks) — no sliding locomotion. Grabbing stays on for the props.
    locomotion: false,
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
  initFirePools(world.scene); // ember/trail pools for the fight hall
  buildProps(world);

  world.registerSystem(TeleportSystem);
  world.registerSystem(PubPlayerSystem);
  world.registerSystem(PropSystem);
  world.registerSystem(DartsSystem);
  world.registerSystem(SnakeSystem);
  world.registerSystem(FightSystem);
  world.registerSystem(BartenderSystem);

  // Your arena cosmetics walk in with you.
  pubConnect(pubServerUrl(), pub.myName, customization.avatar, customization.platform);

  // eslint-disable-next-line no-console
  console.info('[IRON BALLS PUB] Doors open. Mind the low beams.');
});
