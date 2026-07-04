/**
 * Marks a boxer (holds the shared Health). `team` decides who can hurt whom
 * (0 = your team). `slot` identifies the individual fighter — 0 is always the
 * local player, 1..3 are the other boxers and index `opponents[slot-1]` on the
 * pose bus. In the classic duel slot/team line up (you 0/0, rival 1/1); arcade
 * 2v2 puts two fighters per team, and FFA gives every slot its own team.
 * `active` is 1 while this fighter is in the current bout's roster.
 */

import { createComponent, Types } from '@iwsdk/core';

export const Combatant = createComponent(
  'Combatant',
  {
    team: { type: Types.Int32, default: 0 },
    slot: { type: Types.Int32, default: 0 },
    active: { type: Types.Int32, default: 1 },
  },
  'A boxer in the bout (you, an ally or an opponent).',
);
