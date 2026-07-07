/**
 * The GOOP sound kit — every effect synthesised at runtime with WebAudio,
 * tuned wet: squelches, blubs, bubbles, splats and slurps instead of
 * FIRE FIGHT's plate steel (whose `tone`/`whooshNoise`/`bellStrike`
 * primitives this file inherits — the ring bell survives unchanged, some
 * traditions are sacred).
 *
 * The AudioContext can only start inside a user gesture, so we unlock it on
 * the first DOM interaction; after that, sounds triggered from the frame
 * loop play fine.
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
    master.gain.value = 0.3;
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

/** Call from a user gesture (e.g. the landing button) to make audio live. */
export function ensureAudio(): void {
  unlock();
}

/** The shared AudioContext (the announcer decodes through it too). */
export function audioContext(): AudioContext | null {
  return getCtx();
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

/** Bandpass-filtered noise burst — the air/liquid movement primitive. */
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

/** Soft-saturation curve (tanh) — rounds transients into a crunchy, organic
 *  edge instead of the clean click of a raw oscillator. Built once. */
const SHAPE = (() => {
  const n = 512;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2);
  }
  return curve;
})();

/**
 * The wet-impact primitive: a burst of noise driven through a RESONANT
 * low-pass whose cutoff sweeps downward, then lightly saturated. That sweep
 * is what makes it read as a wet "thwuck" of gel rather than a synth beep —
 * one cohesive body instead of a pile of little tones. `q` controls how
 * vocal/squelchy it is; higher = more of a resonant "bloop".
 */
function noiseHit(
  dur: number,
  gain: number,
  cutFrom: number,
  cutTo: number,
  q = 0.7,
  delay = 0,
): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    data[i] = (Math.random() * 2 - 1) * (1 - p) ** 1.5; // fast, natural decay
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = q;
  lp.frequency.setValueAtTime(cutFrom, t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(60, cutTo), t0 + dur * 0.75);
  const sh = c.createWaveShaper();
  sh.curve = SHAPE;
  sh.oversample = '2x';
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(lp).connect(sh).connect(g).connect(c._master!);
  src.start(t0);
}

/** One rising bubble 'blip' — the atom of goo. */
function bubble(freq: number, gain = 0.08, delay = 0, dur = 0.07): void {
  tone({ freq, to: freq * 1.45, type: 'sine', dur, gain, delay });
}

/** A wet downward 'blub' — the body of every impact. */
function blub(freq: number, gain: number, dur: number, delay = 0): void {
  tone({ freq, to: freq * 0.38, type: 'triangle', dur, gain, delay });
  tone({ freq: freq * 0.55, to: freq * 0.22, type: 'sine', dur: dur * 1.2, gain: gain * 0.7, delay: delay + 0.008 });
}

// --- the goo itself --------------------------------------------------------

/** Your fist landing in the gel. `intensity` 0..1 scales the meat of it. One
 *  cohesive wet THWUCK — a bright slap crack on the front, a resonant gel body
 *  that squelches down in pitch, and a sub you feel. No bubble confetti. */
export function squelch(intensity = 0.6): void {
  const i = Math.min(1, Math.max(0, intensity));
  noiseHit(0.03 + 0.02 * i, 0.3 + 0.24 * i, 6200, 1500, 0.7); // crisp wet slap crack
  noiseHit(0.12 + 0.08 * i, 0.26 + 0.3 * i, 1150 + 250 * Math.random(), 150, 2.4); // squelchy body
  tone({ freq: 82, to: 40, type: 'sine', dur: 0.12 + 0.06 * i, gain: 0.16 + 0.2 * i }); // felt sub
  if (i > 0.65) bubble(300 + Math.random() * 240, 0.035, 0.03, 0.05); // a single wet fleck
}

/** A lump tearing clean OFF the body — squelch plus a stretchy rip. */
export function tear(): void {
  squelch(1);
  whooshNoise(0.16, 0.14, 300, 1500, 0.02); // the taffy strand snapping upward
  tone({ freq: 320, to: 900, type: 'sawtooth', dur: 0.09, gain: 0.045, delay: 0.03 });
  bubble(700, 0.07, 0.12);
}

