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
  type Object3D,
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

export const GLOVE_VISUAL_SCALE = 1.28;

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
  // Steel body tinted by the accent through its emissive channel only.
  if (emissive) m.userData.accent = 'emissive';
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
  // A pure neon highlight: both its base colour and glow follow the accent.
  m.userData.accent = 'glow';
  return m;
}

/**
 * How much of the accent the STEEL BODY takes through its emissive channel.
 * The glowing neon parts wear the colour at full; the chassis only catches a
 * faint warm whisper of it, so cranking the accent recolours your neon — not
 * the whole suit. Kept well below 1 on purpose (it used to be the full hue,
 * which washed the body in the accent colour).
 */
const BODY_ACCENT_TINT = 0.3;

/**
 * Re-tint every accent-tagged material under a built avatar (glove or boxer)
 * to `color`. Glow highlights take it on both colour + emissive; chassis steel
 * only on a heavily DAMPENED emissive tint, so the body stays forged metal
 * rather than a slab of the accent. Cheap enough to call live while dragging a
 * slider.
 */
export function setAvatarAccent(root: Object3D, color: number): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const mode = (mat as MeshStandardMaterial).userData?.accent;
      const m = mat as MeshStandardMaterial;
      if (mode === 'glow') {
        m.color.set(color);
        m.emissive.set(color);
      } else if (mode === 'emissive') {
        // `set` resets from the hue, then the scale dims it — idempotent across
        // repeated slider drags, so the body never builds up colour.
        m.emissive.set(color).multiplyScalar(BODY_ACCENT_TINT);
      }
    }
  });
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
export function buildGlove(team: number, accent: number = teamColor(team)): Group {
  const glove = new Group();
  glove.scale.setScalar(GLOVE_VISUAL_SCALE);

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
  // BIG layered crown plume — a tall mohawk crest of metal feathers sweeping
  // up and back over the dome, the eagle's signature headdress.
  const crestBase = new Mesh(new BoxGeometry(r * 0.8, r * 0.2, r * 0.24), darkMat());
  crestBase.position.set(0, r * 0.8, r * 0.05);
  crestBase.rotation.x = 0.4;
  g.add(crestBase);
  for (let i = -4; i <= 4; i++) {
    const a = Math.abs(i);
    const len = r * (1.55 - a * 0.14); // long feathers, tallest in the middle
    const back = new Mesh(new BoxGeometry(r * 0.1, len, r * 0.15), chassisMat(accent, 0.04));
    back.position.set(i * r * 0.13, r * (1.06 - a * 0.04), r * (0.18 + a * 0.05));
    back.rotation.set(0.6 + a * 0.085, i * -0.05, i * 0.13);
    g.add(back);
    const vane = new Mesh(new BoxGeometry(r * 0.045, len * 0.84, r * 0.17), glowMat(accent, 0.7 + (4 - a) * 0.13));
    vane.position.set(i * r * 0.13, r * (1.11 - a * 0.03), r * (0.12 + a * 0.04));
    vane.rotation.copy(back.rotation);
    g.add(vane);
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

// ---------------------------------------------------------------------------
// Torso armour — a distinct cuirass + hip set per skin, each tagged so
// applyAvatarSkin shows ONE. Same silhouette envelope (wide shoulders → taper)
// and the same BODY_IK hitbox spheres, so they stay equally hittable.
// ---------------------------------------------------------------------------

/** COBALT → BEAR: heavy, broad — thick rounded pauldrons with rivet studs, a
 *  big domed chest slab, chunky abs. Brutish. */
function buildBearChest(accent: number): Group {
  const g = taggedHead('cobalt');
  const collar = new Mesh(new BoxGeometry(0.46, 0.11, 0.22), chassisMat(accent, 0.05));
  collar.position.y = 0.1;
  g.add(collar);
  const neck = new Mesh(new CylinderGeometry(0.08, 0.1, 0.1, 8), darkMat());
  neck.position.y = 0.16;
  g.add(neck);
  for (const side of [-1, 1]) {
    const up = new Mesh(new BoxGeometry(0.24, 0.12, 0.3), chassisMat(accent, 0.05));
    up.position.set(side * 0.3, 0.12, 0);
    up.rotation.z = side * -0.18;
    g.add(up);
    const lo = new Mesh(new BoxGeometry(0.22, 0.09, 0.28), darkMat());
    lo.position.set(side * 0.33, 0.02, 0);
    lo.rotation.z = side * -0.22;
    g.add(lo);
    for (let i = 0; i < 3; i++) {
      const stud = new Mesh(new BoxGeometry(0.022, 0.022, 0.022), glowMat(accent, 0.7));
      stud.position.set(side * (0.24 + i * 0.03), 0.18, -0.1 + i * 0.1);
      g.add(stud);
    }
  }
  const trunk = new Mesh(new CylinderGeometry(0.2, 0.12, 0.42, 8), darkMat());
  trunk.scale.z = 0.78;
  trunk.position.y = -0.12;
  g.add(trunk);
  const slab = new Mesh(new BoxGeometry(0.3, 0.26, 0.08), chassisMat(accent, 0.05));
  slab.position.set(0, -0.02, -0.13);
  g.add(slab);
  const core = new Mesh(new CylinderGeometry(0.05, 0.05, 0.03, 12), glowMat(accent, 1.4));
  core.rotation.x = Math.PI / 2;
  core.position.set(0, 0.0, -0.18);
  g.add(core);
  for (let i = 0; i < 2; i++) {
    const w = 0.26 - i * 0.04;
    const ab = new Mesh(new BoxGeometry(w, 0.08, 0.08), chassisMat(accent, 0.04));
    ab.position.set(0, -0.16 - i * 0.1, -0.1);
    g.add(ab);
    const seam = new Mesh(new BoxGeometry(w * 0.92, 0.012, 0.082), glowMat(accent, 0.28));
    seam.position.set(0, -0.205 - i * 0.1, -0.1);
    g.add(seam);
  }
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(0.06, 0.28, 0.22), chassisMat(accent, 0.04));
    flank.position.set(side * 0.17, -0.07, 0);
    flank.rotation.z = side * 0.1;
    g.add(flank);
  }
  return g;
}

