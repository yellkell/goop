/**
 * GOOP — entry point.
 *
 * Boots an IWSDK World with a WebXR **passthrough** (immersive-AR) session:
 * the gel creature oozes around your actual room, the scoreboard floats by
 * your bookshelf, and the only lighting we add is for your fists — the goo
 * lights itself.
 *
 * Run `npm run dev` and open the page: on a headset you get an "Enter the
 * Ring" button; on desktop the IWSDK dev plugin provides a WebXR emulator
 * (WASD + mouse). For creature/shader work without XR, open /dev.html — the
 * flat-screen workbench drives the identical GelCreature.
 */

import { launchXR, SessionMode, World } from '@iwsdk/core';
import { DirectionalLight, HemisphereLight } from 'three';
import titleUrl from './assets/ui/goop-title.png?url';
import { preloadAnnouncer } from './audio/announcer.js';
import { startLobbyMusic } from './audio/music.js';
import { ensureAudio } from './audio/sfx.js';
import { CreatureSystem } from './systems/CreatureSystem.js';
import { FightSystem } from './systems/FightSystem.js';
import { FistSystem } from './systems/FistSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const enterButton = document.getElementById('enter-vr') as HTMLButtonElement | null;
const landingLogo = document.getElementById('landing-logo') as HTMLImageElement | null;
if (landingLogo) landingLogo.src = titleUrl;

enterButton?.setAttribute('disabled', '');

function hideLanding(): void {
  document.body.classList.add('app-entered');
}

function showLanding(): void {
  document.body.classList.remove('app-entered');
  enterButton?.removeAttribute('disabled');
}

World.create(container, {
  // The landing button calls IWSDK's explicit WebXR launcher from the user's
  // tap. Quest Browser needs that direct requestSession gesture path.
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: 'none',
  },
  // A stationary brawl: you stand your ground, the creature comes to you.
  features: {
    grabbing: false,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    // Passthrough is the backdrop; we bring our own light for the fists.
    defaultLighting: false,
    far: 60,
    camera: { position: [0, 1.6, 0] },
  },
}).then(async (world) => {
  // Quest fill-rate relief: the raymarched gel is fragment-bound, so trade
  // a hair of resolution for frame rate, and let the edges of the eye buffer
  // render cheaper (foveation) — invisible in-lens, big GPU win.
  world.renderer.xr.setFramebufferScaleFactor(0.72);
  world.renderer.xr.setFoveation(1);

  // Soft room-ish light so the fists and scoreboard read in passthrough.
  const hemi = new HemisphereLight(0xdfe8dc, 0x24301f, 1.0);
  const key = new DirectionalLight(0xffffff, 0.55);
  key.position.set(0.6, 1.8, 0.4);
  world.scene.add(hemi);
  world.scene.add(key);

  // Punches first (impulses land before the body integrates), then the
  // creature itself, then the referee reading the aftermath, then the
  // lobby menu (lasers + FIGHT/round/music/difficulty).
  world.registerSystem(FistSystem);
  world.registerSystem(CreatureSystem);
  world.registerSystem(FightSystem);
  world.registerSystem(MenuSystem);

  const xrSupported = (await navigator.xr?.isSessionSupported(SessionMode.ImmersiveAR).catch(() => false)) === true;

  if (enterButton && xrSupported) {
    enterButton.removeAttribute('disabled');
    enterButton.addEventListener('click', () => {
      enterButton.setAttribute('disabled', '');
      ensureAudio(); // unlock inside the gesture
      preloadAnnouncer();
      startLobbyMusic();
      launchXR(world, { sessionMode: SessionMode.ImmersiveAR });

      const watchForSession = () => {
        if (world.session) {
          hideLanding();
          world.session.addEventListener('end', showLanding, { once: true });
          return;
        }
        if (!document.body.classList.contains('app-entered')) {
          requestAnimationFrame(watchForSession);
        }
      };
      requestAnimationFrame(watchForSession);
      window.setTimeout(() => {
        if (!world.session) enterButton.removeAttribute('disabled');
      }, 4000);
    });
  } else if (enterButton) {
    enterButton.textContent = 'XR unavailable';
  }

  // eslint-disable-next-line no-console
  console.info('[GOOP] World ready — the puddle is awake.');
});
