/**
 * Pub WebSocket client. Connects to server/pub.mjs, keeps `pub` state
 * current, and fans server messages out on the bus. Offline (no server) the
 * scene still works solo — systems check `pub.online` and fall back to
 * local-only behaviour.
 */

import type { PubClientMsg, PubServerMsg, PubEvent, PubPlayerNet } from './protocol.js';
import { bus, pub } from './state.js';

let ws: WebSocket | null = null;

/** Called by PubPlayerSystem when a player record arrives off the wire. */
export type SpawnHook = (p: PubPlayerNet) => void;
let spawnHook: SpawnHook | null = null;
export function onSpawn(fn: SpawnHook): void {
  spawnHook = fn;
}

export type SnapPoses = Extract<PubServerMsg, { t: 'snap' }>['poses'];
let snapHook: ((poses: SnapPoses) => void) | null = null;
export function onSnap(fn: (poses: SnapPoses) => void): void {
  snapHook = fn;
}

export function pubConnect(url: string, name: string): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(url);
  } catch {
    console.warn('[pub] cannot open WebSocket to', url);
    return;
  }

  ws.onopen = () => pubSendRaw({ t: 'hello', name });

  ws.onmessage = (e) => {
    let msg: PubServerMsg;
    try {
      msg = JSON.parse(String(e.data)) as PubServerMsg;
    } catch {
      return;
    }
    handle(msg);
  };

  ws.onclose = () => {
    pub.online = false;
    ws = null;
    for (const id of [...pub.punters.keys()]) bus.emit('left', id);
    bus.emit('disconnected', undefined);
  };

  ws.onerror = () => {
    console.warn('[pub] WebSocket error — is the pub server running? (npm run server:pub)');
  };
}

function handle(msg: PubServerMsg): void {
  switch (msg.t) {
    case 'welcome':
      pub.myId = msg.id;
      pub.myAccent = msg.accent;
      pub.online = true;
      pub.board = msg.board;
      pub.snakeHi = msg.snakeHi;
      pub.snakePlayer = msg.snakePlayer;
      for (const prop of msg.props) pub.props.set(prop.id, prop);
      for (const p of msg.players) if (p.id !== msg.id) spawnHook?.(p);
      bus.emit('connected', undefined);
      bus.emit('board', msg.board);
      bus.emit('snakeHi', msg.snakeHi);
      break;
    case 'full':
      console.warn('[pub] room is full (12 punters max)');
      break;
    case 'join':
      spawnHook?.(msg.player);
      break;
    case 'leave':
      bus.emit('left', msg.id);
      break;
    case 'snap':
      snapHook?.(msg.poses);
      break;
    case 'grabbed': {
      const prop = pub.props.get(msg.id);
      if (prop) {
        prop.holder = msg.holder;
        prop.mode = 'held';
      }
      bus.emit('propGrabbed', { id: msg.id, holder: msg.holder });
      break;
    }
    case 'released': {
      const prop = pub.props.get(msg.id);
      if (prop) prop.mode = 'flight';
      bus.emit('propReleased', { id: msg.id, holder: msg.holder });
      break;
    }
    case 'prop': {
      const prop = pub.props.get(msg.id);
      if (prop) {
        prop.pos = msg.pos;
        prop.quat = msg.quat;
      }
      bus.emit('propMoved', { id: msg.id, pos: msg.pos, quat: msg.quat });
      break;
    }
    case 'settled': {
      const prop = pub.props.get(msg.id);
      if (prop) {
        prop.holder = null;
        prop.mode = 'rest';
        prop.pos = msg.pos;
        prop.quat = msg.quat;
      }
      bus.emit('propSettled', { id: msg.id, pos: msg.pos, quat: msg.quat });
      break;
    }
    case 'board':
      pub.board = msg.rows;
      bus.emit('board', msg.rows);
      break;
    case 'snake-player':
      pub.snakePlayer = msg.id;
      bus.emit('snakePlayer', msg.id);
      break;
    case 'snake-hi':
      pub.snakeHi = msg.hi;
      bus.emit('snakeHi', msg.hi);
      break;
    case 'ev':
      bus.emit('gameEvent', { from: msg.from, ev: msg.ev });
      break;
  }
}

export function pubSendRaw(msg: PubClientMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function pubSendEvent(ev: PubEvent): void {
  pubSendRaw({ t: 'ev', ev });
}
