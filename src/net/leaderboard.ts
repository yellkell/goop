/**
 * Firebase-backed leaderboards, riding the same Firestore project that does
 * matchmaking (collection `players`, one doc per anonymous player id).
 *
 * Two boards:
 *  - 1V1: ranks SCORE — a real win banks a flat +20, a practice win over the
 *    bot a token +2; losers lose NOTHING. A HIDDEN per-player ELO (K=32) still
 *    moves on every REAL result (rival-quality signal for matchmaking) but no
 *    longer weights the score, and the bot has no rating to move.
 *  - AIM TRAINING: personal-best run scores.
 *
 * Identity is a localStorage uuid with a derived IRON-XXXX callsign — no
 * sign-in. Firestore + firebase/app load lazily so lobby/bot players who
 * never go online don't pay for the bundle. Needs Firestore rules opening
 * the `players` collection (same hackathon-grade shape as `lobbies`).
 */

import { FIREBASE_ENABLED, firebaseConfig } from './firebaseConfig.js';

export interface LbRow {
  name: string;
  value: number;
  /** This row is YOU — the UI highlights it. */
  me: boolean;
}

export type LeaderboardTab = 'duel' | 'training';

const LEADERBOARD_FETCH_LIMIT = 50;
/** Rows the lobby board shows at once — the full top 10, no scrolling needed
 *  to take in the ladder; ranks 11+ (up to the fetch limit) reveal on scroll.
 *  The menu panel imports this so what's drawn and what scroll clamps to agree. */
export const LEADERBOARD_VISIBLE_ROWS = 10;

/** Live leaderboard state the lobby panel reads each redraw. */
export const leaderboard = {
  tab: 'duel' as LeaderboardTab,
  duel: [] as LbRow[],
  training: [] as LbRow[],
  scroll: { duel: 0, training: 0 } as Record<LeaderboardTab, number>,
  status: FIREBASE_ENABLED ? 'loading…' : 'leaderboard offline',
};

/** The current rival's claim about themselves (peer `iam` message). */
export const rival = { name: 'RIVAL', elo: 1000, avatarSkin: '', platformSkin: '', avColor: -1 };

const ELO_K = 32;

/** Leaderboard score banked per win. A real 1v1 pays a full +20; a practice
 *  win over the bot is a token +2 — enough to chart, not enough to farm. */
const SCORE_WIN = 20;
const SCORE_BOT_WIN = 2;

const profile = { id: '', name: '', score: 0, elo: 1000, training: 0 };

export function leaderboardRows(tab: LeaderboardTab = leaderboard.tab): LbRow[] {
  return tab === 'duel' ? leaderboard.duel : leaderboard.training;
}

export function clampLeaderboardScroll(tab: LeaderboardTab = leaderboard.tab): void {
  const max = Math.max(0, leaderboardRows(tab).length - LEADERBOARD_VISIBLE_ROWS);
  leaderboard.scroll[tab] = Math.max(0, Math.min(max, leaderboard.scroll[tab]));
}

export function setLeaderboardTab(tab: LeaderboardTab): void {
  leaderboard.tab = tab;
  clampLeaderboardScroll(tab);
}

export function scrollLeaderboard(delta: number): boolean {
  const before = leaderboard.scroll[leaderboard.tab];
  leaderboard.scroll[leaderboard.tab] += delta;
  clampLeaderboardScroll(leaderboard.tab);
  return leaderboard.scroll[leaderboard.tab] !== before;
}

export function myName(): string {
  return profile.name;
}

export function myElo(): number {
  return profile.elo;
}

/** My own board numbers, for the panel footer. */
export function myStats(): { name: string; score: number; training: number } {
  return { name: profile.name, score: profile.score, training: profile.training };
}

function localId(): string {
  try {
    let id = localStorage.getItem('ff-player-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('ff-player-id', id);
    }
    return id;
  } catch {
    return crypto.randomUUID(); // storage unavailable — session-only identity
  }
}

/** Has this player typed a callsign yet? (Keyboard pops only while false.) */
export function hasCustomName(): boolean {
  try {
    return !!localStorage.getItem('ff-player-name');
  } catch {
    return true; // storage broken — never nag
  }
}

/**
 * Save the typed callsign — once, shared by BOTH boards (training submits
 * and 1v1s). Sanitised to the keyboard's own alphabet, max 12 chars.
 */
export function setPlayerName(raw: string): void {
  const name = raw.replace(/[^A-Z0-9\- ]/gi, '').trim().toUpperCase().slice(0, 12);
  if (!name) return;
  try {
    localStorage.setItem('ff-player-name', name);
  } catch {
    /* keep it for this session at least */
  }
  profile.name = name;
  writeMine({}); // writeMine always carries the name
  void refreshLeaderboard(true);
}

