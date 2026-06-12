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

export const PUB = {
  // Room shell (the pub proper; the fight hall hangs off its west wall).
  halfWidth: 4.5, // x extent
  halfDepth: 3.0, // z extent
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
    wallX: 4.5,
    boardX: 4.46, // proud of the wall on its cabinet
    boardY: 1.73,
    boardZ: 0.6,
    boardRadius: 0.2255, // regulation 451 mm board
    surroundRadius: 0.45, // cork blast zone around it
    ocheX: 4.46 - 2.37,
    rackSlots: 6,
  },

  spawn: { x: -0.5, y: 0, z: 1.6 },

  /** Glasses on the bar at opening time… */
  glassStart: 8,
  /** …and the most the barkeep will bring out (he restocks one at a time). */
  glassMax: 15,
  /** Seconds between the barkeep fetching a fresh glass from the back. */
  glassRestockInterval: 25,
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
const HALL_CX = -10.25; // duel centreline (x)
const PLATFORM_HALF_W = 0.86; // OCTAGON_HALF_WIDTH
const PLATFORM_HALF_D = 0.75; // OCTAGON_HALF_DEPTH

export const FIGHT = {
  centerX: HALL_CX,
  /** Platforms at z = ±platformZ — same 3.0 m gap as the arena. */
  platformZ: 1.5,
  platformThickness: 0.14,
  /** Ball-killing cage, 5 yards out from each platform rim. */
  cage: {
    minX: HALL_CX - PLATFORM_HALF_W - CAGE_YARDS,
    maxX: HALL_CX + PLATFORM_HALF_W + CAGE_YARDS,
    minZ: -1.5 - PLATFORM_HALF_D - CAGE_YARDS,
    maxZ: 1.5 + PLATFORM_HALF_D + CAGE_YARDS,
    ceiling: 4.2,
  },
  /** The hall shell, wrapped just outside the cage. */
  hall: { minX: -16, maxX: -PUB.halfWidth, minZ: -7, maxZ: 7, height: 4.6 },
  /** Doorway in the shared wall (x = -4.5). */
  door: { z0: 0.4, z1: 1.8, height: 2.1 },
  /** Side claim consoles (side 0 south/+z, side 1 north/−z), facing the door. */
  consoles: [
    [-6.6, 0, 2.9],
    [-6.6, 0, -2.9],
  ] as [number, number, number][],
  /** How far a fighter's head may stray from their platform centre. */
  forfeitRadius: 1.35,
  startCountdown: 3, // seconds between both corners claimed and FIGHT
  hpMax: 100,
} as const;

/** Where you may land a teleport (floor rectangles, walls implied between). */
export const TELEPORT_AREAS = [
  // Pub floor, this side of the bar.
  { minX: -4.3, maxX: 4.3, minZ: -1.85, maxZ: 2.8 },
  // The doorway strip.
  { minX: -4.65, maxX: -4.2, minZ: FIGHT.door.z0, maxZ: FIGHT.door.z1 },
  // The fight hall.
  { minX: FIGHT.hall.minX + 0.3, maxX: FIGHT.hall.maxX, minZ: FIGHT.hall.minZ + 0.3, maxZ: FIGHT.hall.maxZ - 0.3 },
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
  { y: 0.78, minX: -3.45, maxX: -2.55, minZ: 1.85, maxZ: 2.75 },
  { y: 0.78, minX: -0.45, maxX: 0.45, minZ: 1.85, maxZ: 2.75 },
  { y: 0.78, minX: 2.55, maxX: 3.45, minZ: 1.85, maxZ: 2.75 },
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

/** Resolve the pub server URL: ?server= param > localStorage > same host. */
export function pubServerUrl(): string {
  const param = new URLSearchParams(location.search).get('server');
  if (param) return param;
  const stored = localStorage.getItem('ibb-pub-server');
  if (stored) return stored;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:8788`;
}