/** Goo landing on the floor. */
export function splat(size = 0.5): void {
  const s = Math.min(1, size);
  whooshNoise(0.08 + 0.1 * s, 0.14 + 0.2 * s, 480, 110);
  blub(110, 0.16 + 0.16 * s, 0.13 + 0.08 * s);
  if (s > 0.4) bubble(240, 0.05, 0.09);
}

/** A lump slurping back into the body. */
export function slurp(): void {
  whooshNoise(0.22, 0.11, 190, 850);
  tone({ freq: 130, to: 430, type: 'triangle', dur: 0.2, gain: 0.09 });
  bubble(520, 0.07, 0.16);
  bubble(760, 0.05, 0.22);
}

/** A little drip budding off and falling. */
export function drip(): void {
  bubble(820 + Math.random() * 300, 0.045, 0, 0.05);
}

/** Idle jelly wobble (poked, or landing after a stagger). */
export function wobble(intensity = 0.5): void {
  const i = Math.min(1, intensity);
  tone({ freq: 95 + 30 * i, to: 55, type: 'sawtooth', dur: 0.22, gain: 0.05 + 0.06 * i });
  tone({ freq: 52, type: 'sine', dur: 0.26, gain: 0.1 + 0.1 * i });
  bubble(300, 0.04 * i, 0.05);
}

/** The creature pulling itself up into its boxer shape — bubbling swell. */
export function gooRise(): void {
  whooshNoise(1.25, 0.15, 85, 420);
  tone({ freq: 42, to: 95, type: 'sine', dur: 1.15, gain: 0.18 });
  for (let i = 0; i < 6; i++) {
    bubble(240 + i * 130 + Math.random() * 80, 0.05, 0.1 + i * 0.16, 0.08);
  }
}

/** Collapsing back into the glob. */
export function gooSink(): void {
  whooshNoise(0.9, 0.13, 380, 90);
  tone({ freq: 95, to: 40, type: 'sine', dur: 0.85, gain: 0.16 });
  for (let i = 0; i < 4; i++) {
    bubble(620 - i * 120, 0.04, 0.08 + i * 0.14, 0.07);
  }
  splat(0.7);
}

/** Punch telegraph — a rising bubbly whine ending exactly at the strike. */
export function gooCharge(dur: number): void {
  tone({ freq: 90, to: 640, type: 'sawtooth', dur, gain: 0.055 });
  whooshNoise(dur, 0.05, 160, 1200);
  for (let i = 0; i < 4; i++) {
    bubble(300 + i * 180, 0.045, dur * (0.25 + i * 0.18), 0.06);
  }
}

/** The creature's fist whipping out. */
export function gooWhoosh(): void {
  whooshNoise(0.28, 0.24, 260, 1500);
  tone({ freq: 150, to: 55, type: 'triangle', dur: 0.16, gain: 0.14 });
}

/** Its punch landing on YOU — a wet sledgehammer you feel in your teeth. One
 *  heavy hit: deep gut sub, a big resonant wet body, a slap crack on the
 *  front — no bubble spray cluttering the impact. */
export function gooSlam(): void {
  tone({ freq: 85, to: 22, type: 'sine', dur: 0.5, gain: 0.5 }); // deep gut sub, felt
  noiseHit(0.2, 0.42, 2200, 110, 1.5); // the big wet body caving in
  noiseHit(0.05, 0.36, 7200, 1700, 0.6); // slap crack on the very front
  tone({ freq: 140, to: 44, type: 'sine', dur: 0.22, gain: 0.24, delay: 0.005 }); // low thud
}

/** Its punch whiffing past your ear. */
export function gooWhiff(): void {
  whooshNoise(0.22, 0.16, 900, 220);
}

/** You blocking its strike on your gloves — a firm, bright leather SLAP,
 *  clearly distinct from the deep wet slam of taking one clean. */
export function gooBlock(): void {
  noiseHit(0.05, 0.42, 5200, 950, 0.9); // sharp bright leather slap
  noiseHit(0.09, 0.26, 1700, 520, 3.0); // tight leathery mid body
  tone({ freq: 150, to: 82, type: 'sine', dur: 0.1, gain: 0.2 }); // small felt thud
}

/** The spinning backfist — a long sweeping rotor of air and slime. */
export function spinWhoosh(): void {
  whooshNoise(0.4, 0.22, 180, 1300);
  whooshNoise(0.34, 0.14, 500, 2000, 0.08);
  tone({ freq: 90, to: 240, type: 'sawtooth', dur: 0.32, gain: 0.06 });
  bubble(340, 0.05, 0.2);
}

