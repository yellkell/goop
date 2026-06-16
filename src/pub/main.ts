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

import { launchXR, SessionMode, World } from '@iwsdk/core';
import { initFirePools } from '../fx/fire.js';
import * as sfx from '../audio/sfx.js';
import { customization } from '../menu/customization.js';
import { PUB, pubServerUrl } from './config.js';
import { buildPub } from './environment.js';
import { pubConnect } from './net.js';
import { Panel } from './panel.js';
import { bus, pub } from './state.js';
import { buildProps, PropSystem } from './systems/PropSystem.js';
import { BartenderSystem } from './systems/BartenderSystem.js';
import { DartsSystem } from './systems/DartsSystem.js';
import { FightSystem } from './systems/FightSystem.js';
import { PubPlayerSystem } from './systems/PubPlayerSystem.js';
import { SnakeSystem } from './systems/SnakeSystem.js';
import { TeleportSystem } from './systems/TeleportSystem.js';
import { ClimbSystem } from './systems/ClimbSystem.js';
import { FXSystem } from '../systems/FXSystem.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const enterVrButton = document.getElementById('enter-vr') as HTMLButtonElement | null;

enterVrButton?.setAttribute('disabled', '');

function hideLanding(): void {
  document.body.classList.add('app-entered');
}

function showLanding(): void {
  document.body.classList.remove('app-entered');
  enterVrButton?.removeAttribute('disabled');
}

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

let fullNotice: Panel | null = null;

/** Hang a "PUB IS FULL" stencil sign at eye level just inside the door. */
function showFullNotice(world: World): void {
  if (fullNotice) return; // only once
  const panel = new Panel(1.5, 0.82, 384);
  panel.setLines([
    { text: 'THE PUB IS FULL', size: 58, colour: '#ffb000', bold: true },
    { text: '12 / 12 PUNTERS IN', size: 30 },
    { text: "You're in a quiet side room —", size: 26, colour: '#aeb6c2' },
    { text: 'come back when a stool frees up.', size: 26, colour: '#aeb6c2' },
  ]);
  // Just in front of the spawn (player walks in facing −z), at eye level.
  panel.mesh.position.set(PUB.spawn.x, 1.55, PUB.spawn.z - 1.3);
  world.scene.add(panel.mesh);
  fullNotice = panel;
}

World.create(container, {
  // A fully virtual interior — no passthrough; the pub IS the room.
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: 'none',
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
}).then(async (world) => {
  pub.myName = resolveName();
  pub.refs = buildPub(world);
  initFirePools(world.scene); // ember/trail pools for the fight hall
  buildProps(world);

  world.registerSystem(TeleportSystem);
  world.registerSystem(ClimbSystem);
  world.registerSystem(PubPlayerSystem);
  world.registerSystem(PropSystem);
  world.registerSystem(DartsSystem);
  world.registerSystem(SnakeSystem);
  world.registerSystem(FightSystem);
  world.registerSystem(BartenderSystem);
  // Animates and self-destructs transient effects (clap gesture cues, fire
  // impacts) and drives the fire particle pools. Without it, the white clap
  // flash spawns but never fades — leaving a permanent mark in the room.
  world.registerSystem(FXSystem);

  // If the room is full (12/12) the server turns us away and we drop into a
  // quiet solo copy — so hang a stencil notice by the door explaining why
  // it's empty, instead of leaving the player baffled.
  bus.on('full', () => showFullNotice(world));

  // Your arena cosmetics walk in with you.
  pubConnect(pubServerUrl(), pub.myName, customization.avatar, customization.platform);

  const xrSupported = (await navigator.xr?.isSessionSupported(SessionMode.ImmersiveVR).catch(() => false)) === true;

  if (enterVrButton && xrSupported) {
    enterVrButton.removeAttribute('disabled');
    enterVrButton.addEventListener('click', () => {
      enterVrButton.setAttribute('disabled', '');
      launchXR(world, { sessionMode: SessionMode.ImmersiveVR });

      const watchForSession = () => {
        if (world.session) {
          hideLanding();
          world.session.addEventListener('end', showLanding, { once: true });
          setTimeout(() => {
            sfx.ensureAudio();
            sfx.saloonEntry();
          }, 700);
          return;
        }

        if (!document.body.classList.contains('app-entered')) {
          requestAnimationFrame(watchForSession);
        }
      };

      requestAnimationFrame(watchForSession);
      window.setTimeout(() => {
        if (!world.session) enterVrButton.removeAttribute('disabled');
      }, 4000);
    });
  } else if (enterVrButton) {
    enterVrButton.textContent = 'XR unavailable';
  }

  // eslint-disable-next-line no-console
  console.info('[IRON BALLS PUB] Doors open. Mind the low beams.');
});
