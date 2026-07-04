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
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { XROrigin } from '@iwsdk/xr-input';
import { OCTAGON_VERTICES, PALETTE } from '../../config.js';
import { octagonSlab } from '../../arena/octagon.js';
import { uiClick } from '../../audio/sfx.js';
import { EXIT_ZONE, PUB, TELEPORT, TELEPORT_AREAS, WALL_SEGMENTS } from '../config.js';
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
  // Normal landings are at stands/pub level; the fight claim sinks the rig
  // into the pit AFTER calling this.
  player.position.y = 0;

  // Rotate the head's offset from the rig origin by the turn we just made,
  // then position the rig so the head ends up exactly on target.
  const offX = _head.x - player.position.x;
  const offZ = _head.z - player.position.z;
  const cos = Math.cos(dYaw);
  const sin = Math.sin(dYaw);
  player.position.x = x - (offX * cos + offZ * sin);
  player.position.z = z - (-offX * sin + offZ * cos);
}

/**
 * Snap-turn the rig by `deltaYaw` radians about the player's HEAD, so your
 * physical spot stays put and the world spins around you (rotating about the
 * rig origin would swing your head through an arc). Positive yaw turns left.
 */
export function snapTurn(player: XROrigin, deltaYaw: number): void {
  player.head.getWorldPosition(_head);
  const hx = _head.x;
  const hz = _head.z;
  player.rotation.y += deltaYaw;
  const offX = hx - player.position.x;
  const offZ = hz - player.position.z;
  const cos = Math.cos(deltaYaw);
  const sin = Math.sin(deltaYaw);
  player.position.x = hx - (offX * cos + offZ * sin);
  player.position.z = hz - (-offX * sin + offZ * cos);
}

function inTeleportArea(x: number, z: number): boolean {
  return TELEPORT_AREAS.some((a) => x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ);
}

/** Do segments AB and CD properly cross? (Collinear/endpoint touches don't
 *  count — grazing a doorway edge shouldn't block the hop.) */
