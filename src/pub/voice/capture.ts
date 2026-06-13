/**
 * Local microphone capture for pub voice chat. Grabs the mic, encodes it to
 * Opus with WebCodecs (low-latency, frame-aligned — unlike MediaRecorder),
 * and hands each compressed frame to a sender callback that ships it over the
 * pub WebSocket. The server fans frames out (and enforces the match bubble —
 * fighters only hear their opponent), so this side just streams whenever the
 * mic is live and unmuted.
 *
 * WebCodecs (AudioEncoder, MediaStreamTrackProcessor, EncodedAudioChunk) is
 * not in the TS DOM lib, so the constructors are reached through globalThis
 * and the per-frame objects are loosely typed — the shapes are stable in the
 * Chromium-based headset browsers we target. If the API is missing we simply
 * report failure and the pub runs silent.
 */

/** Receives one Opus frame: [8-byte float64 µs timestamp][opus payload]. */
export type VoiceSender = (frame: ArrayBuffer) => void;

const SAMPLE_RATE = 48000;
const BITRATE = 24000; // plenty for speech; keeps the relay light

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = globalThis as any;

let track: MediaStreamTrack | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let encoder: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let reader: any = null;
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
 * Ask for the mic and start streaming Opus frames. Resolves true once live,
 * false if WebCodecs is unavailable or the user denies permission. Safe to
 * call more than once — only the first start takes effect.
 */
export async function startVoiceCapture(send: VoiceSender): Promise<boolean> {
  if (running) return true;
  if (!G.AudioEncoder || !G.MediaStreamTrackProcessor) {
    console.warn('[pub voice] WebCodecs capture unavailable — mic disabled');
    return false;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    console.warn('[pub voice] microphone permission denied', err);
    return false;
  }

  sender = send;
  track = stream.getAudioTracks()[0] ?? null;
  if (!track) return false;

  encoder = new G.AudioEncoder({
    output: (chunk: unknown) => emit(chunk),
    error: (e: Error) => console.warn('[pub voice] encoder error', e),
  });
  encoder.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: BITRATE });

  const processor = new G.MediaStreamTrackProcessor({ track });
  reader = processor.readable.getReader();
  running = true;
  void pump();
  return true;
}

async function pump(): Promise<void> {
  while (running && reader) {
    let result: { value: unknown; done: boolean };
    try {
      result = await reader.read();
    } catch {
      break;
    }
    if (result.done) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const audioData = result.value as any; // AudioData
    if (!muted && encoder && encoder.state === 'configured') {
      try {
        encoder.encode(audioData);
      } catch {
        /* a dropped frame is harmless */
      }
    }
    audioData.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emit(chunk: any): void {
  if (!sender) return;
  const payload = new Uint8Array(chunk.byteLength);
  chunk.copyTo(payload);
  const out = new ArrayBuffer(8 + payload.byteLength);
  new DataView(out).setFloat64(0, chunk.timestamp || 0, true);
  new Uint8Array(out, 8).set(payload);
  sender(out);
}

export function stopVoiceCapture(): void {
  running = false;
  try {
    reader?.cancel();
  } catch {
    /* already gone */
  }
  try {
    encoder?.close();
  } catch {
    /* already closed */
  }
  track?.stop();
  reader = null;
  encoder = null;
  track = null;
  sender = null;
}
