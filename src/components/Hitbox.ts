/**
 * A spherical hit volume. `team` decides what can hurt it: a fireball only
 * damages hitboxes whose team differs from the ball's owner. `owner` points at
 * the entity holding the shared `Health` — so a multi-sphere body
 * (head/chest/pelvis) all drains one pool.
 */

import { createComponent, Types } from '@iwsdk/core';

export const HitboxKind = {
  Head: 0,
  Body: 1,
} as const;

export const Hitbox = createComponent(
  'Hitbox',
  {
    radius: { type: Types.Float32, default: 0.25 },
    team: { type: Types.Int32, default: 0 },
    /** Head hitboxes deal headshot damage; body hitboxes use ball damage. */
    kind: { type: Types.Int32, default: HitboxKind.Body },
    /** Entity carrying the Health this hitbox belongs to. */
    owner: { type: Types.Entity, default: null },
    /**
     * Damage multiplier — the ARCADE titans' weak-point law. 1 = a normal
     * body sphere (every human/bot hitbox); 0 = armour plate (the ball clanks
     * off, no damage); >1 = an exposed weak point (the vented core takes
     * double). When overlapping spheres catch one ball, the best wins.
     */
    damageScale: { type: Types.Float32, default: 1 },
  },
  'Spherical hit volume for collision.',
);
