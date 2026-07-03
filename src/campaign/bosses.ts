/**
 * The ARCADE titans — five boss machines in the same 90s robot-wars language
 * as the duel boxer, but built at pit-crane scale, and each one a BESPOKE
 * machine with its own silhouette you can name from across the arena:
 *
 *  I   RUSTHOOK — the scrapyard derelict. Hunched, asymmetric, rust-brown:
 *      a dented drum of a head, mismatched shoulders, exposed rib struts,
 *      and its right arm ends in a giant crane HOOK on a chain link.
 *  II  PISTONKAISER — the foundry press. Anvil-flat crowned head, twin
 *      smokestacks glowing off the shoulders, riveted slab chest, and two
 *      massive rectangular HAMMER-BLOCK fists.
 *  III VULTURE — the executioner. A hooded narrow head with a hooked beak
 *      and ONE round eye (the tracking beam's source), swept wing-plate
 *      pauldrons, a slim tapered trunk and talon-clawed hands.
 *  IV  JUGGERNAUT — the rolling fortress. Squat and WIDE: a dome head sunk
 *      between the shoulders, double-layered bolted chest plates, and a
 *      riveted armour skirt hanging like a tank's curtain.
 *  V   GOLIATH — the king. Near-black plate with gold trim, a five-spike
 *      CROWN, a tall crest, and oversized ceremonial gauntlets.
 *
 * Every rig keeps the same animation contract (head group, visor/eye
 * material, chest CORE, shoulder pod materials, two arm pivots + fists), so
 * CampaignSystem drives them all identically. Geometry + data only;
 * behaviour lives in CampaignSystem.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { PALETTE, RAID } from '../config.js';

/**
 * 'volley' is the one attack aimed at YOU instead of the floor: the shoulder
 * pods spool up and hurl fireballs you can dodge — or BLOCK with a fist.
 * 'nova' is GOLIATH's alone: fire floods the WHOLE platform except one
 * marked safe wedge — the only telegraph in the game that says "stand HERE"
 * instead of "get out".
 */
export type AttackKind = 'slam' | 'sweep' | 'beam' | 'volley' | 'nova';

/**
 * How a titan's slam lands — its melee signature:
 *  - 'single' : one fist, one disc.
 *  - 'rehit'  : the SAME disc detonates again moments later — punishes
 *               rushing back into the crater (RUSTHOOK's patience test).
 *  - 'march'  : a drumline of discs stepping across the platform, each with
 *               its own countdown — move on the beat (PISTONKAISER's rhythm).
 */
export type SlamStyle = 'single' | 'rehit' | 'march';

/** Which bespoke chassis buildTitan assembles. */
export type TitanStyle = 'hook' | 'piston' | 'vulture' | 'fortress' | 'king';

/**
 * How a titan's weak points open up. No prompts — whatever is vulnerable
 * BLINKS (the visor tell on the head, the chest core, the low emblem):
 *  - 'both'      : head AND core are open the whole fight, any order.
 *  - 'alternate' : one point at a time; every landed hit flips head↔core.
 *  - 'double'    : two hits on the blinking point, then it swaps.
 *  - 'triple'    : the cycle adds the LOW BLOW — head → core → low → repeat.
 *  - 'crown'     : GOLIATH's five-point circuit — head → left shoulder →
 *                  core → right shoulder → low — walked THREE full loops to
 *                  kill (the health bar steps down per ring hit, so it is
 *                  exactly fifteen hits no matter what you throw).
 */
export type WeakPattern = 'both' | 'alternate' | 'double' | 'triple' | 'crown';

export interface BossDef {
  name: string;
  epithet: string;
  /** Signature glow colour — eye/visor, core, trims, telegraph strikes. */
  accent: number;
  /** Which bespoke chassis this titan wears. */
  style: TitanStyle;
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
  /** Fireballs per volley (see 'volley' — the blockable projectiles). */
  volleyCount: number;
  /** Parallel beam strips per beam attack. */
  beams: number;
  /** Lateral drift amplitude while idling (metres). */
  swayAmp: number;

