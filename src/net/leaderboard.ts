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
import { xpForArcade, xpForBot, xpForCampaign, xpForMatch, xpForTraining } from '../menu/progression.js';
import { addCoins } from '../menu/wallet.js';
import { CURRENCY, type ArcadeMode } from '../config.js';

export interface LbRow {
  /** The player's doc id — identifies them when their row is clicked. */
  uid: string;
  name: string;
  value: number;
  /** This row is YOU — the UI highlights it. */
  me: boolean;
  /** Cumulative XP — drives the rank badge on every board + the profile. */
  xp: number;
  /** Skill rating, for the profile card. */
  elo: number;
  /** The player's self-written note, shown on their profile. */
  note: string;
}

/** The score boards (BATTLE's 1v1 / 2v2 / ffa, XP), the ARCADE boards (AIM
 *  training plus the four PvE RUN-TIME boards) and a synthetic PROFILE face. */
export type LeaderboardTab =
  | 'ranked'
  | 'xp'
  | 'training'
  | 'duo'
  | 'ffa'
  | 'gauntlet'
  | 'hardcore'
  | 'raid'
  | 'raidHardcore'
  | 'profile';
/** Score/count boards (one numeric value per PLAYER doc). */
type DataTab = 'ranked' | 'xp' | 'training' | 'duo' | 'ffa';
/** RUN-TIME boards — each row is one completed RUN (a squad + a clock), not a
 *  player. Ranked by lowest cumulative fight time. */
export type RunTab = 'gauntlet' | 'hardcore' | 'raid' | 'raidHardcore';
const RUN_TABS: RunTab[] = ['gauntlet', 'hardcore', 'raid', 'raidHardcore'];
/** Firestore collection per run board (separate collections keep the query a
 *  plain single-field orderBy — no composite index needed). */
const RUN_COLLECTION: Record<RunTab, string> = {
  gauntlet: 'runGauntlet',
  hardcore: 'runHardcore',
  raid: 'runRaid',
  raidHardcore: 'runRaidHardcore',
};

/** One entry on a run board: the whole squad (one name for a solo gauntlet,
 *  up to four for a raid) and the run's cumulative fight-time clock. */
export interface RunRow {
  names: string[];
  seconds: number;
  /** My callsign is on this run — the UI highlights it. */
  me: boolean;
}

const LEADERBOARD_FETCH_LIMIT = 50;
/** Rows the lobby board shows at once — the full top 10, no scrolling needed
 *  to take in the ladder; ranks 11+ (up to the fetch limit) reveal on scroll.
 *  The menu panel imports this so what's drawn and what scroll clamps to agree. */
export const LEADERBOARD_VISIBLE_ROWS = 10;

/** Live leaderboard state the lobby panel reads each redraw. */
export const leaderboard = {
  tab: 'ranked' as LeaderboardTab,
  ranked: [] as LbRow[],
  xp: [] as LbRow[],
  training: [] as LbRow[],
  duo: [] as LbRow[],
  ffa: [] as LbRow[],
  gauntlet: [] as RunRow[],
  hardcore: [] as RunRow[],
  raid: [] as RunRow[],
  raidHardcore: [] as RunRow[],
  scroll: {
    ranked: 0,
    xp: 0,
    training: 0,
    duo: 0,
    ffa: 0,
    gauntlet: 0,
    hardcore: 0,
    raid: 0,
    raidHardcore: 0,
  } as Record<DataTab | RunTab, number>,
  status: FIREBASE_ENABLED ? 'loading…' : 'leaderboard offline',
  /** Whose profile the PROFILE face shows; null = your own. */
  viewRow: null as LbRow | null,
};

/** The current rival's claim about themselves (peer `iam` message). */
export const rival = { name: 'RIVAL', elo: 1000, avatarSkin: '', platformSkin: '', avColor: -1, avLight: 0.5 };

const ELO_K = 32;

/** Leaderboard score banked per win. A real 1v1 pays a full +20; a practice
 *  win over the bot is a token +2 — enough to chart, not enough to farm. */