/** CRIMSON → PANTHER: sleek bladed cuirass — sharp angled plates, shoulder
 *  blades, V pecs, chevron abs. Predatory. */
function buildPantherChest(accent: number): Group {
  const g = taggedHead('crimson');
  const collar = new Mesh(new BoxGeometry(0.4, 0.08, 0.19), chassisMat(accent, 0.05));
  collar.position.y = 0.11;
  g.add(collar);
  const neck = new Mesh(new CylinderGeometry(0.065, 0.085, 0.1, 8), darkMat());
  neck.position.y = 0.17;
  g.add(neck);
  for (const side of [-1, 1]) {
    const pad = new Mesh(new BoxGeometry(0.19, 0.07, 0.26), chassisMat(accent, 0.05));
    pad.position.set(side * 0.27, 0.12, 0);
    pad.rotation.z = side * -0.26;
    g.add(pad);
    const blade = new Mesh(new ConeGeometry(0.03, 0.2, 4), darkMat());
    blade.position.set(side * 0.34, 0.16, -0.04);
    blade.rotation.set(-0.5, 0, side * -0.5);
    g.add(blade);
    const lip = new Mesh(new BoxGeometry(0.195, 0.015, 0.265), glowMat(accent, 0.55));
    lip.position.set(side * 0.27, 0.165, 0);
    lip.rotation.z = side * -0.26;
    g.add(lip);
  }
  const trunk = new Mesh(new CylinderGeometry(0.155, 0.08, 0.42, 8), darkMat());
  trunk.scale.z = 0.72;
  trunk.position.y = -0.13;
  g.add(trunk);
  for (const side of [-1, 1]) {
    const pec = new Mesh(new BoxGeometry(0.14, 0.17, 0.06), chassisMat(accent, 0.05));
    pec.position.set(side * 0.08, 0.0, -0.13);
    pec.rotation.set(0.1, side * 0.4, side * 0.12);
    g.add(pec);
  }
  const core = new Mesh(new BoxGeometry(0.04, 0.16, 0.04), glowMat(accent, 1.4));
  core.position.set(0, -0.02, -0.16);
  g.add(core);
  for (let i = 0; i < 3; i++) {
    const w = 0.18 - i * 0.035;
    const ab = new Mesh(new BoxGeometry(w, 0.05, 0.07), chassisMat(accent, 0.04));
    ab.position.set(0, -0.15 - i * 0.072, -0.1);
    ab.rotation.x = -0.1;
    g.add(ab);
    const seam = new Mesh(new BoxGeometry(w * 0.9, 0.009, 0.072), glowMat(accent, 0.32));
    seam.position.set(0, -0.178 - i * 0.072, -0.1);
    g.add(seam);
  }
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(0.045, 0.26, 0.2), chassisMat(accent, 0.04));
    flank.position.set(side * 0.14, -0.08, 0);
    flank.rotation.z = side * 0.14;
    g.add(flank);
  }
  return g;
}

