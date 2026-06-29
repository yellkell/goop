/**
 * Coin-landing chimes — the confirmation sting for an ARENA-THROWN bet. When a
 * spectator lobs a coin into the fight pit and it settles on a fighter's half,
 * the stake is locked in and ONE of these short landing sounds rings at random.
 *
 * Auto-discovered: drop more .mp3s into src/assets/landing and they join the
 * pool. Decoded into the shared AudioContext and fired on demand, the same
 * pattern as the cash chime. No-ops cleanly until a clip has decoded and the
 * context is unlocked.
 */

import { audioContext } from './sfx.js';

// Every landing clip, bundled by Vite (filename order keeps it stable).
const landingUrls = Object.entries(
  import.meta.glob('../assets/landing/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<
    string,
    string
  >,
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

const buffers: (AudioBuffer | null)[] = landingUrls.map(() => null);
let loadStarted: Promise<void> | null = null;

function load(ctx: AudioContext): Promise<void> {
  loadStarted ??= (async () => {
    await Promise.all(
      landingUrls.map(async (url, i) => {
        try {
          const res = await fetch(url);
          buffers[i] = await ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          /* leave this one unloaded — it just won't be picked */
        }
      }),
    );
  })();
  return loadStarted;
}

/** Decode the clips ahead of time (call once the AudioContext exists). */
export function preloadLanding(): void {
  const ctx = audioContext();
  if (ctx) void load(ctx);
}

/** Play a random landing chime — the "bet placed" confirmation. Over-call safe. */
export function playLanding(): void {
  const ctx = audioContext();
  if (!ctx) return;
  const ready = buffers.filter((b): b is AudioBuffer => b !== null);
  if (ready.length === 0) {
    void load(ctx); // not decoded yet — kick a load for next time
    return;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  const buffer = ready[Math.floor(Math.random() * ready.length)];
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.85;
  src.connect(gain).connect(ctx.destination);
  src.start();
}