type FirestoreMod = typeof import('firebase/firestore');
interface Handle {
  fs: FirestoreMod;
  db: import('firebase/firestore').Firestore;
}

let handlePromise: Promise<Handle | null> | null = null;

function firestore(): Promise<Handle | null> {
  if (!FIREBASE_ENABLED) return Promise.resolve(null);
  handlePromise ??= (async () => {
    try {
      const appMod = await import('firebase/app');
      const fs = await import('firebase/firestore');
      // The WebRTC transport may have initialised the app already (or will
      // after us) — share the instance instead of double-initialising.
      const fbApp = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
      return { fs, db: fs.getFirestore(fbApp) };
    } catch {
      leaderboard.status = 'leaderboard offline';
      return null;
    }
  })();
  return handlePromise;
}

/** Load (or create) my player doc, then pull both boards. Call once at boot. */
export function initLeaderboard(): void {
  profile.id = localId();
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('ff-player-name');
  } catch {
    /* fall through to the derived callsign */
  }
  profile.name = stored ?? `IRON-${profile.id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
  void (async () => {
    const h = await firestore();
    if (!h) return;
    try {
      const ref = h.fs.doc(h.db, 'players', profile.id);
      const snap = await h.fs.getDoc(ref);
      if (snap.exists()) {
        const d = snap.data();
        profile.score = (d.score as number) ?? 0;
        profile.elo = (d.elo as number) ?? 1000;
        profile.training = (d.training as number) ?? 0;
        // A locally renamed player syncs the doc's stale callsign.
        if ((d.name as string) !== profile.name) writeMine({});
      } else {
        await h.fs.setDoc(ref, {
          name: profile.name,
          score: 0,
          elo: 1000,
          training: 0,
          updatedAt: h.fs.serverTimestamp(),
        });
      }
    } catch {
      leaderboard.status = 'leaderboard unreachable';
    }
    void refreshLeaderboard(true);
  })();
}

let lastFetch = -Infinity;

/** Pull the top rows of both boards (throttled — `force` bypasses). */
export async function refreshLeaderboard(force = false): Promise<void> {
  if (!force && performance.now() - lastFetch < 20_000) return;
  lastFetch = performance.now();
  const h = await firestore();
  if (!h) return;
  const { fs, db } = h;
  try {
    const players = fs.collection(db, 'players');
    const pull = async (field: 'score' | 'training'): Promise<LbRow[]> => {
      const snap = await fs.getDocs(fs.query(players, fs.orderBy(field, 'desc'), fs.limit(LEADERBOARD_FETCH_LIMIT)));
      return snap.docs
        .map((d) => ({
          name: (d.data().name as string) ?? '???',
          value: (d.data()[field] as number) ?? 0,
          me: d.id === profile.id,
        }))
        .filter((r) => r.value > 0);
    };
    [leaderboard.duel, leaderboard.training] = await Promise.all([pull('score'), pull('training')]);
    clampLeaderboardScroll('duel');
    clampLeaderboardScroll('training');
    leaderboard.status = '';
  } catch {
    leaderboard.status = 'leaderboard unreachable';
  }
}

function writeMine(fields: Record<string, unknown>): void {
  void (async () => {
    const h = await firestore();
    if (!h) return;
    try {
      await h.fs.setDoc(
        h.fs.doc(h.db, 'players', profile.id),
        { name: profile.name, updatedAt: h.fs.serverTimestamp(), ...fields },
        { merge: true },
      );
    } catch {
      /* unreachable right now — the next result will try again */
    }
  })();
}

/**
 * A finished REAL 1v1: a win banks a flat +20 on the board; losing costs
 * nothing visible. The hidden ELO still moves both ways (rival-quality signal
 * for matchmaking) but no longer weights the score.
 */
export function reportResult(win: boolean, oppElo: number): void {
  if (win) profile.score += SCORE_WIN;
  const expected = 1 / (1 + Math.pow(10, (oppElo - profile.elo) / 400));
  profile.elo = Math.max(100, Math.round(profile.elo + ELO_K * ((win ? 1 : 0) - expected)));
  writeMine({ score: profile.score, elo: profile.elo });
  void refreshLeaderboard(true);
}

/**
 * A finished BOT bout: a win banks a token +2 (no ELO movement — the bot has
 * no rating). Losing costs nothing.
 */
export function reportBotResult(win: boolean): void {
  if (!win) return;
  profile.score += SCORE_BOT_WIN;
  writeMine({ score: profile.score });
  void refreshLeaderboard(true);
}

/** An Aim Training run ended — publish a new personal best. */
export function reportTraining(score: number): void {
  if (score <= profile.training) return;
  profile.training = score;
  writeMine({ training: profile.training });
  void refreshLeaderboard(true);
}
