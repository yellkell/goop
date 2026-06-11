/**
 * Iron Balls Boxing tunables — the game is FIRE FIGHT: bare-knuckle boxing at
 * a distance with flaming iron balls. Numbers the gameplay feel depends on
 * live here so they are easy to find and adjust. Dimensions are in metres and
 * follow the Blaston "Play Space Dimensions" layout — two octagonal platforms
 * facing each other — pulled slightly CLOSER together for that in-your-face
 * boxing feel.
 *
 * The fantasy: two flaming iron balls orbit your fists while you hold the
 * triggers; you whip a punch to hurl one at your opponent, and a trigger pull
 * calls it roaring back to your hand.
 */

import type { Vector2Tuple } from 'three';

export const GAME_TITLE = 'FIRE FIGHT';

/**
 * The player's octagonal dodge box, same footprint as Blaston's play-space
 * diagram: overall ~1.72 m wide x 1.5 m deep, with a 0.75 m straight
 * front/back edge and ~0.6 m chamfered corners. Vertices are listed clockwise
 * in the floor plane (x = left/right, z = forward/back, -z faces the opponent).
 */
export const OCTAGON_HALF_WIDTH = 0.86; // 1.72 m / 2
export const OCTAGON_HALF_DEPTH = 0.75; // 1.5 m / 2
const EDGE_HALF = 0.375; // half of the 0.75 m straight edge
const CHAMFER = 0.375; // corner inset, giving ~0.6 m diagonal segments

/** Octagon outline (clockwise), centred on the player rig at the origin. */
export const OCTAGON_VERTICES: Vector2Tuple[] = [
  [-EDGE_HALF, -OCTAGON_HALF_DEPTH], // front-left
  [EDGE_HALF, -OCTAGON_HALF_DEPTH], // front-right
  [OCTAGON_HALF_WIDTH, -CHAMFER], // right-front chamfer
  [OCTAGON_HALF_WIDTH, CHAMFER], // right-back chamfer
  [EDGE_HALF, OCTAGON_HALF_DEPTH], // back-right
  [-EDGE_HALF, OCTAGON_HALF_DEPTH], // back-left
  [-OCTAGON_HALF_WIDTH, CHAMFER], // left-back chamfer
  [-OCTAGON_HALF_WIDTH, -CHAMFER], // left-front chamfer
];

/**
 * Distance between the two pads, centre to centre. Blaston sits around 3.8 m;
 * boxing wants you closer, so the gap is tightened — punches connect faster
 * and dodges get twitchier.
 */
export const ARENA_GAP = 3.4;

/**
 * The fireball — the whole game. Two per player, one bonded to each fist.
 *
 *  - Hold the trigger and the ball ORBITS your fist, roaring hot.
 *  - Release the trigger mid-punch and it FLIES along your swing.
 *  - Pull the trigger while it's away and it RETURNS to your hand.
 */
export const FIREBALL = {
  radius: 0.09, // iron core radius (also the collision radius)
  damage: 12, // damage per landed hit

  // Orbit (trigger held): the ball circles the fist.
  orbitRadius: 0.17, // distance from the fist while orbiting
  orbitSpeedMin: 6.0, // rad/s when the orbit starts
  orbitSpeedMax: 13.0, // rad/s after fully spun up
  orbitSpinUp: 1.2, // seconds of trigger-hold to reach max orbit speed

  // Hover (idle): the ball floats just over your knuckles.
  hoverOffset: [0, 0.05, -0.09] as [number, number, number], // grip-local
  hoverLerp: 14, // exponential smoothing rate toward the hover anchor

  // Throw (trigger released during a punch).
  minPunchSpeed: 1.1, // hand speed (m/s) below which a release just hovers
  throwSpeedMin: 4.2, // slowest launch — readable and dodgeable, Blaston-style
  throwSpeedMax: 8.5, // a genuinely fast haymaker
  punchGain: 1.7, // hand speed → ball speed multiplier
  aimAssist: 0.4, // 0..1 blend of your swing direction toward the opponent
  gravity: 1.1, // gentle arc so throws feel thrown, not shot
  lifetime: 3.0, // seconds of flight before the ball dies out

  // Recall (trigger pulled while the ball is away).
  returnSpeed: 9.5, // homing speed back to the fist
  catchRadius: 0.16, // how close counts as "back in hand"
  nearHandRadius: 0.35, // trigger within this of the ball = orbit, not recall

  // Defence: an orbiting or returning ball of YOURS knocks an incoming
  // enemy ball out of the air on contact.
  deflectBonus: 0.05, // extra contact radius for the parry check
};

/** Combat tuning: health pools shared by the IK body parts. */
export const COMBAT = {
  playerHealth: 100,
};

