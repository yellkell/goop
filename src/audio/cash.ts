/**
 * The cash chime — a short money sting played when you BUY something in the
 * shop and when you WIN a bet at the fight-hall tablets. One mp3
 * (src/assets/currency/cash.mp3) decoded into the shared AudioContext and
 * fired on demand, the same pattern as the ring announcer. It no-ops cleanly
 * until the clip has decoded and the context is unlocked.
 */

import cashUrl from '../assets/currency/cash.mp3?url';
import { audioContext } from './sfx.js';

let buffer: AudioBuffer | null = null;
let loadStarted: Promise<void> | null = null;

function load(ctx: AudioContext): Promise<void> {
  loadStarted ??= (async () => {
    try {
      const res = await fetch(cashUrl);
      buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      /* leave it unloaded — playCash() simply skips */
    }
  })();
  return loadStarted;
}

/** Decode the clip ahead of time (call once the AudioContext exists). */
export function preloadCash(): void {
  const ctx = audioContext();
  if (ctx) void load(ctx);
}

/** Play the cash chime. Safe to over-call. */
export function playCash(): void {
  const ctx = audioContext();
  if (!ctx) return;
  if (!buffer) {
    void load(ctx); // not decoded yet — kick a load for next time
    return;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  src.connect(gain).connect(ctx.destination);
  src.start();
}
