/**
 * Spatialised playback for pub voice chat. Each remote punter gets their own
 * Opus decoder feeding a WebAudio HRTF PannerNode pinned to their head, with
 * the listener glued to your camera — so the room sounds like a room: voices
 * come from where the iron skulls actually stand, and fall off with distance.
 *
 * Frames arrive already routed by the server (the match bubble is enforced
 * there), so we just decode whatever we're handed and place it in 3D. A small
 * jitter buffer smooths network unevenness; decoded PCM is scheduled back to
 * back per speaker so there are no gaps or overlaps.
 *
 * Like the capture side, WebCodecs (AudioDecoder/EncodedAudioChunk) is reached
 * through globalThis since it isn't in the TS DOM lib.
 */

import type { Quaternion, Vector3 } from 'three';
import { audioContext } from '../../audio/sfx.js';

const SAMPLE_RATE = 48000;
const JITTER = 0.12; // s of lead before a speaker starts — absorbs network jitter
const SPEAKING_MS = 250; // recent-frame window for the "is talking" indicator

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = globalThis as any;

interface Speaker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decoder: any;
  panner: PannerNode;
  gain: GainNode;
  nextTime: number; // scheduling cursor in ctx time
  lastFrame: number; // performance.now() of the last decoded frame
}

const speakers = new Map<string, Speaker>();
let warnedNoDecoder = false;

function ensureSpeaker(id: string): Speaker | null {
  const ctx = audioContext();
  if (!ctx) return null;
  const existing = speakers.get(id);
  if (existing) return existing;
  if (!G.AudioDecoder) {
    if (!warnedNoDecoder) {
      console.warn('[pub voice] WebCodecs decode unavailable — voices muted');
      warnedNoDecoder = true;
    }
    return null;
  }

  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.2;
  panner.maxDistance = 24;
  panner.rolloffFactor = 1.1;
  const gain = ctx.createGain();
  gain.gain.value = 1.4; // voices sit just above the sfx bed
  panner.connect(gain).connect(ctx.destination);

  const speaker: Speaker = { decoder: null, panner, gain, nextTime: 0, lastFrame: 0 };
  speaker.decoder = new G.AudioDecoder({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    output: (audioData: any) => schedule(speaker, audioData),
    error: (e: Error) => console.warn('[pub voice] decoder error', e),
  });
  speaker.decoder.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
  speakers.set(id, speaker);
  return speaker;
}

/** Decode and queue one Opus frame from punter `id`. */
export function pushVoiceFrame(id: string, frame: ArrayBuffer): void {
  if (frame.byteLength <= 8) return;
  const speaker = ensureSpeaker(id);
  if (!speaker?.decoder) return;
  const timestamp = new DataView(frame).getFloat64(0, true);
  const data = new Uint8Array(frame, 8);
  try {
    speaker.decoder.decode(new G.EncodedAudioChunk({ type: 'key', timestamp, data }));
  } catch {
    /* a malformed frame just drops */
  }
  speaker.lastFrame = performance.now();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function schedule(speaker: Speaker, audioData: any): void {
  const ctx = audioContext();
  if (!ctx) {
    audioData.close();
    return;
  }
  const frames: number = audioData.numberOfFrames;
  const sr: number = audioData.sampleRate || SAMPLE_RATE;
  const buf = ctx.createBuffer(1, frames, sr);
  try {
    audioData.copyTo(buf.getChannelData(0), { planeIndex: 0, format: 'f32-planar' });
  } catch {
    audioData.close();
    return;
  }
  audioData.close();

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(speaker.panner);
  const now = ctx.currentTime;
  // If we've fallen behind (stall) re-prime the jitter buffer rather than
  // dumping a backlog all at once.
  if (speaker.nextTime < now + 0.005) speaker.nextTime = now + JITTER;
  src.start(speaker.nextTime);
  speaker.nextTime += buf.duration;
}

/** Move a speaker's panner to their head (world space). Call every frame. */
export function setVoiceSpeakerPosition(id: string, pos: Vector3): void {
  const speaker = speakers.get(id);
  const ctx = audioContext();
  if (!speaker || !ctx) return;
  const t = ctx.currentTime + 0.04;
  const p = speaker.panner;
  if (p.positionX) {
    p.positionX.linearRampToValueAtTime(pos.x, t);
    p.positionY.linearRampToValueAtTime(pos.y, t);
    p.positionZ.linearRampToValueAtTime(pos.z, t);
  } else {
    p.setPosition(pos.x, pos.y, pos.z);
  }
}

const _fwd = { x: 0, y: 0, z: 0 };
const _up = { x: 0, y: 0, z: 0 };

/** Glue the audio listener to your camera. Call every frame. */
export function updateVoiceListener(pos: Vector3, quat: Quaternion): void {
  const ctx = audioContext();
  if (!ctx) return;
  const l = ctx.listener;
  const { x, y, z, w } = quat;
  // forward = -Z, up = +Y, both rotated by the camera orientation.
  _fwd.x = -(2 * (x * z + w * y));
  _fwd.y = -(2 * (y * z - w * x));
  _fwd.z = -(1 - 2 * (x * x + y * y));
  _up.x = 2 * (x * y - w * z);
  _up.y = 1 - 2 * (x * x + z * z);
  _up.z = 2 * (y * z + w * x);
  const t = ctx.currentTime + 0.04;
  if (l.positionX) {
    l.positionX.linearRampToValueAtTime(pos.x, t);
    l.positionY.linearRampToValueAtTime(pos.y, t);
    l.positionZ.linearRampToValueAtTime(pos.z, t);
    l.forwardX.linearRampToValueAtTime(_fwd.x, t);
    l.forwardY.linearRampToValueAtTime(_fwd.y, t);
    l.forwardZ.linearRampToValueAtTime(_fwd.z, t);
    l.upX.linearRampToValueAtTime(_up.x, t);
    l.upY.linearRampToValueAtTime(_up.y, t);
    l.upZ.linearRampToValueAtTime(_up.z, t);
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
  }
}

/** True if `id` has produced voice frames in the last quarter-second. */
export function isSpeaking(id: string): boolean {
  const speaker = speakers.get(id);
  return !!speaker && performance.now() - speaker.lastFrame < SPEAKING_MS;
}

/** Tear down a speaker when their punter leaves. */
export function removeVoiceSpeaker(id: string): void {
  const speaker = speakers.get(id);
  if (!speaker) return;
  try {
    speaker.decoder?.close();
  } catch {
    /* already closed */
  }
  speaker.panner.disconnect();
  speaker.gain.disconnect();
  speakers.delete(id);
}
