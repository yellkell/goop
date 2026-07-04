/**
 * Shared match state — the one mutable blackboard every system reads and
 * writes (FIRE FIGHT's appState pattern, trimmed to a single-player bout).
 * FistSystem lands damage here, CreatureSystem drains your health here,
 * FightSystem referees the numbers into phases and verdicts.
 */

import { COMBAT } from './config.js';
import type { GelCreature } from './creature/GelCreature.js';

export type Phase = 'lobby' | 'countdown' | 'fighting' | 'verdict';
export type Verdict = '' | 'win' | 'ko' | 'time' | 'draw';

export const match = {
  phase: 'lobby' as Phase,
  creatureHp: COMBAT.creatureHealth,
  playerHp: COMBAT.playerHealth,
  timeLeft: COMBAT.roundSeconds,
  /** Seconds since the countdown began. */
  countdownT: 0,
  /** The lobby menu's FIGHT button rang; FightSystem consumes this. */
  startRequested: false,
  verdict: '' as Verdict,
  verdictT: 0,
  /** 1 when the creature just clobbered you; FightSystem fades the vignette. */
  playerFlash: 0,
  /** Scoreboard dirty flag — set after anything display-worthy changes. */
  boardDirty: true,
};

/** One difficulty notch: how the creature paces and how hard it hits. */
export interface Difficulty {
  name: string;
  /** Scales roam time between form-ups (smaller = it attacks more often). */
  roamScale: number;
  /** Scales the telegraph + recovery (smaller = tighter dodge windows). */
  tempoScale: number;
  /** Scales its punch damage. */
  damageScale: number;
  comboMax: number;
}

export const DIFFICULTIES: Difficulty[] = [
  { name: 'CHILL', roamScale: 1.45, tempoScale: 1.35, damageScale: 0.6, comboMax: 2 },
  { name: 'SCRAP', roamScale: 1.0, tempoScale: 1.0, damageScale: 1.0, comboMax: 3 },
  { name: 'RUMBLE', roamScale: 0.65, tempoScale: 0.75, damageScale: 1.5, comboMax: 4 },
];

export const ROUND_CHOICES = [99, 60, 30];

/** Pre-bout options, set from the lobby menu panel. */
export const settings = {
  roundSeconds: ROUND_CHOICES[0],
  /** Index into DIFFICULTIES. */
  difficulty: 1,
};

export function currentDifficulty(): Difficulty {
  return DIFFICULTIES[settings.difficulty];
}

export function resetForBout(): void {
  match.creatureHp = COMBAT.creatureHealth;
  match.playerHp = COMBAT.playerHealth;
  match.timeLeft = settings.roundSeconds;
  match.verdict = '';
  match.verdictT = 0;
  match.playerFlash = 0;
  match.boardDirty = true;
}

/** The one creature, shared between systems (CreatureSystem owns it). */
let creature: GelCreature | null = null;

export function setCreature(c: GelCreature): void {
  creature = c;
}

export function getCreature(): GelCreature | null {
  return creature;
}
