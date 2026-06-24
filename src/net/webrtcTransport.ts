/**
 * Serverless multiplayer: Firebase Firestore does matchmaking + WebRTC
 * signaling, then ALL game traffic flows peer-to-peer over RTCDataChannels —
 * Firebase never sees a pose packet. This is the upgrade over relaying game
 * state through a realtime database (the curveball approach): one-time
 * signaling cost, then direct peer latency.
 *
 * Two channels:
 *   'pose' — unordered, no retransmits: a late pose is a useless pose.
 *   'evt'  — reliable, ordered: throws, hits, match state must all arrive.
 * Plus VOICE: both peers offer their microphone on the same connection;
 * the remote track is surfaced via onRemoteAudio and spatialised in
 * net/voice.ts. Mic denied? You still hear them (recvonly).
 *
 * Matchmaking (collection `lobbies`):
 *   - look for an open lobby; claim it with a transaction → you are the
 *     CALLEE (guest, side 1);
 *   - none open → create one and wait → you are the CALLER (host, side 0).
 *   Offer/answer ride on the lobby doc; ICE candidates ride two
 *   subcollections, exactly the Firestore WebRTC codelab shape.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  addDoc,
  collection,
  deleteDoc,
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
import type { PeerMessage } from './protocol.js';
import type { Transport, TransportEvents } from './transport.js';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

/** Lobbies older than this are abandoned tabs — ignore them. */
const LOBBY_FRESH_MS = 2 * 60 * 1000;
/** Private codes live longer — you share one and wait for a friend to type it. */
const PRIVATE_FRESH_MS = 10 * 60 * 1000;
/** Give P2P this long to come up before declaring failure. */
const CONNECT_TIMEOUT_MS = 15_000;

let firebaseApp: FirebaseApp | undefined;

function db(): Firestore {
  // The leaderboard may have initialised the app already — share it.
  firebaseApp ??= getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(firebaseApp);
}

export class WebRtcTransport implements Transport {
  private pc: RTCPeerConnection | null = null;
  private evtChannel: RTCDataChannel | null = null;
  private poseChannel: RTCDataChannel | null = null;
  private lobbyRef: DocumentReference | null = null;
  private isCaller = false;
  private matched = false;
  private closed = false;
  private unsubs: Unsubscribe[] = [];
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private micStream: MediaStream | null = null;

  constructor(private readonly events: TransportEvents) {}

  async queue(): Promise<void> {
    this.events.onStatus('matchmaking…');
    const lobbies = collection(db(), 'lobbies');

    const claimed = await this.tryClaimLobby(lobbies);
    if (this.closed) return;
    if (!(await this.setupConnection())) return;

    if (claimed) {
      this.isCaller = false;
      await this.runCallee(claimed);
      // Opponent already on the line — the clock starts now.
      this.armConnectTimeout();
    } else {
      this.isCaller = true;
      const ref = await addDoc(lobbies, { open: true, createdAt: serverTimestamp() });
      if (this.closed) return;
      // Callers wait in the queue indefinitely; the clock starts when an
      // answer arrives (see runCallerOn).
      await this.runCallerOn(ref);
    }
  }

  /**
   * Host a private match: reserve a free 5-digit code (its own doc id in
   * `privateLobbies`), publish an offer there, and wait. Resolves with the code.
   */
  async hostPrivate(): Promise<string> {
    this.events.onStatus('creating private match…');
    if (!(await this.setupConnection())) throw new Error('cancelled');
    this.isCaller = true;
    const code = await this.allocateCode();
    if (this.closed) throw new Error('cancelled');
    await this.runCallerOn(this.lobbyRef!);
    this.events.onStatus('waiting for your opponent…');
    return code;
  }

