/**
 * The ARCADE titans — five boss machines in the same 90s robot-wars language
 * as the duel boxer, but built at pit-crane scale. Each one is a floating
 * shoulder-heavy chassis (no legs — floating hands and iron, on brand) with
 * a helmet + glowing visor, a chest CORE behind vented armour, two mortar
 * pods riding the pauldrons, and two crane-sized gauntlet arms on shoulder
 * pivots that CampaignSystem swings for the melee attacks.
 *
 * Everything here is geometry + data; behaviour (attack scheduling, weak-point
 * windows, damage) lives in CampaignSystem. The rig exposes the pieces that
 * animate: arm pivots, visor/core/pod materials, and the head group.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { PALETTE } from '../config.js';

export type AttackKind = 'slam' | 'sweep' | 'beam' | 'barrage';

/**
 * How a titan's slam lands — its melee signature:
 *  - 'single' : one fist, one disc.
 *  - 'rehit'  : the SAME disc detonates again moments later — punishes
 *               rushing back into the crater (RUSTHOOK's patience test).
 *  - 'march'  : a drumline of discs stepping across the platform, each with
 *               its own countdown — move on the beat (PISTONKAISER's rhythm).
 */
export type SlamStyle = 'single' | 'rehit' | 'march';

export interface BossDef {
  name: string;
  epithet: string;
  /** One line of pit-lane hype for the intro card. */
  taunt: string;
  /** The survival lesson shown on your board — each titan teaches one. */
  hint: string;
  /** Signature glow colour — visor, core, trims, telegraph strikes. */
  accent: number;
  /** Rig size multiplier; the duel boxer is roughly scale 1. */
  scale: number;
  health: number;
  /** How far BEHIND the far platform centre the titan floats (metres). */
  zOffset: number;
  /** Seconds between attacks (random in [min, max]); shrinks per stage. */
  cooldownMin: number;
  cooldownMax: number;
  /** Telegraph charge time per attack kind — the dodge window. */
  charge: Record<AttackKind, number>;
  /** Attack roster weights; 0 = this titan never uses that attack. */
  weights: Record<AttackKind, number>;
  /** Seconds the chest core vents open after a melee attack lands. */
  coreOpenTime: number;
  /** Shells per mortar barrage. */
  barrageCount: number;
  /** Parallel beam strips per beam attack. */
  beams: number;
  /** Lateral drift amplitude while idling (metres). */
  swayAmp: number;

  // --- signature mechanics: what makes THIS fight feel different ---
  /** Melee signature (see SlamStyle). */
  slamStyle: SlamStyle;
  /** Detonations in a rehit/march pattern (1 for 'single'). */
  slamCount: number;
  /** Beam telegraphs TRACK the player and only lock late — dodge late. */
  beamTracks: boolean;
  /** Mortar shells leave burning floor patches — the platform shrinks. */
  burnPatches: boolean;
  /** Enrage threshold as an HP fraction (0 = never): faster, angrier. */
  enrageAt: number;
}

/**
 * The five titans, and the fight each one IS:
 *
 *  I   RUSTHOOK — the patience test. Slow, heavy, and its slam crater
 *      detonates a second time: greed gets you killed, waiting gets you a
 *      long open core. Teaches the loop.
 *  II  PISTONKAISER — the rhythm fight. Slams come as a marching three-beat
 *      drumline, each disc running its own countdown; you move on the beat
 *      or you get forged. Sweeps keep you honest between bars.
 *  III WIDOWMAKER — the precision fight. Its beam strip TRACKS you while it
 *      charges and only locks in late — an early dodge is a wasted dodge.
 *      The heaviest sweep user; the duel gets personal.
 *  IV  JUGGERNAUT — the ground war. Mortars leave BURNING floor patches and
 *      twin beams cut lanes: safe ground shrinks and you fight for footing
 *      more than for shots.
 *  V   GOLIATH — the exam. Marching slams, tracking twin beams, burning
 *      ground — and at half health it ENRAGES: a roar, a blazing visor, and
 *      everything comes faster.
 */
