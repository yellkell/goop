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
  lock(): void;
  dropSeat(seat: number): void;
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
  /** Seat → that player's callsign, learned from their `iam` message (empty
   *  until it arrives). The HUD reads this so brawlers show real names, not
   *  the bot-bout 'ALLY'/'BOT' placeholders. */
  names: string[] = [];
  /** Seat → that peer's remote voice stream, set by the impl on `ontrack`. */
  voice = new Map<number, MediaStream>();
  /** True once every seat is filled by a human. */
  full = false;
  /** Room closed to new joiners — full, or the host locked a short-handed FFA. */
  locked = false;
  joined = false;
  /** Status sink for the lobby panel. */
  onStatus: (s: string) => void = () => {};

  private impl: MeshImplApi | null = null;

  /** The lowest still-occupied seat (dropped seats are masked out of
   *  `occupants`), or -1 before any occupancy is known. This is the match
   *  authority — it MIGRATES if the current host disconnects. */
  private lowestSeat(): number {
    for (let i = 0; i < this.occupants.length; i++) if (this.occupants[i]) return i;
    return -1;
  }

  /** True while I hold match authority — normally seat 0, but if the host's
   *  headset dies I become authority the moment I'm the lowest live seat, so
   *  the bout doesn't freeze for everyone with no one running it. */
  isHost(): boolean {
    return this.joined && this.lowestSeat() === this.mySeat;
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

  /** Host: close the room so it goes live short-handed (FFA after the grace). */
  lock(): void {
    this.impl?.lock();
  }

  /** Declare a seat dead — its peer went silent (pose-staleness backstop). */
  dropSeat(seat: number): void {
    this.impl?.dropSeat(seat);
  }

  cancel(): void {
    this.close();
  }

  private close(): void {
    this.impl?.close();
    this.impl = null;
    this.joined = false;
    this.full = false;
    this.locked = false;
    this.inbox.length = 0;
    this.mySeat = 0;
    this.occupants = [];
    this.names = [];
    this.voice.clear();
  }
}

/** Shared mutable state the impl writes and the systems read. */
export type MeshState = Mesh;

export const mesh = new Mesh();
