/**
 * Bronze→Overlord progression: turn a cumulative XP total into a tier (for the
 * rank badge) and price each mode's XP award. Pure functions over PROGRESSION;
 * the XP total itself lives on the player profile (see net/leaderboard.ts).
 */

import { PROGRESSION } from '../config.js';

export interface TierInfo {
  name: string;
  /** 0-based tier index (0 = Bronze) — also the badge index in assets/ranks. */
  index: number;
  floor: number;
  next: number | null;
  /** Progress through the current tier, 0..1 (1 at the top tier). */
  progress: number;
}

export function tierForXp(xp: number): TierInfo {
  const tiers = PROGRESSION.tiers;
  let index = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (xp >= tiers[i].xp) index = i;
    else break;
  }
  const floor = tiers[index].xp;
  const next = index + 1 < tiers.length ? tiers[index + 1].xp : null;
  const progress = next === null ? 1 : (xp - floor) / (next - floor);
  return { name: tiers[index].name, index, floor, next, progress };
}

/** Flat XP for completing an Aim Training run (the score sets the board best,
 *  not the XP). */
export function xpForTraining(): number {
  return PROGRESSION.trainingRun;
}

/** XP for a finished real 1v1 (participation always, win bonus on a win). */
export function xpForMatch(won: boolean): number {
  return PROGRESSION.matchPlay + (won ? PROGRESSION.matchWin : 0);
}

/** Flat XP for a quick match vs the bot — win or lose. */
export function xpForBot(): number {
  return PROGRESSION.quickMatch;
}
