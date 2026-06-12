/**
 * Teleport-only locomotion (no sliding, no smooth turn):
 *
 *  - Deflect either thumbstick and that controller starts aiming: a ballistic
 *    arc curves from it to the floor, ending in an OCTAGON marker (the
 *    arena platform footprint, naturally) with an arrow inside it.
 *  - Move the controller to move the landing spot; roll the thumbstick to
 *    spin the arrow — that's the way you'll be FACING when you arrive.
 *  - Let the stick spring back and you're there.
 *
 * Landing spots are restricted to the floor rectangles in TELEPORT_AREAS
 * (the pub, the doorway, the fight hall); anywhere else the marker burns
 * red and release does nothing. Fighters on a claimed corner can't teleport
 * mid-match — feet stay on the platform, like the arena.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import type { XROrigin } from '@iwsdk/xr-input';
import { OCTAGON_VERTICES, PALETTE } from '../../config.js';
import { octagonSlab } from '../../arena/octagon.js';
import { uiClick } from '../../audio/sfx.js';
import { PUB, TELEPORT, TELEPORT_AREAS } from '../config.js';
import { pub } from '../state.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _quat = new Quaternion();
const _p = new Vector3();
const _v = new Vector3();
const _head = new Vector3();

/**
 * Move the rig so the player's head lands over (x, z) facing `yaw`
 * (three.js convention: yaw 0 looks down −z). Shared with the fight claim,
 * which plants fighters on their platform.
 */
export function teleportPlayer(player: XROrigin, x: number, z: number, yaw: number): void {
  player.head.getWorldPosition(_head);
  player.head.getWorldQuaternion(_quat);
  _dir.set(0, 0, -1).applyQuaternion(_quat);
  const headYaw = Math.atan2(-_dir.x, -_dir.z);

  const dYaw = yaw - headYaw;
  player.rotation.y += dYaw;

  // Rotate the head's offset from the rig origin by the turn we just made,
  // then position the rig so the head ends up exactly on target.
  const offX = _head.x - player.position.x;
  const offZ = _head.z - player.position.z;
  const cos = Math.cos(dYaw);
  const sin = Math.sin(dYaw);
  player.position.x = x - (offX * cos + offZ * sin);
  player.position.z = z - (-offX * sin + offZ * cos);
}

function inTeleportArea(x: number, z: number): boolean {
  return TELEPORT_AREAS.some((a) => x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ);
}

/** Is the local player currently locked to a fight platform? */
function lockedToPlatform(): boolean {
  const f = pub.fight;
  return (
    (f.phase === 'starting' || f.phase === 'fighting') &&
    (f.sides[0] === pub.myId || f.sides[1] === pub.myId)
  );
}

export class TeleportSystem extends createSystem({}) {
  private aimingHand: 'left' | 'right' | null = null;
  private arc!: Line;
  private arcGeo!: BufferGeometry;
  private marker!: Group;
  private markerMat!: MeshBasicMaterial;
  private arrowMat!: MeshBasicMaterial;
  private landing = new Vector3();
  private landingYaw = 0;
  private valid = false;
  private spawned = false;

