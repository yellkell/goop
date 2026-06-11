/**
 * The opponent pose bus — one shared, mutable snapshot of where the other
 * boxer is RIGHT NOW, in LOCAL world coordinates (already mirrored across the
 * arena). Written by BotSystem (procedurally) or NetworkSystem (from pose
 * packets); read by OpponentSystem (avatar + hitboxes) and FireballSystem
 * (anchors for the opponent's two balls).
 */

import { Quaternion, Vector3 } from 'three';

export interface OpponentPose {
  /** True while an opponent (bot or remote) is live in the arena. */
  active: boolean;
  headPos: Vector3;
  headQuat: Quaternion;
  /** Index 0 = their left hand, 1 = their right hand. */
  handPos: [Vector3, Vector3];
  handQuat: [Quaternion, Quaternion];
  /** Their trigger-held flags — drives the orbit visual on their balls. */
  orbiting: [boolean, boolean];
}

export const opponent: OpponentPose = {
  active: false,
  headPos: new Vector3(0, 1.45, -3.4),
  headQuat: new Quaternion(),
  handPos: [new Vector3(-0.25, 1.1, -3.2), new Vector3(0.25, 1.1, -3.2)],
  handQuat: [new Quaternion(), new Quaternion()],
  orbiting: [false, false],
};

/**
 * Commands for the opponent's fireballs, queued by BotSystem / NetworkSystem
 * and drained each frame by FireballSystem.
 */
export type BallCommand =
  | { type: 'throw'; hand: 0 | 1; pos: Vector3; vel: Vector3 }
  | { type: 'recall'; hand: 0 | 1 }
  /** The opponent's own sim reports their ball was spent (hit us / parried). */
  | { type: 'spend'; hand: 0 | 1 }
  /** A throwaway enemy ball (training targets' return fire). */
  | { type: 'transient'; pos: Vector3; vel: Vector3; damage: number };

export const ballCommands: BallCommand[] = [];