const SCORE_WIN = 20;
const SCORE_BOT_WIN = 2;

/** Arcade brawl boards (2v2 / FFA): a win banks +11, just showing up banks +1
 *  either way — so the boards reward turning out, and reward winning more. */
const ARCADE_WIN = 11;
const ARCADE_PLAY = 1;

const profile = { id: '', name: '', score: 0, elo: 1000, training: 0, duo: 0, ffa: 0, xp: 0, note: '' };

/** Your own profile as a board row (for the PROFILE face when viewing self). */
export function myProfileRow(): LbRow {
  return {
    uid: profile.id,
    name: profile.name,
    value: profile.elo,
    me: true,
    xp: profile.xp,
    elo: profile.elo,
    note: profile.note,
  };
}

export function myNote(): string {
  return profile.note;
}

/** Save the typed profile note — sanitised to the keyboard alphabet, max 48. */
export function setPlayerNote(raw: string): void {
  const note = raw.replace(/[^A-Z0-9\- ]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 48);
  profile.note = note;
  writeMine({ note });
  if (leaderboard.viewRow?.me) leaderboard.viewRow.note = note;
  void refreshLeaderboard(true);
}

function isDataTab(tab: LeaderboardTab): tab is DataTab {
  return tab === 'ranked' || tab === 'xp' || tab === 'training' || tab === 'duo' || tab === 'ffa';
}

export function isRunTab(tab: LeaderboardTab): tab is RunTab {
  return tab === 'gauntlet' || tab === 'hardcore' || tab === 'raid' || tab === 'raidHardcore';
}

export function leaderboardRows(tab: LeaderboardTab = leaderboard.tab): LbRow[] {
  return isDataTab(tab) ? leaderboard[tab] : [];
}

/** The rows of a run board (empty for any non-run tab). */
export function runRows(tab: LeaderboardTab = leaderboard.tab): RunRow[] {
  return isRunTab(tab) ? leaderboard[tab] : [];
}

/** Rows currently on the active board — either shape, for scroll clamping. */
function activeRowCount(tab: LeaderboardTab): number {
  if (isDataTab(tab)) return leaderboard[tab].length;
  if (isRunTab(tab)) return leaderboard[tab].length;
  return 0;
}

/** Current scroll offset for the active board (0 on the profile face). */
export function boardScroll(): number {
  const t = leaderboard.tab;
  return isDataTab(t) || isRunTab(t) ? leaderboard.scroll[t] : 0;
}

export function clampLeaderboardScroll(tab: DataTab | RunTab): void {
  const max = Math.max(0, activeRowCount(tab) - LEADERBOARD_VISIBLE_ROWS);
  leaderboard.scroll[tab] = Math.max(0, Math.min(max, leaderboard.scroll[tab]));
}

export function setLeaderboardTab(tab: LeaderboardTab): void {
  leaderboard.tab = tab;
  if (isDataTab(tab) || isRunTab(tab)) clampLeaderboardScroll(tab);
}

/** Open a player's profile face (null = your own). */
export function setProfileView(row: LbRow | null): void {
  leaderboard.viewRow = row;
  leaderboard.tab = 'profile';
}

export function scrollLeaderboard(delta: number): boolean {
  const tab = leaderboard.tab;
  if (!isDataTab(tab) && !isRunTab(tab)) return false;
  const before = leaderboard.scroll[tab];
  leaderboard.scroll[tab] += delta;
  clampLeaderboardScroll(tab);
  return leaderboard.scroll[tab] !== before;
}

export function myName(): string {
  return profile.name;
}

export function myElo(): number {
  return profile.elo;
}