  /** Join a private match by code: claim its lobby and answer the host's offer. */
  async joinPrivate(code: string): Promise<void> {
    this.events.onStatus('joining…');
    const ref = doc(collection(db(), 'privateLobbies'), code);
    // Claim it first (validates the code) so a bad code never prompts for mic.
    await runTransaction(db(), async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists()) throw new Error('code not found');
      if (snap.data()?.open !== true) throw new Error('match already started');
      const created = (snap.data()?.createdAt?.toMillis?.() as number | undefined) ?? 0;
      if (Date.now() - created > PRIVATE_FRESH_MS) throw new Error('code expired');
      txn.update(ref, { open: false, claimedAt: serverTimestamp() });
    });
    if (this.closed) return;
    if (!(await this.setupConnection())) return;
    this.isCaller = false;
    await this.runCallee(ref);
    this.armConnectTimeout();
  }

  /** Build the peer connection + voice. Returns false if cancelled meanwhile. */
  private async setupConnection(): Promise<boolean> {
    this.pc = new RTCPeerConnection(ICE_SERVERS);
    this.watchConnection();
    await this.setupVoice();
    return !this.closed;
  }

  /** Reserve a free 5-digit code as a `privateLobbies` doc; sets `lobbyRef`. */
  private async allocateCode(): Promise<string> {
    const coll = collection(db(), 'privateLobbies');
    for (let attempt = 0; attempt < 8 && !this.closed; attempt++) {
      const code = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
      const ref = doc(coll, code);
      try {
        await runTransaction(db(), async (txn) => {
          const snap = await txn.get(ref);
          if (snap.exists()) {
            const created = (snap.data()?.createdAt?.toMillis?.() as number | undefined) ?? 0;
            // Only reuse a code whose lobby is dead; a live one is taken.
            if (snap.data()?.open === true && Date.now() - created < PRIVATE_FRESH_MS) {
              throw new Error('taken');
            }
          }
          txn.set(ref, { open: true, createdAt: serverTimestamp() });
        });
        this.lobbyRef = ref;
        return code;
      } catch {
        /* code collided or was taken — try another */
      }
    }
    throw new Error('could not allocate a code');
  }

  send(d: PeerMessage): void {
    if (!this.matched) return;
    // Poses ride the lossy fast lane; everything else must arrive.
    const channel = d.k === 'pose' && this.poseChannel?.readyState === 'open' ? this.poseChannel : this.evtChannel;
    if (channel?.readyState === 'open') {
      try {
        channel.send(JSON.stringify(d));
      } catch {
        /* channel mid-close; connection watcher will handle it */
      }
    }
  }

  close(): void {
    if (this.closed) return;
    const wasMatched = this.matched;
    this.closed = true;
    this.matched = false;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    for (const u of this.unsubs.splice(0)) u();
    for (const track of this.micStream?.getTracks() ?? []) track.stop();
    this.micStream = null;
    this.evtChannel?.close();
    this.poseChannel?.close();
    this.pc?.close();
    this.pc = null;
    // Best effort: tear down an unclaimed lobby so it can't strand others.
    if (this.lobbyRef && this.isCaller && !wasMatched) {
      void deleteDoc(this.lobbyRef).catch(() => {});
    }
    this.lobbyRef = null;
  }

  // --- voice -----------------------------------------------------------------

  /**
   * Offer the microphone on the peer connection (before any offer/answer is
   * created so the audio m-line is in the SDP), and surface the remote track.
   */
  private async setupVoice(): Promise<void> {
    const pc = this.pc!;
    pc.ontrack = (ev) => {
      if (ev.track.kind !== 'audio') return;
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.events.onRemoteAudio?.(stream);
    };
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.closed) {
        for (const track of this.micStream.getTracks()) track.stop();
        this.micStream = null;
        return;
      }
      // Honour the voice-chat preference: a disabled mic transmits nothing.
      for (const track of this.micStream.getAudioTracks()) track.enabled = voiceEnabled();
      for (const track of this.micStream.getTracks()) pc.addTrack(track, this.micStream);
    } catch {
      // Mic denied/unavailable — still set up to RECEIVE their voice.
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch {
        /* no audio support at all — data channels still work */
      }
    }
  }

  // --- matchmaking -----------------------------------------------------------

  /** Try to claim the freshest open lobby; null means "be the caller". */
  private async tryClaimLobby(
    lobbies: ReturnType<typeof collection>,
  ): Promise<DocumentReference | null> {
    const open = await getDocs(query(lobbies, where('open', '==', true), limit(10)));
    const now = Date.now();
    for (const snap of open.docs) {
      const created = (snap.data().createdAt?.toMillis?.() as number | undefined) ?? 0;
      if (now - created > LOBBY_FRESH_MS) continue;
      try {
        await runTransaction(db(), async (txn) => {
          const fresh = await txn.get(snap.ref);
          if (!fresh.exists() || fresh.data()?.open !== true) throw new Error('claimed');
          txn.update(snap.ref, { open: false, claimedAt: serverTimestamp() });
        });
        return snap.ref; // claimed it — we're the callee
      } catch {
        continue; // somebody beat us to this one; try the next
      }
    }
    return null;
  }

  // --- caller (host, side 0) ---------------------------------------------------

  private async runCallerOn(lobbyRef: DocumentReference): Promise<void> {
    const pc = this.pc!;
    this.lobbyRef = lobbyRef;
    // The caller opens the channels; the callee receives them.
    this.adoptChannels(
      pc.createDataChannel('evt', { ordered: true }),
      pc.createDataChannel('pose', { ordered: false, maxRetransmits: 0 }),
    );

    const callerCandidates = collection(lobbyRef, 'callerCandidates');
    const calleeCandidates = collection(lobbyRef, 'calleeCandidates');

    pc.onicecandidate = (ev) => {
      if (ev.candidate) void addDoc(callerCandidates, ev.candidate.toJSON()).catch(() => {});
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await updateDoc(lobbyRef, { offer: { type: offer.type, sdp: offer.sdp } });
    this.events.onStatus('waiting for an opponent…');

    // Wait for the answer, then drink the callee's candidates.
    this.unsubs.push(
      onSnapshot(lobbyRef, (snap) => {
        const answer = snap.data()?.answer as RTCSessionDescriptionInit | undefined;
        if (answer && !pc.currentRemoteDescription) {
          this.events.onStatus('opponent found — connecting…');
          this.armConnectTimeout();
          void pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(() => {});
        }
      }),
    );
    this.drinkCandidates(calleeCandidates);
  }

  // --- callee (guest, side 1) ---------------------------------------------------

  private async runCallee(lobbyRef: DocumentReference): Promise<void> {
    const pc = this.pc!;
    this.lobbyRef = lobbyRef;
    const callerCandidates = collection(lobbyRef, 'callerCandidates');
    const calleeCandidates = collection(lobbyRef, 'calleeCandidates');

    const channels: RTCDataChannel[] = [];
    pc.ondatachannel = (ev) => {
      channels.push(ev.channel);
      const evt = channels.find((c) => c.label === 'evt') ?? null;
      const pose = channels.find((c) => c.label === 'pose') ?? null;
      if (evt) this.adoptChannels(evt, pose);
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) void addDoc(calleeCandidates, ev.candidate.toJSON()).catch(() => {});
    };

    this.events.onStatus('opponent found — connecting…');
    // The offer may land on the doc a beat after we claim it.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('no offer')), 10_000);
      const unsub = onSnapshot(lobbyRef, (snap) => {
        const offer = snap.data()?.offer as RTCSessionDescriptionInit | undefined;
        if (!offer) return;
        clearTimeout(timeout);
        unsub();
        void (async () => {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await updateDoc(lobbyRef, { answer: { type: answer.type, sdp: answer.sdp } });
          resolve();
        })().catch(reject);
      });
      this.unsubs.push(unsub);
    });
    this.drinkCandidates(callerCandidates);
  }

  // --- plumbing -------------------------------------------------------------------

  private drinkCandidates(candidates: ReturnType<typeof collection>): void {
    this.unsubs.push(
      onSnapshot(candidates, (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type !== 'added') continue;
          void this.pc
            ?.addIceCandidate(new RTCIceCandidate(change.doc.data() as RTCIceCandidateInit))
            .catch(() => {});
        }
      }),
    );
  }

  private adoptChannels(evt: RTCDataChannel, pose: RTCDataChannel | null): void {
    this.evtChannel = evt;
    this.poseChannel = pose;
    const onMsg = (ev: MessageEvent): void => {
      try {
        this.events.onMessage(JSON.parse(String(ev.data)) as PeerMessage);
      } catch {
        /* malformed packet — drop it */
      }
    };
    evt.onmessage = onMsg;
    if (pose) pose.onmessage = onMsg;
    evt.onopen = () => this.onConnected();
    evt.onclose = () => this.teardown('opponent left');
  }

  private onConnected(): void {
    if (this.matched || this.closed) return;
    this.matched = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    // Signaling is done — the lobby doc has served its purpose.
    if (this.lobbyRef && this.isCaller) void deleteDoc(this.lobbyRef).catch(() => {});
    this.events.onMatched(this.isCaller ? 0 : 1);
  }

  private watchConnection(): void {
    const pc = this.pc!;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        this.teardown(this.matched ? 'connection lost' : "couldn't connect peer-to-peer");
      }
    };
  }

  private armConnectTimeout(): void {
    this.connectTimer = setTimeout(() => {
      if (!this.matched && !this.closed) {
        this.teardown("couldn't connect — still searching? try again");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  private teardown(reason: string): void {
    if (this.closed) return;
    this.close();
    this.events.onClosed(reason);
  }
}
