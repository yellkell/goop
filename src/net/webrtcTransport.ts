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

/** A host lobby not SEEN (heartbeat) within this is an abandoned tab — skip it.
 *  Short, because a live host heartbeats every HOST_TICK_MS; this is just how
 *  long a ghost lingers before everyone ignores it. */
const LOBBY_FRESH_MS = 40 * 1000;
/** While waiting as a host: heartbeat our lobby AND re-scan for another host to
 *  pair with (so two simultaneous hosts don't deadlock). Kept short, and
 *  per-client jitter is added on top, so two players who JUST played each other
 *  — who re-enter the queue in lockstep and both become hosts — desynchronise
 *  and pair within a tick instead of sitting forever. */
const HOST_TICK_MS = 2_500;
/** Private codes live longer — you share one and wait for a friend to type it. */
const PRIVATE_FRESH_MS = 10 * 60 * 1000;
/** Give P2P this long to come up before declaring failure. */
const CONNECT_TIMEOUT_MS = 15_000;

/** Back-compat window for a lobby from an OLDER client that has no `seen` field
 *  yet — fall back to createdAt so a mid-rollout peer can still be matched. */
const LOBBY_LEGACY_FRESH_MS = 2 * 60 * 1000;

function millis(v: unknown): number | undefined {
  return (v as { toMillis?: () => number } | undefined)?.toMillis?.();
}

/** Is this lobby a LIVE host? A current client heartbeats `seen`, so trust it
 *  strictly (ghosts go stale in seconds). A pre-heartbeat client has no `seen`,
 *  so fall back to createdAt for the rollout. */
function lobbyFresh(data: Record<string, unknown> | undefined, now: number): boolean {
  const seen = millis(data?.seen);
  if (typeof seen === 'number') return now - seen <= LOBBY_FRESH_MS;
  return now - (millis(data?.createdAt) ?? 0) <= LOBBY_LEGACY_FRESH_MS;
}

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
  private hostTimer: ReturnType<typeof setInterval> | null = null;
  /** Quick one-off cross-over scans fired just after we become a host. */
  private earlyScans: ReturnType<typeof setTimeout>[] = [];
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
      const ref = await addDoc(lobbies, { open: true, createdAt: serverTimestamp(), seen: serverTimestamp() });
      if (this.closed) return;
      // Callers wait in the queue indefinitely; the clock starts when an
      // answer arrives (see runCallerOn).
      await this.runCallerOn(ref);
      if (this.closed) return;
      // While we wait: heartbeat our lobby AND re-scan for another waiting host
      // to pair with, so two simultaneous searchers don't both sit forever.
      this.startHostHeartbeat();
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
    if (this.hostTimer) clearInterval(this.hostTimer);
    this.hostTimer = null;
    for (const t of this.earlyScans) clearTimeout(t);
    this.earlyScans = [];
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
      if (!lobbyFresh(snap.data(), now)) continue; // a ghost — skip it
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

  /** While hosting the public queue: every tick, keep our lobby fresh and look
   *  for another host to pair with. */
  private startHostHeartbeat(): void {
    // Pair two simultaneous hosts IMMEDIATELY, not after a full tick: two
    // players who just played re-enter the queue together, so both run
    // tryClaimLobby before either lobby exists and both fall through to hosting.
    // Scanning right now (rather than waiting HOST_TICK_MS) collapses the window
    // where they'd both sit waiting — the deadlock behind "just played, can't
    // find each other".
    void this.crossOverIfRivalHost();
    // A couple of quick follow-up scans cover the case where the rival's lobby
    // wasn't visible to our first scan yet (both created at the same instant),
    // so we pair in well under a second instead of waiting for a full tick.
    this.earlyScans = [700, 1600].map((ms) => setTimeout(() => void this.crossOverIfRivalHost(), ms));
    // Jitter the period per-client so two lockstep hosts don't keep heartbeating
    // and re-scanning in perfect step (which could resync them indefinitely).
    const period = HOST_TICK_MS + Math.floor(Math.random() * 1500);
    this.hostTimer = setInterval(() => {
      if (this.closed || this.matched || !this.lobbyRef) return;
      // Heartbeat: claimers ignore lobbies not SEEN recently, so a live host
      // stays claimable while an abandoned tab ages out fast.
      void updateDoc(this.lobbyRef, { seen: serverTimestamp() }).catch(() => {});
      void this.crossOverIfRivalHost();
    }, period);
  }

  /**
   * If another host is ALSO waiting, exactly ONE of the two must drop its lobby
   * and re-queue to claim the other — otherwise two people who searched at the
   * same instant (both found nothing, both became hosts) sit forever.
   *
   * The tiebreaker is the lobby document IDs: the host with the SMALLER id stays
   * put, the larger-id host crosses over. This is deliberately CLOCK-FREE. The
   * old code compared `createdAt`, but a just-created lobby's `serverTimestamp()`
   * reads back null (it's a pending write), so a host's own "createdAt" silently
   * became its LOCAL clock while it read rivals' as resolved SERVER stamps —
   * mixing two clocks. With any skew both peers could decide "not me", and they
   * deadlocked. Both peers see the same two ids identically, so id order picks
   * exactly one mover with no timestamps involved.
   */
  private async crossOverIfRivalHost(): Promise<void> {
    const lobbies = collection(db(), 'lobbies');
    const open = await getDocs(query(lobbies, where('open', '==', true), limit(10)));
    if (this.closed || this.matched || !this.lobbyRef) return;
    const now = Date.now();
    const myId = this.lobbyRef.id;
    for (const snap of open.docs) {
      if (snap.id === myId) continue;
      if (!lobbyFresh(snap.data(), now)) continue;
      if (myId < snap.id) continue; // we hold the smaller id — we're the keeper, they cross to us
      // We're the larger id → drop our lobby and re-queue to claim theirs.
      if (this.hostTimer) {
        clearInterval(this.hostTimer);
        this.hostTimer = null;
      }
      const mine = this.lobbyRef;
      this.lobbyRef = null; // so close() doesn't try to delete it twice
      await deleteDoc(mine).catch(() => {});
      if (!this.closed && !this.matched) this.events.onRequeue?.();
      return;
    }
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
    if (this.hostTimer) {
      clearInterval(this.hostTimer);
      this.hostTimer = null;
    }
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
