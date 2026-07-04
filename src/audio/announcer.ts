/**
 * The ring announcer — a deep voice over the pre-round countdown. Four short
 * clips (3 / 2 / 1 / FIGHT, in src/assets/announcer) are decoded into the
 * shared AudioContext and fired on the matching countdown beats by
 * GameStateSystem, on every client. It no-ops cleanly until the clips have
 * decoded and the context is unlocked, so it never blocks a bout.
 */

import { audioContext } from './sfx.js';

export type Call = '1' | '2' | '3' | 'fight';

// Vite bundles each clip to a hashed URL (same pattern as the jukebox songs).
const modules = import.meta.glob('../assets/announcer/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const urls: Partial<Record<Call, string>> = {};
for (const [path, url] of Object.entries(modules)) {
  const stem = (path.split('/').pop() ?? '').replace(/\.mp3$/i, '');
  if (stem === '1' || stem === '2' || stem === '3' || stem === 'fight') urls[stem] = url;
}

const buffers: Partial<Record<Call, AudioBuffer>> = {};
let loadStarted: Promise<void> | null = null;

function load(ctx: AudioContext): Promise<void> {
  loadStarted ??= Promise.all(
    (Object.keys(urls) as Call[]).map(async (k) => {
      try {
        const res = await fetch(urls[k]!);
        buffers[k] = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        /* leave it unloaded — announce() simply skips this call */
      }
    }),
  ).then(() => undefined);
  return loadStarted;
}

/** Decode the clips ahead of time (call once the AudioContext exists). */
export function preloadAnnouncer(): void {
  const ctx = audioContext();
  if (ctx) void load(ctx);
}

/** Speak one countdown beat. Safe to over-call — drive it off transitions. */
export function announce(call: Call): void {
  const ctx = audioContext();
  if (!ctx) return;
  const buf = buffers[call];
  if (!buf) {
    void load(ctx); // not decoded yet — kick a load for next time
    return;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // Its own gain straight to the destination — the announcer rides above the
  // synth SFX (which sit under a quieter master) so the voice cuts through.
  const gain = ctx.createGain();
  gain.gain.value = 0.85;
  src.connect(gain).connect(ctx.destination);
  src.start();
}
