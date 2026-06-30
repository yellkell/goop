/**
 * Pub WebSocket client. Connects to server/pub.mjs, keeps `pub` state
 * current, and fans server messages out on the bus. Offline (no server) the
 * scene still works solo — systems check `pub.online` and fall back to
 * local-only behaviour.
 */

import type { PubClientMsg, PubServerMsg, PubEvent, PubPlayerNet } from './protocol.js';
import { bus, normalizeFight, pub } from './state.js';

let ws: WebSocket | null = null;

/**
 * A stable per-device id, shared with the FIRE FIGHT leaderboard
 * (`ff-player-id`). Sent on join so an admin ban can block this device's
 * rejoin — best-effort (clearing storage mints a new one), but enough to keep
 * out a casual repeat offender.
 */
function clientId(): string {
  try {
    let id = localStorage.getItem('ff-player-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('ff-player-id', id);
    }
    return id;
  } catch {
    return '';
  }
}

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

/** Called with each inbound voice frame: (senderId, opus frame bytes). */
let voiceHook: ((id: string, frame: ArrayBuffer) => void) | null = null;
export function onVoice(fn: (id: string, frame: ArrayBuffer) => void): void {
  voiceHook = fn;
}

export function pubConnect(url: string, name: string, av = '', pf = '', avc = -1, avl = 0.5): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(url);
  } catch {
    console.warn('[pub] cannot open WebSocket to', url);
    return;
  }
  ws.binaryType = 'arraybuffer'; // voice frames ride as binary alongside the JSON

  ws.onopen = () => pubSendRaw({ t: 'hello', name, av, pf, avc, avl, cid: clientId() });

  ws.onmessage = (e) => {
    // Binary payloads are voice frames; everything else is JSON game traffic.
    if (typeof e.data !== 'string') {
      handleVoice(e.data as ArrayBuffer);
      return;
    }
    let msg: PubServerMsg;
    try {
      msg = JSON.parse(e.data) as PubServerMsg;
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
      pub.fight = normalizeFight(msg.fight);
      pub.music = msg.music ?? -1;
      pub.discord = msg.discord ?? [];
      for (const prop of msg.props) pub.props.set(prop.id, prop);
      for (const p of msg.players) if (p.id !== msg.id) spawnHook?.(p);
      bus.emit('connected', undefined);
      bus.emit('board', msg.board);
      bus.emit('snakeHi', msg.snakeHi);
      bus.emit('fight', pub.fight);
      bus.emit('music', pub.music);
      bus.emit('discord', pub.discord);
      break;
    case 'full':
      console.warn('[pub] room is full (12 punters max)');
      bus.emit('full', undefined);
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
    case 'fight':
      pub.fight = normalizeFight(msg.fight);
      bus.emit('fight', pub.fight);
      break;
    case 'glass-out': {
      const prop = pub.props.get(msg.id);
      if (prop) prop.active = true;
      bus.emit('glassOut', msg.id);
      break;
    }
    case 'music':
      pub.music = msg.station;
      bus.emit('music', msg.station);
      break;
    case 'discord':
      // Append the new lines, keep the tail bounded (the TV shows the latest).
      pub.discord = [...pub.discord, ...msg.messages].slice(-30);
      bus.emit('discord', pub.discord);
      break;
    case 'ev':
      bus.emit('gameEvent', { from: msg.from, ev: msg.ev });
      break;
    case 'banned':
      bus.emit('banned', undefined);
      break;
    case 'admin-result':
      bus.emit('adminResult', { ok: msg.ok, msg: msg.msg });
      break;
  }
}

/**
 * A voice frame off the wire: [1-byte id length][ascii sender id][opus frame].
 * The server prepends the sender so we can route it to the right panner.
 */
function handleVoice(buf: ArrayBuffer): void {
  if (!voiceHook || buf.byteLength < 2) return;
  const bytes = new Uint8Array(buf);
  const idLen = bytes[0];
  if (buf.byteLength < 1 + idLen + 8) return;
  let id = '';
  for (let i = 0; i < idLen; i++) id += String.fromCharCode(bytes[1 + i]);
  voiceHook(id, buf.slice(1 + idLen));
}

export function pubSendRaw(msg: PubClientMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Ship one local Opus voice frame to the server (binary). */
export function pubSendVoice(frame: ArrayBuffer): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
}

export function pubSendEvent(ev: PubEvent): void {
  pubSendRaw({ t: 'ev', ev });
}
