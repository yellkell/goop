/**
 * Spatialised playback for pub voice chat. Each remote punter gets a WebAudio
 * HRTF PannerNode pinned to their head, with the listener glued to your camera
 * — so the room sounds like a room: voices come from where the iron skulls
 * actually stand, and fall off with distance. This is the SAME panner graph
 * the arena uses for the rival's WebRTC voice.
 *
 * Frames arrive as plain Int16 PCM (see voice/capture.ts — no WebCodecs), each
 * tagged with its sample rate, fanned out by the server to the whole room. We
 * turn each frame into a short AudioBuffer and schedule them back to back per
 * speaker behind a small jitter buffer.
 *
 * Wire frame: [8-byte float64 LE sample rate][Int16 LE mono PCM].
 */

import type { Quaternion, Vector3 } from 'three';
import { audioContext } from '../../audio/sfx.js';

const JITTER = 0.12; // s of lead before a speaker starts — absorbs network jitter
const SPEAKING_MS = 350; // recent-frame window for the "is talking" indicator

interface Speaker {
  panner: PannerNode;
  gain: GainNode;
  nextTime: number; // scheduling cursor in ctx time
  lastFrame: number; // performance.now() of the last frame
}

const speakers = new Map<string, Speaker>();

function ensureSpeaker(id: string): Speaker | null {
  const ctx = audioContext();
  if (!ctx) return null;
  const existing = speakers.get(id);
  if (existing) return existing;

  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.2;
  panner.maxDistance = 24;
  panner.rolloffFactor = 1.1;
  const gain = ctx.createGain();
  gain.gain.value = 1.5; // voices sit just above the sfx bed
  panner.connect(gain).connect(ctx.destination);

  const speaker: Speaker = { panner, gain, nextTime: 0, lastFrame: 0 };
  speakers.set(id, speaker);
  return speaker;
}

/** Decode (just int16→float) and queue one PCM frame from punter `id`. */
export function pushVoiceFrame(id: string, frame: ArrayBuffer): void {
  if (frame.byteLength <= 8) return;
  const ctx = audioContext();
  if (!ctx) return;
  // Voice may be the first thing to wake the graph in a quiet pub.
  if (ctx.state === 'suspended') void ctx.resume();
  const speaker = ensureSpeaker(id);
  if (!speaker) return;

  const rate = new DataView(frame).getFloat64(0, true) || 16000;
  const pcm = new Int16Array(frame, 8);
  if (pcm.length === 0) return;
  const buf = ctx.createBuffer(1, pcm.length, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;

  const src = ctx.createBufferSource();
  src.buffer = buf; // the context resamples `rate` → output rate automatically
  src.connect(speaker.panner);
  const now = ctx.currentTime;
  // If we've fallen behind (a talk gap or a stall), re-prime the jitter buffer
  // rather than dumping a backlog all at once.
  if (speaker.nextTime < now + 0.005) speaker.nextTime = now + JITTER;
  src.start(speaker.nextTime);
  speaker.nextTime += buf.duration;
  speaker.lastFrame = performance.now();
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

/** True if `id` has produced voice frames in the last fraction of a second. */
export function isSpeaking(id: string): boolean {
  const speaker = speakers.get(id);
  return !!speaker && performance.now() - speaker.lastFrame < SPEAKING_MS;
}

/** Tear down a speaker when their punter leaves. */
export function removeVoiceSpeaker(id: string): void {
  const speaker = speakers.get(id);
  if (!speaker) return;
  speaker.panner.disconnect();
  speaker.gain.disconnect();
  speakers.delete(id);
}