export const BOSSES: BossDef[] = [
  {
    name: 'RUSTHOOK',
    epithet: 'the scrapyard sentinel',
    taunt: 'dredged from the pit floor · never oiled, never beaten',
    hint: 'its crater strikes TWICE — do not rush back in',
    accent: PALETTE.coolFlame,
    scale: 1.6,
    health: 160,
    zOffset: 0.4,
    cooldownMin: 2.6,
    cooldownMax: 3.6,
    charge: { slam: 1.9, sweep: 2.1, beam: 1.7, barrage: 2.0 },
    weights: { slam: 5, sweep: 0, beam: 3, barrage: 0 },
    coreOpenTime: 4.0,
    barrageCount: 3,
    beams: 1,
    swayAmp: 0.5,
    slamStyle: 'rehit',
    slamCount: 2,
    beamTracks: false,
    burnPatches: false,
    enrageAt: 0,
  },
  {
    name: 'PISTONKAISER',
    epithet: 'the forge hammer',
    taunt: 'four hundred tonnes of drop-forge temper',
    hint: 'three hammers on a beat — keep moving',
    accent: PALETTE.amber,
    scale: 2.1,
    health: 220,
    zOffset: 0.7,
    cooldownMin: 2.2,
    cooldownMax: 3.2,
    charge: { slam: 1.6, sweep: 1.9, beam: 1.6, barrage: 1.9 },
    weights: { slam: 4, sweep: 3, beam: 2, barrage: 0 },
    coreOpenTime: 3.4,
    barrageCount: 3,
    beams: 1,
    swayAmp: 0.6,
    slamStyle: 'march',
    slamCount: 3,
    beamTracks: false,
    burnPatches: false,
    enrageAt: 0,
  },
  {
    name: 'WIDOWMAKER',
    epithet: 'arena executioner',
    taunt: 'undefeated in the southern pits · counts in corpses',
    hint: 'the beam FOLLOWS you — dodge late, not early',
    accent: 0x7cff4a,
    scale: 2.7,
    health: 300,
    zOffset: 1.0,
    cooldownMin: 1.9,
    cooldownMax: 2.8,
    charge: { slam: 1.45, sweep: 1.7, beam: 1.55, barrage: 1.7 },
    weights: { slam: 3, sweep: 4, beam: 4, barrage: 2 },
    coreOpenTime: 3.0,
    barrageCount: 4,
    beams: 1,
    swayAmp: 0.7,
    slamStyle: 'single',
    slamCount: 1,
    beamTracks: true,
    burnPatches: false,
    enrageAt: 0,
  },
  {
    name: 'JUGGERNAUT',
    epithet: 'the rolling fortress',
    taunt: 'they stopped counting the machines it has eaten',
    hint: 'the floor stays HOT — fight for your footing',
    accent: 0xb26bff,
    scale: 3.4,
    health: 380,
    zOffset: 1.3,
    cooldownMin: 1.6,
    cooldownMax: 2.4,
    charge: { slam: 1.3, sweep: 1.5, beam: 1.25, barrage: 1.5 },
    weights: { slam: 3, sweep: 2, beam: 4, barrage: 5 },
    coreOpenTime: 2.6,
    barrageCount: 5,
    beams: 2,
    swayAmp: 0.55,
    slamStyle: 'single',
    slamCount: 1,
    beamTracks: false,
    burnPatches: true,
    enrageAt: 0,
  },
  {
    name: 'GOLIATH',
    epithet: 'king of the scrap',
    taunt: 'the pit was dug to bury it · it climbed back out',
    hint: 'survive the rage — it breaks before you do',
    accent: PALETTE.danger,
    scale: 4.4,
    health: 480,
    zOffset: 1.7,
    cooldownMin: 1.35,
    cooldownMax: 2.1,
    charge: { slam: 1.15, sweep: 1.35, beam: 1.2, barrage: 1.35 },
    weights: { slam: 3, sweep: 3, beam: 4, barrage: 4 },
    coreOpenTime: 2.2,
    barrageCount: 6,
    beams: 2,
    swayAmp: 0.4,
    slamStyle: 'march',
    slamCount: 2,
    beamTracks: true,
    burnPatches: true,
    enrageAt: 0.5,
  },
];

// --- rig ---------------------------------------------------------------------

export interface TitanArm {
  /** Shoulder pivot — rotate to wind up and strike. */
  pivot: Group;
  /** The crane gauntlet at the end of the arm. */
  fist: Group;
  /** Rest pose captured at build time so animation can ease home. */
  restX: number;
  restZ: number;
}

export interface TitanRig {
  root: Group;
  head: Group;
  visorMat: MeshStandardMaterial;
  core: Mesh;
  coreMat: MeshStandardMaterial;
  podMats: [MeshStandardMaterial, MeshStandardMaterial];
  arms: [TitanArm, TitanArm];
  /** Key world-frame heights (root at y=0): head centre and core centre. */
  headY: number;
  coreY: number;
  /** Full height, for the rise-from-the-pit intro. */
  height: number;
  dispose(): void;
}

