/**
 * HARD mode's secret weapon: FIGHTING STYLES. Each round the goop privately
 * draws a new martial identity from a shuffled deck and becomes that fighter
 * — silhouette, spacing, pacing, combo book, toughness, footwork. The player
 * is never told; the STANCE is the tell (the gel visibly re-pours itself into
 * the new shape between rounds):
 *
 *  INFIGHTER  (peek-a-boo pressure, think prime Tyson) — crouched, coiled,
 *             gloves welded to the cheeks; swarms you, rips hooks and
 *             uppercuts to head AND body from inside your reach.
 *  KICKBOXER  (rangy striker, think Adesanya) — tall and lanky, lead hand
 *             carried LOW; potshots and long kicks from way outside, spins
 *             when you least want them.
 *  MUAY THAI  (forward march, think Rodtang) — square, upright, high tight
 *             guard; walks through your best shots (very hard to stagger)
 *             and answers with round kicks and the clap-clinch smash.
 *  OUTBOXER   (hands-down showman, think Roy Jones Jr) — leaned back, hands
 *             at his hips, dancing feet; blinding-fast jab-led combinations
 *             and the lead-hand backfist, gone before you answer.
 *  ROPE-A-DOPE (late-career Ali) — shelled up, gloves glued to the face,
 *             leaning away; barely initiates, soaks pressure... then punishes
 *             your flurry with a sharp counter burst the moment you overstay.
 *
 * Pose entries are deltas on BOXER_POSE: [anchor, dx, dy, dz, radiusScale].
 * The sim applies them scaled by form (so glob/KO shapes are untouched) and
 * GelCreature eases toward them, which makes each round-start morph read as
 * the goop literally rebuilding itself into a new fighter.
 */

import type { AttackName } from '../config.js';
import { A } from './poses.js';

export type StyleName = 'infighter' | 'kickboxer' | 'muaythai' | 'outboxer' | 'ropeadope';

/** [anchor index, dx, dy, dz, radius scale] */
export type StylePoseDelta = readonly [number, number, number, number, number];

export interface FightStyle {
  name: StyleName;
  /** Preferred range, × ARENA.holdDistance / pressDistance / strikeDistance. */
  holdScale: number;
  pressScale: number;
  strikeScale: number;
  /** × the rest gap between combinations (smaller = relentless). */
  restScale: number;
  /** Probability a combination is an in-your-face press. */
  pressChance: number;
  /** × difficulty tempo (smaller = faster telegraphs — sharper hands). */
  tempoMul: number;
  /** × footwork speed. */
  moveMul: number;
  /** Chance a body-capable strike goes downstairs. */
  bodyRate: number;
  /** × the stagger threshold (bigger = walks through your flurries). */
  staggerScale: number;
  /** Rope-a-dope: answers a landed flurry with an instant counter burst. */
  counterpuncher: boolean;
  combos: AttackName[][];
  press: AttackName[][];
  pose: ReadonlyArray<StylePoseDelta>;
}