  // --- signature mechanics: what makes THIS fight feel different ---
  slamStyle: SlamStyle;
  /** Detonations in a rehit/march pattern (1 for 'single'). */
  slamCount: number;
  /** Beam telegraphs TRACK the player and only lock late — dodge late. */
  beamTracks: boolean;
  /** Enrage threshold as an HP fraction (0 = never): faster, angrier. */
  enrageAt: number;
  /** How its weak points open (see WeakPattern) — the blink says where. */
  weakPattern: WeakPattern;
}

export const BOSSES: BossDef[] = [
  {
    name: 'RUSTHOOK',
    epithet: 'the scrapyard sentinel',
    accent: PALETTE.coolFlame,
    style: 'hook',
    scale: 1.25,
    health: 210,
    zOffset: 0.2,
    cooldownMin: 2.6,
    cooldownMax: 3.6,
    charge: { slam: 1.9, sweep: 2.1, beam: 1.7, volley: 2.0, nova: 2.2 },
    weights: { slam: 5, sweep: 0, beam: 3, volley: 0, nova: 0 },
    volleyCount: 3,
    beams: 1,
    swayAmp: 0.4,
    slamStyle: 'rehit',
    slamCount: 2,
    beamTracks: false,
    enrageAt: 0,
    weakPattern: 'both',
  },
  {
    name: 'PISTONKAISER',
    epithet: 'the forge hammer',
    accent: PALETTE.amber,
    style: 'piston',
    scale: 1.5,
    health: 220,
    zOffset: 0.3,
    cooldownMin: 2.2,
    cooldownMax: 3.2,
    charge: { slam: 1.6, sweep: 1.9, beam: 1.6, volley: 1.9, nova: 2.2 },
    weights: { slam: 4, sweep: 3, beam: 2, volley: 0, nova: 0 },
    volleyCount: 3,
    beams: 1,
    swayAmp: 0.5,
    slamStyle: 'march',
    slamCount: 3,
    beamTracks: false,
    enrageAt: 0,
    weakPattern: 'alternate',
  },
  {
    name: 'VULTURE',
    epithet: 'arena executioner',
    accent: 0x7cff4a,
    style: 'vulture',
    scale: 1.8,
    health: 300,
    zOffset: 0.45,
    cooldownMin: 1.9,
    cooldownMax: 2.8,
    charge: { slam: 1.45, sweep: 1.7, beam: 1.55, volley: 1.7, nova: 2.2 },
    weights: { slam: 3, sweep: 4, beam: 4, volley: 2, nova: 0 },
    volleyCount: 4,
    beams: 1,
    swayAmp: 0.6,
    slamStyle: 'single',
    slamCount: 1,
    beamTracks: true,
    enrageAt: 0,
    weakPattern: 'double',
  },
  {
    name: 'JUGGERNAUT',
    epithet: 'the rolling fortress',
    accent: 0xb26bff,
    style: 'fortress',
    scale: 2.15,
    health: 380,
    zOffset: 0.6,
    cooldownMin: 1.6,
    cooldownMax: 2.4,
    charge: { slam: 1.3, sweep: 1.5, beam: 1.25, volley: 2.0, nova: 2.2 },
    weights: { slam: 3, sweep: 2, beam: 4, volley: 5, nova: 0 },
    volleyCount: 3,
    beams: 2,
    swayAmp: 0.45,
    slamStyle: 'single',
    slamCount: 1,
    beamTracks: false,
    enrageAt: 0,
    weakPattern: 'triple',
  },
  {
    name: 'GOLIATH',
    epithet: 'king of the scrap',
    accent: PALETTE.danger,
    style: 'king',
    scale: 2.6,
    health: 480,
    zOffset: 0.8,
    cooldownMin: 1.35,
    cooldownMax: 2.1,
    charge: { slam: 1.15, sweep: 1.35, beam: 1.2, volley: 1.8, nova: 2.1 },
    weights: { slam: 3, sweep: 3, beam: 3, volley: 3, nova: 4 },
    volleyCount: 4,
    beams: 2,
    swayAmp: 0.35,
    slamStyle: 'march',
    slamCount: 2,
    beamTracks: true,
    enrageAt: 0.5,
    weakPattern: 'crown',
  },
];

