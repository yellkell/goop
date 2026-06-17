/**
 * Head-driven IK for the player's body — now rendered, not just hitboxes.
 *
 * VR tracks the head (and hands), not the torso — so we solve a lightweight
 * upper-body spine each frame with the SAME `solveTorso` used for the
 * opponent's avatar: hips near your standing spot, spine up to the tracked
 * head, chest lerped along it. The ember iron torso (chest + pelvis) renders
 * so you see your own machine when you look down — but no head: the camera
 * lives inside it. The head/chest/pelvis hitbox spheres are placed from the
 * same solve, so the body you see, the body your rival sees and the body
 * that takes hits are one and the same.
 *
 * Runs before collision so hitboxes reflect the current frame's pose.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { buildBoxer, solveTorso, type BoxerRig } from '../avatar/boxer.js';
import { applyAvatarSkin } from '../avatar/skins.js';
import { BodyPart, PlayerBodyPart } from '../components/PlayerBodyPart.js';
import { app } from '../menu/appState.js';
import { myAvatarSkin } from '../menu/customization.js';

const _head = new Vector3();
const _headQ = new Quaternion();
const _rig = new Vector3();
const _chest = new Vector3();
const _pelvis = new Vector3();

export class PlayerBodySystem extends createSystem({
  parts: { required: [PlayerBodyPart] },
}) {
  private rig?: BoxerRig;

  init(): void {
    // Team 0 = ember. Only the torso joins the scene: gloves are driven by
    // PlayerGloveSystem on the controllers, and your own head stays unseen.
    this.rig = buildBoxer(0);
    this.rig.torso.name = 'player-torso';
    this.rig.torso.visible = false;
    applyAvatarSkin(this.rig.torso, myAvatarSkin());
    this.scene.add(this.rig.torso);
  }

  update(): void {
    const rig = this.rig;
    const headObj = this.playerHeadEntity?.object3D;
    const rigObj = this.playerEntity?.object3D;
    if (!rig || !headObj || !rigObj) return;

    headObj.getWorldPosition(_head);
    headObj.getWorldQuaternion(_headQ);
    rigObj.getWorldPosition(_rig);

    rig.torso.visible = app.state === 'playing' || app.state === 'training';
    solveTorso(rig, _head, _headQ, _rig.x, _rig.z, _chest, _pelvis);

    for (const entity of this.queries.parts.entities) {
      const obj = entity.object3D;
      if (!obj) continue;
      switch (entity.getValue(PlayerBodyPart, 'part')) {
        case BodyPart.Head:
          obj.position.copy(_head);
          break;
        case BodyPart.Chest:
          obj.position.copy(_chest);
          break;
        case BodyPart.Pelvis:
          obj.position.copy(_pelvis);
          break;
      }
    }
  }
}
