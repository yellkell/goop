/**
 * The heavy half of the arcade mesh (see net/mesh.ts for the facade): Firebase
 * Firestore matchmaking + WebRTC signalling. Loaded lazily by the facade so a
 * bot/training/1v1 player never pays for the Firebase bundle.
 *
 * Model: players join a per-mode ROOM and get a canonical SEAT (0..cap-1); seat
 * 0 hosts. Everyone connects peer-to-peer to everyone (a mesh): the lower seat
 * offers, the higher seat answers — the 1v1 codelab handshake, once per pair.
 * Incoming game messages are stamped with the sender's seat and pushed onto the
 * facade's inbox; the facade mirrors seat/occupant/full state for the systems.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentReference,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig.js';
import type { ArcadeMode } from '../config.js';
import type { PeerMessage } from './protocol.js';
import type { MeshState } from './mesh.js';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};
const ROOM_FRESH_MS = 3 * 60 * 1000;
const CAPACITY: Record<ArcadeMode, number> = { '1v1': 2, '2v2': 4, ffa: 4 };

let firebaseApp: FirebaseApp | undefined;
function db(): Firestore {
  firebaseApp ??= getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(firebaseApp);
}

interface MeshWire {
  s: number;
  m: PeerMessage;
}

interface Peer {
  seat: number;
  pc: RTCPeerConnection;
  evt: RTCDataChannel | null;
  pose: RTCDataChannel | null;
  unsubs: Unsubscribe[];
}

export class MeshImpl {
  private readonly clientId = Math.random().toString(36).slice(2, 10);
  private mode: ArcadeMode = '2v2';
  private roomRef: DocumentReference | null = null;
  private peers = new Map<number, Peer>();
  private roomUnsub: Unsubscribe | null = null;
  private closed = false;

  constructor(private readonly state: MeshState) {}

  async queue(mode: ArcadeMode): Promise<void> {
    this.mode = mode;
    this.state.capacity = CAPACITY[mode];
    this.state.onStatus('matchmaking…');
    const rooms = collection(db(), 'arcadeRooms');
    const seat = await this.claimSeat(rooms);
    if (this.closed) return;
    this.state.mySeat = seat;
    this.state.joined = true;
    this.state.onStatus(seat === 0 ? 'hosting — waiting for players…' : `joined (seat ${seat})`);
    this.watchRoom();
  }

  send(msg: PeerMessage): void {
    if (!this.state.joined) return;
    const wire: MeshWire = { s: this.state.mySeat, m: msg };
    const data = JSON.stringify(wire);
    for (const peer of this.peers.values()) {
      const ch = msg.k === 'pose' && peer.pose?.readyState === 'open' ? peer.pose : peer.evt;
      if (ch?.readyState === 'open') {
        try {
          ch.send(data);
        } catch {
          /* channel mid-close */
        }
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.roomUnsub?.();
    this.roomUnsub = null;
    for (const peer of this.peers.values()) {
      for (const u of peer.unsubs) u();
      peer.evt?.close();
      peer.pose?.close();
      peer.pc.close();
    }
    this.peers.clear();
    if (this.roomRef) {
      const ref = this.roomRef;
      const seat = this.state.mySeat;
      const id = this.clientId;
      void runTransaction(db(), async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists()) return;
        const seats = (snap.data().seats as string[]) ?? [];
        if (seat === 0 && seats.filter((s) => s).length <= 1) {
          txn.delete(ref);
        } else if (seats[seat] === id) {
          seats[seat] = '';
          txn.update(ref, { seats, open: true });
        }
      }).catch(() => {});
    }
    this.roomRef = null;
  }

  // --- matchmaking ---------------------------------------------------------

  private async claimSeat(rooms: ReturnType<typeof collection>): Promise<number> {
    const open = await getDocs(
      query(rooms, where('mode', '==', this.mode), where('open', '==', true), limit(10)),
    );
    const now = Date.now();
    for (const snap of open.docs) {
      const created = (snap.data().createdAt?.toMillis?.() as number | undefined) ?? 0;
      if (now - created > ROOM_FRESH_MS) continue;
      try {
        const seat = await runTransaction(db(), async (txn) => {
          const fresh = await txn.get(snap.ref);
          if (!fresh.exists() || fresh.data()?.open !== true) throw new Error('gone');
          const seats = (fresh.data().seats as string[]) ?? [];
          const free = seats.findIndex((s) => !s);
          if (free < 0) throw new Error('full');
          seats[free] = this.clientId;
          txn.update(snap.ref, { seats, open: !seats.every((s) => s) });
          return free;
        });
        this.roomRef = snap.ref;
        return seat;
      } catch {
        continue;
      }
    }
    const seats = Array.from({ length: this.state.capacity }, (_, i) => (i === 0 ? this.clientId : ''));
    this.roomRef = await addDoc(rooms, {
      mode: this.mode,
      capacity: this.state.capacity,
      seats,
      open: true,
      createdAt: serverTimestamp(),
    });
    return 0;
  }

  private watchRoom(): void {
    if (!this.roomRef) return;
    this.roomUnsub = onSnapshot(this.roomRef, (snap) => {
      if (!snap.exists() || this.closed) return;
      const seats = (snap.data().seats as string[]) ?? [];
      this.state.occupants = seats;
      this.state.full = seats.length > 0 && seats.every((s) => s);
      if (this.state.full) this.state.onStatus('all players in — fight!');
      for (let seat = 0; seat < seats.length; seat++) {
        if (seat === this.state.mySeat || !seats[seat] || this.peers.has(seat)) continue;
        if (this.state.mySeat < seat) void this.connectAsOfferer(seat);
        else void this.connectAsAnswerer(seat);
      }
    });
  }

  // --- mesh signalling (one pair = one `sig` doc) --------------------------

  private sigRef(lo: number, hi: number): DocumentReference {
    return doc(collection(this.roomRef!, 'sig'), `${lo}_${hi}`);
  }

  private newPeer(seat: number): Peer {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    const peer: Peer = { seat, pc, evt: null, pose: null, unsubs: [] };
    this.peers.set(seat, peer);
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.dropPeer(seat);
    };
    return peer;
  }

  private adopt(peer: Peer, evt: RTCDataChannel, pose: RTCDataChannel | null): void {
    peer.evt = evt;
    peer.pose = pose;
    const onMsg = (ev: MessageEvent): void => {
      try {
        const wire = JSON.parse(String(ev.data)) as MeshWire;
        if (this.state.inbox.length < 512) this.state.inbox.push({ seat: wire.s, msg: wire.m });
      } catch {
        /* drop malformed */
      }
    };
    evt.onmessage = onMsg;
    if (pose) pose.onmessage = onMsg;
  }

  private async connectAsOfferer(seat: number): Promise<void> {
    const peer = this.newPeer(seat);
    const pc = peer.pc;
    this.adopt(
      peer,
      pc.createDataChannel('evt', { ordered: true }),
      pc.createDataChannel('pose', { ordered: false, maxRetransmits: 0 }),
    );
    const ref = this.sigRef(this.state.mySeat, seat);
    const myCands = collection(ref, `c${this.state.mySeat}`);
    const theirCands = collection(ref, `c${seat}`);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) void addDoc(myCands, ev.candidate.toJSON()).catch(() => {});
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await runTransaction(db(), async (txn) => {
      txn.set(ref, { offer: { type: offer.type, sdp: offer.sdp } }, { merge: true });
    });
    peer.unsubs.push(
      onSnapshot(ref, (snap) => {
        const answer = snap.data()?.answer as RTCSessionDescriptionInit | undefined;
        if (answer && !pc.currentRemoteDescription) {
          void pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(() => {});
        }
      }),
    );
    this.drink(peer, theirCands);
  }

  private async connectAsAnswerer(seat: number): Promise<void> {
    const peer = this.newPeer(seat);
    const pc = peer.pc;
    pc.ondatachannel = (ev) => {
      const chans = [peer.evt, peer.pose, ev.channel].filter(Boolean) as RTCDataChannel[];
      const evt = chans.find((c) => c.label === 'evt') ?? null;
      const pose = chans.find((c) => c.label === 'pose') ?? null;
      if (evt) this.adopt(peer, evt, pose);
    };
    const ref = this.sigRef(seat, this.state.mySeat);
    const myCands = collection(ref, `c${this.state.mySeat}`);
    const theirCands = collection(ref, `c${seat}`);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) void addDoc(myCands, ev.candidate.toJSON()).catch(() => {});
    };
    peer.unsubs.push(
      onSnapshot(ref, (snap) => {
        const offer = snap.data()?.offer as RTCSessionDescriptionInit | undefined;
        if (offer && !pc.currentRemoteDescription) {
          void (async () => {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await updateDoc(ref, { answer: { type: answer.type, sdp: answer.sdp } });
          })().catch(() => {});
        }
      }),
    );
    this.drink(peer, theirCands);
  }

  private drink(peer: Peer, cands: ReturnType<typeof collection>): void {
    peer.unsubs.push(
      onSnapshot(cands, (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type !== 'added') continue;
          void peer.pc.addIceCandidate(new RTCIceCandidate(change.doc.data() as RTCIceCandidateInit)).catch(() => {});
        }
      }),
    );
  }

  private dropPeer(seat: number): void {
    const peer = this.peers.get(seat);
    if (!peer) return;
    for (const u of peer.unsubs) u();
    peer.evt?.close();
    peer.pose?.close();
    peer.pc.close();
    this.peers.delete(seat);
  }
}
