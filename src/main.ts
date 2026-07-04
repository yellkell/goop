/**
 * FIRE FIGHT — entry point.
 *
 * Boots an IWSDK World with a WebXR **passthrough** (immersive-AR) session:
 * the two glowing platforms, the rim barrier and the iron boxer float in your
 * real room. If the device can't do AR, IWSDK falls back to VR.
 *
 * Run `npm run dev` and open the page: on a headset you'll get an "Enter AR"
 * offer; on desktop the IWSDK dev plugin provides a WebXR emulator
 * (WASD + mouse). For online 1v1s also run `npm run server`.
 */

import { launchXR, SessionMode, World } from '@iwsdk/core';
import { installCrashTrap } from './debug/crashTrap.js';
import { initLeaderboard } from './net/leaderboard.js';
import { initGazette } from './net/gazette.js';
import { enterMenuMusic } from './audio/menuMusic.js';
import { buildArena } from './arena/arena.js';
import { setupEnvironment } from './arena/environment.js';
import { setupCombatants } from './combat/setup.js';
import { PlayerBodySystem } from './systems/PlayerBodySystem.js';
import { OpponentSystem } from './systems/OpponentSystem.js';
import { BotSystem } from './systems/BotSystem.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { MeshSystem } from './systems/MeshSystem.js';
import { TrainingSystem } from './systems/TrainingSystem.js';
import { TutorialSystem } from './systems/TutorialSystem.js';
import { CampaignSystem } from './systems/CampaignSystem.js';
import { FireballSystem } from './systems/FireballSystem.js';
import { CollisionSystem } from './systems/CollisionSystem.js';
import { BoundarySystem } from './systems/BoundarySystem.js';
import { GameStateSystem } from './systems/GameStateSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';
import { PromotionSystem } from './systems/PromotionSystem.js';
import { PlayerFeedbackSystem } from './systems/PlayerFeedbackSystem.js';
import { PlayerGloveSystem } from './systems/PlayerGloveSystem.js';
import { PlayerGestureSystem } from './systems/PlayerGestureSystem.js';
import { FXSystem } from './systems/FXSystem.js';
import { DesertSystem } from './systems/DesertSystem.js';

installCrashTrap(); // headset playtests have no console — trap + persist crashes

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

World.create(container, {
  // The landing button calls IWSDK's explicit WebXR launcher from the user's
  // tap. Quest Browser needs that direct requestSession gesture path.
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: 'none',
  },
  // A stationary dodge game: no locomotion (you stay on your platform), no
  // grab system (the fireballs are bonded to your fists, not grabbed).
  features: {
    grabbing: false,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    // We light the scene ourselves (see setupEnvironment) and let passthrough
    // provide the backdrop, so the default sky is off.
    defaultLighting: false,
    // Far enough to render the optional desert's horizon mesas + sun disc when
    // that backdrop is switched on; harmless in bare AR (nothing's out there).
    far: 1600,
    camera: { position: [0, 1.6, 0] },
  },
}).then(async (world) => {
  initLeaderboard(); // anonymous profile + first board fetch
  initGazette(); // pull the day's Gasket Gazette for the lobby paper button
  setupEnvironment(world);
  buildArena(world);
  setupCombatants(world);

  // Body pose first so hitboxes are current for everything downstream.
  world.registerSystem(PlayerBodySystem);
  // Opponent drivers: exactly one of these writes the bus per bout.
  world.registerSystem(BotSystem);
  world.registerSystem(NetworkSystem);
  world.registerSystem(MeshSystem);
  world.registerSystem(OpponentSystem);
  // Aim Training: targets, scoring, return fire.
  world.registerSystem(TrainingSystem);
  // ARCADE campaign: the five-titan gauntlet (its own boss rig, telegraphed
  // attacks and HUD — GameStateSystem stands down for these bouts).
  world.registerSystem(CampaignSystem);
  // The guided basics tutorial — rides a bot bout, paces it with pop-ups. Runs
  // before FireballSystem so its command-bus tweaks land before the balls sim.
  world.registerSystem(TutorialSystem);
  // The fireballs themselves, then collision (so it sees final positions).
  world.registerSystem(FireballSystem);
  world.registerSystem(CollisionSystem);
  // Rim barrier damage, then the match brain + scoreboards.
  world.registerSystem(BoundarySystem);
  world.registerSystem(GameStateSystem);
  // Lobby menu, promotion celebration, hit vignette, gloves, transient FX.
  world.registerSystem(MenuSystem);
  world.registerSystem(PromotionSystem);
  world.registerSystem(PlayerFeedbackSystem);
  world.registerSystem(PlayerGloveSystem);
  world.registerSystem(PlayerGestureSystem);
  world.registerSystem(FXSystem);
  // The optional papercraft desert backdrop (off = bare AR passthrough).
  world.registerSystem(DesertSystem);

  const xrSupported = (await navigator.xr?.isSessionSupported(SessionMode.ImmersiveAR).catch(() => false)) === true;

  if (enterVrButton && xrSupported) {
    enterVrButton.removeAttribute('disabled');
    enterVrButton.addEventListener('click', () => {
      enterVrButton.setAttribute('disabled', '');
      enterMenuMusic(); // lobby music (unless muted last time) — within the gesture
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
        if (!world.session) enterVrButton.removeAttribute('disabled');
      }, 4000);
    });
  } else if (enterVrButton) {
    enterVrButton.textContent = 'XR unavailable';
  }

  // eslint-disable-next-line no-console
  console.info('[FIRE FIGHT] World ready — platforms set, fists hot.');
});