/** VALKYRIE → EAGLE: regal, winged — a crest emblem, glowing winglet pauldrons,
 *  layered feather breast plates, a chevron sigil. Ornate. */
function buildEagleChest(accent: number): Group {
  const g = taggedHead('valkyrie');
  const collar = new Mesh(new BoxGeometry(0.4, 0.08, 0.19), chassisMat(accent, 0.05));
  collar.position.y = 0.11;
  g.add(collar);
  const neck = new Mesh(new CylinderGeometry(0.06, 0.08, 0.1, 8), darkMat());
  neck.position.y = 0.17;
  g.add(neck);
  const crest = new Mesh(new BoxGeometry(0.05, 0.07, 0.04), glowMat(accent, 1.2));
  crest.position.set(0, 0.2, -0.06);
  crest.rotation.z = Math.PI / 4;
  g.add(crest);
  for (const side of [-1, 1]) {
    const base = new Mesh(new BoxGeometry(0.16, 0.07, 0.24), chassisMat(accent, 0.05));
    base.position.set(side * 0.26, 0.12, 0);
    base.rotation.z = side * -0.22;
    g.add(base);
    for (let i = 0; i < 3; i++) {
      const feather = new Mesh(new BoxGeometry(0.04, 0.14 - i * 0.02, 0.1), glowMat(accent, 0.5 + (2 - i) * 0.18));
      feather.position.set(side * (0.3 + i * 0.05), 0.16 + i * 0.02, 0.02 + i * 0.03);
      feather.rotation.set(0.2, side * 0.3, side * (0.5 + i * 0.1));
      g.add(feather);
    }
  }
  const trunk = new Mesh(new CylinderGeometry(0.155, 0.08, 0.42, 8), darkMat());
  trunk.scale.z = 0.72;
  trunk.position.y = -0.13;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const w = 0.26 - i * 0.05;
    const plate = new Mesh(new BoxGeometry(w, 0.09, 0.06), chassisMat(accent, 0.05));
    plate.position.set(0, 0.06 - i * 0.08, -0.12 - i * 0.005);
    plate.rotation.x = -0.18;
    g.add(plate);
  }
  const chevron = new Mesh(new BoxGeometry(0.16, 0.02, 0.05), glowMat(accent, 0.9));
  chevron.position.set(0, -0.03, -0.16);
  g.add(chevron);
  for (let i = 0; i < 3; i++) {
    const w = 0.16 - i * 0.03;
    const ab = new Mesh(new BoxGeometry(w, 0.045, 0.07), chassisMat(accent, 0.04));
    ab.position.set(0, -0.2 - i * 0.065, -0.1);
    g.add(ab);
  }
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(0.045, 0.24, 0.2), chassisMat(accent, 0.04));
    flank.position.set(side * 0.14, -0.08, 0);
    flank.rotation.z = side * 0.13;
    g.add(flank);
  }
  return g;
}

