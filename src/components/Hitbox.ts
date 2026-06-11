/**
 * A spherical hit volume. `team` decides what can hurt it: a fireball only
 * damages hitboxes whose team differs from the ball's owner. `owner` points at
 * the entity holding the shared `Health` — so a multi-sphere body
 * (head/chest/pelvis) all drains one pool.
 */

import { createComponent, Types } from '@iwsdk/core';

export const Hitbox = createComponent(
  'Hitbox',
  {
    radius: { type: Types.Float32, default: 0.25 },
    team: { type: Types.Int32, default: 0 },
    /** Entity carrying the Health this hitbox belongs to. */
    owner: { type: Types.Entity, default: null },
  },
  'Spherical hit volume for collision.',
);