/** My own board numbers, for the panel footer. */
export function myStats(): { name: string; score: number; training: number; xp: number; elo: number } {
  return {
    name: profile.name,
    score: profile.score,
    training: profile.training,
    xp: profile.xp,
    elo: profile.elo,
  };
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

// Becomes true once the boot load has settled (doc fetched, created, or the
// attempt failed) — so `profile.xp` is real, not the pre-load 0. The promotion
// celebration waits for this before baselining, or a cloud load looks like an
// instant promotion on every login.
let loaded = false;

/** Has the boot profile load settled? (XP is real, not the pre-load 0.) */
export function profileReady(): boolean {
  return loaded;
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
    if (!h) {
      loaded = true; // no cloud — local-only play, baseline off the current XP
      return;
    }
    try {
      const ref = h.fs.doc(h.db, 'players', profile.id);
      const snap = await h.fs.getDoc(ref);
      if (snap.exists()) {
        const d = snap.data();
        profile.score = (d.score as number) ?? 0;
        profile.elo = (d.elo as number) ?? 1000;
        profile.training = (d.training as number) ?? 0;
        profile.duo = (d.duo as number) ?? 0;
        profile.ffa = (d.ffa as number) ?? 0;
        profile.xp = (d.xp as number) ?? 0;
        profile.note = (d.note as string) ?? '';
        // A locally renamed player syncs the doc's stale callsign.
        if ((d.name as string) !== profile.name) writeMine({});
      } else {
        await h.fs.setDoc(ref, {
          name: profile.name,
          score: 0,
          elo: 1000,
          training: 0,
          duo: 0,
          ffa: 0,
          xp: 0,
          note: '',
          updatedAt: h.fs.serverTimestamp(),
        });
      }
    } catch {
      leaderboard.status = 'leaderboard unreachable';
    }
    loaded = true; // XP is now real (or the load failed) — safe to baseline
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
    const pull = async (field: 'elo' | 'xp' | 'training' | 'duo' | 'ffa'): Promise<LbRow[]> => {
      const snap = await fs.getDocs(fs.query(players, fs.orderBy(field, 'desc'), fs.limit(LEADERBOARD_FETCH_LIMIT)));
      return snap.docs
        .map((d) => ({
          uid: d.id,
          name: (d.data().name as string) ?? '???',
          value: (d.data()[field] as number) ?? 0,
          me: d.id === profile.id,
          xp: (d.data().xp as number) ?? 0,
          elo: (d.data().elo as number) ?? 1000,
          note: (d.data().note as string) ?? '',
        }))
        // Ranked shows only players whose rating has actually moved (played a
        // real bout); XP/training boards show anyone who's earned anything.
        .filter((r) => (field === 'elo' ? r.value !== 1000 : r.value > 0));
    };
    // RUN boards: each is its own collection of finished runs, ranked by the
    // lowest cumulative fight time. A row is a whole squad, so "me" is my
    // callsign appearing anywhere in the run's name list.
    // Each run board is pulled in its OWN try so a missing collection or a
    // rules gap on the run boards degrades THEM alone — the score boards
    // (which hit the known-open `players` collection) keep working.
    const pullRuns = async (tab: RunTab): Promise<RunRow[]> => {
      try {
        const col = fs.collection(db, RUN_COLLECTION[tab]);
        const snap = await fs.getDocs(fs.query(col, fs.orderBy('seconds', 'asc'), fs.limit(LEADERBOARD_FETCH_LIMIT)));
        return snap.docs.map((d) => {
          const names = Array.isArray(d.data().names) ? (d.data().names as unknown[]).map(String) : [];
          return { names, seconds: (d.data().seconds as number) ?? 0, me: names.includes(profile.name) };
        });
      } catch {
        return leaderboard[tab]; // keep whatever we last had
      }
    };
    const [rk, xp, tr, du, ff, gt, hc, rd, rh] = await Promise.all([
      pull('elo'),
      pull('xp'),
      pull('training'),
      pull('duo'),
      pull('ffa'),
      pullRuns('gauntlet'),
      pullRuns('hardcore'),
      pullRuns('raid'),
      pullRuns('raidHardcore'),
    ]);
    leaderboard.ranked = rk;
    leaderboard.xp = xp;
    leaderboard.training = tr;
    leaderboard.duo = du;
    leaderboard.ffa = ff;
    leaderboard.gauntlet = gt;
    leaderboard.hardcore = hc;
    leaderboard.raid = rd;
    leaderboard.raidHardcore = rh;
    (['ranked', 'xp', 'training', 'duo', 'ffa', ...RUN_TABS] as const).forEach(clampLeaderboardScroll);
    leaderboard.status = '';
  } catch {
    leaderboard.status = 'leaderboard unreachable';
  }
}