function chassisMat(emissive = 0, intensity = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: PALETTE.gunmetal,
    emissive,
    emissiveIntensity: intensity,
    metalness: 0.92,
    roughness: 0.32,
  });
}

function darkMat(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: PALETTE.gunmetalDark,
    metalness: 0.85,
    roughness: 0.45,
  });
}

function glowMat(color: number, intensity = 1.4): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.3,
  });
}

/** A crane-scale gauntlet: armoured block fist, knuckle studs, accent cuff. */
function buildTitanFist(accent: number, s: number): Group {
  const fist = new Group();
  const block = new Mesh(new BoxGeometry(0.22 * s, 0.17 * s, 0.24 * s), chassisMat(accent, 0.06));
  fist.add(block);
  const plate = new Mesh(new BoxGeometry(0.23 * s, 0.06 * s, 0.09 * s), darkMat());
  plate.position.set(0, 0.075 * s, -0.1 * s);
  fist.add(plate);
  for (let i = 0; i < 4; i++) {
    const stud = new Mesh(new BoxGeometry(0.032 * s, 0.03 * s, 0.026 * s), glowMat(accent, 1.1));
    stud.position.set((-0.075 + i * 0.05) * s, 0.078 * s, -0.15 * s);
    fist.add(stud);
  }
  const cuff = new Mesh(new CylinderGeometry(0.085 * s, 0.11 * s, 0.11 * s, 8), chassisMat());
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.14 * s;
  fist.add(cuff);
  const ring = new Mesh(new CylinderGeometry(0.1 * s, 0.1 * s, 0.024 * s, 8), glowMat(accent, 0.9));
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.1 * s;
  fist.add(ring);
  return fist;
}

/**
 * Assemble a titan at `def.scale`. The root group sits at world (0,0,z) with
 * y=0 at the arena floor; CampaignSystem parents it to the scene, sinks it
 * for the intro rise, and drives the pivots/materials from there.
 */
