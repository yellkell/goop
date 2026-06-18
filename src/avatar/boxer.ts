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
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { BODY_IK, PALETTE, teamColor } from '../config.js';

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
  const m = new MeshStandardMaterial({
    color: PALETTE.gunmetal,
    emissive,
    emissiveIntensity: intensity,
    metalness: 0.92,
    roughness: 0.3,
  });
  // Steel body tinted by the accent through its emissive channel only.
  if (emissive) m.userData.accent = 'emissive';
  return m;
}

function darkMat(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: PALETTE.gunmetalDark,
    metalness: 0.85,
    roughness: 0.45,
  });
}

function glowMat(color: number, intensity = 1.4): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.3,
  });
  // A pure neon highlight: both its base colour and glow follow the accent.
  m.userData.accent = 'glow';
  return m;
}

/**
 * Re-tint every accent-tagged material under a built avatar (glove or boxer)
 * to `color`. Glow highlights take it on both colour + emissive; chassis steel
 * only on its emissive tint. Cheap enough to call live while dragging a slider.
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
        m.emissive.set(color);
      }
    }
  });
}

/**
 * A chunky mechanical gauntlet: armoured fist block, riveted knuckle plate
 * with glowing studs, side armour, a top piston, and a flared cuff with a
 * team-glow ring. Knuckles point down local -Z.
 */
export function buildGlove(team: number, accent: number = teamColor(team)): Group {
  const glove = new Group();
  glove.scale.setScalar(GLOVE_VISUAL_SCALE);

  // The fist: one thick armoured block.
  const fist = new Mesh(new BoxGeometry(0.16, 0.125, 0.17), chassisMat(accent, 0.06));
  fist.position.z = -0.015;
  glove.add(fist);

  // Knuckle plate riding the top front edge.
  const plate = new Mesh(new BoxGeometry(0.165, 0.05, 0.07), darkMat());
  plate.position.set(0, 0.05, -0.075);
  glove.add(plate);

  // Four glowing knuckle studs across the strike face.
  for (let i = 0; i < 4; i++) {
    const stud = new Mesh(new BoxGeometry(0.024, 0.022, 0.02), glowMat(accent, 1.1));
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
  const rod = new Mesh(new CylinderGeometry(0.008, 0.008, 0.06, 8), glowMat(accent, 0.7));
  rod.rotation.x = Math.PI / 2;
  rod.position.set(0, 0.07, -0.05);
  glove.add(rod);

  // Flared cuff with a glowing team ring.
  const cuff = new Mesh(new CylinderGeometry(0.06, 0.078, 0.08, 8), chassisMat());
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.095;
  glove.add(cuff);
  const ring = new Mesh(new CylinderGeometry(0.073, 0.073, 0.018, 8), glowMat(accent, 0.9));
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.07;
  glove.add(ring);

  return glove;
}

/** Build the full opponent rig. Pieces start hidden; add them to the scene. */
export function buildBoxer(team: number, accent: number = teamColor(team)): BoxerRig {

  // --- Head: eight-sided helmet, visor slit, jaw guard, crest fin ---
  const head = new Group();
  head.name = 'opponent-head';
  const helm = new Mesh(
    new CylinderGeometry(BODY_IK.headRadius * 0.82, BODY_IK.headRadius * 0.98, BODY_IK.headRadius * 2.05, 8),
    chassisMat(accent, 0.08),
  );
  head.add(helm);
  const crown = new Mesh(
    new CylinderGeometry(BODY_IK.headRadius * 0.5, BODY_IK.headRadius * 0.84, BODY_IK.headRadius * 0.5, 8),
    darkMat(),
  );
  crown.position.y = BODY_IK.headRadius * 1.25;
  head.add(crown);
  const visor = new Mesh(new BoxGeometry(BODY_IK.headRadius * 1.45, 0.03, 0.025), glowMat(accent, 1.8));
  visor.position.set(0, 0.012, -BODY_IK.headRadius * 0.92);
  head.add(visor);
  const jaw = new Mesh(new BoxGeometry(BODY_IK.headRadius * 1.1, 0.05, 0.06), darkMat());
  jaw.position.set(0, -BODY_IK.headRadius * 0.62, -BODY_IK.headRadius * 0.72);
  head.add(jaw);
  const fin = new Mesh(new BoxGeometry(0.018, 0.07, BODY_IK.headRadius * 1.3), darkMat());
  fin.position.y = BODY_IK.headRadius * 1.05;
  head.add(fin);

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

  const gloves: [Group, Group] = [buildGlove(team, accent), buildGlove(team, accent)];
  gloves[0].name = 'opponent-glove-left';
  gloves[1].name = 'opponent-glove-right';

  return { head, torso, chest, pelvis, gloves, all: [head, torso, gloves[0], gloves[1]] };
}

const UP = new Vector3(0, 1, 0);
const _hips = new Vector3();
const _chest = new Vector3();
const _spine = new Vector3();
const _fwd = new Vector3();
const _tilt = new Quaternion();
const _yaw = new Quaternion();

/**
 * Solve the torso under the head, mirroring PlayerBodySystem: hips over the
 * pad centre (padX/padZ) — but dragged DOWN when the head ducks, so a dodge
 * folds the whole machine instead of leaving the pelvis hanging in the air —
 * chest lerped hips→head, both oriented to the spine lean and the head's yaw.
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

  // Hips track the head laterally a bit so big leans drag the torso along,
  // and follow it down on a duck (never higher than standing hip height).
  const hipY = Math.min(BODY_IK.hipHeight, headPos.y - 0.5);
  _hips.set(padX * 0.4 + headPos.x * 0.6, hipY, padZ * 0.4 + headPos.z * 0.6);
  _chest.copy(_hips).lerp(headPos, BODY_IK.chestAlong);

  // Orientation: lean the chest along the hips→head spine, yaw with the head.
  _spine.copy(headPos).sub(_hips).normalize();
  _tilt.setFromUnitVectors(UP, _spine);
  _fwd.set(0, 0, -1).applyQuaternion(headQuat);
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
  const rig = buildBoxer(0, accent);

  rig.pelvis.position.set(0, 0, 0);
  rig.chest.position.set(0, 0.4, 0);
  rig.head.position.set(0, 0.78, 0);
  rig.gloves[0].position.set(-0.26, 0.46, -0.14);
  rig.gloves[1].position.set(0.26, 0.46, -0.14);

  const preview = new Group();
  preview.name = 'avatar-preview';
  preview.add(...rig.all); // head, torso (chest+pelvis), both gloves
  return preview;
}