/**
 * Head-driven IK body. The hitbox is not one sphere — it is a spine solved
 * each frame from the tracked head down to pinned hips, with three hitbox
 * spheres along it. Leaning/ducking the head swings the torso, so dodging is
 * a whole-body act. Radii in metres; `hipHeight` is the pinned pelvis height.
 */
export const BODY_IK = {
  hipHeight: 0.95,
  /** Fraction along hips→head where the chest sphere sits. */
  chestAlong: 0.55,
  headRadius: 0.13,
  chestRadius: 0.2,
  pelvisRadius: 0.17,
};

/** The practice bot: an iron boxer that bobs, weaves and throws fireballs. */
export const BOT = {
  headY: 1.45, // relaxed head height
  headYMin: 1.0, // deepest duck
  headYMax: 1.62, // tallest stand
  padHalfWidth: 0.7, // lateral roaming range on its pad
  moveSpeed: 1.5, // m/s strafe
  duckSpeed: 2.0, // m/s vertical bob
  reactDistance: 1.5, // dodges your ball inside this range
  throwInterval: 2.3, // seconds between throws (alternates hands)
  windup: 0.7, // orbit/wind-up time before the ball leaves
  throwSpeed: 4.4, // a touch slower than yours → readable and dodgeable
  damage: 10,
  aimError: 0.16, // metres of aim slop at the target
  recallDelay: 1.4, // seconds after a throw before it recalls the ball
};

/** Match format: best-of rounds, Blaston-style pacing. */
export const MATCH = {
  roundTime: 60, // seconds per round
  winTarget: 3, // first to N round wins takes the match
  roundOverDelay: 3, // pause after a round
  matchOverDelay: 6, // pause after the match before returning to the lobby
};

/** The visible platform slab under each boxer. */
export const PLATFORM = {
  thickness: 0.14, // slab depth below the floor line — reads as a pedestal
  rimLift: 0.012, // neon rim line height above the floor
};

/**
 * The rim barrier — your platform's guardian. Translucent walls fade in as
 * your head nears the rim; lean your head out past it and the fire of the
 * arena eats your health FAST. Stay on your platform.
 */
export const BOUNDARY = {
  wallHeight: 1.5, // barrier wall height above the platform
  warnDistance: 0.3, // walls start glowing when the head is this close (m)
  drainPerSec: 28, // hp/s while your head is outside the rim
  graceDepth: 0.06, // head may poke this far past the rim before draining
};

/** Aim Training: pop-up targets across the gap; optionally they shoot back. */
export const TRAINING = {
  sessionTime: 90, // seconds per training run
  spawnInterval: 1.6, // base seconds between target pops (speeds up)
  minInterval: 0.75, // fastest spawn cadence at full ramp
  rampTime: 60, // seconds to ramp from base to fastest
  maxLive: 4, // most targets up at once
  holdTime: 2.6, // seconds a target stays up before retreating
  discRadius: 0.18, // bullseye disc hit radius
  cutoutRadius: 0.24, // humanoid cutout chest hit radius
  discPoints: 100,
  cutoutPoints: 150,
  streakBonus: 25, // extra points per current streak step
  // Shoot-back: cutouts hurl a blue ball at you while they're up.
  shootChance: 0.55, // chance a cutout takes its shot
  shootDelay: 0.7, // aim time before it fires
  shotSpeed: 4.0,
  shotDamage: 8,
  regenDelay: 2.5, // seconds after damage before training regen kicks in
  regenPerSec: 9, // training-only health regen
};

/** Networking. The relay server lives in /server (npm run server). */
export const NET = {
  poseRateHz: 20, // pose packets per second
  stateRateHz: 2, // host match-state echoes per second
  smoothing: 18, // exponential smoothing rate for the remote avatar
  /** ws:// URL — override with ?server=wss://host:port, else localStorage. */
  defaultPort: 8787,
};

/** Resolve the relay server URL: ?server= param > localStorage > same host. */
export function serverUrl(): string {
  const param = new URLSearchParams(location.search).get('server');
  if (param) return param;
  const stored = localStorage.getItem('ibb-server');
  if (stored) return stored;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:${NET.defaultPort}`;
}

/**
 * Fire palette. YOUR fire burns orange; THEIR fire burns blue — instantly
 * readable in the heat of a duel.
 */
export const PALETTE = {
  ember: 0xff7a18, // your fire
  flame: 0xffc04d,
  whiteHot: 0xfff3cf,
  coolFlame: 0x4fb7ff, // their fire
  coolCore: 0x9fe2ff,
  danger: 0xe8352a,
  iron: 0x3a3d46,
  charcoal: 0x191b22,
  white: 0xf4f6fb,
};

/** Team → fire tint: 0 = you (orange), 1 = opponent (blue). */
export function teamColor(team: number): number {
  return team === 0 ? PALETTE.ember : PALETTE.coolFlame;
}
