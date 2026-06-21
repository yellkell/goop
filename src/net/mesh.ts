/**
 * Arcade mesh networking facade (2v2 / FFA). Kept Firebase-free so it can be
 * imported synchronously by the gameplay systems without dragging the Firebase
 * bundle into the main chunk — the heavy Firestore + WebRTC half lives in
 * meshImpl.ts and is loaded lazily the first time you queue an arcade brawl.
 * Completely separate from the 1v1 transports, so the duel is untouched.
 *
 * The facade owns the shared, mutable state the gameplay reads each frame
 * (inbox of {seat,msg}, my seat, room occupancy, whether the room is full);
 * the impl writes into it. NOTE: the mesh is built without a live multi-client
 * test rig — it type-checks/builds but expect to validate it against real
 * peers. It never runs for the duel or bot bouts.
 */

import type { ArcadeMode } from '../config.js';
import type { PeerMessage } from './protocol.js';

export interface MeshInbox {
  seat: number;
  msg: PeerMessage;
}

interface MeshImplApi {
  queue(mode: ArcadeMode): Promise<void>;
  send(msg: PeerMessage): void;
  close(): void;
}

class Mesh {
  /** {seat,msg} received since the last drain — MeshSystem empties it. */
  inbox: MeshInbox[] = [];
  /** My canonical seat in the room (0 = host). */
  mySeat = 0;
  /** Players this mode seats. */
  capacity = 0;
  /** Seat → member id ('' = still empty); mirrors the room doc. */
  occupants: string[] = [];
  /** True once every seat is filled by a human. */
  full = false;
  joined = false;
  /** Status sink for the lobby panel. */
  onStatus: (s: string) => void = () => {};

  private impl: MeshImplApi | null = null;

  /** True while I host the room (seat 0) — owns match state. */
  isHost(): boolean {
    return this.joined && this.mySeat === 0;
  }

  /** Begin matchmaking for a mode; lazily loads the Firestore/WebRTC impl. */
  async queue(mode: ArcadeMode, onStatus?: (s: string) => void): Promise<void> {
    this.close();
    if (onStatus) this.onStatus = onStatus;
    const { MeshImpl } = await import('./meshImpl.js');
    this.impl = new MeshImpl(this);
    await this.impl.queue(mode);
  }

  /** Broadcast a game message to every connected peer (stamped with my seat). */
  send(msg: PeerMessage): void {
    this.impl?.send(msg);
  }

  cancel(): void {
    this.close();
  }

  private close(): void {
    this.impl?.close();
    this.impl = null;
    this.joined = false;
    this.full = false;
    this.inbox.length = 0;
    this.mySeat = 0;
    this.occupants = [];
  }
}

/** Shared mutable state the impl writes and the systems read. */
export type MeshState = Mesh;

export const mesh = new Mesh();
