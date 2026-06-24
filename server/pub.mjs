/**
 * IRON BALLS PUB server — one shared room, up to 12 punters.
 *
 * Unlike the 1v1 bout relay (index.mjs) this server holds real state:
 *   - players and their latest poses, snapshotted to everyone at 20 Hz;
 *   - prop ownership: each pint glass / dart has at most one simulating
 *     owner; grabs are granted first-come (which is also how a mid-air
 *     CATCH transfers a throw to the catcher);
 *   - the darts leaderboard (per session — wiped when the pub empties);
 *   - the IRON SNAKE machine claim + its high score, persisted to
 *     server/pub-data.json so the house record survives restarts.
 *
 * Protocol: see src/pub/protocol.ts.
 *
 *   npm run server:pub        # listens on :8788 (or PORT=...)
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8788);
const MAX_PLAYERS = 12;
const TICK_MS = 50; // 20 Hz snapshots
// Glasses are ids 0-14 (the pub opens with 8 active; the barkeep brings the
// rest out one at a time), darts are ids 15-20. Mirrors src/pub/config.ts.
const GLASS_MAX = 8;
const GLASS_START = 0;
const DART_COUNT = 6;
const PROP_COUNT = GLASS_MAX + DART_COUNT;
const RESTOCK_MS = 14_000;

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), 'pub-data.json');

// Accents handed out by join order — mirrors ACCENTS in src/pub/config.ts.
const ACCENTS = [
  0xff7a18, 0x4fb7ff, 0x7dff5a, 0xff4fd8, 0xffb000, 0x9f7bff,
  0x4dffc8, 0xe8352a, 0xf4f6fb, 0x5a8cff, 0xffe04d, 0xff8c5a,
];

// --- persisted state ---------------------------------------------------------
function loadData() {
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { snakeHi: { name: '—', score: 0 } };
  }
}

// --- moderation -----------------------------------------------------------------
// An admin (yellkell) can remove a misbehaving punter from the browser admin
// panel (hold Z+A+P). A ban closes their socket — which also cuts their voice,
// since voice rides this same socket — and remembers their IP + client id so
// they can't just rejoin. The list persists with the rest of the pub data.
//
// Bans must carry ADMIN_TOKEN (set it in the Render service environment);
// without it the ban controls are inert, so a random punter can't wield them.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
// This name can never be banned, however it's typed (case/space-insensitive).
const PROTECTED_NAME = 'yellkell';

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '';
}

function isBanned(ip, cid) {
  return (ip && data.bans.ips.includes(ip)) || (cid && data.bans.cids.includes(cid));
}
function saveData() {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[iron-balls-pub] could not persist data:', err.message);
  }
}
const data = loadData();
if (!data.bans) data.bans = { ips: [], cids: [] };

// --- room state ---------------------------------------------------------------
/** id → { ws, name, accent, head, left, right } */
const players = new Map();
/** id → { kind, holder, mode, pos, quat } */
const props = new Map();
for (let i = 0; i < PROP_COUNT; i++) {
  props.set(i, {
    id: i,
    kind: i < GLASS_MAX ? 'glass' : 'dart',
    holder: null,
    mode: 'rest',
    pos: null,
    quat: null,
    // Darts are always out; glasses past the opening 8 wait in the back.
    active: i >= GLASS_MAX || i < GLASS_START,
  });
}
const board = new Map(); // playerId → { name, accent, score, darts }
let snakePlayer = null;
// Jukebox station the whole room shares (−1 = off). Flipped at the cabinet by
// any punter; reset when the pub empties. Mirrors JUKEBOX in src/pub/config.ts.
let music = -1;
// Songs are bundled client-side now (src/pub/songs), so the count is dynamic;
// this is just a sanity cap on the index a client may select.
const MUSIC_STATIONS = 64;
let nextId = 1;
let joinCount = 0;

// --- fight hall lifecycle -------------------------------------------------------
// Best of 5 (first to WIN_TARGET round wins), mirroring the arena's MATCH:
//   idle → (both corners claimed) starting (3-2-1) → fighting
//   round ends on a KO (hp 0) or when ROUND_TIME runs out (higher hp wins)
//   → roundOver (a breather) → starting (3-2-1) → next round's fighting …
//   until someone reaches 3 → over → idle. Fighters report their own hp
//   (victim-authoritative, like the arena); the server rules on the lifecycle.
// Keep these in sync with FIGHT in src/pub/config.ts.
const HP_MAX = 100;
const WIN_TARGET = 3; // round wins to take the match (best of 5)
const ROUND_TIME = 60; // seconds per round
const START_COUNTDOWN = 3; // pre-round 3-2-1 countdown, before EVERY round
const ROUND_OVER_DELAY = 5; // seconds of round-result breather between rounds
const MATCH_OVER_DELAY = 6; // seconds of match-result pause
const fight = {
  phase: 'idle',
  sides: [null, null],
  hp: [HP_MAX, HP_MAX],
  score: [0, 0],
  round: 1,
  roundTimer: 0,
  winner: null,
};
let fightTimer = null;
let lastTimerSent = -1;

