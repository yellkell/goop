/**
 * THE GASKET GAZETTE — the frontier town of Gasket's daily paper, written by
 * its sheriff, Cole Ironside: a tin-star lawman who despises the metal
 * "Clankers" tearing up his quiet streets (and who is, of course, a Clanker
 * himself — he just won't admit it). A scheduled Claude task reads the ladder
 * every day, works out who fought and who rose or fell, and writes Cole's
 * editorial in character, dropping it into Firestore at `newspaper/latest`.
 *
 * This module is the lobby's reader: it pulls the latest edition, and tracks
 * whether THIS player has read it yet so the lobby's paper button can wear a
 * red notification dot until they do. Rides the same Firestore project as
 * matchmaking + the leaderboard; loads firebase lazily like leaderboard.ts so
 * offline lobby players never pay for the bundle. Needs a Firestore rule
 * opening the `newspaper` collection for read (the scheduled task writes it).
 */

import { FIREBASE_ENABLED, firebaseConfig } from './firebaseConfig.js';

export interface GazetteArticle {
  /** Monotonic edition number — drives the unread dot. */
  edition: number;
  /** "GASKET TERRITORY — TUESDAY, JUNE 23" etc. */
  dateline: string;
  headline: string;
  subhead: string;
  /** The body copy; paragraphs split on blank lines. */
  body: string;
  byline: string;
  /** A one-word mood Cole's in today (e.g. OUTRAGE, GLEE) — stamped on the page. */
  mood: string;
}

/** Live gazette state the lobby reads each redraw. */
export const gazette = {
  article: null as GazetteArticle | null,
  status: FIREBASE_ENABLED ? 'loading…' : 'gazette offline',
  /** True while the latest edition is newer than the one this reader has seen. */
  unread: false,
};

const SEEN_KEY = 'gg-seen-edition';

function seenEdition(): number {
  try {
    return parseInt(localStorage.getItem(SEEN_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
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
      // Share the app instance the leaderboard / WebRTC transport may already
      // have spun up rather than double-initialising.
      const fbApp = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
      return { fs, db: fs.getFirestore(fbApp) };
    } catch {
      gazette.status = 'gazette offline';
      return null;
    }
  })();
  return handlePromise;
}

let lastFetch = -Infinity;

/** Pull the latest edition (throttled — `force` bypasses the cooldown). */
export async function refreshGazette(force = false): Promise<void> {
  if (!force && performance.now() - lastFetch < 60_000) return;
  lastFetch = performance.now();
  const h = await firestore();
  if (!h) return;
  try {
    const snap = await h.fs.getDoc(h.fs.doc(h.db, 'newspaper', 'latest'));
    if (!snap.exists()) {
      gazette.status = 'the presses are quiet';
      return;
    }
    const d = snap.data();
    gazette.article = {
      edition: (d.edition as number) ?? 0,
      dateline: (d.dateline as string) ?? '',
      headline: (d.headline as string) ?? '',
      subhead: (d.subhead as string) ?? '',
      body: (d.body as string) ?? '',
      byline: (d.byline as string) ?? 'Sheriff Cole Ironside',
      mood: (d.mood as string) ?? '',
    };
    gazette.unread = gazette.article.edition > seenEdition();
    gazette.status = '';
  } catch {
    gazette.status = 'gazette unreachable';
  }
}

/** Pull the latest edition once at boot. */
export function initGazette(): void {
  void refreshGazette(true);
}

/** Mark the current edition read — clears the lobby button's red dot. */
export function markGazetteRead(): void {
  if (!gazette.article) return;
  try {
    localStorage.setItem(SEEN_KEY, String(gazette.article.edition));
  } catch {
    /* storage unavailable — the dot just stays until next boot */
  }
  gazette.unread = false;
}
