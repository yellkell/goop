/**
 * Transport abstraction: how PeerMessages reach the other boxer. The game
 * (NetClient and the systems above it) speaks one dialect; the wire under it
 * is swappable:
 *
 *  - wsTransport     — the bundled WebSocket relay (lowest latency when
 *                      hosted near both players; also the LAN/dev default).
 *  - webrtcTransport — serverless: Firebase Firestore for matchmaking +
 *                      signaling, then true peer-to-peer RTCDataChannels.
 */

import type { PeerMessage } from './protocol.js';

export interface TransportEvents {
  /** Human-readable progress for the lobby panel. */
  onStatus(status: string): void;
  /** Paired and the pipe is open. side 0 hosts the match state. */
  onMatched(side: 0 | 1): void;
  onMessage(d: PeerMessage): void;
  /** The opponent's microphone arrived (P2P transport only). */
  onRemoteAudio?(stream: MediaStream): void;
  /** The bout/queue ended underneath us (peer left, connection lost…). */
  onClosed(reason: string): void;
  /** Two players who both became hosts spotted each other: drop this host
   *  lobby and re-enter matchmaking so one claims the other. P2P only. */
  onRequeue?(): void;
}

export interface Transport {
  /** Begin matchmaking. Resolves once queued (NOT once matched). */
  queue(): Promise<void>;
  /** Host a private match; resolves with the 5-digit code to share. P2P only. */
  hostPrivate?(): Promise<string>;
  /** Join a private match by its 5-digit code. P2P only. */
  joinPrivate?(code: string): Promise<void>;
  send(d: PeerMessage): void;
  /** Cancel the queue or tear down a live bout. Safe to call twice. */
  close(): void;
}