function fightNet() {
  return {
    phase: fight.phase,
    sides: fight.sides,
    hp: fight.hp,
    score: fight.score,
    round: fight.round,
    roundTimer: fight.roundTimer,
    winner: fight.winner,
  };
}

function broadcastFight() {
  lastTimerSent = Math.ceil(fight.roundTimer);
  broadcast({ t: 'fight', fight: fightNet() });
}

function resetFight() {
  clearTimeout(fightTimer);
  fightTimer = null;
  fight.phase = 'idle';
  fight.sides = [null, null];
  fight.hp = [HP_MAX, HP_MAX];
  fight.score = [0, 0];
  fight.round = 1;
  fight.roundTimer = 0;
  fight.winner = null;
}

/** Both corners claimed → fresh match: zero the card, then round 1's countdown. */
function startMatch() {
  fight.score = [0, 0];
  fight.winner = null;
  startRound(1);
}

/** Open a round on a 3-2-1 countdown ('starting'). The round-clock tick rolls
 *  it into the bell (beginRound) when it reaches zero — so EVERY round, not
 *  just the first, gets the countdown. */
function startRound(roundNum) {
  clearTimeout(fightTimer);
  fightTimer = null;
  fight.round = roundNum;
  fight.phase = 'starting';
  fight.hp = [HP_MAX, HP_MAX];
  fight.roundTimer = START_COUNTDOWN;
  fight.winner = null;
  broadcastFight();
}

/** Bell: full health, clock reset, live. */
function beginRound() {
  fight.phase = 'fighting';
  fight.hp = [HP_MAX, HP_MAX];
  fight.roundTimer = ROUND_TIME;
  fight.winner = null;
  broadcastFight();
}

/** A round was decided (KO, time, or draw): score it, then the next round or the match. */
function endRound(winnerSide) {
  if (winnerSide !== null && winnerSide !== 0 && winnerSide !== 1) return;
  fight.winner = winnerSide === null ? null : fight.sides[winnerSide];
  if (winnerSide !== null) {
    fight.score[winnerSide] += 1;
    if (fight.score[winnerSide] >= WIN_TARGET) {
      endMatch(fight.sides[winnerSide]);
      return;
    }
  }
  fight.phase = 'roundOver';
  broadcastFight();
  clearTimeout(fightTimer);
  fightTimer = setTimeout(() => {
    if (fight.sides[0] && fight.sides[1]) startRound(fight.round + 1);
  }, ROUND_OVER_DELAY * 1000);
}

function endMatch(winnerId) {
  fight.phase = 'over';
  fight.winner = winnerId;
  broadcastFight();
  clearTimeout(fightTimer);
  fightTimer = setTimeout(() => {
    resetFight();
    broadcastFight();
  }, MATCH_OVER_DELAY * 1000);
}

function leaveFight(id) {
  const side = fight.sides.indexOf(id);
  if (side === -1) return;
  if (fight.phase === 'fighting' || fight.phase === 'starting' || fight.phase === 'roundOver') {
    // Walked off / disconnected mid-bout: forfeit the whole match.
    endMatch(fight.sides[side === 0 ? 1 : 0]);
  } else if (fight.phase === 'idle') {
    fight.sides[side] = null;
    broadcastFight();
  }
}

// Round clock + pre-round countdown: tick while a round is live (higher hp wins
// on time-out) AND while the 3-2-1 counts down (ring the bell at zero).
setInterval(() => {
  if (fight.phase === 'fighting') {
    fight.roundTimer = Math.max(0, fight.roundTimer - 0.25);
    if (fight.roundTimer <= 0) {
      endRound(fight.hp[0] === fight.hp[1] ? null : fight.hp[0] > fight.hp[1] ? 0 : 1);
    } else if (Math.ceil(fight.roundTimer) !== lastTimerSent) {
      broadcastFight(); // push the clock only when the displayed second changes
    }
  } else if (fight.phase === 'starting') {
    fight.roundTimer = Math.max(0, fight.roundTimer - 0.25);
    if (fight.roundTimer <= 0) {
      if (fight.sides[0] && fight.sides[1]) beginRound();
    } else if (Math.ceil(fight.roundTimer) !== lastTimerSent) {
      broadcastFight(); // push the countdown second so clients show 3 → 2 → 1
    }
  }
}, 250);

