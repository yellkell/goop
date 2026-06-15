/**
 * The network client: picks a transport, owns the matchmaking lifecycle, and
 * keeps an inbox of peer messages that NetworkSystem drains once per frame
 * (so all game mutations happen inside the ECS update, never in a transport
 * callback).
 *
 * Transport choice:
 *   - `?server=wss://…` (or a saved `ibb-server`) → the WebSocket relay;
 *   - otherwise, if Firebase is enabled → serverless WebRTC (Firestore
 *     matchmaking + P2P data channels);
 *   - otherwise → the relay on localhost (dev default).
 *   `?net=ws` forces the relay; `?net=p2p` forces WebRTC.
 */

import { Quaternion, Vector3 } from 'three';
import { ARENA_GAP, serverUrl } from '../config.js';
import { app } from '../menu/appState.js';
import { FIREBASE_ENABLED } from './firebaseConfig.js';
import type { PeerMessage, PoseTuple } from './protocol.js';
import type { Transport, TransportEvents } from './transport.js';
import { attachRemoteVoice, detachRemoteVoice } from './voice.js';
import { WsTransport } from './wsTransport.js';

const Y_180 = new Quaternion(0, 1, 0, 0); // 180° yaw, used to mirror poses

/** Sender-space position → my world space (across the arena, facing me). */
export function mirrorPos(out: Vector3, x: number, y: number, z: number): Vector3 {
  return out.set(-x, y, -z - ARENA_GAP);
}

/** Sender-space orientation → my world space. */
export function mirrorQuat(out: Quaternion, x: number, y: number, z: number, w: number): Quaternion {
  out.set(x, y, z, w);
  return out.premultiply(Y_180);
}

/** Sender-space velocity/direction → my world space. */
export function mirrorVel(out: Vector3, x: number, y: number, z: number): Vector3 {
  return out.set(-x, y, -z);
}

export function packPose(pos: Vector3, quat: Quaternion): PoseTuple {
  return [pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w];
}

/** True when a relay URL was explicitly chosen (param or saved). */
function explicitRelay(): boolean {
  return (
    new URLSearchParams(location.search).has('server') ||
    localStorage.getItem('ibb-server') !== null
  );
}

class NetClient {
  /** Peer messages received since the last drain, oldest first. */
  inbox: PeerMessage[] = [];
  matched = false;

  private transport: Transport | null = null;

  /** Pick a transport and enter the quick-match queue. */
  queue(): void {
    this.disconnect();
    const events = this.makeEvents();
    const force = new URLSearchParams(location.search).get('net');
    const useP2p = force === 'p2p' || (force !== 'ws' && FIREBASE_ENABLED && !explicitRelay());

    void (async () => {
      try {
        if (useP2p) {
          // Firebase + WebRTC loads lazily — bot/training players never pay
          // for the Firebase bundle.
          const { WebRtcTransport } = await import('./webrtcTransport.js');
          this.transport = new WebRtcTransport(events);
        } else {
          this.transport = new WsTransport(serverUrl(), events);
        }
        await this.transport.queue();
      } catch (err) {
        app.netStatus = err instanceof Error ? err.message : 'matchmaking failed';
        this.disconnect();
        if (app.state === 'queueing') app.state = 'menu';
      }
    })();
  }

  /** Leave the queue (or tear down a live bout). */
  cancel(): void {
    this.disconnect();
    app.netStatus = 'not connected';
  }

  disconnect(): void {
    this.matched = false;
    this.inbox.length = 0;
    detachRemoteVoice();
    this.transport?.close();
    this.transport = null;
  }

  send(d: PeerMessage): void {
    if (this.matched) this.transport?.send(d);
  }

  private makeEvents(): TransportEvents {
    return {
      onStatus: (status) => {
        app.netStatus = status;
      },
      onMatched: (side) => {
        this.matched = true;
        app.side = side;
        app.mode = 'net';
        app.state = 'playing';
        app.netStatus = `in a bout (${side === 0 ? 'host' : 'guest'})`;
      },
      onMessage: (d) => {
        // Bound the inbox so a stall can't balloon memory.
        if (this.inbox.length < 256) this.inbox.push(d);
      },
      onRemoteAudio: (stream) => {
        attachRemoteVoice(stream);
      },
      onClosed: (reason) => {
        this.matched = false;
        detachRemoteVoice();
        this.transport = null;
        app.netStatus = reason;
        // A background search that dies mid-bot-bout must NOT evict the player
        // from it — only a foreground queue or a live net bout drops to the
        // lobby. (vs-bot keeps a search running in the background.)
        const inBotBout = app.state === 'playing' && app.mode === 'bot';
        if (app.state !== 'menu' && !inBotBout) app.state = 'menu';
      },
    };
  }
}

export const net = new NetClient();