/** BEAR hips: broad belt, chunky tassets, wide guard — heavy. */
function buildBearPelvis(accent: number): Group {
  const g = taggedHead('cobalt');
  const belt = new Mesh(new BoxGeometry(0.24, 0.07, 0.18), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const buckle = new Mesh(new BoxGeometry(0.07, 0.06, 0.03), glowMat(accent, 1.0));
  buckle.position.set(0, 0.05, -0.095);
  g.add(buckle);
  const guard = new Mesh(new CylinderGeometry(0.12, 0.05, 0.15, 6), chassisMat(accent, 0.03));
  guard.position.set(0, -0.05, -0.02);
  g.add(guard);
  for (const side of [-1, 1]) {
    const tasset = new Mesh(new BoxGeometry(0.1, 0.16, 0.15), chassisMat(accent, 0.04));
    tasset.position.set(side * 0.12, -0.04, 0);
    tasset.rotation.z = side * 0.26;
    g.add(tasset);
  }
  return g;
}

/** PANTHER hips: slim belt, a pointed guard, bladed glow-edged tassets. */
function buildPantherPelvis(accent: number): Group {
  const g = taggedHead('crimson');
  const belt = new Mesh(new BoxGeometry(0.19, 0.05, 0.15), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const buckle = new Mesh(new BoxGeometry(0.045, 0.045, 0.03), glowMat(accent, 1.1));
  buckle.position.set(0, 0.05, -0.08);
  g.add(buckle);
  const guard = new Mesh(new ConeGeometry(0.08, 0.18, 5), chassisMat(accent, 0.03));
  guard.rotation.x = Math.PI;
  guard.position.set(0, -0.06, -0.03);
  g.add(guard);
  for (const side of [-1, 1]) {
    const tasset = new Mesh(new BoxGeometry(0.055, 0.18, 0.12), chassisMat(accent, 0.04));
    tasset.position.set(side * 0.1, -0.05, 0);
    tasset.rotation.z = side * 0.34;
    g.add(tasset);
    const edge = new Mesh(new BoxGeometry(0.06, 0.013, 0.125), glowMat(accent, 0.4));
    edge.position.set(side * 0.12, -0.13, 0);
    edge.rotation.z = side * 0.34;
    g.add(edge);
  }
  return g;
}

/** EAGLE hips: glow-trimmed belt, tapered guard, layered feathered tassets. */
function buildEaglePelvis(accent: number): Group {
  const g = taggedHead('valkyrie');
  const belt = new Mesh(new BoxGeometry(0.2, 0.05, 0.16), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const beltGlow = new Mesh(new BoxGeometry(0.205, 0.015, 0.165), glowMat(accent, 0.5));
  beltGlow.position.y = 0.075;
  g.add(beltGlow);
  const guard = new Mesh(new CylinderGeometry(0.08, 0.03, 0.14, 6), chassisMat(accent, 0.03));
  guard.position.set(0, -0.05, -0.02);
  g.add(guard);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const t = new Mesh(
        new BoxGeometry(0.05, 0.12 - i * 0.02, 0.11),
        i === 0 ? chassisMat(accent, 0.04) : glowMat(accent, 0.4),
      );
      // Stagger the layers in DEPTH (z), not just XY — otherwise the glow plate
      // and the chassis plate share a front plane where they overlap and the
      // neon z-fights/flickers. The glow edge now sits proud in front.
      t.position.set(side * (0.09 + i * 0.03), -0.04 - i * 0.04, -i * 0.022);
      t.rotation.z = side * (0.28 + i * 0.1);
      g.add(t);
    }
  }
  return g;
}

/** KNIGHT → a CRUSADER great helm: a flat-topped steel barrel with a raised
 *  gold Templar cross, a dark sight slit, breathing-hole dots and a riveted
 *  rim. (The cross/eyes are the accent, so the colour picker recolours them.) */
function buildKnightHead(accent: number): Group {
  const r = BODY_IK.headRadius;
  const g = taggedHead('knight');

  // Flat-topped barrel helm fully enclosing the head, capped flat with a seam.
  const barrel = new Mesh(new CylinderGeometry(r * 0.98, r * 1.06, r * 1.7, 20), chassisMat(accent, 0.04));
  barrel.position.y = r * 0.3;
  g.add(barrel);
  const cap = new Mesh(new CylinderGeometry(r * 0.99, r * 0.98, r * 0.16, 20), chassisMat(accent, 0.04));
  cap.position.y = r * 1.2;
  g.add(cap);
  const ridge = new Mesh(new BoxGeometry(r * 0.12, r * 0.1, r * 2.05), chassisMat(accent, 0.05));
  ridge.position.set(0, r * 1.27, 0);
  g.add(ridge);

  // The raised TEMPLAR CROSS: a long vertical bar + a crossbar at the sight line.
  const vbar = new Mesh(new BoxGeometry(r * 0.3, r * 1.78, r * 0.08), glowMat(accent, 0.85));
  vbar.position.set(0, r * 0.32, -r * 1.06);
  g.add(vbar);
  const hbar = new Mesh(new BoxGeometry(r * 1.85, r * 0.28, r * 0.08), glowMat(accent, 0.85));
  hbar.position.set(0, r * 0.5, -r * 1.085);
  g.add(hbar);

  // The sight: a dark slit either side of the cross, with a faint eye glow so
  // it still reads alive across the gap.
  for (const side of [-1, 1]) {
    const slit = new Mesh(new BoxGeometry(r * 0.6, r * 0.13, r * 0.08), darkMat());
    slit.position.set(side * r * 0.52, r * 0.34, -r * 1.04);
    g.add(slit);
    const eye = new Mesh(new BoxGeometry(r * 0.48, r * 0.05, r * 0.05), glowMat(accent, 1.4));
    eye.position.set(side * r * 0.52, r * 0.34, -r * 1.075);
    g.add(eye);
  }

  // Breathing holes — clustered dark studs across the lower face, both sides.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const hole = new Mesh(new CylinderGeometry(r * 0.05, r * 0.05, r * 0.05, 7), darkMat());
      hole.rotation.x = Math.PI / 2;
      hole.position.set(side * (r * 0.24 + col * r * 0.14), -r * 0.06 - row * r * 0.17 - col * r * 0.04, -r * 1.05);
      g.add(hole);
    }
  }

  // Riveted lower-front rim.
  for (let i = 0; i < 13; i++) {
    const a = -Math.PI * 0.6 + (i / 12) * Math.PI * 1.2;
    const stud = new Mesh(new SphereGeometry(r * 0.045, 6, 5), chassisMat(accent, 0.06));
    stud.position.set(Math.sin(a) * r * 1.04, -r * 0.5, -Math.cos(a) * r * 1.06);
    g.add(stud);
  }

  // Gorget neck base flaring under the helm.
  const gorget = new Mesh(new CylinderGeometry(r * 0.72, r * 0.9, r * 0.34, 16), darkMat());
  gorget.position.y = -r * 0.64;
  g.add(gorget);
  return g;
}

