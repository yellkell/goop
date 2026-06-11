/**
 * The network client: owns the WebSocket to the relay, the matchmaking
 * lifecycle, and an inbox of peer messages that NetworkSystem drains once per
 * frame (so all game mutations happen inside the ECS update, never in a
 * socket callback).
 */

import { Quaternion, Vector3 } from 'three';
import { ARENA_GAP, serverUrl } from '../config.js';
import { app } from '../menu/appState.js';
import type { ClientEnvelope, PeerMessage, PoseTuple, ServerEnvelope } from './protocol.js';

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

class NetClient {
  /** Peer messages received since the last drain, oldest first. */
  inbox: PeerMessage[] = [];
  matched = false;

  private ws: WebSocket | null = null;

  /** Connect (if needed) and enter the quick-match queue. */
  queue(): void {
    app.netStatus = 'connecting…';
    this.open()
      .then(() => {
        this.sendRaw({ t: 'queue' });
        app.netStatus = 'searching for an opponent…';
      })
      .catch(() => {
        app.netStatus = `can't reach server ${serverUrl()}`;
        if (app.state === 'queueing') app.state = 'menu';
      });
  }

  /** Leave the queue (or tear down a live bout). */
  cancel(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.sendRaw({ t: 'cancel' });
    this.disconnect();
    app.netStatus = 'not connected';
  }

  disconnect(): void {
    this.matched = false;
    this.inbox.length = 0;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }

  send(d: PeerMessage): void {
    if (this.matched) this.sendRaw({ t: 'msg', d });
  }

  private sendRaw(env: ClientEnvelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(env));
  }

  private open(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    this.disconnect();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(serverUrl());
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('ws error'));
      ws.onclose = () => this.onClosed();
      ws.onmessage = (ev) => this.onMessage(ev);
    });
  }

  private onMessage(ev: MessageEvent): void {
    let env: ServerEnvelope;
    try {
      env = JSON.parse(String(ev.data)) as ServerEnvelope;
    } catch {
      return;
    }
    switch (env.t) {
      case 'waiting':
        app.netStatus = 'searching for an opponent…';
        break;
      case 'matched':
        this.matched = true;
        app.side = env.side;
        app.mode = 'net';
        app.state = 'playing';
        app.netStatus = `in a bout (${env.side === 0 ? 'host' : 'guest'})`;
        break;
      case 'peer-left':
        this.endBout('opponent left');
        break;
      case 'msg':
        // Bound the inbox so a stall can't balloon memory.
        if (this.inbox.length < 256) this.inbox.push(env.d);
        break;
    }
  }

  private onClosed(): void {
    if (this.matched || app.state === 'queueing') this.endBout('connection lost');
    this.ws = null;
  }

  private endBout(why: string): void {
    this.matched = false;
    app.netStatus = why;
    if (app.state !== 'menu') app.state = 'menu';
  }
}

export const net = new NetClient();
