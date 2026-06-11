/**
 * Head-driven IK for the player's body.
 *
 * VR tracks the head (and hands), not the torso — so we solve a lightweight
 * upper-body spine each frame: the hips are pinned at the player's standing
 * spot (rig XZ, fixed height) and the spine runs up to the tracked head. The
 * head/chest/pelvis hitbox spheres are placed along that spine, so leaning or
 * ducking your real head swings the whole torso volume. That makes dodging a
 * believable full-body act instead of just sliding one head sphere around.
 *
 * Runs before collision so hitboxes reflect the current frame's pose.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { BodyPart, PlayerBodyPart } from '../components/PlayerBodyPart.js';
import { BODY_IK } from '../config.js';

const _head = new Vector3();
const _rig = new Vector3();
const _hips = new Vector3();
const _chest = new Vector3();

export class PlayerBodySystem extends createSystem({
  parts: { required: [PlayerBodyPart] },
}) {
  update(): void {
    const headObj = this.playerHeadEntity?.object3D;
    const rigObj = this.playerEntity?.object3D;
    if (!headObj || !rigObj) return;

    headObj.getWorldPosition(_head);
    rigObj.getWorldPosition(_rig);

    // Hips pinned under the standing spot; spine = hips -> tracked head.
    _hips.set(_rig.x, _rig.y + BODY_IK.hipHeight, _rig.z);
    _chest.copy(_hips).lerp(_head, BODY_IK.chestAlong);

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
          obj.position.copy(_hips);
          break;
      }
    }
  }
}
