/**
 * Tiny WebAudio sound kit — every sound is synthesised at runtime (no asset
 * files to ship or load), tuned to the game's industrial robot-wars palette:
 * struck plate steel, servos, pistons, furnace roar. The core building blocks
 * are `tone` (a glided oscillator), `whooshNoise` (bandpassed noise) and
 * `clank` (an inharmonic partial stack with a noisy attack — metal on metal).
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

/** The shared AudioContext (voice chat spatialises through it too). */
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

/**
 * Struck plate steel: an inharmonic partial stack (plate-bell ratios, each
 * slightly detuned) over a sharp noise tick. `base` sets the pitch of the
 * plate, `dur` how long it rings.
 */
function clank(base: number, gain = 0.2, dur = 0.3, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const ratios = [1, 1.51, 2.27, 3.43, 4.83];
  ratios.forEach((ratio, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.015);
    const env = c.createGain();
    const g = gain * (1 / (i + 1));
    const d = dur * (1 - i * 0.12);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.04, d));
    osc.connect(env).connect(c._master!);
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  });
  // The impact tick that sells the strike.
  whooshNoise(0.03, gain * 0.7, base * 4, base * 2, delay);
}

/** Servo whine: a narrow-banded saw gliding between two pitches. */
function servo(from: number, to: number, dur: number, gain = 0.07, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 7;
  bp.frequency.setValueAtTime(from * 2, t0);
  bp.frequency.exponentialRampToValueAtTime(Math.max(1, to * 2), t0 + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(bp).connect(env).connect(c._master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// --- Game sounds ---------------------------------------------------------

/** Trigger pulled at the fist — a latch clacks and the furnace lights. */
export function ignite(): void {
  clank(1900, 0.05, 0.06); // igniter latch
  whooshNoise(0.32, 0.15, 140, 850); // furnace catching
  tone({ freq: 70, to: 46, type: 'sine', dur: 0.22, gain: 0.16 }); // sub thump
}

/** A punched ball leaving the fist — piston release into a hard whoosh. */
export function throwWhoosh(): void {
  clank(620, 0.06, 0.09); // piston knock
  whooshNoise(0.42, 0.28, 280, 1600);
  tone({ freq: 210, to: 70, type: 'triangle', dur: 0.18, gain: 0.18 });
}

/** Recall pulled — a winch servo spools the ball back in. */
export function recall(): void {
  servo(150, 520, 0.35, 0.09);
  whooshNoise(0.32, 0.16, 1200, 300);
  clank(880, 0.04, 0.06, 0.05);
}

/** The ball clamps back into the gauntlet. */
export function catchBall(): void {
  clank(430, 0.15, 0.14);
  tone({ freq: 140, to: 88, type: 'triangle', dur: 0.08, gain: 0.18 });
}

/** Mic toggle: a short up-blip when opening, a duller down-blip when muting. */
export function micToggle(on: boolean): void {
  clank(on ? 1300 : 700, 0.05, 0.05);
  tone({ freq: on ? 520 : 360, to: on ? 760 : 240, type: 'sine', dur: 0.08, gain: 0.12 });
}

/** Your ball lands on the opponent — anvil ring over a heavy body. */
export function hitDealt(): void {
  clank(540, 0.26, 0.35);
  tone({ freq: 260, to: 78, type: 'sine', dur: 0.18, gain: 0.3 });
}

/** Aim Training target impacts: disc = bright gong, cutout = hollow armour. */
export function trainingTargetHit(kind: 0 | 1): void {
  if (kind === 0) {
    clank(920, 0.18, 0.42);
    clank(1380, 0.08, 0.26, 0.015);
    tone({ freq: 740, to: 980, type: 'triangle', dur: 0.11, gain: 0.12 });
  } else {
    clank(360, 0.18, 0.28);
    clank(520, 0.08, 0.18, 0.025);
    tone({ freq: 150, to: 72, type: 'triangle', dur: 0.16, gain: 0.18 });
  }
}

/** A single solid metallic CLINK — two iron gauntlets striking, not a papery
 *  clap: a short bright inharmonic strike with a tight decay and a touch of
 *  iron body under it. No airy hiss, no cartoon glide. */
export function clap(): void {
  clank(1040, 0.3, 0.12);
  clank(1560, 0.13, 0.07, 0.004); // bright overtone a hair later
  tone({ freq: 300, to: 188, type: 'sine', dur: 0.05, gain: 0.09 }); // iron thump
}

/** Knuckle plates meeting — a deeper, fuller metal DONK with a short ring. */
export function fistBump(): void {
  clank(720, 0.28, 0.22);
  clank(1180, 0.12, 0.13, 0.01);
  tone({ freq: 150, to: 80, type: 'sine', dur: 0.1, gain: 0.14 });
}

export function boundaryBuzz(intensity = 1): void {
  const gain = 0.08 + 0.12 * Math.min(1, intensity);
  tone({ freq: 72, to: 46, type: 'sawtooth', dur: 0.18, gain });
  servo(95, 48, 0.18, 0.07 + 0.05 * Math.min(1, intensity));
  whooshNoise(0.12, 0.06 + 0.06 * Math.min(1, intensity), 95, 520);
}

export function hitTaken(): void {
  clank(760, 0.26, 0.45); // the iron ball ringing off your armour
  tone({ freq: 105, to: 36, type: 'sawtooth', dur: 0.3, gain: 0.3 });
  clank(270, 0.14, 0.26, 0.015); // loose chassis rattle behind it
  whooshNoise(0.12, 0.12, 380, 140);
}

/** Iron on iron: your orbiting ball parries theirs — hammer on anvil. */
export function deflect(): void {
  clank(1240, 0.22, 0.45);
  clank(1860, 0.09, 0.25, 0.02);
  whooshNoise(0.1, 0.1, 2600, 1000);
}

/** Two flying balls blocking each other mid-air — a hard double clink. */
export function ballClash(): void {
  clank(1040, 0.26, 0.42);
  clank(1560, 0.11, 0.22, 0.025); // ricochet ring
  whooshNoise(0.08, 0.11, 3000, 1200);
  tone({ freq: 170, to: 90, type: 'triangle', dur: 0.1, gain: 0.12 });
}

/** A spent ball slamming into the arena's far cage wall — distant boom. */
export function wallThud(): void {
  tone({ freq: 90, to: 38, type: 'sine', dur: 0.28, gain: 0.18 });
  clank(180, 0.08, 0.3, 0.01);
}

// --- pub prop impacts: glass and steel sound NOTHING alike ------------------

/**
 * Glass on a hard surface — a bright, quick 'tink' of high near-pure partials
 * (not the inharmonic ring of struck steel). `hard` is a real bounce; soft is
 * a glass merely set down.
 */
export function glassTap(hard = false): void {
  const g = hard ? 0.16 : 0.1;
  tone({ freq: 2600, type: 'sine', dur: hard ? 0.22 : 0.15, gain: g });
  tone({ freq: 3900, type: 'sine', dur: hard ? 0.14 : 0.09, gain: g * 0.5, delay: 0.004 });
  tone({ freq: 5200, type: 'sine', dur: 0.05, gain: g * 0.3 });
  whooshNoise(0.025, g * 0.4, 6500, 3000); // the glassy attack tick
}

/** Glass meeting glass — a stacked pint clinking onto another. Brighter, two-tone. */
export function glassClink(): void {
  tone({ freq: 3000, type: 'sine', dur: 0.2, gain: 0.14 });
  tone({ freq: 4550, type: 'sine', dur: 0.12, gain: 0.07, delay: 0.006 });
  tone({ freq: 6100, type: 'sine', dur: 0.05, gain: 0.04 });
  whooshNoise(0.02, 0.28, 7500, 3500);
}

/** A steel dart clattering down on the floor — light metal tink + a low rattle. */
export function dartFloor(): void {
  clank(900, 0.1, 0.12);
  clank(1400, 0.05, 0.07, 0.03); // the barrel's second bounce
  tone({ freq: 150, to: 80, type: 'triangle', dur: 0.05, gain: 0.06 });
}

/** A dart biting into the cork board — a soft, dull thock, no ring. */
export function dartStick(): void {
  tone({ freq: 320, to: 150, type: 'sine', dur: 0.06, gain: 0.16 });
  whooshNoise(0.04, 0.12, 1300, 320);
}


/** UI: a relay snapping closed. */
export function uiClick(): void {
  clank(1500, 0.05, 0.04);
  tone({ freq: 110, type: 'sine', dur: 0.04, gain: 0.08 });
}

/** UI: the laser pointer sweeping onto a panel — a soft, quick zap. Kept very
 *  quiet: it fires on every hover, so it should barely register. */
export function uiHover(): void {
  tone({ freq: 1700, to: 2500, type: 'sine', dur: 0.05, gain: 0.016 });
  whooshNoise(0.035, 0.008, 3200, 5200);
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
  // The hammer hitting the bell.
  whooshNoise(0.025, 0.16, 2800, 1500, delay);
}

/** DING DING — a round begins. */
export function roundBell(): void {
  bellStrike(0);
  bellStrike(0.32);
}

/** End-of-round cue. */
export function roundEnd(win: boolean | 'draw'): void {
  bellStrike(0);
  if (win === 'draw') {
    tone({ freq: 440, type: 'triangle', dur: 0.12, gain: 0.16, delay: 0.24 });
    tone({ freq: 440, type: 'sine', dur: 0.16, gain: 0.12, delay: 0.4 });
  } else if (win) {
    tone({ freq: 523, type: 'triangle', dur: 0.1, gain: 0.2, delay: 0.25 });
    tone({ freq: 784, type: 'triangle', dur: 0.12, gain: 0.2, delay: 0.35 });
  } else {
    tone({ freq: 392, to: 300, type: 'sine', dur: 0.2, gain: 0.2, delay: 0.25 });
  }
}

/** End-of-match fanfare / sad cue. */
export function matchEnd(win: boolean): void {
  if (win) {
    // Wooshing triumph — no tune. A big air-rush builds and lands on a
    // gut-punch impact, then a low power drone (root + octave) rings out.
    const HIT = 0.62; // when the rising whoosh lands
    // The build: two layered noise sweeps rushing upward into the hit.
    whooshNoise(HIT + 0.05, 0.26, 130, 2200);
    whooshNoise(HIT + 0.05, 0.18, 320, 3600, 0.06);
    // Rising sub underneath the build for weight.
    tone({ freq: 60, to: 150, type: 'sine', dur: HIT, gain: 0.22 });
    // The landing: layered strikes + a downward impact whoosh.
    bellStrike(HIT);
    clank(150, 0.16, 0.5, HIT);
    clank(300, 0.1, 0.35, HIT + 0.02);
    whooshNoise(0.5, 0.24, 2600, 200, HIT);
    tone({ freq: 80, to: 44, type: 'sine', dur: 0.45, gain: 0.26, delay: HIT }); // impact thump
    // Triumphant power drone — a sustained root + octave (no melody) that
    // swells in just after the hit and rings out long.
    [98, 196].forEach((f) =>
      tone({ freq: f, to: f * 1.005, type: 'sawtooth', dur: 1.6, gain: 0.1, delay: HIT + 0.04 }),
    );
    bellStrike(HIT + 0.04);
    bellStrike(HIT + 0.55);
  } else {
    bellStrike(0);
    bellStrike(0.28);
    bellStrike(0.56);
    [392, 330, 262].forEach((f, i) =>
      tone({ freq: f, to: f * 0.9, type: 'sine', dur: 0.24, gain: 0.2, delay: 0.7 + i * 0.16 }),
    );
  }
}

/**
 * Saloon entrance — the swinging-doors-of-a-western-bar sound when someone
 * walks in: a wooden door creak (descending filtered noise + a low wood
 * knock), a spring-hinge twang, then a brass spittoon-ish bell ding.
 */
export function saloonEntry(): void {
  // Hinge creak: filtered noise sweeping down, plus a detuned squeak.
  whooshNoise(0.42, 0.1, 900, 240);
  tone({ freq: 520, to: 240, type: 'sawtooth', dur: 0.32, gain: 0.05 });
  // Two wooden door knocks as the panels swing past the jamb.
  clank(220, 0.12, 0.16, 0.04);
  clank(180, 0.1, 0.18, 0.22);
  // A little entrance bell over the door.
  tone({ freq: 1480, type: 'sine', dur: 0.18, gain: 0.12, delay: 0.12 });
  tone({ freq: 1970, type: 'sine', dur: 0.14, gain: 0.07, delay: 0.16 });
}
