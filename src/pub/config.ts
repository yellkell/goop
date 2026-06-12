/**
 * THE IRON TANKARD — layout + tunables for the pub social scene.
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
  // Room shell.
  halfWidth: 4.5, // x extent
  halfDepth: 3.0, // z extent
  ceiling: 2.45, // proper low pub ceiling — mind your head
  beamDrop: 0.16, // steel I-beams hang this far below the ceiling

  // Bar counter along the north wall.
  bar: {
    z: -2.35, // front face of the counter
    top: 1.05, // counter top height
    halfLength: 2.6, // runs x −2.6 … +2.6
    depth: 0.55,
  },

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

  glassCount: 8,
} as const;

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
