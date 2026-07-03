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
import { voiceEnabled } from '../audio/voicePref.js';
import type { ArcadeMode } from '../config.js';
import type { PeerMessage } from './protocol.js';
import type { MeshState } from './mesh.js';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};
const ROOM_FRESH_MS = 3 * 60 * 1000;
const CAPACITY: Record<ArcadeMode, number> = { '1v1': 2, '2v2': 4, ffa: 4, raid: 4 };

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
  /** Latest raw `seats` from the room doc (before masking dropped peers). */
  private rawSeats: string[] = [];
  /** seat → the id we've declared DEAD (headset died / went silent). Masked out
   *  of `occupants` so a hard-disconnected player stops counting as present,
   *  even though they never cleaned up their own seat in the room doc. */
  private droppedIds = new Map<number, string>();
  private roomUnsub: Unsubscribe | null = null;
  private closed = false;
  private micStream: MediaStream | null = null;
  private micPromise: Promise<MediaStream | null> | null = null;

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

  /** RAID: always CREATE a fresh, visible lobby (never auto-join) — the room
   *  browser is the front door; hosts and joiners take different paths. */
  async hostRaid(name: string): Promise<void> {
    this.mode = 'raid';
    this.state.capacity = CAPACITY.raid;
    this.state.onStatus('opening a raid lobby…');
    const rooms = collection(db(), 'arcadeRooms');
    const seats = Array.from({ length: this.state.capacity }, (_, i) => (i === 0 ? this.clientId : ''));
    const names = Array.from({ length: this.state.capacity }, (_, i) => (i === 0 ? name : ''));
    this.roomRef = await addDoc(rooms, {
      mode: 'raid',
      capacity: this.state.capacity,
      seats,
      names,
      hardcore: false,
      started: false,
      open: true,
      createdAt: serverTimestamp(),
    });
    if (this.closed) return;
    this.state.mySeat = 0;
    this.state.joined = true;
    this.state.names[0] = name;
    this.state.onStatus('lobby open — waiting for raiders…');
    this.watchRoom();
  }

  /** RAID: claim a seat in a SPECIFIC listed lobby. False = filled/gone. */
  async joinRaid(roomId: string, name: string): Promise<boolean> {
    this.mode = 'raid';
    this.state.capacity = CAPACITY.raid;
    this.state.onStatus('joining the raid…');
    const ref = doc(collection(db(), 'arcadeRooms'), roomId);
    try {
      const seat = await runTransaction(db(), async (txn) => {
        const fresh = await txn.get(ref);
        if (!fresh.exists() || fresh.data()?.open !== true || fresh.data()?.started === true) {
          throw new Error('gone');
        }
        const seats = (fresh.data().seats as string[]) ?? [];
        const names = (fresh.data().names as string[]) ?? seats.map(() => '');
        const free = seats.findIndex((s) => !s);
        if (free < 0) throw new Error('full');
        seats[free] = this.clientId;
        names[free] = name;
        txn.update(ref, { seats, names, open: !seats.every((s) => s) });
        return free;
      });
      if (this.closed) return false;
      this.roomRef = ref;
      this.state.mySeat = seat;
      this.state.joined = true;
      this.state.names[seat] = name;
      this.state.onStatus(`joined (seat ${seat})`);
      this.watchRoom();
      return true;
    } catch {
      this.state.onStatus('that lobby just closed');
      return false;
    }
  }

  /** RAID host: flip the lobby's hardcore breaker (room doc mirrors it out). */
  setRaidHardcore(v: boolean): void {
    if (this.roomRef) void updateDoc(this.roomRef, { hardcore: v }).catch(() => {});
  }

  /** RAID host: lock the lobby and launch — members see `started` flip. */
  startRaid(): void {
    if (this.roomRef) void updateDoc(this.roomRef, { started: true, open: false }).catch(() => {});
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

  /** Host: close the room to new joiners so a short-handed FFA can start. */
  lock(): void {
    if (this.roomRef) void updateDoc(this.roomRef, { open: false }).catch(() => {});
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
    this.rawSeats = [];
    this.droppedIds.clear();
    for (const track of this.micStream?.getTracks() ?? []) track.stop();
    this.micStream = null;
    this.state.voice.clear();
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
      this.rawSeats = (snap.data().seats as string[]) ?? [];
      this.applyOccupants();
      this.state.locked = snap.data().open === false;
      // RAID lobby extras: seed the callsigns from the doc (the `iam` message
      // re-affirms them in the bout) and mirror the host's controls.
      const docNames = snap.data().names as string[] | undefined;
      if (docNames) {
        docNames.forEach((n, i) => {
          if (n && !this.state.names[i]) this.state.names[i] = n;
        });
      }
      this.state.raidHardcore = snap.data().hardcore === true;
      this.state.raidStarted = snap.data().started === true;
      if (this.state.full) this.state.onStatus('all players in — fight!');
      const occ = this.state.occupants; // masked — never (re)connect a dropped seat
      for (let seat = 0; seat < occ.length; seat++) {
        if (seat === this.state.mySeat || !occ[seat] || this.peers.has(seat)) continue;
        if (this.state.mySeat < seat) void this.connectAsOfferer(seat);
        else void this.connectAsAnswerer(seat);
      }
    });
  }

  /** Publish `occupants` from the raw seats with any dropped ids masked to ''. */
  private applyOccupants(): void {
    // Forget a drop once the doc no longer holds that dead id there (seat freed
    // or reclaimed by a fresh player), so a replacement isn't wrongly masked.
    for (const [seat, id] of this.droppedIds) if (this.rawSeats[seat] !== id) this.droppedIds.delete(seat);
    this.state.occupants = this.rawSeats.map((s, i) => (s && this.droppedIds.get(i) === s ? '' : s));
    this.state.full = this.state.occupants.length > 0 && this.state.occupants.every((s) => s);
  }

  /** Declare a seat dead (its peer died / went silent). Reachable from the pose
   *  staleness backstop in MeshSystem, as well as from dropPeer on RTC failure. */
  dropSeat(seat: number): void {
    this.dropPeer(seat);
  }

  private markDropped(seat: number): void {
    const id = this.rawSeats[seat];
    if (!id || this.droppedIds.get(seat) === id) return;
    this.droppedIds.set(seat, id);
    this.applyOccupants();
    this.vacateSeatInDoc(seat, id);
  }

  /** Free a dead player's seat in the room doc so a replacement can claim it —
   *  a hard-disconnected client never cleans up its own seat. Best-effort +
   *  idempotent (every survivor may attempt it; the id guard makes all but the
   *  first bail). Only re-opens the room to joiners if it's still FILLING; a
   *  live (locked) bout stays closed. */
  private vacateSeatInDoc(seat: number, deadId: string): void {
    const ref = this.roomRef;
    if (!ref) return;
    void runTransaction(db(), async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists()) return;
      const seats = (snap.data().seats as string[]) ?? [];
      if (seats[seat] !== deadId) return; // already vacated / reclaimed
      seats[seat] = '';
      const locked = snap.data().open === false; // live bout — don't reopen mid-fight
      txn.update(ref, { seats, open: locked ? false : !seats.every((s) => s) });
    }).catch(() => {});
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
    // Spatial voice: surface this peer's mic track to the facade, keyed by seat.
    pc.ontrack = (ev) => {
      if (ev.track.kind !== 'audio') return;
      this.state.voice.set(seat, ev.streams[0] ?? new MediaStream([ev.track]));
    };
    return peer;
  }

  /** Grab the mic once (shared across every peer). Null if denied/unavailable. */
  private ensureMic(): Promise<MediaStream | null> {
    this.micPromise ??= navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((s) => {
        this.micStream = s;
        // Honour the voice-chat preference: a disabled mic transmits nothing.
        for (const t of s.getAudioTracks()) t.enabled = voiceEnabled();
        return s;
      })
      .catch(() => null);
    return this.micPromise;
  }

  /** Add my mic to a peer connection (recvonly if the mic was denied). */
  private async addVoice(pc: RTCPeerConnection): Promise<void> {
    const mic = await this.ensureMic();
    if (this.closed) return;
    if (mic) for (const track of mic.getTracks()) pc.addTrack(track, mic);
    else
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch {
        /* no audio support — data channels still work */
      }
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
    await this.addVoice(pc); // mic m-line must be in the offer SDP
    if (this.closed) return;
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
            await this.addVoice(pc); // answer with my mic too
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
    if (peer) {
      for (const u of peer.unsubs) u();
      peer.evt?.close();
      peer.pose?.close();
      peer.pc.close();
      this.peers.delete(seat);
    }
    this.state.voice.delete(seat);
    // Mask the seat so the roster/match layer sees the player as gone — even
    // though a hard-disconnected client never vacates its own seat in the doc.
    this.markDropped(seat);
  }
}
