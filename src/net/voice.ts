/**
 * Directional voice chat. The WebRTC transport hands us the opponent's
 * microphone track; we route it through a WebAudio HRTF PannerNode pinned to
 * their avatar's HEAD, with the listener glued to your camera every frame —
 * so your rival's trash talk comes from where their iron skull actually is,
 * ducks when they duck, and pans as you both circle.
 *
 * Voice rides the same RTCPeerConnection as the game data (no extra
 * infrastructure); it only exists on the serverless P2P transport.
 */

import type { Quaternion, Vector3 } from 'three';
import { audioContext } from '../audio/sfx.js';

let el: HTMLAudioElement | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let panner: PannerNode | null = null;
let gain: GainNode | null = null;

/** Start spatialised playback of the opponent's voice stream. */
export function attachRemoteVoice(stream: MediaStream): void {
  const ctx = audioContext();
  if (!ctx) return;
  detachRemoteVoice();

  // Chromium quirk: a WebRTC audio stream produces silence in WebAudio
  // unless it is also sunk into a (muted) media element.
  el = new Audio();
  el.srcObject = stream;
  el.muted = true;
  void el.play().catch(() => {});

  source = ctx.createMediaStreamSource(stream);
  panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.2;
  panner.maxDistance = 30;
  panner.rolloffFactor = 1;
  gain = ctx.createGain();
  gain.gain.value = 1.5; // voice sits above the sfx bed
  source.connect(panner).connect(gain).connect(ctx.destination);
}

export function detachRemoteVoice(): void {
  if (el) {
    el.srcObject = null;
    el = null;
  }
  source?.disconnect();
  panner?.disconnect();
  gain?.disconnect();
  source = null;
  panner = null;
  gain = null;
}

const setParam = (p: AudioParam | undefined, v: number, t: number): void => {
  // linearRamp keeps fast head motion from zipper-clicking the pan.
  if (p) p.linearRampToValueAtTime(v, t);
};

/** Pin the voice to the opponent's head. Call every frame during a bout. */
export function setSpeakerPosition(pos: Vector3): void {
  const ctx = audioContext();
  if (!ctx || !panner) return;
  const t = ctx.currentTime + 0.05;
  if (panner.positionX) {
    setParam(panner.positionX, pos.x, t);
    setParam(panner.positionY, pos.y, t);
    setParam(panner.positionZ, pos.z, t);
  } else {
    panner.setPosition(pos.x, pos.y, pos.z);
  }
}

// --- mesh (2v2 / FFA): many spatial speakers at once, keyed by seat ----------

interface Speaker {
  el: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  panner: PannerNode;
  gain: GainNode;
}
const speakers = new Map<number, Speaker>();

/** Start spatialised playback of one mesh peer's voice, keyed by their seat. */
export function attachMeshVoice(key: number, stream: MediaStream): void {
  const ctx = audioContext();
  if (!ctx) return;
  detachMeshVoice(key);
  // Chromium quirk: sink the stream into a muted element or WebAudio is silent.
  const el = new Audio();
  el.srcObject = stream;
  el.muted = true;
  void el.play().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.2;
  panner.maxDistance = 30;
  panner.rolloffFactor = 1;
  const gain = ctx.createGain();
  gain.gain.value = 1.5;
  source.connect(panner).connect(gain).connect(ctx.destination);
  speakers.set(key, { el, source, panner, gain });
}

/** Pin a mesh peer's voice to their avatar's head. Call every frame. */
export function setMeshSpeaker(key: number, pos: Vector3): void {
  const ctx = audioContext();
  const sp = speakers.get(key);
  if (!ctx || !sp) return;
  const t = ctx.currentTime + 0.05;
  if (sp.panner.positionX) {
    setParam(sp.panner.positionX, pos.x, t);
    setParam(sp.panner.positionY, pos.y, t);
    setParam(sp.panner.positionZ, pos.z, t);
  } else {
    sp.panner.setPosition(pos.x, pos.y, pos.z);
  }
}

export function detachMeshVoice(key: number): void {
  const sp = speakers.get(key);
  if (!sp) return;
  sp.el.srcObject = null;
  sp.source.disconnect();
  sp.panner.disconnect();
  sp.gain.disconnect();
  speakers.delete(key);
}

export function detachAllMeshVoice(): void {
  for (const key of [...speakers.keys()]) detachMeshVoice(key);
}

const _fwd = { x: 0, y: 0, z: 0 };
const _up = { x: 0, y: 0, z: 0 };

/** Glue the audio listener to your camera. Call every frame during a bout. */
export function updateListener(pos: Vector3, quat: Quaternion): void {
  const ctx = audioContext();
  if (!ctx) return;
  const l = ctx.listener;
  // forward = -Z and up = +Y rotated by the camera orientation.
  const { x, y, z, w } = quat;
  _fwd.x = -(2 * (x * z + w * y));
  _fwd.y = -(2 * (y * z - w * x));
  _fwd.z = -(1 - 2 * (x * x + y * y));
  _up.x = 2 * (x * y - w * z);
  _up.y = 1 - 2 * (x * x + z * z);
  _up.z = 2 * (y * z + w * x);
  const t = ctx.currentTime + 0.05;
  if (l.positionX) {
    setParam(l.positionX, pos.x, t);
    setParam(l.positionY, pos.y, t);
    setParam(l.positionZ, pos.z, t);
    setParam(l.forwardX, _fwd.x, t);
    setParam(l.forwardY, _fwd.y, t);
    setParam(l.forwardZ, _fwd.z, t);
    setParam(l.upX, _up.x, t);
    setParam(l.upY, _up.y, t);
    setParam(l.upZ, _up.z, t);
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
  }
}