/**
 * Post a finished RUN to its board: one entry per completed run, ranked by the
 * lowest cumulative fight-time clock. `names` is the whole squad (one name for
 * a solo gauntlet/hardcore, up to four for a raid — the raid HOST posts it once
 * for the group so the squad ranks together on their run). No-op offline.
 */
export function reportRun(tab: RunTab, seconds: number, names: string[]): void {
  const clean = names.map((n) => String(n).slice(0, 12)).filter(Boolean).slice(0, 4);
  if (!clean.length) return;
  void (async () => {
    const h = await firestore();
    if (!h) return;
    try {
      await h.fs.addDoc(h.fs.collection(h.db, RUN_COLLECTION[tab]), {
        names: clean,
        seconds: Math.max(0, Math.round(seconds * 10) / 10),
        at: h.fs.serverTimestamp(),
      });
      await refreshLeaderboard(true);
    } catch {
      /* unreachable — the board just won't carry this run */
    }
  })();
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
  profile.xp += xpForMatch(win); // every real bout feeds the rank ladder
  addCoins(CURRENCY.perGame); // …and the coin wallet, alongside the XP
  writeMine({ score: profile.score, elo: profile.elo, xp: profile.xp });
  void refreshLeaderboard(true);
}

/**
 * A finished quick match vs the BOT: banks XP either way (win 15 / loss 5) so
 * the mode always rewards, plus a token score on a win. No ELO movement — the
 * bot has no rating.
 */
export function reportBotResult(win: boolean): void {
  if (win) profile.score += SCORE_BOT_WIN;
  profile.xp += xpForBot();
  addCoins(CURRENCY.perGame);
  writeMine({ score: profile.score, xp: profile.xp });
  void refreshLeaderboard(true);
}

/**
 * A finished arcade brawl (2v2 / FFA): bank a flat participation XP either way,
 * and tick that mode's own board — +11 for a win, +1 just for taking part.
 */
export function reportArcade(mode: ArcadeMode, win: boolean): void {
  profile.xp += xpForArcade();
  addCoins(CURRENCY.perGame);
  const gain = win ? ARCADE_WIN : ARCADE_PLAY;
  const fields: Record<string, unknown> = { xp: profile.xp };
  if (mode === '2v2') {
    profile.duo += gain;
    fields.duo = profile.duo;
  } else if (mode === 'ffa') {
    profile.ffa += gain;
    fields.ffa = profile.ffa;
  }
  writeMine(fields);
  void refreshLeaderboard(true);
}

/**
 * A finished ARCADE campaign titan bout. Pays the SAME flat rate as a quick
 * match vs the bot (XP + coins, win or lose) — except the FIRST time each
 * titan is felled, when both pay double. Campaign bouts are offline solo
 * fights, so nothing ticks the online score boards.
 */
export function reportCampaign(win: boolean, firstClear: boolean): void {
  const mult = win && firstClear ? 2 : 1;
  profile.xp += xpForCampaign() * mult;
  addCoins(CURRENCY.perGame * mult);
  writeMine({ xp: profile.xp });
  void refreshLeaderboard(true);
}

/** An Aim Training run ended — bank XP (every run) and a new personal best. */
export function reportTraining(score: number): void {
  const newBest = score > profile.training;
  profile.xp += xpForTraining();
  addCoins(CURRENCY.perGame);
  if (newBest) profile.training = score;
  writeMine({ training: profile.training, xp: profile.xp });
  void refreshLeaderboard(true);
}