const ZERO_POSE = [0, 0, 0, 0, 0, 0, 1];

// --- voice routing --------------------------------------------------------------
// Spatial voice rides this same socket as binary PCM frames. The server fans
// each frame out to the WHOLE room — fighters and crowd alike always hear
// everyone (the open pub never goes quiet, even mid-bout). Spatial falloff in
// the client keeps distant voices distant.
function relayVoice(senderId, payload) {
  if (!players.has(senderId)) return;
  const idBuf = Buffer.from(senderId, 'ascii');
  const out = Buffer.concat([Buffer.from([idBuf.length]), idBuf, payload]);
  for (const [rid, r] of players) {
    if (rid === senderId) continue;
    if (r.ws.readyState === r.ws.OPEN) r.ws.send(out, { binary: true });
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId) {
  const raw = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(raw);
  }
}

function boardRows() {
  return [...board.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.score - a.score);
}

function playerNet(id) {
  const p = players.get(id);
  return { id, name: p.name, accent: p.accent, av: p.av, pf: p.pf, avc: p.avc, avl: p.avl, head: p.head, left: p.left, right: p.right };
}

function releaseSnake(id) {
  if (snakePlayer === id) {
    snakePlayer = null;
    broadcast({ t: 'snake-player', id: null });
  }
}

function handleEvent(senderId, ev) {
  switch (ev.e) {
    case 'DART_HIT': {
      const p = players.get(senderId);
      const row = board.get(senderId) ?? { name: p.name, accent: p.accent, score: 0, darts: 0 };
      row.score += ev.score;
      row.darts += 1;
      board.set(senderId, row);
      broadcast({ t: 'ev', from: senderId, ev });
      broadcast({ t: 'board', rows: boardRows() });
      break;
    }
    case 'DARTS_RESET':
      board.clear();
      broadcast({ t: 'ev', from: senderId, ev });
      broadcast({ t: 'board', rows: [] });
      break;
    case 'FIGHT_HP': {
      const side = fight.sides.indexOf(senderId);
      if (side !== -1 && fight.phase === 'fighting') {
        fight.hp[side] = ev.hp;
        if (ev.hp <= 0) {
          endRound(fight.hp[0] <= 0 && fight.hp[1] <= 0 ? null : side === 0 ? 1 : 0); // the OTHER corner won the round
        } else {
          broadcastFight();
        }
      }
      break;
    }
    case 'SNAKE_OVER': {
      if (ev.score > data.snakeHi.score) {
        data.snakeHi = { name: players.get(senderId)?.name ?? '???', score: ev.score };
        saveData();
        broadcast({ t: 'snake-hi', hi: data.snakeHi });
      }
      releaseSnake(senderId);
      broadcast({ t: 'ev', from: senderId, ev }, senderId);
      break;
    }
    default:
      // SNAKE_STATE and friends: pure relay, skip the sender.
      broadcast({ t: 'ev', from: senderId, ev }, senderId);
  }
}

