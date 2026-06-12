/**
 * Firebase-backed leaderboards, riding the same Firestore project that does
 * matchmaking (collection `players`, one doc per anonymous player id).
 *
 * Two boards:
 *  - 1V1: ranks SCORE — winners gain +10..30 per match depending on the
 *    quality of the beaten rival; losers lose NOTHING. Quality comes from a
 *    HIDDEN per-player ELO (K=32) that moves on every result but is never
 *    shown in game.
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

/** Live leaderboard state the lobby panel reads each redraw. */
export const leaderboard = {
  tab: 'duel' as 'duel' | 'training',
  duel: [] as LbRow[],
  training: [] as LbRow[],
  status: FIREBASE_ENABLED ? 'loading…' : 'leaderboard offline',
};

/** The current rival's claim about themselves (peer `iam` message). */
export const rival = { name: 'RIVAL', elo: 1000 };

const ELO_K = 32;

const profile = { id: '', name: '', score: 0, elo: 1000, training: 0 };

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
  let id = localStorage.getItem('ff-player-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('ff-player-id', id);
  }
  return id;
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
  profile.name = `IRON-${profile.id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
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

/** Pull the top 10 of both boards (throttled — `force` bypasses). */
export async function refreshLeaderboard(force = false): Promise<void> {
  if (!force && performance.now() - lastFetch < 20_000) return;
  lastFetch = performance.now();
  const h = await firestore();
  if (!h) return;
  const { fs, db } = h;
  try {
    const players = fs.collection(db, 'players');
    const pull = async (field: 'score' | 'training'): Promise<LbRow[]> => {
      const snap = await fs.getDocs(fs.query(players, fs.orderBy(field, 'desc'), fs.limit(10)));
      return snap.docs
        .map((d) => ({
          name: (d.data().name as string) ?? '???',
          value: (d.data()[field] as number) ?? 0,
          me: d.id === profile.id,
        }))
        .filter((r) => r.value > 0);
    };
    [leaderboard.duel, leaderboard.training] = await Promise.all([pull('score'), pull('training')]);
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
 * A finished 1v1: winners bank +10..30 score weighted by how strong the
 * rival was; losing costs nothing visible. The hidden ELO moves both ways.
 */
export function reportResult(win: boolean, oppElo: number): void {
  const expected = 1 / (1 + Math.pow(10, (oppElo - profile.elo) / 400));
  if (win) profile.score += Math.round(10 + 20 * (1 - expected));
  profile.elo = Math.max(100, Math.round(profile.elo + ELO_K * ((win ? 1 : 0) - expected)));
  writeMine({ score: profile.score, elo: profile.elo });
  void refreshLeaderboard(true);
}

/** An Aim Training run ended — publish a new personal best. */
export function reportTraining(score: number): void {
  if (score <= profile.training) return;
  profile.training = score;
  writeMine({ training: profile.training });
  void refreshLeaderboard(true);
}
