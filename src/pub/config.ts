/**
 * IRON BALLS PUB — layout + tunables for the pub social scene.
 *
 * One low-ceilinged steel boozer, roughly 9 m × 6 m, everything in metres
 * and world space (no mirroring — all twelve punters share one room):
 *
 *        z = -3  ───────────── BAR (north wall) ─────────────
 *          arcade │ taps & shelves          bar counter      │
 *          corner │                                          │ dartboard
 *        x = -4.5 │              open floor                  │ x = +4.5
 *                 │                                   oche ┊ │ (east wall)
 *          booth  │  booth        booth                      │
 *        z = +3  ────────────── (south wall) ────────────────
 */

import { PALETTE } from '../config.js';

// Room shell extents (also used inside PUB below — object literals can't
// self-reference). Stretched from 4.5×3.0 to fit more seating and a longer
// darts corridor.
const HALF_W = 5.2;
const HALF_D = 3.6;

export const PUB = {
  // Room shell (the pub proper; the fight hall hangs off its west wall).
  halfWidth: HALF_W, // x extent
  halfDepth: HALF_D, // z extent
  ceiling: 2.45, // proper low pub ceiling — mind your head
  beamDrop: 0.16, // steel I-beams hang this far below the ceiling

  // Bar counter along the north wall, pulled out far enough to leave a
  // working aisle behind it for the barkeep.
  bar: {
    z: -1.95, // front face of the counter
    top: 1.05, // counter top height
    halfLength: 2.6, // runs x −2.6 … +2.6
    depth: 0.55,
    aisleZ: -2.7, // the barkeep's rail, between counter back and shelf
  },

  /** Tap positions along the counter (x), used by the build and the barkeep. */
  tapXs: [-1.2, -0.4, 0.4, 1.2],

  // Dartboard on the east wall (standard: bull at 1.73 m, oche 2.37 m out).
  darts: {
    wallX: HALF_W,
    boardX: HALF_W - 0.04, // proud of the wall on its cabinet
    boardY: 1.73,
    boardZ: 0.6,
    boardRadius: 0.42, // oversized house board, filling its cork circle
    surroundRadius: 0.45, // cork blast zone around it
    ocheX: HALF_W - 0.04 - 2.37,
    rackSlots: 6,
  },

  /** The way you came in: a door on the south wall, west end. Teleport onto
   *  its mat and you're back at the FIRE FIGHT main menu. */
  exit: { x0: -4.8, x1: -4.0, height: 2.1 },

  // Open floor east of the banquette bank (the old spot is now furniture).
  spawn: { x: 1.3, y: 0, z: 0.8 },

  /** Glasses on the bar at opening time — they ALL start under the counter;
   *  the barkeep brings each one out between his other jobs. */
  glassStart: 0,
  /** …and the most he'll bring out (he restocks one at a time). */
  glassMax: 8,
  /** Seconds between the barkeep fetching a fresh glass from under the bar. */
  glassRestockInterval: 14,
  /** Seconds between a glass being announced and it landing on the bar —
   *  covers the barkeep's walk-and-place animation on every client. */
  glassDeliverDelay: 4,
} as const;

/**
 * The FIGHT HALL — a second room through the door in the pub's west wall,
 * with the full FIRE FIGHT duel on display: the two octagonal platforms from
 * the main game, claim consoles, and room for the whole pub to gather round.
 *
 * The invisible cage is pulled in to FIVE yards from each platform rim
 * (the arena uses ten) so the duel fits indoors.
 */
const CAGE_YARDS = 4.572; // 5 yards in metres
const HALL_CX = -12.5; // duel centreline (x) — pushed west so a spectator
// ring (the stands) fits all the way around the sunken pit
const PLATFORM_HALF_W = 0.86; // OCTAGON_HALF_WIDTH
const PLATFORM_HALF_D = 0.75; // OCTAGON_HALF_DEPTH

export const FIGHT = {
  centerX: HALL_CX,
  /** Platforms at z = ±platformZ — same 3.0 m gap as the arena. */
  platformZ: 1.5,
  platformThickness: 0.14,
  /** The duel floor is DUG IN: the cage rect drops this far below the hall
   *  floor, with bench stands around the rim — a little stadium. */
  pitDepth: 0.7,
  /** Ball-killing cage, 5 yards out from each platform rim. */
  cage: {
    minX: HALL_CX - PLATFORM_HALF_W - CAGE_YARDS,
    maxX: HALL_CX + PLATFORM_HALF_W + CAGE_YARDS,
    minZ: -1.5 - PLATFORM_HALF_D - CAGE_YARDS,
    maxZ: 1.5 + PLATFORM_HALF_D + CAGE_YARDS,
    ceiling: 4.2,
  },
  /** The hall shell: the sunken pit (cage rect) + a stands ring around it. */
  hall: { minX: -19.8, maxX: -PUB.halfWidth, minZ: -8.6, maxZ: 8.6, height: 4.6 },
  /** Doorway in the shared wall. */
  door: { z0: 0.4, z1: 1.8, height: 2.1 },
  /** Side claim consoles on the east stands (side 0 south/+z, side 1 north/−z). */
  consoles: [
    [-6.3, 0, 2.9],
    [-6.3, 0, -2.9],
  ] as [number, number, number][],
  /** How far a fighter's head may stray from their platform centre. */
  forfeitRadius: 1.35,
  startCountdown: 3, // seconds between both corners claimed and FIGHT
  hpMax: 100,
} as const;

/** Teleporting onto this mat (inside the pub, by the exit door) leaves the
 *  pub and returns to the FIRE FIGHT main menu. */
export const EXIT_ZONE = { minX: -4.8, maxX: -4.0, minZ: HALF_D - 0.55, maxZ: HALF_D - 0.08 };

