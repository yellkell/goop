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
export type { ArcadeMode } from '../config.js';
import type { ArcadeMode } from '../config.js';
/** The arena backdrop: bare AR passthrough, or the papercraft desert. */
export type AppEnvironment = 'ar' | 'desert';

export interface LifetimeStats {
  wins: number;
  losses: number;
  trainingBest: number;
  ballsThrown: number;
  hitsLanded: number;
}

/** Default glove-accent hue (≈0.07 → the classic ember orange). */
export const DEFAULT_ACCENT_HUE = 0.07;

function loadAccentHue(): number {
  const raw = localStorage.getItem('ff-accent');
  const n = raw == null ? NaN : parseFloat(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_ACCENT_HUE;
}

export const DEFAULT_ACCENT_LIGHT = 0.5;

function loadAccentLight(): number {
  const raw = localStorage.getItem('ff-accent-light');
  const n = raw == null ? NaN : parseFloat(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_ACCENT_LIGHT;
}

/** Per-fist ball attachment: [left, right], each 0 none / 1 split / 2 grow / 3 shrink. */
function loadBallAttach(): [number, number] {
  const raw = localStorage.getItem('ff-ballattach');
  const parts = (raw ?? '').split(',').map((s) => parseInt(s, 10));
  const clamp = (n: number): number => (Number.isFinite(n) && n >= 0 && n <= 3 ? n : 0);
  return [clamp(parts[0]), clamp(parts[1])];
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
  /**
   * Active arena layout for the current bout. '1v1' is the classic duel (and
   * the lobby default); '2v2' and 'ffa' are the ARCADE brawls. Drives the
   * platform roster, combatant count and HUD.
   */
  arcade: ArcadeMode;
  /**
   * My CANONICAL seat in a networked arcade bout (0..N-1 in the shared
   * MODE_LAYOUT). 0 for bot bouts, the classic duel and the mesh host; a mesh
   * guest gets the seat matchmaking assigned. The local view is always rebuilt
   * with me at index 0 (see combat/layout.ts), so gameplay never sees this
   * directly — only the netcode's coordinate transforms do.
   */
  mySlot: number;
  /** Human-readable connection status for the lobby info panel. */
  netStatus: string;
  /**
   * The guided BASICS TUTORIAL is running. It rides a normal vs-bot bout, but
   * a standalone TutorialSystem (the ONLY reader of this flag) layers pop-ups,
   * a half-health bot and a paced lesson script on top WITHOUT touching any
   * combat system. False in every normal bout, so the regular game is
   * untouched — set true only by the lobby's TUTORIAL button.
   */
  tutorial: boolean;
  /** Aim Training option: targets shoot back so you can train dodging. */
  shootBack: boolean;
  /** How many boxers are in the quick-match queue right now (−1 = unknown,
   *  e.g. before the matchmaker is reachable). Drives the 1V1 panel. */
  searching: number;
  /** Total punters across all pub regions right now (−1 = none reachable).
   *  Drives the pub door's headcount badge. */
  pubCount: number;
  /** Punter count per pub region id (for the EU/USA door picker). */
  pubRegionCounts: Record<string, number>;
  /** Which face the lobby info panel shows: its doors, or the pub-region picker. */
  infoView: 'root' | 'pubpick';
  /** The Gasket Gazette is open over the lobby (modal, like customisation). */
  gazetteOpen: boolean;
  /** Which backdrop the arena renders — held across every mode. */
  environment: AppEnvironment;
  /** Player's chosen avatar-accent hue (0..1 around the colour wheel). */
  accentHue: number;
  /** Player's chosen avatar-accent lightness (0..1, 0.5 = neutral). */
  accentLight: number;
  /** Ball attachment per fist: [left, right] (0 none/1 split/2 grow/3 shrink). */
  ballAttach: [number, number];
  /** Which face the 1V1 panel shows: the mode list, or the private-match flow. */
  duelView: 'root' | 'private' | 'hosting' | 'keypad';
  /** The 5-digit code shown while hosting a private match. */
  privateCode: string;
  /** Digits typed on the join keypad (up to 5). */
  codeEntry: string;
  stats: LifetimeStats;
} = {
  state: 'menu',
  mode: 'bot',
  tutorial: false,
  side: 0,
  arcade: '1v1',
  mySlot: 0,
  netStatus: 'not connected',
  // Off unless the player has explicitly switched it on.
  shootBack: localStorage.getItem('ff-shootback') === '1',
  searching: -1,
  pubCount: -1,
  pubRegionCounts: {},
  infoView: 'root',
  gazetteOpen: false,
  environment: localStorage.getItem('ff-env') === 'desert' ? 'desert' : 'ar',
  accentHue: loadAccentHue(),
  accentLight: loadAccentLight(),
  ballAttach: loadBallAttach(),
  duelView: 'root',
  privateCode: '',
  codeEntry: '',
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

export function saveEnvironment(): void {
  try {
    localStorage.setItem('ff-env', app.environment);
  } catch {
    /* ignore */
  }
}

export function saveAccentHue(): void {
  try {
    localStorage.setItem('ff-accent', app.accentHue.toFixed(4));
  } catch {
    /* ignore */
  }
}

export function saveAccentLight(): void {
  try {
    localStorage.setItem('ff-accent-light', app.accentLight.toFixed(4));
  } catch {
    /* ignore */
  }
}

export function saveBallAttach(): void {
  try {
    localStorage.setItem('ff-ballattach', `${app.ballAttach[0]},${app.ballAttach[1]}`);
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
