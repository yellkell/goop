/**
 * Shared match state — the one mutable blackboard every system reads and
 * writes (FIRE FIGHT's appState pattern, trimmed to a single-player bout).
 * FistSystem lands damage here, CreatureSystem drains your health here,
 * FightSystem referees the numbers into phases and verdicts.
 */

import { Vector3 } from 'three';
import { COMBAT } from './config.js';
import type { GelCreature } from './creature/GelCreature.js';

export type Phase = 'lobby' | 'countdown' | 'fighting' | 'roundEnd' | 'verdict';
export type Verdict = '' | 'win' | 'ko' | 'time' | 'draw';
export type RoundWinner = '' | 'player' | 'creature' | 'draw';

/** A proper contest: best of five rounds (first to three). */
export const MAX_ROUNDS = 5;
export const ROUNDS_TO_WIN = 3;
/** Rest between rounds — the goop pulls itself together, so do you. */
export const REST_SECONDS = 7;

export const match = {
  phase: 'lobby' as Phase,
  creatureHp: COMBAT.creatureHealth,
  playerHp: COMBAT.playerHealth,
  timeLeft: COMBAT.roundSeconds,
  /** The round in progress, 1-based. */
  round: 1,
  playerRounds: 0,
  creatureRounds: 0,
  /** Who took the round that just ended (drives the rest-period screen). */
  lastRound: '' as RoundWinner,
  /** Seconds into the rest period. */
  roundEndT: 0,
  /** Seconds since the countdown began. */
  countdownT: 0,
  /** The lobby menu's FIGHT button rang; FightSystem consumes this. */
  startRequested: false,
  verdict: '' as Verdict,
  verdictT: 0,
  /** 1 when the creature just clobbered you; FightSystem fades the red vignette. */
  playerFlash: 0,
  /** 1 when you just blocked a strike; FightSystem fades a white vignette. */
  blockFlash: 0,
  /** Screen-space direction (x right, y up; unit-ish) the last hit / block
   *  came from — the rim glow leans that way so you know where it landed. */
  hitDirX: 0,
  hitDirY: -1,
  blockDirX: 0,
  blockDirY: -1,
  /** Set by FistSystem the frame you land a BIG punch; CreatureSystem reads
   *  it (and clears it) to decide whether a hurt goop collapses into a glob. */
  bigHit: false,
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
  { name: 'EASY', roamScale: 1.45, tempoScale: 1.35, damageScale: 0.6, comboMax: 2 },
  { name: 'MEDIUM', roamScale: 1.0, tempoScale: 1.0, damageScale: 1.0, comboMax: 3 },
  { name: 'HARD', roamScale: 0.65, tempoScale: 0.75, damageScale: 1.5, comboMax: 4 },
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

/** Fresh round: full health both sides, clock rewound. */
export function resetForRound(): void {
  match.creatureHp = COMBAT.creatureHealth;
  match.playerHp = COMBAT.playerHealth;
  match.timeLeft = settings.roundSeconds;
  match.playerFlash = 0;
  match.blockFlash = 0;
  match.bigHit = false;
  match.boardDirty = true;
}

/** Fresh match: round one, cards wiped. */
export function resetForMatch(): void {
  resetForRound();
  match.round = 1;
  match.playerRounds = 0;
  match.creatureRounds = 0;
  match.lastRound = '';
  match.roundEndT = 0;
  match.verdict = '';
  match.verdictT = 0;
}

/**
 * The player's live pose, written by FistSystem each frame and read by
 * CreatureSystem when it resolves a strike — so blocking can ask "was a
 * glove on the spot his fist landed?". World-space metres.
 */
export const player = {
  head: new Vector3(0, 1.6, 0),
  gloves: {
    left: new Vector3(),
    right: new Vector3(),
  },
};

/** The one creature, shared between systems (CreatureSystem owns it). */
let creature: GelCreature | null = null;

export function setCreature(c: GelCreature): void {
  creature = c;
}

export function getCreature(): GelCreature | null {
  return creature;
}