/**
 * Where you may land a teleport (floor rectangles, walls implied between).
 * The fight hall is split into a RING around the sunken pit: spectators
 * roam the stands on every side, but the pit itself is invisible-walled —
 * fighters only get in via the claim consoles.
 */
export const TELEPORT_AREAS = [
  // Pub floor, this side of the bar.
  { minX: -(HALF_W - 0.2), maxX: HALF_W - 0.2, minZ: -1.85, maxZ: HALF_D - 0.08 },
  // The doorway strip.
  { minX: -(HALF_W + 0.15), maxX: -(HALF_W - 0.3), minZ: FIGHT.door.z0, maxZ: FIGHT.door.z1 },
  // The fight hall stands — four strips wrapped around the pit (cage rect).
  { minX: FIGHT.hall.minX + 0.3, maxX: FIGHT.cage.minX - 0.15, minZ: FIGHT.hall.minZ + 0.3, maxZ: FIGHT.hall.maxZ - 0.3 },
  { minX: FIGHT.cage.maxX + 0.15, maxX: FIGHT.hall.maxX, minZ: FIGHT.hall.minZ + 0.3, maxZ: FIGHT.hall.maxZ - 0.3 },
  { minX: FIGHT.cage.minX - 0.15, maxX: FIGHT.cage.maxX + 0.15, minZ: FIGHT.hall.minZ + 0.3, maxZ: FIGHT.cage.minZ - 0.15 },
  { minX: FIGHT.cage.minX - 0.15, maxX: FIGHT.cage.maxX + 0.15, minZ: FIGHT.cage.maxZ + 0.15, maxZ: FIGHT.hall.maxZ - 0.3 },
];

export const TELEPORT = {
  engage: 0.5, // thumbstick magnitude that starts aiming
  release: 0.35, // …and below this on the way back, you go
  launchSpeed: 7.5, // m/s along the controller ray
  gravity: 9.8,
  arcPoints: 48,
  arcStep: 0.035, // seconds of simulated flight per arc sample
};

/** Pint glass dimensions — used by the mesh, stacking and physics alike. */
export const GLASS = {
  radiusTop: 0.042,
  radiusBottom: 0.034,
  height: 0.15,
  /** Vertical offset when stacked on another glass (they nest a little). */
  stackRise: 0.12,
  /** Max XZ distance for a settling glass to snap onto one below. */
  stackSnap: 0.07,
};

/** Shared-prop physics (owner-side simulation). */
export const PROP_PHYS = {
  gravity: 9.8,
  maxThrowSpeed: 16, // m/s cap on release velocity
  restitution: 0.32, // glass bounce energy retention
  settleSpeed: 0.6, // below this on contact a glass settles
  dartMaxSpeed: 18,
  dartStuckLifetime: 6, // seconds a dart stays in the board
  dartFadeTime: 0.5,
  streamHz: 20, // owner transform stream rate
};

/** Horizontal surfaces glasses can land on: y top + XZ bounds. */
export interface Surface {
  y: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const SURFACES: Surface[] = [
  // Bar counter top.
  {
    y: PUB.bar.top,
    minX: -PUB.bar.halfLength,
    maxX: PUB.bar.halfLength,
    minZ: PUB.bar.z - PUB.bar.depth,
    maxZ: PUB.bar.z,
  },
  // Booth tables (kept in sync with environment.ts buildBooth calls).
  { y: 0.78, minX: -3.45, maxX: -2.55, minZ: HALF_D - 1.15, maxZ: HALF_D - 0.25 },
  { y: 0.78, minX: -0.45, maxX: 0.45, minZ: HALF_D - 1.15, maxZ: HALF_D - 0.25 },
  { y: 0.78, minX: 2.55, maxX: 3.45, minZ: HALF_D - 1.15, maxZ: HALF_D - 0.25 },
  // The banquette-bank tables (environment.ts buildBanquetteBank: spine at
  // x -1.5 / z 1.4, tables at x ±0.8 off centre, z ±0.78 off the spine).
  { y: 0.78, minX: -2.65, maxX: -1.95, minZ: 0.395, maxZ: 0.845 },
  { y: 0.78, minX: -1.05, maxX: -0.35, minZ: 0.395, maxZ: 0.845 },
  { y: 0.78, minX: -2.65, maxX: -1.95, minZ: 1.955, maxZ: 2.405 },
  { y: 0.78, minX: -1.05, maxX: -0.35, minZ: 1.955, maxZ: 2.405 },
];

/** Accent colours cycled by join order — distinct fire tints per punter. */
export const ACCENTS = [
  PALETTE.ember, // orange — same as your fire in the main game
  PALETTE.coolFlame, // blue
  0x7dff5a, // green
  0xff4fd8, // magenta
  PALETTE.amber, // hazard amber
  0x9f7bff, // violet
  0x4dffc8, // teal
  PALETTE.danger, // red
  0xf4f6fb, // white-hot
  0x5a8cff, // cobalt
  0xffe04d, // gold
  0xff8c5a, // copper
];

/** The hosted pub relay (Render). Override per-session with ?server=… or by
 *  setting localStorage 'ibb-pub-server'. */
export const PUB_SERVER = 'wss://iron-balls-pub.onrender.com';

/** Resolve the pub server URL: ?server= param > localStorage > local dev
 *  server > the hosted Render relay. */
export function pubServerUrl(): string {
  const param = new URLSearchParams(location.search).get('server');
  if (param) return param;
  const stored = localStorage.getItem('ibb-pub-server');
  if (stored) return stored;
  // On your own machine, talk to a pub server running locally; anywhere
  // else (Firebase Hosting, yellkell.com/ff) use the hosted relay.
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return `ws://${host}:8788`;
  return PUB_SERVER;
}
