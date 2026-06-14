/**
 * The iron boxer — the opponent's avatar, styled like a 90s UK robot-wars
 * machine: an eight-sided helmet with a glowing visor slit, a shoulder-heavy
 * torso (wide armoured yoke + sloped pauldrons tapering down to a narrow
 * waist — the silhouette is THICKEST at the shoulders), a small pelvis block,
 * and two chunky mechanical gauntlets driven straight by the (bot or remote)
 * hand poses. No legs — floating hands and iron, on brand.
 *
 * The body volumes still track the gameplay hitboxes (head/chest/pelvis
 * spheres from BODY_IK) so what you see is what you can hit.
 */

import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  Vector3,
} from 'three';
import { BODY_IK, PALETTE, teamColor } from '../config.js';
import { buildHand } from './hands.js';

/**
 * A shared brushed-steel roughness map: fine horizontal grain + speckle so the
 * armour plate reads as worked metal under the room reflections, not a flat
 * panel. One texture, tiled across every chassis/trim material.
 */
function brushedSteelMap(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const len = 4 + Math.random() * 22;
    const g = (110 + Math.random() * 110) | 0;
    ctx.strokeStyle = `rgba(${g},${g},${g},0.5)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y); // horizontal brush strokes
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

const STEEL_ROUGH = brushedSteelMap();

export interface BoxerRig {
  /** Helmet + visor; position/orient from the head pose. */
  head: Group;
  /** Container for the solved torso pieces (sits at the world origin). */
  torso: Group;
  /** Shoulder yoke + pauldrons + trunk; placed/oriented at the chest point. */
  chest: Group;
  /** Pelvis block; placed at the hips. */
  pelvis: Group;
  /** One gauntlet per hand; position/orient from the hand poses. */
  gloves: [Group, Group];
  /** Everything, for showing/hiding as one. */
  all: Group[];
}

function chassisMat(emissive = 0, intensity = 0): MeshStandardMaterial {
  // Near-black mirror steel: the RoomEnvironment reflections do the reading.
  const m = new MeshStandardMaterial({
    color: 0x1c1f25,
    emissive,
    emissiveIntensity: intensity,
    metalness: 0.96,
    roughness: 0.2,
  });
  if (STEEL_ROUGH) m.roughnessMap = STEEL_ROUGH; // brushed-metal grain
  m.userData.role = 'chassis'; // skin recolour target (avatar/skins.ts)
  return m;
}

function darkMat(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: 0x121419,
    metalness: 0.9,
    roughness: 0.3,
  });
  if (STEEL_ROUGH) m.roughnessMap = STEEL_ROUGH;
  m.userData.role = 'trim';
  return m;
}

function glowMat(color: number, intensity = 1.4): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.3,
  });
  m.userData.role = 'glow';
  return m;
}

/**
 * A chunky mechanical gauntlet: armoured fist block, riveted knuckle plate
 * with glowing studs, side armour, a top piston, and a flared cuff with a
 * team-glow ring. Knuckles point down local -Z.
 *
 * The glow parts double as LEDs: they're registered on `glove.userData.leds`
 * and `setGloveLit` flares them while the owner squeezes trigger/grip — a
 * readable tell on BOTH boxers' fists.
 */
export function buildGlove(team: number): Group {
  const glove = new Group();
  const accent = teamColor(team);

  const leds: MeshStandardMaterial[] = [];
  /** Register a material as an LED: `lit` flares it to litIntensity. */
  const registerLed = (
    m: MeshStandardMaterial,
    base: number,
    litIntensity: number,
    whiten: number,
  ): MeshStandardMaterial => {
    m.userData.baseIntensity = base;
    m.userData.litIntensity = litIntensity;
    m.userData.baseColor = new Color(accent);
    m.userData.litColor = new Color(accent).lerp(new Color(PALETTE.white), whiten);
    leds.push(m);
    return m;
  };
  const ledMat = (base: number, litIntensity: number): MeshStandardMaterial =>
    registerLed(glowMat(accent, base), base, litIntensity, 0.7);
  glove.userData.leds = leds;

  // The fist: one thick armoured block — its faint team glow joins the LED
  // set so the WHOLE fist visibly charges up, readable across the arena.
  const fist = new Mesh(
    new BoxGeometry(0.16, 0.125, 0.17),
    registerLed(chassisMat(accent, 0.06), 0.06, 1.1, 0.35),
  );
  fist.position.z = -0.015;
  glove.add(fist);

  // Knuckle plate riding the top front edge.
  const plate = new Mesh(new BoxGeometry(0.165, 0.05, 0.07), darkMat());
  plate.position.set(0, 0.05, -0.075);
  glove.add(plate);

  // Four glowing knuckle studs across the strike face.
  for (let i = 0; i < 4; i++) {
    const stud = new Mesh(new BoxGeometry(0.024, 0.022, 0.02), ledMat(1.1, 5.0));
    stud.position.set(-0.054 + i * 0.036, 0.052, -0.108);
    glove.add(stud);
  }

  // Side armour cheeks.
  for (const side of [-1, 1]) {
    const cheek = new Mesh(new BoxGeometry(0.022, 0.1, 0.13), darkMat());
    cheek.position.set(side * 0.09, 0, -0.01);
    glove.add(cheek);
  }

  // Recoil piston along the top.
  const piston = new Mesh(new CylinderGeometry(0.016, 0.016, 0.1, 8), darkMat());
  piston.rotation.x = Math.PI / 2;
  piston.position.set(0, 0.07, 0.02);
  glove.add(piston);
  const rod = new Mesh(new CylinderGeometry(0.008, 0.008, 0.06, 8), ledMat(0.7, 3.5));
  rod.rotation.x = Math.PI / 2;
  rod.position.set(0, 0.07, -0.05);
  glove.add(rod);

  // Flared cuff with a glowing team ring.
  const cuff = new Mesh(new CylinderGeometry(0.06, 0.078, 0.08, 8), chassisMat());
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.095;
  glove.add(cuff);
  const ring = new Mesh(new CylinderGeometry(0.073, 0.073, 0.018, 8), ledMat(0.9, 4.0));
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.07;
  glove.add(ring);

  return glove;
}

/**
 * Flare (or settle) a gauntlet's LEDs. `lit` = the hand is ACTIVE — its
 * owner is squeezing trigger/grip, or its ball is mid-return. Eases so the
 * light blooms on and fades off.
 */
export function setGloveLit(glove: Group, lit: boolean, delta: number): void {
  const leds = glove.userData.leds as MeshStandardMaterial[] | undefined;
  if (!leds) return;
  const k = Math.min(1, delta * 14);
  for (const m of leds) {
    const target = lit
      ? ((m.userData.litIntensity as number) ?? 3)
      : ((m.userData.baseIntensity as number) ?? 1);
    m.emissiveIntensity += (target - m.emissiveIntensity) * k;
    m.emissive.lerp(lit ? (m.userData.litColor as Color) : (m.userData.baseColor as Color), k);
  }
}

// ---------------------------------------------------------------------------
// Animal heads — a detailed metallic head per skin. Each is a self-contained
// Group tagged with the skin id it belongs to (applyAvatarSkin shows one). The
// front faces −z; everything is sized off BODY_IK.headRadius so the head fills
// the (unchanged) head hitbox sphere. Materials are role-tagged so a skin
// recolours them: chassis = body steel, trim = dark, glow = the accent (eyes).
// ---------------------------------------------------------------------------

function taggedHead(id: string): Group {
  const g = new Group();
  g.userData.skinTag = id;
  g.visible = false;
  return g;
}

/** COBALT → BEAR: broad heavy skull, rounded ears, blunt muzzle, tusks. */
function buildBearHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('cobalt');

  const skull = new Mesh(new SphereGeometry(r * 0.92, 16, 12), chassisMat(accent, 0.06));
  skull.scale.set(1.14, 0.96, 1.04);
  skull.position.y = r * 0.16;
  g.add(skull);
  // Forehead plate + a glowing crown seam down the middle.
  const forehead = new Mesh(new BoxGeometry(r * 1.5, r * 0.5, r * 0.5), chassisMat(accent, 0.05));
  forehead.position.set(0, r * 0.34, -r * 0.5);
  g.add(forehead);
  const seam = new Mesh(new BoxGeometry(r * 0.09, r * 0.05, r * 1.3), glowMat(accent, 0.5));
  seam.position.set(0, r * 0.66, -r * 0.2);
  g.add(seam);
  // Heavy brow ridges + deep-set glowing eyes.
  for (const side of [-1, 1]) {
    const ridge = new Mesh(new BoxGeometry(r * 0.62, r * 0.18, r * 0.42), darkMat());
    ridge.position.set(side * r * 0.42, r * 0.26, -r * 0.78);
    ridge.rotation.z = side * 0.16;
    g.add(ridge);
    const eye = new Mesh(new BoxGeometry(r * 0.26, r * 0.16, r * 0.1), glowMat(accent, 2.2));
    eye.position.set(side * r * 0.42, r * 0.1, -r * 0.86);
    g.add(eye);
  }
  // Rounded ears: outer disc + dark inner.
  for (const side of [-1, 1]) {
    const ear = new Mesh(new CylinderGeometry(r * 0.34, r * 0.34, r * 0.14, 16), chassisMat(accent, 0.05));
    ear.rotation.x = Math.PI / 2;
    ear.position.set(side * r * 0.72, r * 0.96, -r * 0.02);
    g.add(ear);
    const inner = new Mesh(new CylinderGeometry(r * 0.2, r * 0.2, r * 0.16, 16), darkMat());
    inner.rotation.x = Math.PI / 2;
    inner.position.set(side * r * 0.72, r * 0.96, -r * 0.05);
    g.add(inner);
  }
  // Blunt muzzle: bridge + snout box + nose pad + lower jaw.
  const bridge = new Mesh(new BoxGeometry(r * 0.4, r * 0.26, r * 0.55), chassisMat(accent, 0.04));
  bridge.position.set(0, r * 0.02, -r * 0.98);
  g.add(bridge);
  const muzzle = new Mesh(new BoxGeometry(r * 0.72, r * 0.46, r * 0.66), chassisMat(accent, 0.04));
  muzzle.position.set(0, -r * 0.34, -r * 0.96);
  g.add(muzzle);
  const nose = new Mesh(new SphereGeometry(r * 0.18, 10, 8), darkMat());
  nose.scale.set(1.3, 0.85, 0.9);
  nose.position.set(0, -r * 0.26, -r * 1.32);
  g.add(nose);
  const jaw = new Mesh(new BoxGeometry(r * 0.6, r * 0.22, r * 0.5), chassisMat(accent, 0.03));
  jaw.position.set(0, -r * 0.62, -r * 0.9);
  g.add(jaw);
  // Tusks at the mouth corners.
  for (const side of [-1, 1]) {
    const tusk = new Mesh(new ConeGeometry(r * 0.06, r * 0.2, 5), darkMat());
    tusk.rotation.x = Math.PI;
    tusk.position.set(side * r * 0.22, -r * 0.5, -r * 1.18);
    g.add(tusk);
  }
  // Cheek fur tufts (angled plates).
  for (const side of [-1, 1]) {
    const tuft = new Mesh(new BoxGeometry(r * 0.12, r * 0.5, r * 0.42), chassisMat(accent, 0.04));
    tuft.position.set(side * r * 0.82, -r * 0.12, -r * 0.42);
    tuft.rotation.set(0, side * 0.3, side * 0.5);
    g.add(tuft);
  }
  return g;
}

/** CRIMSON → PANTHER: sleek narrow skull, tall pointed ears, fangs, whiskers. */
function buildPantherHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('crimson');
  g.scale.setScalar(1.08);

  const skull = new Mesh(new SphereGeometry(r * 0.86, 16, 12), chassisMat(accent, 0.06));
  skull.scale.set(0.9, 0.92, 1.2);
  skull.position.y = r * 0.12;
  g.add(skull);
  // Dorsal ridge from brow over the crown.
  const ridge = new Mesh(new BoxGeometry(r * 0.12, r * 0.16, r * 1.25), chassisMat(accent, 0.06));
  ridge.position.set(0, r * 0.42, -r * 0.28);
  ridge.rotation.x = -0.16;
  g.add(ridge);
  // Angular brow + slanted glowing slit eyes.
  for (const side of [-1, 1]) {
    const brow = new Mesh(new BoxGeometry(r * 0.5, r * 0.1, r * 0.34), darkMat());
    brow.position.set(side * r * 0.34, r * 0.2, -r * 0.86);
    brow.rotation.z = side * 0.34;
    g.add(brow);
    const eye = new Mesh(new BoxGeometry(r * 0.34, r * 0.08, r * 0.08), glowMat(accent, 2.4));
    eye.position.set(side * r * 0.38, r * 0.05, -r * 0.93);
    eye.rotation.z = side * 0.42;
    g.add(eye);
  }
  // Tall pointed ears + dark inner.
  for (const side of [-1, 1]) {
    const ear = new Mesh(new ConeGeometry(r * 0.24, r * 0.62, 4), chassisMat(accent, 0.05));
    ear.position.set(side * r * 0.5, r * 0.95, r * 0.05);
    ear.rotation.set(-0.15, 0, side * -0.18);
    g.add(ear);
    const inner = new Mesh(new ConeGeometry(r * 0.12, r * 0.42, 4), darkMat());
    inner.position.set(side * r * 0.5, r * 0.92, r * 0.01);
    inner.rotation.set(-0.15, 0, side * -0.18);
    g.add(inner);
  }
  // Narrow muzzle + nose + fangs.
  const muzzle = new Mesh(new BoxGeometry(r * 0.44, r * 0.42, r * 0.74), chassisMat(accent, 0.04));
  muzzle.position.set(0, -r * 0.32, -r * 1.0);
  g.add(muzzle);
  const nose = new Mesh(new SphereGeometry(r * 0.12, 8, 6), darkMat());
  nose.scale.set(1.4, 0.7, 0.8);
  nose.position.set(0, -r * 0.2, -r * 1.36);
  g.add(nose);
  for (const side of [-1, 1]) {
    const fang = new Mesh(new ConeGeometry(r * 0.05, r * 0.22, 5), darkMat());
    fang.rotation.x = Math.PI;
    fang.position.set(side * r * 0.13, -r * 0.52, -r * 1.2);
    g.add(fang);
  }
  // Swept cheek blades.
  for (const side of [-1, 1]) {
    const blade = new Mesh(new BoxGeometry(r * 0.06, r * 0.32, r * 0.7), chassisMat(accent, 0.05));
    blade.position.set(side * r * 0.6, -r * 0.05, -r * 0.48);
    blade.rotation.set(0, side * 0.55, side * 0.22);
    g.add(blade);
  }
  // Glowing metal whisker spines.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const wsp = new Mesh(new CylinderGeometry(r * 0.012, r * 0.004, r * 0.5, 4), glowMat(accent, 0.6));
      wsp.rotation.set(0, i * 0.2, Math.PI / 2 + side * 0.2);
      wsp.position.set(side * r * 0.45, -r * 0.36 - i * r * 0.12, -r * 1.0);
      g.add(wsp);
    }
  }
  return g;
}

/** VALKYRIE → EAGLE: scowling brow, big hooked beak, swept feather crest. */
function buildEagleHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('valkyrie');

  const skull = new Mesh(new SphereGeometry(r * 0.82, 16, 12), chassisMat(accent, 0.06));
  skull.scale.set(0.96, 0.98, 1.0);
  skull.position.y = r * 0.18;
  g.add(skull);
  // Scowling brow (two angled plates) + fierce forward eyes.
  for (const side of [-1, 1]) {
    const brow = new Mesh(new BoxGeometry(r * 0.56, r * 0.18, r * 0.32), chassisMat(accent, 0.05));
    brow.position.set(side * r * 0.3, r * 0.3, -r * 0.7);
    brow.rotation.z = side * 0.5;
    g.add(brow);
    const eye = new Mesh(new BoxGeometry(r * 0.22, r * 0.16, r * 0.1), glowMat(accent, 2.6));
    eye.position.set(side * r * 0.34, r * 0.1, -r * 0.82);
    g.add(eye);
  }
  // Upper beak: base box → forward cone → downturned hook; shorter lower beak.
  const beakBase = new Mesh(new BoxGeometry(r * 0.36, r * 0.36, r * 0.42), chassisMat(accent, 0.05));
  beakBase.position.set(0, -r * 0.12, -r * 0.9);
  g.add(beakBase);
  const beak = new Mesh(new ConeGeometry(r * 0.22, r * 0.72, 4), chassisMat(accent, 0.06));
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, -r * 0.18, -r * 1.22);
  g.add(beak);
  const hook = new Mesh(new ConeGeometry(r * 0.13, r * 0.26, 4), darkMat());
  hook.rotation.x = -Math.PI * 0.78;
  hook.position.set(0, -r * 0.34, -r * 1.44);
  g.add(hook);
  const lower = new Mesh(new ConeGeometry(r * 0.16, r * 0.44, 4), darkMat());
  lower.rotation.x = -Math.PI / 2;
  lower.position.set(0, -r * 0.4, -r * 1.12);
  g.add(lower);
  // Cere (nostril band).
  const cere = new Mesh(new BoxGeometry(r * 0.3, r * 0.14, r * 0.2), darkMat());
  cere.position.set(0, -r * 0.04, -r * 1.0);
  g.add(cere);
  // Swept-back feather crest — fanning glowing blades.
  for (let i = -2; i <= 2; i++) {
    const len = r * 0.52 - Math.abs(i) * r * 0.07;
    const feather = new Mesh(new BoxGeometry(r * 0.05, len, r * 0.16), glowMat(accent, 0.6 + (2 - Math.abs(i)) * 0.2));
    feather.position.set(i * r * 0.16, r * 0.7, r * 0.12);
    feather.rotation.set(0.7, 0, i * 0.12);
    g.add(feather);
  }
  // Layered cheek feather plates.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const plate = new Mesh(new BoxGeometry(r * 0.07, r * 0.34, r * 0.4 - i * r * 0.1), chassisMat(accent, 0.04));
      plate.position.set(side * (r * 0.55 - i * r * 0.08), -r * 0.05 - i * r * 0.12, -r * 0.48 + i * r * 0.1);
      plate.rotation.set(0, side * 0.5, side * 0.25);
      g.add(plate);
    }
  }
  return g;
}

/** Build the full opponent rig. Pieces start hidden; add them to the scene. */
export function buildBoxer(team: number): BoxerRig {
  const accent = teamColor(team);

  // --- Head: a detailed metallic ANIMAL head per skin (front is −z). All
  //     three are built and ONE is shown by applyAvatarSkin; the bot defaults
  //     to the panther (see OPPONENT_DEFAULT_AVATAR). Hitboxes are the BODY_IK
  //     spheres and never change, so every fighter is equally hittable. ---
  const head = new Group();
  head.name = 'opponent-head';
  head.add(buildBearHead(accent), buildPantherHead(accent), buildEagleHead(accent));

  // --- Chest assembly: shoulders are the widest point of the machine ---
  const chest = new Group();
  chest.name = 'opponent-chest';

  // Shoulder yoke: the wide armoured beam across the top.
  const yoke = new Mesh(new BoxGeometry(0.46, 0.1, 0.2), chassisMat(accent, 0.05));
  yoke.position.y = 0.09;
  chest.add(yoke);

  // Pauldrons sloping off either end — the robot-wars wedge look.
  for (const side of [-1, 1]) {
    const pad = new Mesh(new BoxGeometry(0.17, 0.14, 0.24), darkMat());
    pad.position.set(side * 0.27, 0.1, 0);
    pad.rotation.z = side * -0.2; // slope down and out
    chest.add(pad);
    const trim = new Mesh(new BoxGeometry(0.175, 0.018, 0.245), glowMat(accent, 0.5));
    trim.position.set(side * 0.27, 0.175, 0);
    trim.rotation.z = side * -0.2;
    chest.add(trim);
  }

  // Trunk: an 8-sided wedge tapering hard from shoulders to waist —
  // nothing bulbous below the yoke.
  const trunk = new Mesh(new CylinderGeometry(0.19, 0.1, 0.42, 8), chassisMat(accent, 0.04));
  trunk.scale.z = 0.72;
  trunk.position.y = -0.13;
  chest.add(trunk);

  // Glowing reactor core slit on the chest plate.
  const core = new Mesh(new BoxGeometry(0.06, 0.11, 0.02), glowMat(accent, 1.3));
  core.position.set(0, -0.05, -0.135);
  chest.add(core);

  // --- Per-skin chest ornaments (hidden; applyAvatarSkin shows ONE set) ---
  const chestTag = (g: Group, id: string): Group => {
    g.userData.skinTag = id;
    g.visible = false;
    return g;
  };

  // COBALT: shoulder sensor mast + a glowing data stripe across the yoke.
  const sensor = chestTag(new Group(), 'cobalt');
  const mast = new Mesh(new CylinderGeometry(0.005, 0.007, 0.16, 6), darkMat());
  mast.position.set(0.3, 0.23, 0.02);
  sensor.add(mast);
  const beacon = new Mesh(new BoxGeometry(0.02, 0.02, 0.02), glowMat(accent, 1.6));
  beacon.position.set(0.3, 0.32, 0.02);
  sensor.add(beacon);
  const stripe = new Mesh(new BoxGeometry(0.4, 0.016, 0.205), glowMat(accent, 0.7));
  stripe.position.y = 0.145;
  sensor.add(stripe);
  chest.add(sensor);

  // CRIMSON: rows of pauldron spikes — pure pit-fighter menace.
  const spikes = chestTag(new Group(), 'crimson');
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const spike = new Mesh(new CylinderGeometry(0.001, 0.015, 0.075, 6), darkMat());
      spike.position.set(side * (0.2 + i * 0.07), 0.21 - i * 0.012, 0);
      spike.rotation.z = side * -(0.15 + i * 0.2);
      spikes.add(spike);
    }
  }
  chest.add(spikes);

  // VALKYRIE: angled glowing winglets off the pauldrons.
  const wings = chestTag(new Group(), 'valkyrie');
  for (const side of [-1, 1]) {
    const wing = new Mesh(new BoxGeometry(0.17, 0.014, 0.07), glowMat(accent, 0.6));
    wing.position.set(side * 0.37, 0.17, 0.02);
    wing.rotation.z = side * 0.5;
    wings.add(wing);
  }
  chest.add(wings);

  // --- Pelvis: a small armoured block, the narrow end of the wedge ---
  const pelvis = new Group();
  pelvis.name = 'opponent-pelvis';
  const hipBlock = new Mesh(new BoxGeometry(0.21, 0.15, 0.17), chassisMat(accent, 0.03));
  pelvis.add(hipBlock);
  const beltTrim = new Mesh(new BoxGeometry(0.215, 0.02, 0.175), glowMat(accent, 0.4));
  beltTrim.position.y = 0.06;
  pelvis.add(beltTrim);

  const torso = new Group();
  torso.name = 'opponent-torso';
  torso.add(chest, pelvis);

  // Articulated VR hands (left thumb +x, right thumb -x), not gauntlets.
  const gloves: [Group, Group] = [buildHand(1), buildHand(-1)];
  gloves[0].name = 'opponent-glove-left';
  gloves[1].name = 'opponent-glove-right';

  return { head, torso, chest, pelvis, gloves, all: [head, torso, gloves[0], gloves[1]] };
}

const UP = new Vector3(0, 1, 0);
const _hips = new Vector3();
const _chest = new Vector3();
const _spine = new Vector3();
const _fwd = new Vector3();
const _anchor = new Vector3();
const _tilt = new Quaternion();
const _yaw = new Quaternion();

/**
 * Solve the torso under the head, mirroring PlayerBodySystem: hips over the
 * pad centre (padX/padZ) — but dragged DOWN when the head ducks, so a dodge
 * folds the whole machine instead of leaving the pelvis hanging in the air —
 * chest lerped hips→head, both oriented to the spine lean and the head's yaw.
 *
 * The spine hangs from a point slightly BEHIND the head along its yaw
 * (faces sit forward of spines): looking down shows the player the front of
 * their own chest instead of the base of their neck, and the torso stops
 * blocking the view of what's in front.
 *
 * Returns chest/pelvis world positions for the caller's hitboxes via out args.
 */
export function solveTorso(
  rig: BoxerRig,
  headPos: Vector3,
  headQuat: Quaternion,
  padX: number,
  padZ: number,
  outChest: Vector3,
  outPelvis: Vector3,
): void {
  rig.head.position.copy(headPos);
  rig.head.quaternion.copy(headQuat);

  // Horizontal yaw-forward of the head; the spine anchor sits behind it.
  _fwd.set(0, 0, -1).applyQuaternion(headQuat);
  const hl = Math.hypot(_fwd.x, _fwd.z);
  const nx = hl > 1e-3 ? _fwd.x / hl : 0;
  const nz = hl > 1e-3 ? _fwd.z / hl : -1;
  _anchor.set(
    headPos.x - nx * BODY_IK.spineSetBack,
    headPos.y,
    headPos.z - nz * BODY_IK.spineSetBack,
  );

  // Hips track the anchor laterally a bit so big leans drag the torso along,
  // and follow it down on a duck (never higher than standing hip height).
  const hipY = Math.min(BODY_IK.hipHeight, headPos.y - 0.5);
  _hips.set(padX * 0.4 + _anchor.x * 0.6, hipY, padZ * 0.4 + _anchor.z * 0.6);
  _chest.copy(_hips).lerp(_anchor, BODY_IK.chestAlong);

  // Orientation: lean the chest along the hips→anchor spine, yaw with the head.
  _spine.copy(_anchor).sub(_hips).normalize();
  _tilt.setFromUnitVectors(UP, _spine);
  _yaw.setFromAxisAngle(UP, Math.atan2(-_fwd.x, -_fwd.z));

  // The torso group sits at the world origin, so world coords ARE local here.
  rig.chest.position.copy(_chest);
  rig.chest.quaternion.copy(_tilt).multiply(_yaw);
  rig.pelvis.position.copy(_hips);
  rig.pelvis.quaternion.copy(_yaw);

  outChest.copy(_chest);
  outPelvis.copy(_hips);
}
