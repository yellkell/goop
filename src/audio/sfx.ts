/**
 * Tiny WebAudio sound kit — every sound is synthesised at runtime (no asset
 * files to ship or load). Whooshes, clangs and a proper boxing bell.
 *
 * The AudioContext can only start inside a user gesture, so we unlock it on
 * the first DOM interaction; after that, sounds triggered from the frame loop
 * play fine.
 */

type Ctx = AudioContext & { _master?: GainNode };

let ctx: Ctx | null = null;

function getCtx(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as Ctx;
    const master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
    ctx._master = master;
  }
  return ctx;
}

function unlock(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'click', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlock, { capture: true });
  }
}

/** Call from a user gesture (e.g. menu click) to make sure audio is live. */
export function ensureAudio(): void {
  unlock();
}

function ready(): Ctx | null {
  const c = getCtx();
  if (!c) return null;
  if (c.state === 'suspended') void c.resume();
  return c.state === 'running' ? c : null;
}

interface ToneOpts {
  freq: number;
  to?: number; // glide target
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  delay?: number;
}

function tone(o: ToneOpts): void {
  const c = ready();
  if (!c) return;
  const { freq, to, type = 'sine', dur = 0.12, gain = 0.2, delay = 0 } = o;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c._master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** Bandpass-filtered noise burst — the basis of every whoosh. */
function whooshNoise(dur: number, gain: number, fromHz: number, toHz: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    data[i] = (Math.random() * 2 - 1) * (p < 0.12 ? p / 0.12 : 1) * (1 - p) ** 0.8;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(fromHz, t0);
  bp.frequency.exponentialRampToValueAtTime(toHz, t0 + dur * 0.6);
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(c._master!);
  src.start(t0);
}

// --- Game sounds ---------------------------------------------------------

/** Trigger pulled at the fist — the ball flares into orbit. */
export function ignite(): void {
  whooshNoise(0.28, 0.16, 220, 1100);
  tone({ freq: 90, to: 60, type: 'sine', dur: 0.2, gain: 0.14 });
}

/** A punched ball leaving the fist — a hard whoosh with body. */
export function throwWhoosh(): void {
  whooshNoise(0.4, 0.26, 320, 1500);
  tone({ freq: 240, to: 90, type: 'triangle', dur: 0.16, gain: 0.18 });
}

/** Recall pulled — the ball roars as it turns back. */
export function recall(): void {
  whooshNoise(0.35, 0.18, 1300, 280);
  tone({ freq: 320, to: 560, type: 'sine', dur: 0.18, gain: 0.12 });
}

/** The ball slaps back into your palm. */
export function catchBall(): void {
  tone({ freq: 200, to: 110, type: 'triangle', dur: 0.08, gain: 0.2 });
  whooshNoise(0.08, 0.1, 900, 500);
}

/** Your ball lands on the opponent — a heavy "thock". */
export function hitDealt(): void {
  tone({ freq: 320, to: 110, type: 'sine', dur: 0.15, gain: 0.32 });
  whooshNoise(0.07, 0.14, 1200, 600);
}

/** You take a hit — a duller, lower thud. */
export function hitTaken(): void {
  tone({ freq: 160, to: 60, type: 'sawtooth', dur: 0.22, gain: 0.28 });
  whooshNoise(0.1, 0.1, 500, 200);
}

/** Iron on iron: your orbiting ball parries theirs — a bright clang. */
export function deflect(): void {
  tone({ freq: 1180, to: 880, type: 'square', dur: 0.09, gain: 0.15 });
  tone({ freq: 1560, type: 'square', dur: 0.06, gain: 0.1, delay: 0.02 });
  whooshNoise(0.12, 0.12, 2400, 900);
}

/** Soft UI tick for menu buttons. */
export function uiClick(): void {
  tone({ freq: 680, to: 900, type: 'sine', dur: 0.05, gain: 0.16 });
}

/** One strike of the ring bell — long metallic decay. */
function bellStrike(delay: number): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  // Fundamental + inharmonic partials = a passable steel bell.
  for (const [f, g, d] of [[660, 0.3, 1.1], [1320, 0.12, 0.7], [1980, 0.06, 0.45], [392, 0.08, 0.9]] as const) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    osc.connect(env).connect(c._master!);
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  }
}

/** DING DING — a round begins. */
export function roundBell(): void {
  bellStrike(0);
  bellStrike(0.32);
}

/** End-of-round cue. */
export function roundEnd(win: boolean): void {
  bellStrike(0);
  if (win) {
    tone({ freq: 523, type: 'triangle', dur: 0.1, gain: 0.2, delay: 0.25 });
    tone({ freq: 784, type: 'triangle', dur: 0.12, gain: 0.2, delay: 0.35 });
  } else {
    tone({ freq: 392, to: 300, type: 'sine', dur: 0.2, gain: 0.2, delay: 0.25 });
  }
}

/** End-of-match fanfare / sad cue. */
export function matchEnd(win: boolean): void {
  bellStrike(0);
  bellStrike(0.28);
  bellStrike(0.56);
  if (win) {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.16, gain: 0.22, delay: 0.7 + i * 0.12 }),
    );
  } else {
    [392, 330, 262].forEach((f, i) =>
      tone({ freq: f, to: f * 0.9, type: 'sine', dur: 0.24, gain: 0.2, delay: 0.7 + i * 0.16 }),
    );
  }
}
