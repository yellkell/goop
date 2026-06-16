/**
 * Pub voice chat over a LiveKit SFU. The 1v1 arena keeps its own peer-to-peer
 * WebRTC voice (which works well); the pub — up to 12 punters in one room —
 * fans voice through LiveKit Cloud instead, which scales far better than the
 * old mesh/PCM-relay attempts.
 *
 * Flow: fetch a short-lived join token from our room server (server/pub.mjs
 * `/token`, signed with the LiveKit API secret), connect to the LiveKit room,
 * publish the mic, and let LiveKit play everyone else back. The local punter id
 * is used as the LiveKit identity so the rest of the pub can map a speaker to
 * their avatar.
 *
 * Connecting (and enabling the mic) must happen inside a user gesture — we kick
 * it off on the first controller press (see PubPlayerSystem).
 */

import { Room, RoomEvent, Track, type RemoteTrack, type RemoteParticipant } from 'livekit-client';

let room: Room | null = null;
let connecting = false;
let muted = false;
let micOk = false;
/** Short human-readable state for the in-world voice readout. */
let statusText = 'press trigger to talk';
/** Identities LiveKit currently reports as actively talking. */
const speaking = new Set<string>();
/** Hidden <audio> sinks, one per remote speaker, so we can tear them down. */
const sinks = new Map<string, HTMLMediaElement[]>();

export function isPubVoiceLive(): boolean {
  return room !== null;
}

export function isSpeaking(id: string): boolean {
  return speaking.has(id);
}

/** Is anyone in the room talking right now? (Jukebox ducks music under chat.) */
export function anyPubVoiceSpeaking(): boolean {
  return speaking.size > 0;
}

/** One-line status for the pub's voice readout panel. */
export function pubVoiceStatus(): string {
  if (!room) return statusText;
  const peers = room.remoteParticipants?.size ?? 0;
  if (!room.canPlaybackAudio) return 'tap trigger to enable sound';
  const mic = micOk ? '' : ' · mic blocked';
  return peers > 0 ? `live · ${peers} here${mic}` : `live · waiting for others${mic}`;
}

/**
 * Browsers gate audio PLAYBACK behind a user gesture, and our connect runs
 * async so the press that started it has lapsed by the time tracks arrive.
 * Call this on later controller presses (fresh gestures) to unlock sound.
 */
export function pokePubAudio(): void {
  if (room && !room.canPlaybackAudio) void room.startAudio().catch(() => {});
}

/** Flip the local mic; returns the new muted state. */
export function togglePubMic(): boolean {
  muted = !muted;
  void room?.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
  return muted;
}

function attach(track: RemoteTrack, participant: RemoteParticipant): void {
  if (track.kind !== Track.Kind.Audio) return;
  const el = track.attach(); // LiveKit plays the stream through this element
  el.autoplay = true;
  (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  el.style.display = 'none';
  document.body.appendChild(el);
  const list = sinks.get(participant.identity) ?? [];
  list.push(el);
  sinks.set(participant.identity, list);
}

function detach(identity: string): void {
  for (const el of sinks.get(identity) ?? []) {
    (el as HTMLMediaElement & { srcObject?: MediaProvider | null }).srcObject = null;
    el.remove();
  }
  sinks.delete(identity);
  speaking.delete(identity);
}

/**
 * Join the pub's LiveKit room and go live. `identity` should be the stable pub
 * player id so speakers map to avatars. Resolves true once connected and the
 * mic is publishing, false on any failure (no token server, denied mic, …).
 */
export async function connectPubVoice(
  tokenUrl: string,
  identity: string,
  name: string,
  roomName: string,
): Promise<boolean> {
  if (room || connecting) return room !== null;
  connecting = true;
  statusText = 'connecting…';
  try {
    const q = `identity=${encodeURIComponent(identity)}&name=${encodeURIComponent(name)}&room=${encodeURIComponent(roomName)}`;
    const res = await fetch(`${tokenUrl}?${q}`);
    if (!res.ok) throw new Error(`token ${res.status}`);
    const { token, url } = (await res.json()) as { token?: string; url?: string };
    if (!token || !url) {
      statusText = 'server voice off';
      throw new Error('voice not configured on the server');
    }

    const r = new Room({ adaptiveStream: false, dynacast: false });
    r.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => attach(track, participant));
    r.on(RoomEvent.TrackUnsubscribed, (_t, _p, participant) => detach(participant.identity));
    r.on(RoomEvent.ParticipantDisconnected, (participant) => detach(participant.identity));
    r.on(RoomEvent.Disconnected, () => {
      for (const id of [...sinks.keys()]) detach(id);
      room = null;
      statusText = 'disconnected';
    });
    r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      speaking.clear();
      for (const s of speakers) speaking.add(s.identity);
    });

    try {
      await r.connect(url, token);
    } catch (e) {
      statusText = 'connect failed';
      throw e;
    }
    room = r;
    // Mic failure (denied/busy) must NOT abort — we still want to HEAR others.
    try {
      await r.localParticipant.setMicrophoneEnabled(!muted);
      micOk = true;
    } catch (e) {
      micOk = false;
      console.warn('[pub voice] mic publish failed (still receiving)', e);
    }
    await r.startAudio().catch(() => {}); // unlock playback (poked again on later presses)
    // eslint-disable-next-line no-console
    console.info('[pub voice] LiveKit room joined');
    return true;
  } catch (err) {
    console.warn('[pub voice] LiveKit connect failed — will retry on the next press', err);
    return false;
  } finally {
    connecting = false;
  }
}

export function disconnectPubVoice(): void {
  for (const id of [...sinks.keys()]) detach(id);
  void room?.disconnect().catch(() => {});
  room = null;
}
