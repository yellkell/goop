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

import { SessionMode, World } from '@iwsdk/core';
import { initLeaderboard } from './net/leaderboard.js';
import { buildArena } from './arena/arena.js';
import { setupEnvironment } from './arena/environment.js';
import { setupCombatants } from './combat/setup.js';
import { PlayerBodySystem } from './systems/PlayerBodySystem.js';
import { OpponentSystem } from './systems/OpponentSystem.js';
import { BotSystem } from './systems/BotSystem.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { TrainingSystem } from './systems/TrainingSystem.js';
import { FireballSystem } from './systems/FireballSystem.js';
import { CollisionSystem } from './systems/CollisionSystem.js';
import { BoundarySystem } from './systems/BoundarySystem.js';
import { GameStateSystem } from './systems/GameStateSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';
import { PlayerFeedbackSystem } from './systems/PlayerFeedbackSystem.js';
import { PlayerGloveSystem } from './systems/PlayerGloveSystem.js';
import { PlayerGestureSystem } from './systems/PlayerGestureSystem.js';
import { FXSystem } from './systems/FXSystem.js';
import { DesertSystem } from './systems/DesertSystem.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const enterVrSlot = document.getElementById('enter-vr-slot') as HTMLDivElement | null;
const xrOfferPattern = /\b(enter|start|launch)\b.*\b(ar|vr|xr)\b|\b(ar|vr|xr)\b.*\b(enter|start|launch)\b/i;
const originalXrOfferStyles = new Map<HTMLElement | SVGElement, string | null>();
const wiredXrOffers = new WeakSet<HTMLElement>();

function collectXrOfferCandidates(): HTMLElement[] {
  const roots: Array<Document | ShadowRoot> = [document];

  document.querySelectorAll<HTMLElement>('*').forEach((element) => {
    if (element.shadowRoot) roots.push(element.shadowRoot);
  });

  return roots.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>('button, a, [role="button"]')));
}

function getElementLabel(element: HTMLElement): string {
  return `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`;
}

function isNativeXrOffer(element: HTMLElement): boolean {
  return !element.closest('#landing') && xrOfferPattern.test(getElementLabel(element));
}

function findNativeXrOffer(): HTMLElement | null {
  return collectXrOfferCandidates().find(isNativeXrOffer) ?? null;
}

function rememberStyle(element: HTMLElement | SVGElement): void {
  if (!originalXrOfferStyles.has(element)) {
    originalXrOfferStyles.set(element, element.getAttribute('style'));
  }
}

function applyStyles(element: HTMLElement | SVGElement, styles: Partial<CSSStyleDeclaration>): void {
  rememberStyle(element);
  Object.assign(element.style, styles);
}

function restoreNativeXrOfferStyles(): void {
  originalXrOfferStyles.forEach((style, element) => {
    if (style === null) {
      element.removeAttribute('style');
    } else {
      element.setAttribute('style', style);
    }
  });
  originalXrOfferStyles.clear();
}

function handleNativeXrOfferClick(): void {
  document.body.classList.add('app-entered');
  window.setTimeout(() => {
    restoreNativeXrOfferStyles();
    nativeXrOfferObserver.disconnect();
    window.removeEventListener('resize', syncNativeXrOffer);
  }, 250);
}

function wireNativeXrOffer(offer: HTMLElement): void {
  if (wiredXrOffers.has(offer)) return;

  wiredXrOffers.add(offer);
  offer.addEventListener('click', handleNativeXrOfferClick, { capture: true });
}

function syncNativeXrOffer(): void {
  if (!enterVrSlot || document.body.classList.contains('app-entered')) return;

  const offer = findNativeXrOffer();
  if (!offer) return;

  const root = offer.getRootNode();
  const host = root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
  const frame = offer.closest('div');
  const rect = enterVrSlot.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  if (host) {
    applyStyles(host, {
      visibility: 'visible',
    });
  }

  if (frame) {
    applyStyles(frame, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      zIndex: '1001',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0',
      padding: '0',
      border: '0',
      borderRadius: '8px',
      background: 'transparent',
      boxSizing: 'border-box',
      pointerEvents: 'all',
      transform: 'none',
      transition: 'none',
      visibility: 'visible',
    });

    Array.from(frame.children).forEach((child) => {
      if (child instanceof SVGElement) {
        applyStyles(child, { display: 'none' });
      }
    });
  }

  offer.textContent = 'ENTER VR';
  offer.setAttribute('aria-label', 'Enter VR');
  applyStyles(offer, {
    width: '100%',
    height: '100%',
    minWidth: '0',
    minHeight: '0',
    padding: '0 34px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '8px',
    boxSizing: 'border-box',
    color: '#120906',
    background: 'linear-gradient(180deg, #ffb35c 0%, #f25b24 100%)',
    boxShadow: '0 18px 48px rgba(242, 91, 36, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    font: '900 1.08rem/1 system-ui, -apple-system, sans-serif',
    letterSpacing: '0.12em',
    pointerEvents: 'all',
    textTransform: 'uppercase',
  });

  wireNativeXrOffer(offer);
}

const nativeXrOfferObserver = new MutationObserver(syncNativeXrOffer);
nativeXrOfferObserver.observe(document.body, { childList: true, subtree: true });
window.addEventListener('resize', syncNativeXrOffer);
requestAnimationFrame(syncNativeXrOffer);
window.setTimeout(syncNativeXrOffer, 500);
window.setTimeout(syncNativeXrOffer, 1500);

World.create(container, {
  // Offer an immersive-AR (passthrough) session as soon as the page is
  // interacted with — FIRE FIGHT plays in your real room.
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: 'always',
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
}).then((world) => {
  initLeaderboard(); // anonymous profile + first board fetch
  setupEnvironment(world);
  buildArena(world);
  setupCombatants(world);

  // Body pose first so hitboxes are current for everything downstream.
  world.registerSystem(PlayerBodySystem);
  // Opponent drivers: exactly one of these writes the bus per bout.
  world.registerSystem(BotSystem);
  world.registerSystem(NetworkSystem);
  world.registerSystem(OpponentSystem);
  // Aim Training: targets, scoring, return fire.
  world.registerSystem(TrainingSystem);
  // The fireballs themselves, then collision (so it sees final positions).
  world.registerSystem(FireballSystem);
  world.registerSystem(CollisionSystem);
  // Rim barrier damage, then the match brain + scoreboards.
  world.registerSystem(BoundarySystem);
  world.registerSystem(GameStateSystem);
  // Lobby menu, hit vignette, gloves, transient FX + fire particle pools.
  world.registerSystem(MenuSystem);
  world.registerSystem(PlayerFeedbackSystem);
  world.registerSystem(PlayerGloveSystem);
  world.registerSystem(PlayerGestureSystem);
  world.registerSystem(FXSystem);
  // The optional papercraft desert backdrop (off = bare AR passthrough).
  world.registerSystem(DesertSystem);

  // eslint-disable-next-line no-console
  console.info('[FIRE FIGHT] World ready — platforms set, fists hot.');
});
