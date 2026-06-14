/**
 * Top-level app state — the lobby vs. an active bout vs. Aim Training.
 *
 *  - 'menu'     : standing on your platform at the floating menu, choosing.
 *  - 'queueing' : you pressed 1V1 QUICK MATCH; waiting for the relay server
 *                 to pair you with another boxer.
 *  - 'playing'  : a bout is live, vs the bot (`mode: 'bot'`) or a real
 *                 opponent over the wire (`mode: 'net'`).
 *  - 'training' : Aim Training — pop-up targets, optional return fire.
 *
 * MenuSystem and NetworkSystem own the transitions; the combat systems read
 * `state`/`mode` to know when and what to simulate.
 */

export type AppState = 'menu' | 'queueing' | 'playing' | 'training';
export type AppMode = 'bot' | 'net';

export interface LifetimeStats {
  wins: number;
  losses: number;
  trainingBest: number;
  ballsThrown: number;
  hitsLanded: number;
}

function loadStats(): LifetimeStats {
  try {
    const raw = localStorage.getItem('ff-stats');
    if (raw) return { wins: 0, losses: 0, trainingBest: 0, ballsThrown: 0, hitsLanded: 0, ...JSON.parse(raw) };
  } catch {
    /* fresh start */
  }
  return { wins: 0, losses: 0, trainingBest: 0, ballsThrown: 0, hitsLanded: 0 };
}

export const app: {
  state: AppState;
  mode: AppMode;
  /** Network side: 0 = host (match authority), 1 = guest. */
  side: 0 | 1;
  /** Human-readable connection status for the lobby info panel. */
  netStatus: string;
  /** Aim Training option: targets shoot back so you can train dodging. */
  shootBack: boolean;
  /** How many boxers are in the quick-match queue right now (−1 = unknown,
   *  e.g. before the matchmaker is reachable). Drives the 1V1 panel. */
  searching: number;
  stats: LifetimeStats;
} = {
  state: 'menu',
  mode: 'bot',
  side: 0,
  netStatus: 'not connected',
  // Off unless the player has explicitly switched it on.
  shootBack: localStorage.getItem('ff-shootback') === '1',
  searching: -1,
  stats: loadStats(),
};

export function saveStats(): void {
  try {
    localStorage.setItem('ff-stats', JSON.stringify(app.stats));
  } catch {
    /* storage unavailable — stats stay in-memory */
  }
}

export function saveShootBack(): void {
  try {
    localStorage.setItem('ff-shootback', app.shootBack ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Live Aim Training session numbers (TrainingSystem writes, UI reads). */
export const training = {
  active: false,
  score: 0,
  hits: 0,
  thrown: 0,
  streak: 0,
  bestStreak: 0,
  timeLeft: 0,
  /** Set when a run ends so the UI can show the result. */
  lastScore: 0,
};
