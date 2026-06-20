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

/** XP for an Aim Training run of `score`, capped; `newBest` adds a bonus. */
export function xpForTraining(score: number, newBest: boolean): number {
  const base = Math.min(PROGRESSION.trainingMax, Math.floor(Math.max(0, score) * PROGRESSION.trainingPerScore));
  return base + (newBest ? PROGRESSION.trainingBestBonus : 0);
}

/** XP for a finished real 1v1 (participation always, win bonus on a win). */
export function xpForMatch(won: boolean): number {
  return PROGRESSION.matchPlay + (won ? PROGRESSION.matchWin : 0);
}

/** XP for a bot-bout win (a token amount). */
export function xpForBotWin(): number {
  return PROGRESSION.botWin;
}
