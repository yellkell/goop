/**
 * ladder-brief.mjs — the Gasket Gazette's "wire report".
 *
 * Reads the live ladder (Firestore `players`) and the snapshot left by the
 * LAST published edition (`newspaper/_snapshot`), works out what changed since
 * — who fought, who climbed, who slid, who's new in town — and prints a
 * compact JSON brief to stdout.
 *
 * It writes NOTHING. The scheduled Claude task pipes this brief into Sheriff
 * Cole Ironside's pen; `publish-gazette.mjs` then files the finished edition
 * AND rolls the snapshot forward. Run: `node scripts/ladder-brief.mjs`.
 *
 * The ladder only stores running totals (no per-match log), so "games played"
 * is inferred from the XP delta — every bout, win or lose, banks ~25 XP
 * (see src/config.ts PROGRESSION), so gamesApprox = round(ΔXP / 25).
 */

import { initializeApp } from 'firebase/app';
import { collection, doc, getDoc, getDocs, getFirestore, limit, orderBy, query } from 'firebase/firestore';

// Public web config (an identifier, not a secret — same as src/net/firebaseConfig.ts).
const firebaseConfig = {
  apiKey: 'AIzaSyA0NYO_w6uU0Fcc6nuVPitRQaGW3B6518E',
  authDomain: 'arfi-b68f9.firebaseapp.com',
  projectId: 'arfi-b68f9',
  storageBucket: 'arfi-b68f9.firebasestorage.app',
  messagingSenderId: '188374608574',
  appId: '1:188374608574:web:108250406138b5a5988cef',
};

const XP_PER_GAME = 25; // PROGRESSION.matchPlay — a bout banks ~25 XP win or lose
const ACTIVE_WINDOW_MS = 26 * 60 * 60 * 1000; // "fought recently" — a touch over a day

const db = getFirestore(initializeApp(firebaseConfig));

/** Read the top players by cumulative XP, with the fields the paper cares about. */
async function readPlayers() {
  const snap = await getDocs(query(collection(db, 'players'), orderBy('xp', 'desc'), limit(50)));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      uid: d.id,
      name: x.name ?? '???',
      xp: x.xp ?? 0,
      elo: x.elo ?? 1000,
      score: x.score ?? 0,
      duo: x.duo ?? 0,
      ffa: x.ffa ?? 0,
      updatedAt: x.updatedAt?.toMillis?.() ?? 0,
    };
  });
}

/** The standings captured when the last edition was filed (or null on day one). */
async function readSnapshot() {
  const snap = await getDoc(doc(db, 'newspaper', '_snapshot'));
  if (!snap.exists()) return null;
  const data = snap.data();
  const byUid = {};
  for (const p of data.players ?? []) byUid[p.uid] = p;
  // Previous XP-rank, for climb/slide detection.
  const prevRank = {};
  [...(data.players ?? [])].sort((a, b) => b.xp - a.xp).forEach((p, i) => (prevRank[p.uid] = i + 1));
  return { byUid, prevRank, capturedAt: data.capturedAt ?? null, edition: data.edition ?? 0 };
}

const players = await readPlayers();
const prev = await readSnapshot();
const now = Date.now();

const rows = players.map((p, i) => {
  const before = prev?.byUid[p.uid];
  const xpDelta = before ? p.xp - before.xp : 0;
  const games = Math.max(0, Math.round(xpDelta / XP_PER_GAME));
  const prevRank = prev?.prevRank[p.uid] ?? null;
  return {
    rank: i + 1,
    name: p.name,
    xp: p.xp,
    elo: p.elo,
    score: p.score,
    duoWins: p.duo,
    ffaWins: p.ffa,
    isNew: !before, // not in the last edition's snapshot — new to the ladder
    xpGained: xpDelta,
    gamesApprox: games,
    scoreGained: before ? p.score - before.score : 0,
    duoGained: before ? p.duo - before.duo : 0,
    ffaGained: before ? p.ffa - before.ffa : 0,
    rankChange: prevRank ? prevRank - (i + 1) : null, // +climbed, -slid
    activeRecently: p.updatedAt > 0 && now - p.updatedAt < ACTIVE_WINDOW_MS,
  };
});

const movers = rows.filter((r) => r.gamesApprox > 0 || r.activeRecently);
const totalGames = rows.reduce((s, r) => s + r.gamesApprox, 0);
const climbers = rows.filter((r) => (r.rankChange ?? 0) > 0).sort((a, b) => b.rankChange - a.rankChange);
const fallers = rows.filter((r) => (r.rankChange ?? 0) < 0).sort((a, b) => a.rankChange - b.rankChange);
const busiest = [...rows].sort((a, b) => b.gamesApprox - a.gamesApprox).filter((r) => r.gamesApprox > 0);

const brief = {
  date: new Date(now).toISOString().slice(0, 10),
  weekday: new Date(now).toLocaleDateString('en-US', { weekday: 'long' }),
  edition: (prev?.edition ?? 0) + 1,
  firstEdition: !prev,
  // Cole's favourite kind of day: nobody threw a single iron ball.
  nobodyFought: totalGames === 0 && movers.length === 0,
  summary: {
    activePlayers: movers.length,
    totalGamesApprox: totalGames,
    newcomers: rows.filter((r) => r.isNew).map((r) => r.name),
    topClimber: climbers[0] ?? null,
    biggestFaller: fallers[0] ?? null,
    busiest: busiest[0] ?? null,
    leader: rows[0] ?? null,
  },
  standings: rows.slice(0, 12),
};

process.stdout.write(JSON.stringify(brief, null, 2) + '\n');
// Firestore's gRPC channel keeps the event loop alive; exit explicitly.
process.exit(0);
