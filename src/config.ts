/**
 * GOOP tunables — every number the feel of the fight depends on. Dimensions
 * are in metres, times in seconds. The star of the show is THE GOOP: a
 * man-sized gel creature built from ~two dozen simulated blobs rendered as
 * one raymarched liquid surface. Most of these knobs shape how it wobbles,
 * how hard it is to knock lumps out of it, and how quickly it pulls itself
 * back together.
 */

export const GAME_TITLE = 'GOOP';

/** Where the creature stands relative to the player's starting spot. */
export const ARENA = {
  /** Creature spawn, metres in front of you (negative Z is "ahead"). */
  spawn: [0, 0, -1.9] as const,
  /** The creature roams inside this radius around its spawn point. */
  roamRadius: 1.1,
  /** Out-fighter spacing: it holds at `rangeDistance` and only lurches in to
   *  `strikeDistance` for a combo, then backs off again. */
  rangeDistance: 1.7,
  strikeDistance: 0.92,
  /** The wall board: the whole HUD, mounted behind the creature's corner. */
  wall: [0, 1.8, -3.3] as const,
};

/** Your defence. Raise a glove onto the spot his fist lands and it's blocked. */
export const BLOCK = {
  /** A glove within this of the strike's impact point stops it. */
  radius: 0.26,
  /** Chip damage that still leaks through a block (fraction of the hit). */
  chip: 0.12,
};

/** The creature's body plan. */
export const CREATURE = {
  /** Head height when fully formed up into its boxer shape. */
  height: 1.78,
  /** Glob-mode dome: roughly this radius, this tall. */
  globRadius: 0.62,
  globHeight: 0.95,
  /** Smooth-min blend width — how gloopily the blobs fuse (bigger = soupier). */
  blend: 0.19,
  /** Max simultaneous knocked-out lumps in flight/resting on the floor. */
  maxLumps: 8,
  /** Max simultaneous punch dents (negative blobs carved by your fists). */
  maxDents: 4,
  /** Seconds for glob -> boxer form-up (and back down). */
  formTime: 1.35,
};

/** Punch reception — what your fists do to the gel. */
export const PUNCH = {
  /** Fist speed (m/s) below this only nudges the surface, no "hit". */
  hitSpeed: 1.3,
  /** Fist speed that knocks a lump clean out of the body. */
  lumpSpeed: 2.5,
  /** Impulse scale from fist velocity into nearby blobs. */
  impulse: 0.55,
  /** Radius around the contact point that feels the punch. */
  splashRadius: 0.5,
  /** Seconds a dent crater lingers before the gel flows back in. */
  dentLife: 0.5,
  /** Per-hand cooldown between scoring hits. */
  cooldown: 0.2,
  /** Damage per scoring hit (scaled up with fist speed). */
  damage: 3.2,
  /** Extra damage when a lump is knocked out. */
  lumpBonus: 2.5,
};

/** The bout. */
export const COMBAT = {
  playerHealth: 100,
  /** It's a tank — wearing it down is the fight; the finisher is landing
   *  on it once it's exhausted (see EXHAUST). */
  creatureHealth: 300,
  /** The creature's straight does this much when it lands on you. */
  creaturePunchDamage: 9,
  /** Round length before it goes to the cards (TIME verdict). */
  roundSeconds: 99,
  /** 3-2-1-FIGHT beat length. */
  countdownBeat: 1.0,
};

/**
 * The moveset — every strike THE GOOP knows. Telegraph is your dodge
 * window (scaled by difficulty tempo); strike time is fixed so a punch
 * always looks like a punch. Damage is before the difficulty multiplier.
 */
export type AttackName = 'jab' | 'cross' | 'hook' | 'uppercut' | 'overhand' | 'backfist' | 'roundhouse';

export interface AttackSpec {
  telegraph: number;
  strike: number;
  recover: number;
  damage: number;
  /** Contact distance from the striking blob to your head at apex. */
  hitRadius: number;
}

export const ATTACKS: Record<AttackName, AttackSpec> = {
  jab: { telegraph: 0.38, strike: 0.13, recover: 0.35, damage: 5, hitRadius: 0.42 },
  cross: { telegraph: 0.62, strike: 0.17, recover: 0.55, damage: 9, hitRadius: 0.45 },
  hook: { telegraph: 0.55, strike: 0.2, recover: 0.5, damage: 11, hitRadius: 0.45 },
  uppercut: { telegraph: 0.6, strike: 0.18, recover: 0.55, damage: 12, hitRadius: 0.45 },
  overhand: { telegraph: 0.72, strike: 0.22, recover: 0.6, damage: 13, hitRadius: 0.48 },
  backfist: { telegraph: 0.75, strike: 0.34, recover: 0.6, damage: 14, hitRadius: 0.5 },
  roundhouse: { telegraph: 0.7, strike: 0.26, recover: 0.65, damage: 13, hitRadius: 0.5 },
};

/** Creature AI pacing (seconds unless noted). */
export const BRAIN = {
  /** Glob-phase roaming before it forms up to swing. */
  roamMin: 2.6,
  roamMax: 5.2,
  /** Punches per form-up combo. */
  comboMin: 1,
  comboMax: 3,
  /** Telegraph (wind-up) before a straight — your dodge window. */
  telegraph: 0.62,
  /** The strike itself: fist launch to full extension. */
  strikeTime: 0.17,
  recoverTime: 0.55,
  /** Accumulated damage inside one combo that staggers it (wobble pause). */
  staggerDamage: 30,
};

/**
 * The finisher window. It fights on its feet the whole round; only when it
 * is REALLY hurt does it lose its shape — collapsing into an exhausted glob
 * that takes double damage. Dive on it.
 */
export const EXHAUST = {
  /** HP fraction that triggers the collapse (once per round). */
  threshold: 0.3,
  /** Seconds it lies there vulnerable before pulling itself together. */
  duration: 6,
  /** Damage multiplier while it's down. */
  vulnerability: 2,
};

/** Gel look. Colours are linear-ish hex fed straight into the shader. */
export const GEL_LOOK = {
  /** Shallow (thin-edge) tint — backlit lime. */
  shallowColor: 0x8cff70,
  /** Deep-body tint — dark bottle-green. */
  deepColor: 0x14602f,
  /** Inner nucleus glow — the denser "organ" slime in the middle. */
  nucleusColor: 0x36e05a,
  /** Eye flash colour during a punch telegraph. */
  telegraphColor: 0xffb03a,
  /** Raymarch step cap (the single biggest perf knob on Quest). */
  maxSteps: 22,
  /** Surface wobble amplitude at rest / when agitated. */
  wobble: 0.010,
  wobbleAgitated: 0.028,
};