/**
 * The RAID cut of a titan: grown past the solo version, a health pool sized
 * for FOUR fists (well over 4x), and a cadence tuned per stage to how many
 * raiders each swing marks — stage I rotates one target and swings fast;
 * stage III+ mark the whole squad, so the pace eases back toward solo.
 */
export function raidBoss(def: BossDef, stage: number): BossDef {
  const charge = { ...def.charge };
  for (const k of Object.keys(charge) as AttackKind[]) charge[k] *= RAID.chargeMult;
  const cd = RAID.cooldownMult[stage] ?? RAID.cooldownMult[RAID.cooldownMult.length - 1] ?? 0.9;
  return {
    ...def,
    scale: def.scale * RAID.scaleMult,
    health: Math.round(def.health * RAID.healthMult),
    cooldownMin: def.cooldownMin * cd,
    cooldownMax: def.cooldownMax * cd,
    charge,
  };
}

// --- rig ---------------------------------------------------------------------

export interface TitanArm {
  /** Shoulder pivot — rotate to wind up and strike. */
  pivot: Group;
  /** The gauntlet / hook / talon at the end of the arm. */
  fist: Group;
  /** Rest pose captured at build time so animation can ease home. */
  restX: number;
  restZ: number;
}

export interface TitanRig {
  root: Group;
  head: Group;
  /** The eye/visor glow — blinks while the HEAD is a live weak point. */
  visorMat: MeshStandardMaterial;
  core: Mesh;
  /** The chest core glow — blinks while the CORE is a live weak point. */
  coreMat: MeshStandardMaterial;
  /** The LOW-BLOW emblem on the pelvis (JUGGERNAUT's third target). */
  low: Mesh;
  /** Its glow — blinks while the low blow is the live weak point. */
  lowMat: MeshStandardMaterial;
  /** Shoulder emblems [left, right] — GOLIATH's crown circuit stops. */
  shoulders: [Mesh, Mesh];
  /** Their glows — blink while that shoulder is the live weak point. */
  shoulderMats: [MeshStandardMaterial, MeshStandardMaterial];
  podMats: [MeshStandardMaterial, MeshStandardMaterial];
  arms: [TitanArm, TitanArm];
  /** Key world-frame heights (root at y=0): head centre and core centre. */
  headY: number;
  coreY: number;
  /** Full height, for the rise-from-the-pit intro. */
  height: number;
  dispose(): void;
}

/** Per-style paint: chassis steel + dark trim (accent glows come from defs). */
const STYLE_PAINT: Record<TitanStyle, { chassis: number; trim: number }> = {
  hook: { chassis: 0x4a3b2b, trim: 0x2c2318 }, // oxidised rust-brown
  piston: { chassis: 0x33373f, trim: 0x1a1d23 }, // foundry iron
  vulture: { chassis: 0x2e3428, trim: 0x171b14 }, // olive plumage steel
  fortress: { chassis: 0x342e40, trim: 0x1b1724 }, // bruised violet plate
  king: { chassis: 0x17181d, trim: 0x0c0d10 }, // near-black royal plate
};

const GOLD = 0xd9a832;

