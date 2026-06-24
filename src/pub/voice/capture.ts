/**
 * Local microphone capture for pub voice chat — PLAIN WEB AUDIO, no WebCodecs.
 *
 * The arena's 1:1 voice rides WebRTC, where the browser encodes the mic with
 * native Opus for free. The pub fans voice out to up to 12 punters through the
 * room WebSocket, so it can't lean on a peer connection — and the previous
 * WebCodecs (AudioEncoder/MediaStreamTrackProcessor) path proved unreliable on
 * the headset browsers (mic worked in a quick match but was dead in the pub).
 *
 * So we capture the mic the old-fashioned, universally-supported way: a WebAudio
 * graph taps the mic, downsamples to ~16 kHz and ships small Int16 PCM frames.
 * Playback (voice/playback.ts) feeds those straight into the SAME HRTF panner
 * graph the arena uses for the rival's voice.
 *
 * Wire frame: [8-byte float64 LE sample rate][Int16 LE mono PCM]. The server
 * prepends the sender id and relays the bytes verbatim to the whole room, so
 * nothing on the server or in the protocol has to change.
 */

import { audioContext } from '../../audio/sfx.js';
import { voiceEnabled } from '../../audio/voicePref.js';

/** Receives one PCM voice frame ready for the wire. */
export type VoiceSender = (frame: ArrayBuffer) => void;

const TARGET_RATE = 16000; // speech band — keeps the relay light
const FRAME_SAMPLES = 2048; // ScriptProcessor block size at the context rate
const SILENCE_RMS = 0.006; // below this it's room tone; don't send a frame

let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let processor: ScriptProcessorNode | null = null;
let sink: GainNode | null = null;
/** Muted element the mic stream is also attached to — see the quirk note in
 *  startVoiceCapture. Without it the WebAudio graph pumps silence. */
let pump: HTMLAudioElement | null = null;
let running = false;
let muted = false;
let sender: VoiceSender | null = null;

export function isVoiceCapturing(): boolean {
  return running;
}
export function isVoiceMuted(): boolean {
  return muted;
}
export function setVoiceMuted(m: boolean): void {
  muted = m;
}
/** Flip mute; returns the new muted state. */
export function toggleVoiceMuted(): boolean {
  muted = !muted;
  return muted;
}

/**
 * Ask for the mic and start streaming PCM frames. Resolves true once live,
 * false if there's no audio context, getUserMedia is unavailable, or the user
 * denies permission. Safe to call more than once — only the first start takes.
 */
export async function startVoiceCapture(send: VoiceSender): Promise<boolean> {
  if (running) return true;
  // Voice chat turned off in the main menu: don't even ask for the mic.
  if (!voiceEnabled()) return false;
  const ctx = audioContext();
  if (!ctx) {
    console.warn('[pub voice] no audio context — mic disabled');
    return false;
  }
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      /* a gesture will resume it shortly */
    }
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('[pub voice] getUserMedia unavailable — mic disabled');
    return false;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    console.warn('[pub voice] microphone permission denied', err);
    return false;
  }

  sender = send;

  // Chromium quirk (same one net/voice.ts works around for the rival's WebRTC
  // voice): a getUserMedia MediaStream routed through WebAudio produces SILENCE
  // unless the stream is also sunk into a media element. Without this the mic
  // graph below processes zeros — the silence gate eats every frame and nobody
  // in the pub ever hears you. The element stays muted so we don't echo your
  // own mic back at you locally.
  pump = new Audio();
  pump.srcObject = stream;
  pump.muted = true;
  void pump.play().catch(() => {});

  source = ctx.createMediaStreamSource(stream);

  // ScriptProcessorNode is deprecated but rock-solid across the headset
  // browsers, and needs no separate worklet module to bundle.
  processor = ctx.createScriptProcessor(FRAME_SAMPLES, 1, 1);
  const inRate = ctx.sampleRate;
  const factor = Math.max(1, Math.round(inRate / TARGET_RATE));
  const outRate = inRate / factor;

  processor.onaudioprocess = (e: AudioProcessingEvent): void => {
    if (muted || !sender) return;
    const input = e.inputBuffer.getChannelData(0);
    const outLen = Math.floor(input.length / factor);
    if (outLen === 0) return;
    const pcm = new Int16Array(outLen);
    let sumSq = 0;
    for (let i = 0; i < outLen; i++) {
      // Box-average each group of `factor` samples — a cheap anti-alias.
      let acc = 0;
      for (let j = 0; j < factor; j++) acc += input[i * factor + j];
      const s = acc / factor;
      sumSq += s * s;
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
    // Don't flood the relay with silence — only send when someone's talking.
    if (Math.sqrt(sumSq / outLen) < SILENCE_RMS) return;
    const out = new ArrayBuffer(8 + pcm.byteLength);
    new DataView(out).setFloat64(0, outRate, true);
    new Int16Array(out, 8).set(pcm);
    sender(out);
  };

  // Pull the graph without echoing the mic back into the room (silent sink).
  sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(processor).connect(sink).connect(ctx.destination);
  running = true;
  return true;
}

export function stopVoiceCapture(): void {
  running = false;
  if (processor) processor.onaudioprocess = null;
  source?.disconnect();
  processor?.disconnect();
  sink?.disconnect();
  if (pump) {
    pump.srcObject = null;
    pump = null;
  }
  for (const t of stream?.getTracks() ?? []) t.stop();
  source = null;
  processor = null;
  sink = null;
  stream = null;
  sender = null;
}
