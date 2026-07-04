/**
 * Small runtime lookups over the active bout's LOCAL fighter roster (me at
 * index 0; see combat/layout.ts). Kept apart from config.ts (which must not
 * import app state) so gameplay systems and the bot can ask "what team is
 * fighter N on right now?" without a cycle.
 */

import { localLayout } from './layout.js';

/** Team of a fighter slot in the live bout (0 = your team). */
export function fighterTeam(slot: number): number {
  return localLayout()[slot]?.team ?? (slot === 0 ? 0 : 1);
}

/** Slots present in the live bout, e.g. [0,1] for 1v1, [0,1,2,3] for FFA. */
export function activeSlots(): number[] {
  return localLayout().map((_, slot) => slot);
}
