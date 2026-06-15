/**
 * Shared, mutable match state. `GameStateSystem` owns the transitions (the
 * HOST owns them in a network bout and echoes them to the guest); other
 * systems read `phase` to know when play is live.
 */

export type MatchPhase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

export interface MatchState {
  phase: MatchPhase;
  round: number;
  myScore: number;
  oppScore: number;
  roundTimer: number; // seconds left in the round, or pre-fight countdown
  resultTimer: number; // countdown shown during roundOver / matchOver
  message: string; // headline status for the HUD
  /** Bumped every time a fresh round starts — systems reset on change. */
  resetCount: number;
  /** Net bouts hold at FIGHT OVER: I pressed REMATCH on the panel. */
  rematchMine: boolean;
  /** …and the rival pressed theirs (peer `rematch` message). Both → restart. */
  rematchTheirs: boolean;
}

export const match: MatchState = {
  phase: 'playing',
  round: 1,
  myScore: 0,
  oppScore: 0,
  roundTimer: 0,
  resultTimer: 0,
  message: '',
  resetCount: 0,
  rematchMine: false,
  rematchTheirs: false,
};
