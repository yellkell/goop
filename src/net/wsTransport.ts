/**
 * WebSocket relay transport — speaks to server/index.mjs. Everything
 * (poses and events) flows through the relay. Best when the relay is hosted
 * near both players; also the dev/LAN default.
 */

import type { ClientEnvelope, ServerEnvelope } from './protocol.js';
import type { PeerMessage } from './protocol.js';
import type { Transport, TransportEvents } from './transport.js';

export class WsTransport implements Transport {
  private ws: WebSocket | null = null;
  private matched = false;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly events: TransportEvents,
  ) {}

  queue(): Promise<void> {
    this.events.onStatus('connecting…');
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.sendRaw({ t: 'queue' });
        this.events.onStatus('searching for an opponent…');
        resolve();
      };
      ws.onerror = () => reject(new Error(`can't reach relay ${this.url}`));
      ws.onclose = () => {
        if (!this.closed && (this.matched || true)) {
          this.teardown('connection lost');
        }
      };
      ws.onmessage = (ev) => this.onMessage(ev);
    });
  }

  send(d: PeerMessage): void {
    if (this.matched) this.sendRaw({ t: 'msg', d });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) this.sendRaw({ t: 'cancel' });
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
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
        this.events.onStatus('searching for an opponent…');
        break;
      case 'matched':
        this.matched = true;
        this.events.onMatched(env.side);
        break;
      case 'peer-left':
        this.teardown('opponent left');
        break;
      case 'msg':
        this.events.onMessage(env.d);
        break;
    }
  }

  private sendRaw(env: ClientEnvelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(env));
  }

  private teardown(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.matched = false;
    this.ws = null;
    this.events.onClosed(reason);
  }
}