/** The roundhouse — heavier, lower, a whole limb's worth of gel in flight. */
export function kickWhoosh(): void {
  whooshNoise(0.3, 0.28, 160, 900);
  tone({ freq: 120, to: 45, type: 'triangle', dur: 0.24, gain: 0.18 });
  blub(140, 0.1, 0.14, 0.05);
}

/** The KO collapse — everything lets go at once. */
export function koSplat(): void {
  splat(1);
  blub(70, 0.3, 0.3, 0.02);
  whooshNoise(0.5, 0.2, 300, 60, 0.02);
  for (let i = 0; i < 8; i++) {
    bubble(180 + Math.random() * 700, 0.05, 0.05 + Math.random() * 0.5);
  }
}

/** You taking a hit — the wet impact plus a deep body thud. */
export function hitTaken(): void {
  squelch(1);
  tone({ freq: 92, to: 34, type: 'sine', dur: 0.26, gain: 0.26 }); // felt body, not a buzz
}

/** UI: a soft wet click. */
export function uiClick(): void {
  bubble(600, 0.07, 0, 0.05);
  tone({ freq: 140, type: 'sine', dur: 0.04, gain: 0.07 });
}

/** UI: the laser landing on a button — the click's quieter echo. */
export function uiHover(): void {
  bubble(520, 0.03, 0, 0.04);
}

// --- the ring bell (inherited, sacred) --------------------------------------

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
  // The hammer hitting the bell.
  whooshNoise(0.025, 0.16, 2800, 1500, delay);
}

/** DING DING — the round begins. */
export function roundBell(): void {
  bellStrike(0);
  bellStrike(0.32);
}

/** End-of-round cue: one bell, then a happy blip, a sour slide, or a flat
 *  double-tap for an even round (ported from FIRE FIGHT, wet garnish). */
export function roundEnd(win: boolean | 'draw'): void {
  bellStrike(0);
  if (win === 'draw') {
    tone({ freq: 440, type: 'triangle', dur: 0.12, gain: 0.16, delay: 0.24 });
    tone({ freq: 440, type: 'sine', dur: 0.16, gain: 0.12, delay: 0.4 });
  } else if (win) {
    tone({ freq: 523, type: 'triangle', dur: 0.1, gain: 0.2, delay: 0.25 });
    tone({ freq: 784, type: 'triangle', dur: 0.12, gain: 0.2, delay: 0.35 });
    bubble(600, 0.06, 0.45);
  } else {
    tone({ freq: 392, to: 300, type: 'sine', dur: 0.2, gain: 0.2, delay: 0.25 });
    bubble(220, 0.06, 0.4, 0.09);
  }
}

/** End-of-match fanfare / sad trombone (wet edition). */
export function matchEnd(win: boolean): void {
  if (win) {
    const HIT = 0.62;
    whooshNoise(HIT + 0.05, 0.26, 130, 2200);
    whooshNoise(HIT + 0.05, 0.18, 320, 3600, 0.06);
    tone({ freq: 60, to: 150, type: 'sine', dur: HIT, gain: 0.22 });
    bellStrike(HIT);
    whooshNoise(0.5, 0.24, 2600, 200, HIT);
    tone({ freq: 80, to: 44, type: 'sine', dur: 0.45, gain: 0.26, delay: HIT });
    [98, 196].forEach((f) =>
      tone({ freq: f, to: f * 1.005, type: 'sawtooth', dur: 1.6, gain: 0.1, delay: HIT + 0.04 }),
    );
    bellStrike(HIT + 0.55);
    // And the goop's death rattle under the fanfare.
    koSplat();
  } else {
    bellStrike(0);
    bellStrike(0.28);
    bellStrike(0.56);
    [392, 330, 262].forEach((f, i) =>
      tone({ freq: f, to: f * 0.9, type: 'sine', dur: 0.24, gain: 0.2, delay: 0.7 + i * 0.16 }),
    );
    // Smug victory bubbling from the blob.
    for (let i = 0; i < 5; i++) bubble(300 + i * 160, 0.06, 1.2 + i * 0.13);
  }
}