function segmentsCross(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
    (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(cx, cz, dx, dz, ax, az);
  const d2 = o(cx, cz, dx, dz, bx, bz);
  const d3 = o(ax, az, bx, bz, cx, cz);
  const d4 = o(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Does the straight path (x0,z0)→(x1,z1) cross any solid wall? */
function crossesWall(x0: number, z0: number, x1: number, z1: number): boolean {
  return WALL_SEGMENTS.some(([ax, az, bx, bz]) => segmentsCross(x0, z0, x1, z1, ax, az, bx, bz));
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
  private arc!: Line2;
  private arcGeo!: LineGeometry;
  private arcMat!: LineMaterial;
  private arcBuf = new Array<number>(TELEPORT.arcPoints * 3).fill(0);
  private marker!: Group;
  private markerMat!: MeshBasicMaterial;
  private arrowMat!: MeshBasicMaterial;
  private landing = new Vector3();
  private landingYaw = 0;
  private valid = false;
  private spawned = false;
  /** Snap turn fires once per flick: armed again only after the stick recentres. */
  private snapArmed = true;

  init(): void {
    // Arc line — a fat world-unit ribbon (LineBasicMaterial ignores width).
    this.arcGeo = new LineGeometry();
    this.arcGeo.setPositions(this.arcBuf);
    this.arcMat = new LineMaterial({
      color: PALETTE.amber,
      linewidth: 0.016, // metres — reads as proper neon tubing
      worldUnits: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.arc = new Line2(this.arcGeo, this.arcMat);
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
    // The full platform footprint was huge underfoot — shrink the whole
    // marker (octagon + arrow) to a compact puck.
    this.marker.scale.setScalar(0.42);
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

    // Not mid-aim? An isolated sideways flick is a snap turn (forward/back is
    // left for teleport; sideways WHILE aiming steers facing, handled below).
    if (!this.aimingHand && this.trySnapTurn()) return;

    // Pick / keep the aiming hand. A teleport only STARTS on a forward/back
    // push (vertical-dominant) so a sideways flick stays free for snap turn;
    // once aiming, the stick angle still steers the landing facing.
    let axes: { x: number; y: number } | null = null;
    if (this.aimingHand) {
      const a = this.input.xr.gamepads[this.aimingHand]?.getAxesValues(InputComponent.Thumbstick);
      axes = a ?? null;
    } else {
      for (const hand of ['left', 'right'] as const) {
        const a = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick);
        if (a && Math.hypot(a.x, a.y) >= TELEPORT.engage && Math.abs(a.y) >= Math.abs(a.x)) {
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
        // Landing on the exit mat walks you back out to the main menu.
        if (
          this.landing.x >= EXIT_ZONE.minX && this.landing.x <= EXIT_ZONE.maxX &&
          this.landing.z >= EXIT_ZONE.minZ && this.landing.z <= EXIT_ZONE.maxZ
        ) {
          this.hide();
          const go = (): void => window.location.assign('index.html');
          const session = this.world.session as XRSession | undefined;
          if (session) void Promise.resolve(session.end()).then(go, go);
          else go();
          return;
        }
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
    const buf = this.arcBuf;
    const put = (i: number): void => {
      buf[i * 3] = _p.x;
      buf[i * 3 + 1] = _p.y;
      buf[i * 3 + 2] = _p.z;
    };
    let landed = false;
    for (let i = 0; i < TELEPORT.arcPoints; i++) {
      put(i);
      if (landed) continue;
      _v.y -= TELEPORT.gravity * TELEPORT.arcStep;
      _p.addScaledVector(_v, TELEPORT.arcStep);
      if (_p.y <= 0) {
        _p.y = 0;
        landed = true;
        this.landing.copy(_p);
        // Pin the remaining points at the landing spot so the ribbon stops.
        for (let j = i + 1; j < TELEPORT.arcPoints; j++) {
          buf[j * 3] = _p.x;
          buf[j * 3 + 1] = _p.y;
          buf[j * 3 + 2] = _p.z;
        }
        break;
      }
    }
    if (!landed) {
      // Arc never reached the floor (pointing at the ceiling) — invalid.
      this.landing.copy(_p);
    }
    this.arcGeo.setPositions(buf);

    // Valid only if it lands on floor AND the straight path there doesn't phase
    // through a wall (you must go through the doorway, not the wall beside it).
    this.player.head.getWorldPosition(_head);
    this.valid =
      landed &&
      inTeleportArea(this.landing.x, this.landing.z) &&
      !crossesWall(_head.x, _head.z, this.landing.x, this.landing.z);

    // Facing: thumbstick angle relative to where the controller points.
    const ctrlYaw = Math.atan2(-_dir.x, -_dir.z);
    const stickAngle = Math.atan2(axes.x, -axes.y); // 0 = pushed forward
    this.landingYaw = ctrlYaw - stickAngle;

    // Show it.
    const colour = this.valid ? PALETTE.amber : PALETTE.danger;
    this.markerMat.color.set(colour);
    this.arrowMat.color.set(colour);
    this.arcMat.color.set(colour);
    this.marker.position.set(this.landing.x, 0.01, this.landing.z);
    this.marker.rotation.y = this.landingYaw;
    this.marker.visible = true;
    this.arc.visible = true;
  }

  /**
   * An isolated left/right flick of either stick yaws the rig by snapAngle.
   * One turn per flick: the stick must spring back below snapReset to re-arm,
   * so holding it sideways doesn't spin you. Returns true if it turned.
   */
  private trySnapTurn(): boolean {
    let sx = 0;
    let sy = 0;
    let mag = 0;
    for (const hand of ['left', 'right'] as const) {
      const a = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick);
      if (!a) continue;
      const m = Math.hypot(a.x, a.y);
      if (m > mag) {
        mag = m;
        sx = a.x;
        sy = a.y;
      }
    }
    if (mag < TELEPORT.snapReset) {
      this.snapArmed = true;
      return false;
    }
    // A clear sideways flick past the threshold — turn the way it's pushed
    // (stick right yaws you right, which is a NEGATIVE rotation about +y).
    if (this.snapArmed && Math.abs(sx) >= TELEPORT.snapEngage && Math.abs(sx) > Math.abs(sy)) {
      this.snapArmed = false;
      snapTurn(this.player, sx > 0 ? -TELEPORT.snapAngle : TELEPORT.snapAngle);
      uiClick();
      return true;
    }
    return false;
  }

  private hide(): void {
    this.aimingHand = null;
    this.valid = false;
    this.arc.visible = false;
    this.marker.visible = false;
  }
}
