/**
 * The iron boxer — the opponent's avatar, built from cheap primitives so it
 * reads instantly across the arena: a riveted metal head with a glowing
 * visor, a chest/pelvis torso solved under the head, and two boxing gloves
 * driven straight by the (bot or remote) hand poses.
 *
 * The body intentionally matches the gameplay hitboxes (head/chest/pelvis
 * spheres from BODY_IK) so what you see is what you can hit.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { BODY_IK, PALETTE, teamColor } from '../config.js';

export interface BoxerRig {
  /** Head + visor; position/orient from the head pose. */
  head: Group;
  /** Chest + pelvis spheres; solved from the head each frame. */
  torso: Group;
  chest: Mesh;
  pelvis: Mesh;
  /** One glove per hand; position/orient from the hand poses. */
  gloves: [Group, Group];
  /** Everything, for showing/hiding as one. */
  all: Group[];
}

function ironMat(emissive: number, intensity = 0.25): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: PALETTE.iron,
    emissive,
    emissiveIntensity: intensity,
    metalness: 0.85,
    roughness: 0.35,
  });
}

/** A chunky boxing glove, knuckles pointing down local -Z. */
export function buildGlove(team: number): Group {
  const glove = new Group();
  const accent = teamColor(team);

  const fist = new Mesh(
    new SphereGeometry(0.075, 18, 14),
    new MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.22,
      metalness: 0.3,
      roughness: 0.5,
    }),
  );
  fist.scale.set(1, 0.88, 1.12);
  glove.add(fist);

  const cuff = new Mesh(new CylinderGeometry(0.05, 0.062, 0.07, 14), ironMat(accent, 0.35));
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = 0.085;
  glove.add(cuff);

  return glove;
}

/** Build the full opponent rig. Pieces start hidden; add them to the scene. */
export function buildBoxer(team: number): BoxerRig {
  const accent = teamColor(team);

  // --- Head: iron dome + glowing visor slit ---
  const head = new Group();
  head.name = 'opponent-head';
  const dome = new Mesh(new SphereGeometry(BODY_IK.headRadius, 20, 16), ironMat(accent));
  dome.scale.set(1, 1.08, 1.05);
  head.add(dome);
  const visor = new Mesh(
    new BoxGeometry(BODY_IK.headRadius * 1.5, 0.035, 0.02),
    new MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 1.6,
      metalness: 0.2,
      roughness: 0.3,
    }),
  );
  visor.position.set(0, 0.01, -BODY_IK.headRadius * 0.95);
  head.add(visor);

  // --- Torso: chest + pelvis spheres matching the hitbox volumes ---
  const torso = new Group();
  torso.name = 'opponent-torso';
  const chest = new Mesh(new SphereGeometry(BODY_IK.chestRadius, 18, 14), ironMat(accent, 0.18));
  chest.scale.set(1.05, 1.15, 0.8);
  const pelvis = new Mesh(new SphereGeometry(BODY_IK.pelvisRadius, 18, 14), ironMat(accent, 0.12));
  pelvis.scale.set(1, 0.9, 0.85);
  torso.add(chest, pelvis);

  const gloves: [Group, Group] = [buildGlove(team), buildGlove(team)];
  gloves[0].name = 'opponent-glove-left';
  gloves[1].name = 'opponent-glove-right';

  return { head, torso, chest, pelvis, gloves, all: [head, torso, gloves[0], gloves[1]] };
}

const _hips = new Vector3();
const _chest = new Vector3();

/**
 * Solve the torso under the head, mirroring PlayerBodySystem: hips pinned
 * over the pad centre (padX/padZ) at hip height, chest lerped hips→head.
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

  // Hips track the head laterally a bit so big leans drag the torso along.
  _hips.set(padX * 0.4 + headPos.x * 0.6, BODY_IK.hipHeight, padZ * 0.4 + headPos.z * 0.6);
  _chest.copy(_hips).lerp(headPos, BODY_IK.chestAlong);

  // The torso group sits at the world origin, so world coords ARE local here.
  rig.chest.position.copy(_chest);
  rig.pelvis.position.copy(_hips);

  outChest.copy(_chest);
  outPelvis.copy(_hips);
}
