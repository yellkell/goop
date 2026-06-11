/** Marks a boxer (holds the shared Health). team 0 = you, 1 = the opponent. */

import { createComponent, Types } from '@iwsdk/core';

export const Combatant = createComponent(
  'Combatant',
  {
    team: { type: Types.Int32, default: 0 },
  },
  'A boxer in the duel (you or the opponent).',
);
