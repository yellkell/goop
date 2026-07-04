/**
 * Tags an entity as one segment of the player's IK-solved body.
 * `PlayerBodySystem` positions each segment every frame from the head pose.
 */

import { createComponent, Types } from '@iwsdk/core';

export const BodyPart = {
  Head: 0,
  Chest: 1,
  Pelvis: 2,
} as const;

export const PlayerBodyPart = createComponent(
  'PlayerBodyPart',
  {
    /** 0 = head, 1 = chest, 2 = pelvis (see BodyPart). */
    part: { type: Types.Int32, default: 0 },
  },
  'A segment of the IK-solved player body.',
);
