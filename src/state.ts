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
  /** Lobby warm-up punches landed (N of POKES_TO_START starts the bout). */
  lobbyPokes: 0,
  verdict: '' as Verdict,
  verdictT: 0,
  /** 1 when the creature just clobbered you; FightSystem fades the vignette. */
  playerFlash: 0,
  /** Scoreboard dirty flag — set after anything display-worthy changes. */
  boardDirty: true,
};

export const POKES_TO_START = 3;

export function resetForBout(): void {
  match.creatureHp = COMBAT.creatureHealth;
  match.playerHp = COMBAT.playerHealth;
  match.timeLeft = COMBAT.roundSeconds;
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
