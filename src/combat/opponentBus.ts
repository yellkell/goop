/**
 * The opponent pose bus — shared, mutable snapshots of where the OTHER boxers
 * are RIGHT NOW, in LOCAL world coordinates (already placed at their platform).
 * Written by BotSystem (procedurally) or NetworkSystem (from pose packets);
 * read by OpponentSystem (avatars + hitboxes) and FireballSystem (anchors for
 * each other boxer's two balls).
 *
 * The classic duel has exactly one other boxer, so the original code used a
 * single `opponent` snapshot. Arcade 2v2 / FFA add up to three OTHER fighters
 * (allies in 2v2 count too — their avatars are rendered the same way), so the
 * bus is now an array of slots. `opponents[0]` is the primary rival — the
 * across-the-gap opponent in 1v1/2v2 — and the legacy `opponent` export is a
 * live alias to it, so every 1v1 reader/writer is unchanged.
 */

import { Quaternion, Vector3 } from 'three';

export interface OpponentPose {
  /** True while this other boxer (bot or remote) is live in the arena. */
  active: boolean;
  headPos: Vector3;
  headQuat: Quaternion;
  /** Index 0 = their left hand, 1 = their right hand. */
  handPos: [Vector3, Vector3];
  handQuat: [Quaternion, Quaternion];
  /** Their trigger-held flags — drives the orbit visual on their balls. */
  orbiting: [boolean, boolean];
  fisting: [boolean, boolean];
  /**
   * Their chosen avatar-accent hue (0..1), from their pose packets. -1 until a
   * packet arrives (or in bot bouts) → OpponentSystem keeps the team colour.
   */
  accentHue: number;
  /** Their avatar-accent lightness (0..1, 0.5 = neutral), from their pose packets. */
  accentLight: number;
}

/** Most OTHER boxers in any mode: FFA (3 rivals) and 2v2 (1 ally + 2 rivals). */
export const MAX_OPPONENTS = 3;

function makePose(): OpponentPose {
  return {
    active: false,
    headPos: new Vector3(0, 1.45, -3.4),
    headQuat: new Quaternion(),
    handPos: [new Vector3(-0.25, 1.1, -3.2), new Vector3(0.25, 1.1, -3.2)],
    handQuat: [new Quaternion(), new Quaternion()],
    orbiting: [false, false],
    fisting: [false, false],
    accentHue: -1,
    accentLight: 0.5,
  };
}

/** Pose slot per other boxer; slot i maps to roster slot i+1 of the active mode. */
export const opponents: OpponentPose[] = Array.from({ length: MAX_OPPONENTS }, makePose);

/**
 * Legacy alias for the primary rival (the across-the-gap opponent). Aliases
 * `opponents[0]` by reference, so all classic 1v1 reads/writes hit slot 0.
 */
export const opponent: OpponentPose = opponents[0];

/**
 * Commands for an other boxer's fireballs, queued by BotSystem / NetworkSystem
 * and drained each frame by FireballSystem. `slot` selects which other boxer
 * (index into `opponents`, default 0 = the primary rival), so a single command
 * type serves every mode.
 */
export type BallCommand =
  | { type: 'throw'; slot?: number; hand: 0 | 1; pos: Vector3; vel: Vector3 }
  /** Recall; `att`/`dmg`/`scl` carry a fired attachment (see protocol). */
  | { type: 'recall'; slot?: number; hand: 0 | 1; att?: number; dmg?: number; scl?: number }
  /** The other boxer's own sim reports their ball was spent (hit us / parried). */
  | { type: 'spend'; slot?: number; hand: 0 | 1 }
  /** A throwaway enemy ball (training targets' return fire). */
  | { type: 'transient'; pos: Vector3; vel: Vector3; damage: number };

export const ballCommands: BallCommand[] = [];