/** KNIGHT cuirass: a tall riveted gorget, big rounded pauldrons with studded
 *  rims + lower lames, and a studded chest yoke ending in a pointed plate. */
function buildKnightChest(accent: number): Group {
  const g = taggedHead('knight');

  // Tall riveted gorget collar.
  const gorget = new Mesh(new CylinderGeometry(0.12, 0.16, 0.17, 16), chassisMat(accent, 0.05));
  gorget.position.y = 0.12;
  g.add(gorget);
  const neck = new Mesh(new CylinderGeometry(0.07, 0.085, 0.08, 8), darkMat());
  neck.position.y = 0.2;
  g.add(neck);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const stud = new Mesh(new SphereGeometry(0.011, 6, 5), chassisMat(accent, 0.07));
    stud.position.set(Math.sin(a) * 0.135, 0.18, -Math.cos(a) * 0.135);
    g.add(stud);
  }

  // Big rounded pauldrons + a studded rim + two lower lames per shoulder.
  for (const side of [-1, 1]) {
    const pauldron = new Mesh(new SphereGeometry(0.17, 16, 12), chassisMat(accent, 0.05));
    pauldron.scale.set(1, 0.72, 1.12);
    pauldron.position.set(side * 0.27, 0.1, 0);
    g.add(pauldron);
    for (let i = 0; i < 4; i++) {
      const stud = new Mesh(new SphereGeometry(0.012, 6, 5), chassisMat(accent, 0.07));
      stud.position.set(side * (0.2 + i * 0.02), 0.16, -0.12 + i * 0.05);
      g.add(stud);
    }
    for (let j = 0; j < 2; j++) {
      const lame = new Mesh(new BoxGeometry(0.2, 0.055, 0.18), chassisMat(accent, 0.04));
      lame.position.set(side * 0.28, -j * 0.06, 0);
      lame.rotation.z = side * 0.12;
      g.add(lame);
    }
  }

  // Studded chest yoke ending in a pointed (V) plate.
  const yoke = new Mesh(new BoxGeometry(0.36, 0.17, 0.07), chassisMat(accent, 0.05));
  yoke.position.set(0, 0.01, -0.13);
  g.add(yoke);
  const point = new Mesh(new ConeGeometry(0.13, 0.18, 4), chassisMat(accent, 0.05));
  point.scale.set(1, 1, 0.5);
  point.rotation.set(Math.PI, Math.PI / 4, 0); // 4-sided plate, apex pointing DOWN
  point.position.set(0, -0.14, -0.12);
  g.add(point);
  for (let i = 0; i < 6; i++) {
    const stud = new Mesh(new SphereGeometry(0.012, 6, 5), chassisMat(accent, 0.07));
    stud.position.set(-0.14 + i * 0.056, 0.07, -0.165);
    g.add(stud);
  }
  for (const side of [-1, 1]) {
    for (let j = 0; j < 2; j++) {
      const stud = new Mesh(new SphereGeometry(0.012, 6, 5), chassisMat(accent, 0.07));
      stud.position.set(side * 0.16, 0.02 - j * 0.06, -0.165);
      g.add(stud);
    }
  }

  // Lower body trunk + side flanks under the yoke.
  const trunk = new Mesh(new CylinderGeometry(0.16, 0.09, 0.4, 10), darkMat());
  trunk.scale.z = 0.7;
  trunk.position.y = -0.16;
  g.add(trunk);
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(0.05, 0.26, 0.2), chassisMat(accent, 0.04));
    flank.position.set(side * 0.15, -0.1, 0);
    flank.rotation.z = side * 0.12;
    g.add(flank);
  }
  return g;
}