export const FIGHT_STYLES: FightStyle[] = [
  {
    name: 'infighter',
    holdScale: 0.72,
    pressScale: 0.9,
    strikeScale: 0.85,
    restScale: 0.6,
    pressChance: 0.8,
    tempoMul: 0.95,
    moveMul: 1.25,
    bodyRate: 0.6,
    staggerScale: 1.0,
    counterpuncher: false,
    combos: [
      ['jab', 'hook'],
      ['hook'],
      ['hook', 'uppercut'],
      ['uppercut'],
      ['jab', 'jab', 'hook'],
      ['overhand'],
      ['hook', 'hook', 'uppercut'],
    ],
    press: [
      ['hook', 'uppercut', 'hook'],
      ['uppercut', 'overhand'],
      ['hook', 'hook', 'uppercut'],
      ['uppercut', 'hook', 'overhand'],
      ['hook', 'uppercut', 'hook', 'hook'],
    ],
    // Crouched, coiled, gloves at the cheeks — a compact ball of menace.
    pose: [
      [A.HEAD, 0, -0.14, 0.06, 1.0],
      [A.NECK, 0, -0.12, 0.04, 1.08],
      [A.CHEST_L, -0.02, -0.08, 0.03, 1.14],
      [A.CHEST_R, 0.02, -0.08, 0.03, 1.14],
      [A.BELLY, 0, -0.06, 0.02, 1.1],
      [A.PELVIS, 0, -0.05, 0, 1.06],
      [A.SHOULDER_L, -0.03, -0.08, 0.04, 1.16],
      [A.SHOULDER_R, 0.03, -0.08, 0.04, 1.16],
      [A.ELBOW_L, 0.08, -0.06, -0.02, 1.0],
      [A.ELBOW_R, -0.08, -0.06, -0.02, 1.0],
      [A.FIST_L, 0.1, -0.08, -0.12, 1.05],
      [A.FIST_R, -0.12, -0.04, -0.1, 1.05],
      [A.HIP_L, -0.02, -0.05, 0, 1.05],
      [A.HIP_R, 0.02, -0.05, 0, 1.05],
      [A.KNEE_L, -0.02, -0.04, 0, 1.08],
      [A.KNEE_R, 0.02, -0.04, 0, 1.08],
      [A.BASE_L, -0.04, 0, 0, 1.04],
      [A.BASE_R, 0.04, 0, 0, 1.04],
    ],
  },
  {
    name: 'kickboxer',
    holdScale: 1.3,
    pressScale: 1.1,
    strikeScale: 1.1,
    restScale: 1.0,
    pressChance: 0.22,
    tempoMul: 1.0,
    moveMul: 1.0,
    bodyRate: 0.45,
    staggerScale: 1.0,
    counterpuncher: false,
    combos: [
      ['jab'],
      ['jab', 'jab'],
      ['jab', 'cross'],
      ['roundhouse'],
      ['cross', 'roundhouse'],
      ['jab', 'roundhouse'],
      ['spinkick'],
      ['jab', 'spinkick'],
      ['backfist'],
      ['jab', 'cross', 'roundhouse'],
    ],
    press: [
      ['cross', 'hook'],
      ['jab', 'cross', 'hook'],
      ['cross', 'spinkick'],
    ],
    // Tall, lanky, lead hand carried LOW and lazy — pure range merchant.
    pose: [
      [A.HEAD, 0, 0.07, -0.03, 0.97],
      [A.NECK, 0, 0.06, -0.02, 0.95],
      [A.CHEST_L, 0.02, 0.04, -0.02, 0.92],
      [A.CHEST_R, -0.02, 0.04, -0.02, 0.92],
      [A.BELLY, 0, 0.04, -0.02, 0.9],
      [A.SHOULDER_L, -0.02, 0.05, -0.02, 0.95],
      [A.SHOULDER_R, 0.02, 0.05, -0.02, 0.95],
      [A.ELBOW_L, 0.02, -0.22, -0.06, 0.95],
      [A.FIST_L, -0.06, -0.38, -0.08, 0.95],
      [A.FIST_R, -0.05, 0.03, -0.06, 1.0],
      [A.KNEE_L, 0, 0.03, 0.01, 1.06],
      [A.KNEE_R, 0, 0.03, 0, 1.06],
      [A.BASE_L, -0.02, 0, 0.02, 0.98],
      [A.BASE_R, 0.02, 0, -0.02, 0.98],
    ],
  },
  {
    name: 'muaythai',
    holdScale: 0.9,
    pressScale: 0.95,
    strikeScale: 0.95,
    restScale: 0.7,
    pressChance: 0.62,
    tempoMul: 1.05,
    moveMul: 1.1,
    bodyRate: 0.6,
    staggerScale: 1.7,
    counterpuncher: false,
    combos: [
      ['roundhouse'],
      ['roundhouse', 'roundhouse'],
      ['jab', 'roundhouse'],
      ['cross', 'roundhouse'],
      ['clap'],
      ['jab', 'cross', 'roundhouse'],
      ['jab', 'clap'],
    ],
    press: [
      ['hook', 'roundhouse'],
      ['clap', 'hook'],
      ['uppercut', 'roundhouse'],
      ['hook', 'hook', 'roundhouse'],
    ],
    // Square, upright, high tight frame — elbows and gloves a fortress wall,
    // whole stance leaning INTO you.
    pose: [
      [A.HEAD, 0, 0.02, 0.02, 1.0],
      [A.CHEST_L, 0.02, 0, 0.05, 1.05],
      [A.CHEST_R, -0.02, 0, 0.05, 1.05],
      [A.BELLY, 0, 0.01, 0.03, 1.04],
      [A.SHOULDER_L, 0, 0.03, 0.03, 1.06],
      [A.SHOULDER_R, 0, 0.03, 0.03, 1.06],
      [A.ELBOW_L, 0.03, 0.1, -0.02, 1.08],
      [A.ELBOW_R, -0.03, 0.1, -0.02, 1.08],
      [A.FIST_L, 0.04, 0.1, -0.04, 1.06],
      [A.FIST_R, -0.04, 0.12, 0, 1.06],
      [A.KNEE_R, 0, 0, 0.05, 1.0],
      [A.BASE_L, 0, 0, -0.05, 1.0],
      [A.BASE_R, 0, 0, 0.05, 1.0],
      [A.BASE_F, 0, 0, 0.05, 1.04],
    ],
  },
  {
    name: 'outboxer',
    holdScale: 1.35,
    pressScale: 1.15,
    strikeScale: 1.05,
    restScale: 1.1,
    pressChance: 0.15,
    tempoMul: 0.78,
    moveMul: 1.35,
    bodyRate: 0.2,
    staggerScale: 0.8,
    counterpuncher: false,
    combos: [
      ['jab'],
      ['jab', 'jab'],
      ['jab', 'cross'],
      ['cross'],
      ['backfist'],
      ['jab', 'backfist'],
      ['jab', 'jab', 'cross'],
      ['jab', 'cross', 'hook'],
    ],
    press: [
      ['jab', 'cross', 'hook'],
      ['cross', 'hook'],
    ],
    // Leaned back, hands down at the hips, long springy stance — all
    // arrogance until the hands blur.
    pose: [
      [A.HEAD, 0, 0.02, -0.09, 0.98],
      [A.NECK, 0, 0.01, -0.06, 1.0],
      [A.CHEST_L, 0, 0, -0.05, 0.98],
      [A.CHEST_R, 0, 0, -0.05, 0.98],
      [A.BELLY, 0, 0, -0.03, 0.98],
      [A.ELBOW_L, -0.02, -0.16, -0.08, 0.95],
      [A.ELBOW_R, 0.02, -0.16, -0.08, 0.95],
      [A.FIST_L, -0.02, -0.3, -0.12, 0.95],
      [A.FIST_R, 0.02, -0.26, -0.1, 0.95],
      [A.KNEE_L, 0, 0.02, 0.01, 1.0],
      [A.KNEE_R, 0, 0.02, 0, 1.0],
      [A.BASE_F, 0, 0, 0.08, 1.0],
      [A.BASE_B, 0, 0, -0.08, 1.0],
    ],
  },
  {
    name: 'ropeadope',
    holdScale: 1.0,
    pressScale: 0.95,
    strikeScale: 0.95,
    restScale: 1.6,
    pressChance: 0.06,
    tempoMul: 0.85,
    moveMul: 0.9,
    bodyRate: 0.35,
    staggerScale: 1.4,
    counterpuncher: true,
    combos: [
      ['jab'],
      ['cross'],
      ['jab', 'jab'],
    ],
    press: [
      ['hook', 'uppercut'],
      ['uppercut', 'overhand'],
      ['cross', 'hook', 'uppercut'],
      ['hook', 'uppercut', 'overhand'],
    ],
    // Shelled up: gloves glued to the face, elbows tucked, leaning away —
    // a wall of gel daring you to empty the tank on it.
    pose: [
      [A.HEAD, 0, -0.04, -0.08, 1.0],
      [A.NECK, 0, -0.03, -0.05, 1.06],
      [A.CHEST_L, 0.01, -0.02, -0.06, 1.05],
      [A.CHEST_R, -0.01, -0.02, -0.06, 1.05],
      [A.BELLY, 0, -0.02, -0.04, 1.08],
      [A.SHOULDER_L, 0, 0.04, -0.04, 1.1],
      [A.SHOULDER_R, 0, 0.04, -0.04, 1.1],
      [A.ELBOW_L, 0.12, -0.02, -0.1, 1.0],
      [A.ELBOW_R, -0.12, -0.02, -0.1, 1.0],
      [A.FIST_L, 0.13, 0.11, -0.18, 1.08],
      [A.FIST_R, -0.15, 0.17, -0.16, 1.08],
      [A.KNEE_L, 0, -0.01, -0.02, 1.02],
      [A.KNEE_R, 0, -0.01, -0.02, 1.02],
    ],
  },
];

/** A freshly shuffled copy of the deck — one per match; deal one per round. */
export function shuffledStyles(): FightStyle[] {
  const deck = [...FIGHT_STYLES];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
