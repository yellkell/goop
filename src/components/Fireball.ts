/**
 * One of the four flaming iron balls in a duel (two per boxer, one per fist).
 * `FireballSystem` runs the state machine; `CollisionSystem` reads FLYING
 * balls for hits and ORBIT/RETURNING balls for parries.
 */

import { createComponent, Types } from '@iwsdk/core';

export const BallState = {
  /** Floating quietly over the knuckles, waiting. */
  Hover: 0,
  /** Trigger held: roaring orbit around the fist. */
  Orbit: 1,
  /** Punched: ballistic flight toward the other boxer. */
  Flying: 2,
  /** Recalled: homing back to its fist. */
  Returning: 3,
  /** Spent: burnt out on the floor until recalled. */
  Dead: 4,
} as const;

export const Fireball = createComponent(
  'Fireball',
  {
    /** Which fist owns it: 0 = left, 1 = right. */
    hand: { type: Types.Int32, default: 0 },
    /** Whose ball: 0 = the local player, 1 = the opponent (bot or remote). */
    owner: { type: Types.Int32, default: 0 },
    /** BallState — see above. */
    state: { type: Types.Int32, default: 0 },
    /** World-space velocity in m/s (Flying / Dead fall). */
    velocity: { type: Types.Vec3, default: [0, 0, 0] as [number, number, number] },
    /** Orbit angle in radians. */
    phase: { type: Types.Float32, default: 0 },
    /** Seconds the trigger has been held in orbit (spins the orbit up). */
    spin: { type: Types.Float32, default: 0 },
    /** Seconds in flight (lifetime check). */
    elapsed: { type: Types.Float32, default: 0 },
    /** Smoothed shader heat, 0 (cold iron) .. ~1.5 (white-hot). */
    heat: { type: Types.Float32, default: 0.8 },
    damage: { type: Types.Float32, default: 20 },
    radius: { type: Types.Float32, default: 0.09 },
    /**
     * 1 = a throwaway ball (training targets' return fire): it is destroyed
     * when spent instead of falling Dead and being recallable.
     */
    transient: { type: Types.Int32, default: 0 },
    /**
     * 1 once this ball has connected during its CURRENT return flight — a
     * recalled ball that passes through a body or target counts as a hit,
     * but only once per recall. Cleared whenever a return starts.
     */
    returnHit: { type: Types.Int32, default: 0 },
  },
  'A flaming iron ball bonded to one fist.',
);