export function buildTitan(def: BossDef): TitanRig {
  const s = def.scale;
  const accent = def.accent;
  const root = new Group();
  root.name = `titan-${def.name.toLowerCase()}`;

  const hipY = 0.78 * s;
  const shoulderY = 1.22 * s;
  const headY = 1.5 * s;

  // --- Head: the eight-sided pit helmet, oversized crown, wide visor ---
  const head = new Group();
  const headR = 0.16 * s;
  const helm = new Mesh(new CylinderGeometry(headR * 0.82, headR * 1.0, headR * 2.0, 8), chassisMat(accent, 0.08));
  head.add(helm);
  const crown = new Mesh(new CylinderGeometry(headR * 0.5, headR * 0.86, headR * 0.55, 8), darkMat());
  crown.position.y = headR * 1.25;
  head.add(crown);
  const visorMat = glowMat(accent, 1.8);
  const visor = new Mesh(new BoxGeometry(headR * 1.5, 0.035 * s, 0.03 * s), visorMat);
  visor.position.set(0, headR * 0.1, -headR * 0.95);
  head.add(visor);
  const jaw = new Mesh(new BoxGeometry(headR * 1.15, 0.06 * s, 0.07 * s), darkMat());
  jaw.position.set(0, -headR * 0.62, -headR * 0.72);
  head.add(jaw);
  const fin = new Mesh(new BoxGeometry(0.02 * s, 0.09 * s, headR * 1.35), darkMat());
  fin.position.y = headR * 1.05;
  head.add(fin);
  head.position.set(0, headY, 0);
  root.add(head);

  // --- Torso: yoke widest, wedge trunk, armoured chest with the CORE ---
  const chest = new Group();
  chest.position.y = shoulderY;
  const yoke = new Mesh(new BoxGeometry(0.62 * s, 0.13 * s, 0.26 * s), chassisMat(accent, 0.05));
  yoke.position.y = 0.06 * s;
  chest.add(yoke);
  for (const side of [-1, 1]) {
    const pad = new Mesh(new BoxGeometry(0.24 * s, 0.18 * s, 0.32 * s), darkMat());
    pad.position.set(side * 0.37 * s, 0.08 * s, 0);
    pad.rotation.z = side * -0.22;
    chest.add(pad);
    const trim = new Mesh(new BoxGeometry(0.245 * s, 0.024 * s, 0.325 * s), glowMat(accent, 0.5));
    trim.position.set(side * 0.37 * s, 0.175 * s, 0);
    trim.rotation.z = side * -0.22;
    chest.add(trim);
  }
  const trunk = new Mesh(new CylinderGeometry(0.26 * s, 0.14 * s, 0.55 * s, 8), chassisMat(accent, 0.04));
  trunk.scale.z = 0.72;
  trunk.position.y = -0.2 * s;
  chest.add(trunk);

  // The CORE: a glowing octagonal heart set proud of the chest plate. Its
  // material flips between shuttered (dim) and vented-open (blazing) — the
  // weak-point window players hunt for.
  const coreMat = glowMat(accent, 0.25);
  const core = new Mesh(new CylinderGeometry(0.11 * s, 0.11 * s, 0.05 * s, 8), coreMat);
  core.rotation.x = Math.PI / 2;
  core.position.set(0, -0.12 * s, -0.21 * s);
  chest.add(core);
  // Shutter louvres framing the core — read as armour until it vents.
  for (const dy of [-1, 1]) {
    const louvre = new Mesh(new BoxGeometry(0.3 * s, 0.035 * s, 0.03 * s), darkMat());
    louvre.position.set(0, (-0.12 + dy * 0.11) * s, -0.215 * s);
    chest.add(louvre);
  }
  root.add(chest);

  // --- Mortar pods riding the pauldrons (they glow during a barrage) ---
  const podMats: [MeshStandardMaterial, MeshStandardMaterial] = [glowMat(accent, 0.2), glowMat(accent, 0.2)];
  podMats.forEach((mat, i) => {
    const side = i === 0 ? -1 : 1;
    const housing = new Mesh(new BoxGeometry(0.13 * s, 0.12 * s, 0.2 * s), darkMat());
    housing.position.set(side * 0.37 * s, shoulderY + 0.2 * s, 0.02 * s);
    root.add(housing);
    const muzzle = new Mesh(new CylinderGeometry(0.035 * s, 0.045 * s, 0.1 * s, 8), mat);
    muzzle.rotation.x = Math.PI / 2.6; // tipped up-and-forward, mortar style
    muzzle.position.set(side * 0.37 * s, shoulderY + 0.27 * s, -0.04 * s);
    root.add(muzzle);
  });

  // --- Pelvis + hover skirt: the narrow end of the wedge, no legs ---
  const pelvis = new Mesh(new BoxGeometry(0.28 * s, 0.18 * s, 0.22 * s), chassisMat(accent, 0.03));
  pelvis.position.y = hipY - 0.28 * s;
  root.add(pelvis);
  const skirt = new Mesh(new CylinderGeometry(0.16 * s, 0.05 * s, 0.28 * s, 8), darkMat());
  skirt.position.y = hipY - 0.48 * s;
  root.add(skirt);
  const skirtGlow = new Mesh(new CylinderGeometry(0.09 * s, 0.05 * s, 0.06 * s, 8), glowMat(accent, 1.2));
  skirtGlow.position.y = hipY - 0.6 * s;
  root.add(skirtGlow);

  // --- Arms: shoulder pivots carrying girder arms and crane gauntlets ---
  const arms = [0, 1].map((i) => {
    const side = i === 0 ? -1 : 1;
    const pivot = new Group();
    pivot.position.set(side * 0.46 * s, shoulderY + 0.04 * s, 0);
    const upper = new Mesh(new BoxGeometry(0.11 * s, 0.62 * s, 0.13 * s), chassisMat(accent, 0.03));
    upper.position.y = -0.31 * s;
    pivot.add(upper);
    const elbow = new Mesh(new CylinderGeometry(0.075 * s, 0.075 * s, 0.14 * s, 8), darkMat());
    elbow.rotation.z = Math.PI / 2;
    elbow.position.y = -0.62 * s;
    pivot.add(elbow);
    const fist = buildTitanFist(accent, s);
    fist.position.y = -0.82 * s;
    pivot.add(fist);
    // Rest pose: hanging slightly out and forward, guard-ish.
    pivot.rotation.x = 0.18;
    pivot.rotation.z = side * 0.14;
    root.add(pivot);
    return { pivot, fist, restX: 0.18, restZ: side * 0.14 } satisfies TitanArm;
  }) as [TitanArm, TitanArm];

  const height = headY + 0.35 * s;

  return {
    root,
    head,
    visorMat,
    core,
    coreMat,
    podMats,
    arms,
    headY,
    coreY: shoulderY - 0.12 * s,
    height,
    dispose() {
      root.traverse((o) => {
        const m = o as Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      root.removeFromParent();
    },
  };
}