function steelMat(color: number, emissive = 0, intensity = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    metalness: 0.9,
    roughness: 0.34,
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

/**
 * Assemble a titan at `def.scale`. The root group sits at world (0,0,z) with
 * y=0 at the arena floor; CampaignSystem parents it to the scene, sinks it
 * for the intro rise, and drives the pivots/materials from there. All five
 * styles share one skeleton (head / chest+core / pods / two arm pivots) so
 * the animation contract never changes — everything AROUND the skeleton is
 * bespoke per machine.
 */
export function buildTitan(def: BossDef): TitanRig {
  const s = def.scale;
  const accent = def.accent;
  const paint = STYLE_PAINT[def.style];
  const chassis = (e = 0, i = 0): MeshStandardMaterial => steelMat(paint.chassis, e, i);
  const dark = (): MeshStandardMaterial => steelMat(paint.trim);

  const root = new Group();
  root.name = `titan-${def.name.toLowerCase()}`;

  const squat = def.style === 'fortress';
  const hunched = def.style === 'hook';
  const hipY = 0.78 * s;
  const shoulderY = (squat ? 1.12 : 1.22) * s;
  const headY = (hunched ? 1.4 : squat ? 1.34 : 1.5) * s;

  // ── HEAD — bespoke per machine, the visor/eye glow shared ────────────────
  const head = new Group();
  const headR = 0.16 * s;
  const visorMat = glowMat(accent, 1.8);

  switch (def.style) {
    case 'hook': {
      // A dented oil-drum head, tipped off-axis, with two big round lamp
      // EYES set proud of the drum — the blink tell has to read from across
      // the arena, and a thin slit never did.
      const drum = new Mesh(new CylinderGeometry(headR * 0.95, headR * 1.05, headR * 1.7, 10), chassis(accent, 0.05));
      drum.rotation.z = 0.12;
      head.add(drum);
      const dent = new Mesh(new BoxGeometry(headR * 1.4, 0.05 * s, headR * 0.9), dark());
      dent.position.set(headR * 0.2, headR * 0.75, 0);
      dent.rotation.z = -0.2;
      head.add(dent);
      for (const ex of [-1, 1]) {
        const socket = new Mesh(new CylinderGeometry(headR * 0.32, headR * 0.32, 0.03 * s, 10), dark());
        socket.rotation.x = Math.PI / 2;
        socket.position.set(ex * headR * 0.44, headR * 0.12 * ex * 0.5, -headR * 0.95); // crooked pair
        head.add(socket);
        const eye = new Mesh(new CylinderGeometry(headR * 0.24, headR * 0.24, 0.045 * s, 10), visorMat);
        eye.rotation.x = Math.PI / 2;
        eye.position.set(ex * headR * 0.44, headR * 0.12 * ex * 0.5, -headR * 1.03);
        head.add(eye);
      }
      break;
    }
    case 'piston': {
      // An anvil: flat-topped block head with a heavy brow and two big
      // rectangular lamp EYES set proud of the face — the thin visor strip
      // it had before never read as a blink from across the arena.
      const anvil = new Mesh(new BoxGeometry(headR * 2.4, headR * 1.5, headR * 1.8), chassis(accent, 0.06));
      head.add(anvil);
      const horn = new Mesh(new BoxGeometry(headR * 0.9, headR * 0.9, headR * 0.8), dark());
      horn.position.set(headR * 1.5, headR * 0.1, 0);
      head.add(horn);
      const brow = new Mesh(new BoxGeometry(headR * 2.5, 0.08 * s, headR * 0.5), dark());
      brow.position.set(0, headR * 0.5, -headR * 0.78);
      head.add(brow);
      for (const ex of [-1, 1]) {
        const socket = new Mesh(new BoxGeometry(headR * 0.9, headR * 0.52, 0.04 * s), dark());
        socket.position.set(ex * headR * 0.62, headR * 0.02, -headR * 0.92);
        head.add(socket);
        const eye = new Mesh(new BoxGeometry(headR * 0.64, headR * 0.34, 0.06 * s), visorMat);
        eye.position.set(ex * headR * 0.62, headR * 0.02, -headR * 0.99);
        head.add(eye);
      }
      break;
    }
    case 'vulture': {
      // A hooded scavenger skull: narrow casque and ONE big round eye — the
      // source of the tracking beam, so the tell reads at a glance. (No beak:
      // the old cone hung straight over the eye and hid the blink.)
      const hood = new Mesh(new CylinderGeometry(headR * 0.55, headR * 0.9, headR * 1.9, 8), chassis(accent, 0.06));
      hood.rotation.x = 0.28; // craned forward, watching you
      head.add(hood);
      // The eye sits PROUD of the hood's rim — tucked inside the casque it
      // was invisible, and a blink nobody can see is no tell at all.
      const eye = new Mesh(new CylinderGeometry(headR * 0.42, headR * 0.42, 0.05 * s, 12), visorMat);
      eye.rotation.x = Math.PI / 2 + 0.28; // faces out along the craned hood
      eye.position.set(0, headR * 0.14, -headR * 1.12);
      head.add(eye);
      const crest = new Mesh(new BoxGeometry(0.015 * s, headR * 0.9, headR * 1.4), dark());
      crest.position.y = headR * 1.0;
      crest.rotation.x = 0.28;
      head.add(crest);
      break;
    }
    case 'fortress': {
      // A low armoured dome, half-sunk — no neck, all bunker.
      const dome = new Mesh(new CylinderGeometry(headR * 1.15, headR * 1.3, headR * 1.1, 10), chassis(accent, 0.05));
      head.add(dome);
      const cap = new Mesh(new CylinderGeometry(headR * 0.6, headR * 1.1, headR * 0.55, 10), dark());
      cap.position.y = headR * 0.75;
      head.add(cap);
      const slot = new Mesh(new BoxGeometry(headR * 1.7, 0.03 * s, 0.03 * s), visorMat);
      slot.position.set(0, headR * 0.1, -headR * 1.05);
      head.add(slot);
      // Bolt studs ringing the dome.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const bolt = new Mesh(new BoxGeometry(0.03 * s, 0.03 * s, 0.03 * s), dark());
        bolt.position.set(Math.cos(a) * headR * 1.15, -headR * 0.3, Math.sin(a) * headR * 1.15);
        head.add(bolt);
      }
      break;
    }
    case 'king': {
      // The royal helm: tall eight-sided casque, gold five-spike crown.
      const helm = new Mesh(new CylinderGeometry(headR * 0.85, headR * 1.0, headR * 2.1, 8), chassis(accent, 0.08));
      head.add(helm);
      const band = new Mesh(new CylinderGeometry(headR * 0.95, headR * 0.95, 0.04 * s, 8), steelMat(GOLD, GOLD, 0.35));
      band.position.y = headR * 0.9;
      head.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = new Mesh(new CylinderGeometry(0.005 * s, 0.024 * s, headR * 0.85, 4), steelMat(GOLD, GOLD, 0.4));
        spike.position.set(Math.cos(a) * headR * 0.78, headR * 1.35, Math.sin(a) * headR * 0.78);
        head.add(spike);
      }
      const visor = new Mesh(new BoxGeometry(headR * 1.5, 0.035 * s, 0.03 * s), visorMat);
      visor.position.set(0, 0.01 * s, -headR * 0.95);
      head.add(visor);
      const jaw = new Mesh(new BoxGeometry(headR * 1.1, 0.05 * s, 0.06 * s), dark());
      jaw.position.set(0, -headR * 0.62, -headR * 0.72);
      head.add(jaw);
      break;
    }
  }
  head.position.set(0, headY, 0);
  root.add(head);

  // ── TORSO — shared frame, bespoke dressing ────────────────────────────────
  const chest = new Group();
  chest.position.y = shoulderY;
  const yokeW = (def.style === 'fortress' ? 0.74 : def.style === 'vulture' ? 0.56 : 0.62) * s;
  const yoke = new Mesh(new BoxGeometry(yokeW, 0.13 * s, 0.26 * s), chassis(accent, 0.05));
  yoke.position.y = 0.06 * s;
  chest.add(yoke);

  // Shoulders per style.
  for (const side of [-1, 1]) {
    if (def.style === 'vulture') {
      // Swept wing plates, layered and angled up-and-out like folded wings.
      for (let layer = 0; layer < 3; layer++) {
        const wing = new Mesh(new BoxGeometry(0.3 * s, 0.02 * s, (0.24 - layer * 0.05) * s), dark());
        wing.position.set(side * (0.36 + layer * 0.1) * s, (0.12 + layer * 0.07) * s, 0.02 * s);
        wing.rotation.z = side * -(0.35 + layer * 0.18);
        chest.add(wing);
      }
    } else if (def.style === 'hook' && side === 1) {
      // RUSTHOOK's right shoulder is a bare stub — the armour fell off years ago.
      const stub = new Mesh(new BoxGeometry(0.14 * s, 0.1 * s, 0.2 * s), dark());
      stub.position.set(side * 0.34 * s, 0.08 * s, 0);
      chest.add(stub);
    } else {
      const padW = (def.style === 'fortress' ? 0.3 : 0.24) * s;
      const pad = new Mesh(new BoxGeometry(padW, 0.18 * s, 0.32 * s), dark());
      pad.position.set(side * 0.37 * s, 0.08 * s, 0);
      pad.rotation.z = side * -0.22;
      chest.add(pad);
      const trimMat = def.style === 'king' ? steelMat(GOLD, GOLD, 0.35) : glowMat(accent, 0.5);
      const trim = new Mesh(new BoxGeometry(padW + 0.005 * s, 0.024 * s, 0.325 * s), trimMat);
      trim.position.set(side * 0.37 * s, 0.175 * s, 0);
      trim.rotation.z = side * -0.22;
      chest.add(trim);
    }
  }

  // Trunk: slim for the vulture, slabbed for the fortress, wedge otherwise.
  const trunk = new Mesh(
    new CylinderGeometry((def.style === 'vulture' ? 0.2 : 0.26) * s, 0.14 * s, 0.55 * s, 8),
    chassis(accent, 0.04),
  );
  trunk.scale.z = 0.72;
  if (def.style === 'vulture') trunk.scale.x = 0.85;
  trunk.position.y = -0.2 * s;
  chest.add(trunk);

  if (def.style === 'fortress') {
    // Double-layered bolted front plates — the fortress doctrine made steel.
    for (const [w, h, z, y] of [
      [0.5, 0.3, -0.19, -0.02],
      [0.38, 0.24, -0.23, -0.3],
    ] as const) {
      const slab = new Mesh(new BoxGeometry(w * s, h * s, 0.04 * s), dark());
      slab.position.set(0, y * s, z * s);
      chest.add(slab);
    }
  }
  if (def.style === 'hook') {
    // Exposed rib struts where the chest plate rusted away.
    for (const ry of [-0.08, -0.2, -0.32]) {
      const rib = new Mesh(new BoxGeometry(0.34 * s, 0.022 * s, 0.03 * s), dark());
      rib.position.set(0, ry * s, -0.16 * s);
      chest.add(rib);
    }
  }
  if (def.style === 'piston') {
    // Riveted slab chest plate.
    const plate = new Mesh(new BoxGeometry(0.42 * s, 0.34 * s, 0.035 * s), dark());
    plate.position.set(0, -0.1 * s, -0.185 * s);
    chest.add(plate);
    for (const [bx, by] of [[-0.17, 0.03], [0.17, 0.03], [-0.17, -0.23], [0.17, -0.23]] as const) {
      const bolt = new Mesh(new CylinderGeometry(0.018 * s, 0.018 * s, 0.02 * s, 6), chassis());
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(bx * s, by * s, -0.2 * s);
      chest.add(bolt);
    }
  }

  // The CORE: a glowing octagonal heart set PROUD of the chest plate — the
  // weak point players hunt. Sits far enough forward that a ball reaches it
  // before the (invisible) body armour sphere can eat the throw.
  const coreMat = glowMat(accent, 0.25);
  const core = new Mesh(new CylinderGeometry(0.11 * s, 0.11 * s, 0.06 * s, 8), coreMat);
  core.rotation.x = Math.PI / 2;
  core.position.set(0, -0.12 * s, -0.26 * s);
  chest.add(core);
  for (const dy of [-1, 1]) {
    const louvre = new Mesh(new BoxGeometry(0.3 * s, 0.035 * s, 0.03 * s), dark());
    louvre.position.set(0, (-0.12 + dy * 0.11) * s, -0.25 * s);
    chest.add(louvre);
  }
  root.add(chest);

  // ── Launcher pods riding the shoulders (they glow — and fire — during a
  //    volley: the blockable fireballs leave from here) ──────────────────────
  const podMats: [MeshStandardMaterial, MeshStandardMaterial] = [glowMat(accent, 0.2), glowMat(accent, 0.2)];
  podMats.forEach((mat, i) => {
    const side = i === 0 ? -1 : 1;
    if (def.style === 'piston') {
      // Smokestack exhausts, tipped back, ember-hot at the mouth.
      const stack = new Mesh(new CylinderGeometry(0.05 * s, 0.065 * s, 0.42 * s, 8), dark());
      stack.rotation.x = 0.35;
      stack.position.set(side * 0.3 * s, shoulderY + 0.3 * s, 0.1 * s);
      root.add(stack);
      const mouth = new Mesh(new CylinderGeometry(0.052 * s, 0.045 * s, 0.05 * s, 8), mat);
      mouth.rotation.x = 0.35;
      mouth.position.set(side * 0.3 * s, shoulderY + 0.5 * s, 0.17 * s);
      root.add(mouth);
    } else {
      const housing = new Mesh(new BoxGeometry(0.13 * s, 0.12 * s, 0.2 * s), dark());
      housing.position.set(side * 0.37 * s, shoulderY + 0.2 * s, 0.02 * s);
      root.add(housing);
      const muzzle = new Mesh(new CylinderGeometry(0.035 * s, 0.045 * s, 0.1 * s, 8), mat);
      muzzle.rotation.x = Math.PI / 2.6; // tipped up-and-forward, mortar style
      muzzle.position.set(side * 0.37 * s, shoulderY + 0.27 * s, -0.04 * s);
      root.add(muzzle);
    }
  });

  // ── Shoulder emblems: octagonal lamps set proud of each pauldron. Dim on
  //    most machines; GOLIATH's crown circuit blinks them as ring stops. ────
  const shoulderMats: [MeshStandardMaterial, MeshStandardMaterial] = [glowMat(accent, 0.2), glowMat(accent, 0.2)];
  // The king's crown-circuit shoulder stops run larger than the other
  // machines' vestigial lamps — they're targets you must hunt, so they read.
  const lampR = (def.style === 'king' ? 0.09 : 0.06) * s;
  const makeShoulderLamp = (i: 0 | 1): Mesh => {
    const side = i === 0 ? -1 : 1;
    const lamp = new Mesh(new CylinderGeometry(lampR, lampR, 0.055 * s, 8), shoulderMats[i]);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(side * 0.38 * s, shoulderY + 0.13 * s, -0.13 * s);
    root.add(lamp);
    return lamp;
  };
  const shoulders: [Mesh, Mesh] = [makeShoulderLamp(0), makeShoulderLamp(1)];

  // ── Pelvis + hover skirt: no legs — floating hands and iron, on brand ────
  const pelvis = new Mesh(new BoxGeometry(0.28 * s, 0.18 * s, 0.22 * s), chassis(accent, 0.03));
  pelvis.position.y = hipY - 0.28 * s;
  root.add(pelvis);
  // The LOW-BLOW emblem: an octagonal lamp set proud of the belt plate.
  // Dim on most machines; JUGGERNAUT's weak-point cycle blinks it live.
  const lowMat = glowMat(accent, 0.2);
  const low = new Mesh(new CylinderGeometry(0.07 * s, 0.07 * s, 0.05 * s, 8), lowMat);
  low.rotation.x = Math.PI / 2;
  low.position.set(0, hipY - 0.28 * s, -0.14 * s);
  root.add(low);
  if (def.style === 'fortress') {
    // The armour curtain: a ring of riveted skirt plates.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const plate = new Mesh(new BoxGeometry(0.14 * s, 0.2 * s, 0.025 * s), dark());
      plate.position.set(Math.cos(a) * 0.19 * s, hipY - 0.42 * s, Math.sin(a) * 0.19 * s);
      plate.rotation.y = -a + Math.PI / 2;
      plate.rotation.x = 0.12;
      root.add(plate);
    }
  }
  const skirt = new Mesh(new CylinderGeometry(0.16 * s, 0.05 * s, 0.28 * s, 8), dark());
  skirt.position.y = hipY - 0.48 * s;
  root.add(skirt);
  const skirtGlow = new Mesh(new CylinderGeometry(0.09 * s, 0.05 * s, 0.06 * s, 8), glowMat(accent, 1.2));
  skirtGlow.position.y = hipY - 0.6 * s;
  root.add(skirtGlow);

  // ── ARMS: shoulder pivots carrying girder arms + bespoke hands ───────────
  const buildHand = (side: -1 | 1): Group => {
    const hand = new Group();
    if (def.style === 'hook' && side === 1) {
      // The crane HOOK: a chain link, a shank, and the big open J-hook.
      const link = new Mesh(new CylinderGeometry(0.05 * s, 0.05 * s, 0.05 * s, 8), dark());
      link.rotation.x = Math.PI / 2;
      hand.add(link);
      const shank = new Mesh(new CylinderGeometry(0.03 * s, 0.035 * s, 0.16 * s, 8), steelMat(paint.chassis));
      shank.position.y = -0.1 * s;
      hand.add(shank);
      // Hook belly: a half-torus faked with three angled boxes (keeps the
      // low-poly robot-wars look), plus the up-turned point.
      const seg = (): Mesh => new Mesh(new BoxGeometry(0.06 * s, 0.14 * s, 0.06 * s), chassis(accent, 0.06));
      const a1 = seg();
      a1.position.set(0, -0.24 * s, 0);
      hand.add(a1);
      const a2 = seg();
      a2.position.set(-0.07 * s, -0.32 * s, 0);
      a2.rotation.z = 1.1;
      hand.add(a2);
      const a3 = seg();
      a3.position.set(-0.15 * s, -0.26 * s, 0);
      a3.rotation.z = 2.4;
      hand.add(a3);
      const point = new Mesh(new CylinderGeometry(0.004 * s, 0.045 * s, 0.14 * s, 6), dark());
      point.position.set(-0.17 * s, -0.16 * s, 0);
      hand.add(point);
      return hand;
    }
    if (def.style === 'piston') {
      // The HAMMER-BLOCK: one massive rectangular drop-forge fist.
      const block = new Mesh(new BoxGeometry(0.3 * s, 0.26 * s, 0.3 * s), chassis(accent, 0.06));
      hand.add(block);
      const face = new Mesh(new BoxGeometry(0.31 * s, 0.08 * s, 0.31 * s), dark());
      face.position.y = -0.16 * s;
      hand.add(face);
      const ring = new Mesh(new BoxGeometry(0.32 * s, 0.03 * s, 0.32 * s), glowMat(accent, 0.9));
      ring.position.y = 0.1 * s;
      hand.add(ring);
      return hand;
    }
    if (def.style === 'vulture') {
      // Talons: three claw fingers curling from a slim wrist block.
      const wrist = new Mesh(new BoxGeometry(0.12 * s, 0.1 * s, 0.12 * s), chassis(accent, 0.05));
      hand.add(wrist);
      for (let f = -1; f <= 1; f++) {
        const claw = new Mesh(new CylinderGeometry(0.006 * s, 0.03 * s, 0.2 * s, 5), dark());
        claw.position.set(f * 0.05 * s, -0.14 * s, -0.03 * s);
        claw.rotation.x = -0.5;
        hand.add(claw);
      }
      return hand;
    }
    // Fortress + king: the classic crane gauntlet (the king's wears gold cuffs).
    const block = new Mesh(new BoxGeometry(0.22 * s, 0.17 * s, 0.24 * s), chassis(accent, 0.06));
    hand.add(block);
    const plate = new Mesh(new BoxGeometry(0.23 * s, 0.06 * s, 0.09 * s), dark());
    plate.position.set(0, 0.075 * s, -0.1 * s);
    hand.add(plate);
    for (let i = 0; i < 4; i++) {
      const stud = new Mesh(new BoxGeometry(0.032 * s, 0.03 * s, 0.026 * s), glowMat(accent, 1.1));
      stud.position.set((-0.075 + i * 0.05) * s, 0.078 * s, -0.15 * s);
      hand.add(stud);
    }
    const cuffMat = def.style === 'king' ? steelMat(GOLD, GOLD, 0.35) : steelMat(paint.chassis);
    const cuff = new Mesh(new CylinderGeometry(0.085 * s, 0.11 * s, 0.11 * s, 8), cuffMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.14 * s;
    hand.add(cuff);
    return hand;
  };

  const arms = [0, 1].map((i) => {
    const side = (i === 0 ? -1 : 1) as -1 | 1;
    const pivot = new Group();
    pivot.position.set(side * (yokeW / 2 + 0.15 * s), shoulderY + 0.04 * s, 0);
    const upper = new Mesh(new BoxGeometry(0.11 * s, 0.62 * s, 0.13 * s), chassis(accent, 0.03));
    upper.position.y = -0.31 * s;
    pivot.add(upper);
    const elbow = new Mesh(new CylinderGeometry(0.075 * s, 0.075 * s, 0.14 * s, 8), dark());
    elbow.rotation.z = Math.PI / 2;
    elbow.position.y = -0.62 * s;
    pivot.add(elbow);
    const fist = buildHand(side);
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
    low,
    lowMat,
    shoulders,
    shoulderMats,
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