/** KNIGHT hips: a plated fauld (overlapping lames) with broad tassets. */
function buildKnightPelvis(accent: number): Group {
  const g = taggedHead('knight');
  const belt = new Mesh(new BoxGeometry(0.23, 0.06, 0.17), chassisMat(accent, 0.04));
  belt.position.y = 0.05;
  g.add(belt);
  const buckle = new Mesh(new BoxGeometry(0.06, 0.05, 0.03), glowMat(accent, 1.1));
  buckle.position.set(0, 0.05, -0.095);
  g.add(buckle);
  // Fauld: a stack of overlapping horizontal plates curving round the front.
  for (let i = 0; i < 3; i++) {
    const lame = new Mesh(new BoxGeometry(0.24 - i * 0.02, 0.06, 0.16), chassisMat(accent, 0.03));
    lame.position.set(0, 0.0 - i * 0.05, -0.005);
    lame.rotation.x = -0.05;
    g.add(lame);
  }
  // Broad tassets guarding the thighs.
  for (const side of [-1, 1]) {
    const tasset = new Mesh(new BoxGeometry(0.1, 0.17, 0.13), chassisMat(accent, 0.04));
    tasset.position.set(side * 0.11, -0.06, 0);
    tasset.rotation.z = side * 0.22;
    g.add(tasset);
    const trim = new Mesh(new BoxGeometry(0.11, 0.015, 0.135), glowMat(accent, 0.4));
    trim.position.set(side * 0.13, -0.145, 0);
    trim.rotation.z = side * 0.22;
    g.add(trim);
  }
  return g;
}

/** Per-skin builders, keyed by skin id — pick one (a fixed wearer) or all
 *  four (the customisation mirror, which toggles between them live). */
const HEAD_BUILDERS: Record<string, (accent: number) => Group> = {
  cobalt: buildBearHead,
  crimson: buildPantherHead,
  valkyrie: buildEagleHead,
  knight: buildKnightHead,
};
const CHEST_BUILDERS: Record<string, (accent: number) => Group> = {
  cobalt: buildBearChest,
  crimson: buildPantherChest,
  valkyrie: buildEagleChest,
  knight: buildKnightChest,
};
const PELVIS_BUILDERS: Record<string, (accent: number) => Group> = {
  cobalt: buildBearPelvis,
  crimson: buildPantherPelvis,
  valkyrie: buildEaglePelvis,
  knight: buildKnightPelvis,
};
const ALL_SKIN_IDS = ['cobalt', 'crimson', 'valkyrie', 'knight'];

/**
 * Build the full opponent rig. Pieces start hidden; add them to the scene.
 *
 * Pass `skinId` when the wearer never changes skin (a pub punter, the bartender,
 * a chosen fighter) and ONLY that skin's head/cuirass/hips are built — and shown
 * straight away. With no `skinId` all three are built (two left hidden) so the
 * customisation mirror can flip between them live; `applyAvatarSkin` reveals one.
 * Building just the one avoids carrying two extra skins' geometry per rig — a
 * real saving with a roomful of punters.
 */
