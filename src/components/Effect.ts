/**
 * A transient visual effect (flash, ember shard, shockwave ring).
 * `FXSystem` animates these by `kind` and destroys them at end of life.
 */

import { createComponent, Types } from '@iwsdk/core';

export const EffectKind = {
  Flash: 0, // grow + fade (impact pop)
  Shard: 1, // ballistic ember chunk: move + gravity + shrink + fade
  Ring: 2, // expanding additive shockwave ring
} as const;

export const Effect = createComponent(
  'Effect',
  {
    kind: { type: Types.Int32, default: 0 },
    age: { type: Types.Float32, default: 0 },
    life: { type: Types.Float32, default: 0.3 },
    /** Shard velocity (m/s). */
    velocity: { type: Types.Vec3, default: [0, 0, 0] as [number, number, number] },
    /** Base scale captured at spawn. */
    baseScale: { type: Types.Float32, default: 1 },
    spin: { type: Types.Float32, default: 0 },
  },
  'A transient visual effect.',
);
