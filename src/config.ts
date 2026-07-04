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
  /** It tries to keep about this distance from your head while brawling. */
  engageDistance: 0.95,
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
  creatureHealth: 100,
  /** The creature's straight does this much when it lands on you. */
  creaturePunchDamage: 9,
  /** Round length before it goes to the cards (TIME verdict). */
  roundSeconds: 99,
  /** 3-2-1-FIGHT beat length. */
  countdownBeat: 1.0,
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
  /** Accumulated damage inside one form-up that staggers it back to glob. */
  staggerDamage: 14,
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
  maxSteps: 30,
  /** Surface wobble amplitude at rest / when agitated. */
  wobble: 0.010,
  wobbleAgitated: 0.028,
};