  init(): void {
    // Arc line.
    this.arcGeo = new BufferGeometry();
    this.arcGeo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(TELEPORT.arcPoints * 3), 3),
    );
    this.arc = new Line(
      this.arcGeo,
      new LineBasicMaterial({
        color: PALETTE.amber,
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.scene.add(this.arc);

    // Octagon landing marker — the platform silhouette, ghosted.
    this.markerMat = new MeshBasicMaterial({
      color: PALETTE.amber,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const slab = new Mesh(octagonSlab(OCTAGON_VERTICES, 0.012), this.markerMat);
    this.marker = new Group();
    this.marker.add(slab);

    // The facing arrow inside it (points −z at yaw 0, like the camera).
    const shape = new Shape();
    shape.moveTo(0, 0.34);
    shape.lineTo(0.16, 0.06);
    shape.lineTo(0.06, 0.06);
    shape.lineTo(0.06, -0.26);
    shape.lineTo(-0.06, -0.26);
    shape.lineTo(-0.06, 0.06);
    shape.lineTo(-0.16, 0.06);
    shape.closePath();
    this.arrowMat = new MeshBasicMaterial({
      color: PALETTE.amber,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const arrow = new Mesh(new ShapeGeometry(shape), this.arrowMat);
    arrow.rotation.x = -Math.PI / 2; // lay flat: shape's +y becomes −z (forward)
    arrow.position.y = 0.03;
    this.marker.add(arrow);
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  update(): void {
    // Plant the player at the pub spawn once the rig exists.
    if (!this.spawned) {
      this.spawned = true;
      this.player.position.set(PUB.spawn.x, 0, PUB.spawn.z);
    }

    if (lockedToPlatform()) {
      this.hide();
      return;
    }

    // Pick / keep the aiming hand.
    let axes: { x: number; y: number } | null = null;
    if (this.aimingHand) {
      const a = this.input.xr.gamepads[this.aimingHand]?.getAxesValues(InputComponent.Thumbstick);
      axes = a ?? null;
    } else {
      for (const hand of ['left', 'right'] as const) {
        const a = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick);
        if (a && Math.hypot(a.x, a.y) >= TELEPORT.engage) {
          this.aimingHand = hand;
          axes = a;
          break;
        }
      }
    }

    if (!this.aimingHand || !axes) {
      this.hide();
      return;
    }

    const mag = Math.hypot(axes.x, axes.y);
    if (mag < TELEPORT.release) {
      // Stick sprung back — go (if the marker was on valid floor).
      if (this.valid) {
        teleportPlayer(this.player, this.landing.x, this.landing.z, this.landingYaw);
        uiClick();
      }
      this.hide();
      return;
    }

    this.traceArc(axes);
  }

  private traceArc(axes: { x: number; y: number }): void {
    const ray = this.player.raySpaces[this.aimingHand!];
    ray.getWorldPosition(_origin);
    ray.getWorldQuaternion(_quat);
    _dir.set(0, 0, -1).applyQuaternion(_quat);

    // Ballistic arc from the controller.
    _p.copy(_origin);
    _v.copy(_dir).multiplyScalar(TELEPORT.launchSpeed);
    const pos = this.arcGeo.getAttribute('position') as BufferAttribute;
    let landed = false;
    let used = 0;
    for (let i = 0; i < TELEPORT.arcPoints; i++) {
      pos.setXYZ(i, _p.x, _p.y, _p.z);
      used = i + 1;
      if (landed) continue;
      _v.y -= TELEPORT.gravity * TELEPORT.arcStep;
      _p.addScaledVector(_v, TELEPORT.arcStep);
      if (_p.y <= 0) {
        _p.y = 0;
        landed = true;
        this.landing.copy(_p);
        // Fill the remaining points at the landing spot so the line stops.
        for (let j = i + 1; j < TELEPORT.arcPoints; j++) pos.setXYZ(j, _p.x, _p.y, _p.z);
        break;
      }
    }
    if (!landed) {
      // Arc never reached the floor (pointing at the ceiling) — invalid.
      this.landing.copy(_p);
    }
    pos.needsUpdate = true;
    this.arcGeo.setDrawRange(0, landed ? TELEPORT.arcPoints : used);

    this.valid = landed && inTeleportArea(this.landing.x, this.landing.z);

    // Facing: thumbstick angle relative to where the controller points.
    const ctrlYaw = Math.atan2(-_dir.x, -_dir.z);
    const stickAngle = Math.atan2(axes.x, -axes.y); // 0 = pushed forward
    this.landingYaw = ctrlYaw - stickAngle;

    // Show it.
    const colour = this.valid ? PALETTE.amber : PALETTE.danger;
    this.markerMat.color.set(colour);
    this.arrowMat.color.set(colour);
    (this.arc.material as LineBasicMaterial).color.set(colour);
    this.marker.position.set(this.landing.x, 0.01, this.landing.z);
    this.marker.rotation.y = this.landingYaw;
    this.marker.visible = true;
    this.arc.visible = true;
  }

  private hide(): void {
    this.aimingHand = null;
    this.valid = false;
    this.arc.visible = false;
    this.marker.visible = false;
  }
}
