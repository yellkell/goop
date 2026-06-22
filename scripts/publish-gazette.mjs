/**
 * publish-gazette.mjs — files the finished edition.
 *
 * Usage:  node scripts/publish-gazette.mjs <article.json>
 *
 * Takes Sheriff Cole Ironside's finished article (written by the scheduled
 * Claude task from the ladder brief) and:
 *   1. writes it to Firestore `newspaper/latest` with a bumped edition number
 *      and a publish timestamp — the lobby reads this and lights the red dot;
 *   2. rolls `newspaper/_snapshot` forward to the CURRENT standings, so the
 *      next `ladder-brief.mjs` run diffs against today, not last week.
 *
 * The article JSON must have: headline, subhead, body, mood. Optional:
 * byline (defaults to Sheriff Cole Ironside), dateline (auto-built if absent).
 *
 * Needs a Firestore rule allowing writes to the `newspaper` collection — see
 * docs/gasket-gazette.md.
 */

import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { collection, doc, getDoc, getDocs, getFirestore, limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyA0NYO_w6uU0Fcc6nuVPitRQaGW3B6518E',
  authDomain: 'arfi-b68f9.firebaseapp.com',
  projectId: 'arfi-b68f9',
  storageBucket: 'arfi-b68f9.firebasestorage.app',
  messagingSenderId: '188374608574',
  appId: '1:188374608574:web:108250406138b5a5988cef',
};

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/publish-gazette.mjs <article.json>');
  process.exit(1);
}

const article = JSON.parse(readFileSync(file, 'utf8'));
for (const field of ['headline', 'body']) {
  if (!article[field] || typeof article[field] !== 'string') {
    console.error(`article is missing a string "${field}"`);
    process.exit(1);
  }
}

const db = getFirestore(initializeApp(firebaseConfig));

// Bump the edition off whatever's currently live.
const latestSnap = await getDoc(doc(db, 'newspaper', 'latest'));
const edition = ((latestSnap.exists() && latestSnap.data().edition) || 0) + 1;

const today = new Date();
const dateline =
  article.dateline ||
  `GASKET TERRITORY — ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}`;

await setDoc(doc(db, 'newspaper', 'latest'), {
  edition,
  dateline,
  headline: article.headline,
  subhead: article.subhead ?? '',
  body: article.body,
  byline: article.byline ?? 'Sheriff Cole Ironside',
  mood: article.mood ?? '',
  publishedAt: serverTimestamp(),
});

// Roll the snapshot forward to today's standings for tomorrow's diff.
const playersSnap = await getDocs(query(collection(db, 'players'), orderBy('xp', 'desc'), limit(80)));
const standings = playersSnap.docs.map((d) => {
  const x = d.data();
  return {
    uid: d.id,
    name: x.name ?? '???',
    xp: x.xp ?? 0,
    elo: x.elo ?? 1000,
    score: x.score ?? 0,
    duo: x.duo ?? 0,
    ffa: x.ffa ?? 0,
  };
});
await setDoc(doc(db, 'newspaper', '_snapshot'), {
  edition,
  capturedAt: serverTimestamp(),
  players: standings,
});

console.log(`Filed edition No. ${edition} — "${article.headline}" (${standings.length} players snapshotted).`);
