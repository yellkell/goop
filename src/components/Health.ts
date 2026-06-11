/** Hit points for a boxer. */

import { createComponent, Types } from '@iwsdk/core';

export const Health = createComponent(
  'Health',
  {
    current: { type: Types.Float32, default: 100 },
    max: { type: Types.Float32, default: 100 },
  },
  'Hit points for a boxer.',
);
