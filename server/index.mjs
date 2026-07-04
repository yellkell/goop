/**
 * FIRE FIGHT relay server — minimal WebSocket matchmaking + message relay.
 *
 * Protocol (JSON):
 *   client → server: {t:'queue'} | {t:'cancel'} | {t:'msg', d:{...}}
 *   server → client: {t:'waiting'} | {t:'matched', side:0|1}
 *                  | {t:'peer-left'} | {t:'msg', d:{...}}
 *
 * Quick-match pairs the two longest-waiting players into a room and relays
 * `msg` envelopes between them verbatim. No game logic lives here — the
 * clients rule on hits themselves (victim-authoritative) and the host client
 * owns the match state. That keeps this server tiny, stateless per message,
 * and trivially hostable anywhere Node runs.
 *
 *   npm run server          # listens on :8787 (or PORT=...)
 *
 * Point clients at it with  ?server=wss://your-host:8787  (or ws:// in dev).
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8787);

const http = createServer((req, res) => {
  // A friendly health/status endpoint for load balancers and curiosity.
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ game: 'fire-fight', queue: queue.length, rooms: rooms.size }));
});

const wss = new WebSocketServer({ server: http });

/** Sockets waiting for an opponent, oldest first. */
let queue = [];
/** socket → { peer, room } for live bouts. */
const rooms = new Map();
let nextRoomId = 1;

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function leaveQueue(ws) {
  queue = queue.filter((q) => q !== ws);
}

function endRoom(ws, notifyPeer = true) {
  const entry = rooms.get(ws);
  if (!entry) return;
  rooms.delete(ws);
  rooms.delete(entry.peer);
  if (notifyPeer) send(entry.peer, { t: 'peer-left' });
}

function tryMatch() {
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    if (a.readyState !== a.OPEN) {
      if (b) queue.unshift(b);
      continue;
    }
    if (b.readyState !== b.OPEN) {
      queue.unshift(a);
      continue;
    }
    const room = nextRoomId++;
    rooms.set(a, { peer: b, room });
    rooms.set(b, { peer: a, room });
    send(a, { t: 'matched', side: 0 }); // first in queue hosts
    send(b, { t: 'matched', side: 1 });
    console.log(`[fire-fight] room ${room} matched (queue ${queue.length})`);
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.t) {
      case 'queue':
        if (!rooms.has(ws) && !queue.includes(ws)) {
          queue.push(ws);
          send(ws, { t: 'waiting' });
          tryMatch();
        }
        break;
      case 'cancel':
        leaveQueue(ws);
        endRoom(ws);
        break;
      case 'msg': {
        const entry = rooms.get(ws);
        if (entry) send(entry.peer, { t: 'msg', d: msg.d });
        break;
      }
    }
  });

  ws.on('close', () => {
    leaveQueue(ws);
    endRoom(ws);
  });
});

// Heartbeat: cull dead sockets so queues and rooms never wedge.
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
  console.log(`[fire-fight] relay listening on :${PORT}`);
});
