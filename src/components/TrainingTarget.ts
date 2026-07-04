/**
 * A pop-up target in Aim Training: a classic bullseye disc or a humanoid
 * cutout. Targets rise from below the gap, hold, then sink away. Cutouts can
 * shoot back when the option is on. `TrainingSystem` drives the lifecycle;
 * `CollisionSystem` lands your fireballs on them.
 */

import { createComponent, Types } from '@iwsdk/core';

export const TargetKind = {
  Disc: 0,
  Cutout: 1,
  /** The last-30-seconds bonus target: a small strafing gold OCTA plate
   *  (pub octa-hunt style) worth a jackpot. */
  Drone: 2,
} as const;

export const TargetState = {
  Rising: 0,
  Holding: 1,
  Leaving: 2, // timed out — sinks away, breaks your streak
  Falling: 3, // hit! topples over, then despawns
} as const;

export const TrainingTarget = createComponent(
  'TrainingTarget',
  {
    kind: { type: Types.Int32, default: 0 },
    state: { type: Types.Int32, default: 0 },
    /** Seconds in the current state. */
    age: { type: Types.Float32, default: 0 },
    /** Seconds it stays up before leaving. */
    holdTime: { type: Types.Float32, default: 2.6 },
    /** Hit radius of the scoring zone (disc face / cutout chest). */
    radius: { type: Types.Float32, default: 0.18 },
    /** Fully-risen base height of the scoring zone centre. */
    upY: { type: Types.Float32, default: 1.3 },
    /** Cutout shoot-back: <0 = won't shoot, else countdown while holding. */
    shootTimer: { type: Types.Float32, default: -1 },
    /** Drone strafing: the anchor X it oscillates around… */
    baseX: { type: Types.Float32, default: 0 },
    /** …the strafe half-range in metres (0 = a static target)… */
    driftAmp: { type: Types.Float32, default: 0 },
    /** …and the strafe rate in rad/s. */
    driftRate: { type: Types.Float32, default: 0 },
  },
  'A pop-up Aim Training target.',
);