export function buildBoxer(team: number, skinId?: string): BoxerRig {
  const accent = teamColor(team);
  const ids = skinId && HEAD_BUILDERS[skinId] ? [skinId] : ALL_SKIN_IDS;
  const sole = ids.length === 1; // the one built skin shows without applyAvatarSkin

  // --- Head: a detailed metallic ANIMAL head per built skin (front is −z).
  //     Hitboxes are the BODY_IK spheres and never change, so every fighter is
  //     equally hittable whatever's built. ---
  const head = new Group();
  head.name = 'opponent-head';
  for (const id of ids) {
    const g = HEAD_BUILDERS[id](accent);
    if (sole) g.visible = true;
    head.add(g);
  }

  // --- Torso: a DISTINCT armoured cuirass + hip set per built skin. Same
  //     silhouette envelope and BODY_IK hitbox spheres, equally hittable. ---
  const chest = new Group();
  chest.name = 'opponent-chest';
  for (const id of ids) {
    const g = CHEST_BUILDERS[id](accent);
    if (sole) g.visible = true;
    chest.add(g);
  }

  const pelvis = new Group();
  pelvis.name = 'opponent-pelvis';
  for (const id of ids) {
    const g = PELVIS_BUILDERS[id](accent);
    if (sole) g.visible = true;
    pelvis.add(g);
  }

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
/** Platform top in the solve's local space — the torso never sinks below it. */
const GROUND_Y = 0.14;
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
 * That set-back is tuned for the FIRST-PERSON wearer; a third-person viewer
 * just sees the head jutting ahead of the chest, so callers rendering OTHER
 * people (the pub crowd) can pass a smaller `setBackBase` to seat the head
 * more naturally over the shoulders.
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
  setBackBase: number = BODY_IK.spineSetBack,
): void {
  rig.head.position.copy(headPos);
  rig.head.quaternion.copy(headQuat);

  // Horizontal yaw-forward of the head; the spine anchor sits behind it.
  _fwd.set(0, 0, -1).applyQuaternion(headQuat);
  const hl = Math.hypot(_fwd.x, _fwd.z);
  const nx = hl > 1e-3 ? _fwd.x / hl : 0;
  const nz = hl > 1e-3 ? _fwd.z / hl : -1;
  // How far the head has dropped toward the platform — 0 standing, →1 laid
  // right out. As you go down, the spine anchor backs FURTHER off so the torso
  // stretches flat out BEHIND you along the slab instead of folding straight
  // down through it.
  const duck = Math.min(1, Math.max(0, (BODY_IK.hipHeight - headPos.y + 0.35) / 0.8));
  const setBack = setBackBase + duck * 0.5;
  _anchor.set(headPos.x - nx * setBack, headPos.y, headPos.z - nz * setBack);

  // Hips track the anchor laterally so big leans drag the torso along, and
  // follow it down on a duck — but NEVER below the platform top, so a low
  // lay-out smushes up against the slab rather than clipping through it.
  const hipY = Math.max(GROUND_Y, Math.min(BODY_IK.hipHeight, headPos.y - 0.5));
  _hips.set(padX * 0.4 + _anchor.x * 0.6, hipY, padZ * 0.4 + _anchor.z * 0.6);
  _chest.copy(_hips).lerp(_anchor, BODY_IK.chestAlong);
  _chest.y = Math.max(GROUND_Y + 0.12, _chest.y); // chest stays off the slab too

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

/**
 * A static, posed bust of YOUR boxer for the lobby customization preview —
 * head over chest over pelvis with both gauntlets up in a guard. Built at the
 * given accent so the slider visibly drives the whole avatar's neon, not just
 * the gloves. Returns one group; scale/position/spin it as you like, and call
 * `setAvatarAccent` on it to recolour live.
 */
export function buildBoxerPreview(accent: number): Group {
  const rig = buildBoxer(0, 'cobalt');

  rig.pelvis.position.set(0, 0, 0);
  rig.chest.position.set(0, 0.4, 0);
  rig.head.position.set(0, 0.78, 0);
  rig.gloves[0].position.set(-0.26, 0.46, -0.14);
  rig.gloves[1].position.set(0.26, 0.46, -0.14);

  const preview = new Group();
  preview.name = 'avatar-preview';
  preview.add(...rig.all); // head, torso (chest+pelvis), both gloves
  setAvatarAccent(preview, accent);
  return preview;
}
