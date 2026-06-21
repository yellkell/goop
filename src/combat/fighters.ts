/**
 * Small runtime lookups over the active mode's fighter roster. Kept apart from
 * config.ts (which must not import app state) so both gameplay systems and the
 * bot can ask "what team is fighter N on right now?" without a cycle.
 */

import { app } from '../menu/appState.js';
import { MODE_LAYOUT } from '../config.js';

/** Team of a fighter slot in the live bout (0 = your team). */
export function fighterTeam(slot: number): number {
  const seat = MODE_LAYOUT[app.arcade][slot];
  return seat ? seat.team : slot === 0 ? 0 : 1;
}

/** Slots present in the live bout, e.g. [0,1] for 1v1, [0,1,2,3] for FFA. */
export function activeSlots(): number[] {
  return MODE_LAYOUT[app.arcade].map((_, slot) => slot);
}