// --- LiveKit voice tokens -------------------------------------------------------
// Pub voice runs through a LiveKit SFU (the 1v1 arena keeps its own P2P voice).
// We mint short-lived access tokens here so the API secret never reaches the
// browser. A LiveKit token is a plain HS256 JWT, so we sign it with the API
// secret using node:crypto — no extra server dependency to deploy on Render.
//
// Set these in the Render service environment (Dashboard → Environment):
//   LIVEKIT_URL      wss://<your-project>.livekit.cloud
//   LIVEKIT_API_KEY  (from the LiveKit Cloud project's Keys page)
//   LIVEKIT_API_SECRET
const LK_URL = process.env.LIVEKIT_URL || '';
const LK_KEY = process.env.LIVEKIT_API_KEY || '';
const LK_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LK_READY = Boolean(LK_URL && LK_KEY && LK_SECRET);

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A LiveKit join token (JWT) for `identity` in `room`, valid for 6 hours. */
function livekitToken(identity, name, room) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: LK_KEY,
      sub: identity,
      name,
      nbf: now,
      iat: now,
      exp: now + 6 * 60 * 60,
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false },
    }),
  );
  const sig = b64url(createHmac('sha256', LK_SECRET).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

// --- wiring ---------------------------------------------------------------------
const http = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Browser fetches the voice token cross-origin (Firebase Hosting → Render).
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/token') {
    if (!LK_READY) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'voice not configured' }));
      return;
    }
    const identity = (url.searchParams.get('identity') || `anon-${Math.random().toString(36).slice(2, 8)}`).slice(0, 64);
    const name = (url.searchParams.get('name') || '').slice(0, 32);
    const room = (url.searchParams.get('room') || 'iron-balls-pub').slice(0, 64);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ token: livekitToken(identity, name, room), url: LK_URL }));
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      pub: 'iron-balls-pub',
      punters: players.size,
      snakeHi: data.snakeHi,
      voice: LK_READY ? 'livekit' : 'off',
    }),
  );
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const ip = clientIp(req);
  let myId = null;

  ws.on('message', (raw, isBinary) => {
    // Binary frames are spatial voice — fanned out to the whole room (open mic).
    if (isBinary) {
      if (myId) relayVoice(myId, raw);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.t === 'hello') {
      if (myId) return;
      const cid = String(msg.cid || '').slice(0, 64);
      if (isBanned(ip, cid)) {
        send(ws, { t: 'banned' });
        ws.close(1008, 'banned');
        return;
      }
      if (players.size >= MAX_PLAYERS) {
        send(ws, { t: 'full' });
        ws.close(1013, 'pub full');
        return;
      }
      myId = `p${nextId++}`;
      const accent = ACCENTS[joinCount++ % ACCENTS.length];
      players.set(myId, {
        ws,
        ip,
        cid,
        name: String(msg.name || myId).slice(0, 14),
        accent,
        av: String(msg.av || '').slice(0, 16),
        pf: String(msg.pf || '').slice(0, 16),
        avc: Number.isFinite(msg.avc) ? msg.avc : -1, // custom armour hue (0..1) or -1
        avl: Number.isFinite(msg.avl) ? msg.avl : 0.5, // custom armour lightness (0..1)
        head: ZERO_POSE,
        left: ZERO_POSE,
        right: ZERO_POSE,
      });
      send(ws, {
        t: 'welcome',
        id: myId,
        accent,
        players: [...players.keys()].map(playerNet),
        props: [...props.values()],
        board: boardRows(),
        snakeHi: data.snakeHi,
        snakePlayer,
        fight: fightNet(),
        music,
      });
      broadcast({ t: 'join', player: playerNet(myId) }, myId);
      console.log(`[iron-balls-pub] ${myId} (${players.get(myId).name}) in — ${players.size}/${MAX_PLAYERS}`);
      return;
    }

    if (!myId) return;
    const me = players.get(myId);

    switch (msg.t) {
      case 'pose':
        me.head = msg.head;
        me.left = msg.left;
        me.right = msg.right;
        break;
      case 'grab': {
        const prop = props.get(msg.id);
        if (!prop) break;
        // Granted if free or mid-flight (a catch). A prop held in someone's
        // hand can't be wrestled away — the requester learns who has it.
        if (prop.holder === null || prop.mode === 'flight' || prop.holder === myId) {
          prop.holder = myId;
          prop.mode = 'held';
          broadcast({ t: 'grabbed', id: prop.id, holder: myId });
        } else {
          send(ws, { t: 'grabbed', id: prop.id, holder: prop.holder });
        }
        break;
      }
      case 'release': {
        const prop = props.get(msg.id);
        if (prop && prop.holder === myId) {
          prop.mode = 'flight';
          broadcast({ t: 'released', id: prop.id, holder: myId }, myId);
        }
        break;
      }
      case 'prop': {
        const prop = props.get(msg.id);
        if (prop && prop.holder === myId) {
          prop.pos = msg.pos;
          prop.quat = msg.quat;
          broadcast({ t: 'prop', id: prop.id, pos: msg.pos, quat: msg.quat }, myId);
        }
        break;
      }
      case 'settle': {
        const prop = props.get(msg.id);
        if (prop && (prop.holder === myId || prop.holder === null)) {
          prop.holder = null;
          prop.mode = 'rest';
          prop.pos = msg.pos;
          prop.quat = msg.quat;
          broadcast({ t: 'settled', id: prop.id, pos: msg.pos, quat: msg.quat }, myId);
        }
        break;
      }
      case 'claim-snake':
        if (snakePlayer === null || snakePlayer === myId) {
          snakePlayer = myId;
          broadcast({ t: 'snake-player', id: myId });
        } else {
          send(ws, { t: 'snake-player', id: snakePlayer });
        }
        break;
      case 'leave-snake':
        releaseSnake(myId);
        break;
      case 'claim-fight': {
        const side = msg.side === 1 ? 1 : 0;
        if (fight.phase === 'idle' && fight.sides[side] === null && !fight.sides.includes(myId)) {
          fight.sides[side] = myId;
          if (fight.sides[0] && fight.sides[1]) startMatch();
          else broadcastFight();
        } else {
          send(ws, { t: 'fight', fight: fightNet() });
        }
        break;
      }
      case 'leave-fight':
        leaveFight(myId);
        break;
      case 'music': {
        // Any punter may flip the room's station. Clamp to a real station or off.
        const s = Number.isInteger(msg.station) ? msg.station : -1;
        music = s >= 0 && s < MUSIC_STATIONS ? s : -1;
        broadcast({ t: 'music', station: music });
        break;
      }
      case 'admin-ban': {
        if (!ADMIN_TOKEN || msg.token !== ADMIN_TOKEN) {
          send(ws, {
            t: 'admin-result',
            ok: false,
            msg: ADMIN_TOKEN ? 'wrong admin key' : 'admin disabled — no ADMIN_TOKEN set on the server',
          });
          break;
        }
        const target = players.get(msg.id);
        if (!target) {
          send(ws, { t: 'admin-result', ok: false, msg: 'that punter has already left' });
          break;
        }
        if (String(target.name).trim().toLowerCase() === PROTECTED_NAME) {
          send(ws, { t: 'admin-result', ok: false, msg: `${target.name} can't be banned` });
          break;
        }
        if (target.ip && !data.bans.ips.includes(target.ip)) data.bans.ips.push(target.ip);
        if (target.cid && !data.bans.cids.includes(target.cid)) data.bans.cids.push(target.cid);
        saveData();
        send(target.ws, { t: 'banned' });
        target.ws.close(1008, 'banned'); // the close handler clears their seat + props
        send(ws, { t: 'admin-result', ok: true, msg: `banned ${target.name}` });
        console.log(`[iron-balls-pub] ADMIN ${myId} banned ${msg.id} (${target.name}) ip=${target.ip} cid=${target.cid}`);
        break;
      }
      case 'ev':
        handleEvent(myId, msg.ev);
        break;
    }
  });

  ws.on('close', () => {
    if (!myId) return;
    players.delete(myId);
    releaseSnake(myId);
    leaveFight(myId);
    // Drop anything they were holding or had in the air where it was last
    // seen — someone else can pick it up.
    for (const prop of props.values()) {
      if (prop.holder === myId) {
        prop.holder = null;
        prop.mode = 'rest';
        if (prop.pos) broadcast({ t: 'settled', id: prop.id, pos: prop.pos, quat: prop.quat });
      }
    }
    broadcast({ t: 'leave', id: myId });
    // Last one out: wipe the session chalkboard (the snake hi-score stays).
    if (players.size === 0) {
      board.clear();
      resetFight();
      music = -1; // the jukebox falls quiet for the next punter in

      for (const prop of props.values()) {
        prop.holder = null;
        prop.mode = 'rest';
        prop.pos = null;
        prop.quat = null;
        prop.active = prop.kind === 'dart' || prop.id < GLASS_START;
      }
    }
    console.log(`[iron-balls-pub] ${myId} out — ${players.size}/${MAX_PLAYERS}`);
  });
});

// The barkeep's restock round: while anyone is in, bring out one fresh
// glass every RESTOCK_MS until all 8 are on the floor. (Clients animate the
// robot walking it over; the glass lands on the bar a few seconds after this
// broadcast — see glassDeliverDelay in src/pub/config.ts.)
setInterval(() => {
  if (players.size === 0) return;
  const next = [...props.values()].find((p) => p.kind === 'glass' && !p.active);
  if (!next) return;
  next.active = true;
  broadcast({ t: 'glass-out', id: next.id });
}, RESTOCK_MS);

// 20 Hz pose snapshots (each recipient gets everyone but themselves).
setInterval(() => {
  if (players.size < 2) return;
  for (const [id, p] of players) {
    const poses = [];
    for (const [oid, o] of players) {
      if (oid !== id) poses.push([oid, o.head, o.left, o.right]);
    }
    send(p.ws, { t: 'snap', poses });
  }
}, TICK_MS);

// Heartbeat: cull dead sockets.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 10_000);

http.listen(PORT, () => {
  console.log(`[iron-balls-pub] pub open on :${PORT} — hi-score ${data.snakeHi.score} (${data.snakeHi.name})`);
});
