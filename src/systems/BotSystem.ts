/**
 * The practice bot. It does NOT move an entity — it writes the opponent pose
 * bus (head/hand poses) like a phantom player and queues ball commands, so
 * downstream (OpponentSystem, FireballSystem, CollisionSystem) treats it
 * exactly like a remote human. That keeps bot bouts and online bouts on one
 * code path.
 *
 * Behaviour: strafes and bobs on its platform, reactively dodges your
 * incoming balls, keeps a boxing guard, winds a ball up (orbit) and hurls it
 * at your head/chest on a cadence, then recalls it.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { Fireball, BallState } from '../components/Fireball.js';
import { ballCommands, opponent } from '../combat/opponentBus.js';
import { match } from '../combat/matchState.js';
import { app } from '../menu/appState.js';
import { ARENA_GAP, BOT, FIREBALL } from '../config.js';

const _head = new Vector3();
const _ballPos = new Vector3();
const _aim = new Vector3();
const _vel = new Vector3();
const _look = new Quaternion();
const _pitchQ = new Quaternion();
const _tmp = new Vector3();
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class BotSystem extends createSystem({
  balls: { required: [Fireball] },
}) {
  // Where the bot is drifting to (its own local frame: x lateral, y head
  // height, z forward/back across its pad depth).
  private targetX = 0;
  private targetY = BOT.headY;
  private targetZ = 0;
  private x = 0;
  private y = BOT.headY;
  private z = 0;
  private moveTimer = 1;
  private throwTimer = BOT.throwInterval;
  private windupHand: 0 | 1 = 0;
  private windup = -1; // <0 idle, else counts down to release
  private recallTimers: [number, number] = [-1, -1];
  private guardPhase = 0;

  update(delta: number): void {
    if (app.state !== 'playing' || app.mode !== 'bot') return;
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    headObj.getWorldPosition(_head);

    this.move(delta);
    this.pose(delta);
    if (match.phase === 'playing') {
      this.fight(delta);
    } else {
      this.windup = -1;
      opponent.orbiting[0] = opponent.orbiting[1] = false;
    }
  }

  /** Strafe + duck targets, with reactive dodges off your incoming balls. */
  private move(delta: number): void {
    this.moveTimer -= delta;
    if (this.moveTimer <= 0) {
      const r = Math.random();
      if (r < 0.2) this.targetX = this.x + (Math.random() * 0.5 - 0.25);
      else if (r < 0.45) this.targetX = Math.random() * 0.6 - 0.3;
      else this.targetX = (Math.random() * 2 - 1) * BOT.padHalfWidth;
      this.targetX = clamp(this.targetX, -BOT.padHalfWidth, BOT.padHalfWidth);

      const d = Math.random();
      if (d < 0.25) this.targetY = BOT.headYMin + Math.random() * 0.2;
      else if (d < 0.4) this.targetY = BOT.headYMax - Math.random() * 0.1;
      else this.targetY = BOT.headY + (Math.random() * 0.24 - 0.12);
      this.targetY = clamp(this.targetY, BOT.headYMin, BOT.headYMax);

      // Forward pressure / backpedal across the pad depth too.
      this.targetZ = clamp((Math.random() * 2 - 1) * 0.5, -0.5, 0.5);

      this.moveTimer = Math.random() < 0.3 ? 0.35 + Math.random() * 0.5 : 0.9 + Math.random() * 1.1;
    }

    // Reactive dodge: your flying balls within react range push it away.
    for (const ball of this.queries.balls.entities) {
      if ((ball.getValue(Fireball, 'owner') ?? 0) !== 0) continue;
      if ((ball.getValue(Fireball, 'state') ?? 0) !== BallState.Flying) continue;
      const obj = ball.object3D;
      if (!obj) continue;
      obj.getWorldPosition(_ballPos);
      _tmp.set(this.x, this.y, -ARENA_GAP + this.z);
      if (_ballPos.distanceTo(_tmp) < BOT.reactDistance) {
        const away = Math.sign(this.x - _ballPos.x) || (Math.random() < 0.5 ? -1 : 1);
        this.targetX = clamp(this.x + away * 0.6, -BOT.padHalfWidth, BOT.padHalfWidth);
        this.targetY = _ballPos.y > this.y - 0.15 ? BOT.headYMin : BOT.headYMax;
        this.targetZ = -0.5; // and give ground
        break;
      }
    }

    const stepX = BOT.moveSpeed * delta;
    const dx = this.targetX - this.x;
    this.x += Math.abs(dx) <= stepX ? dx : Math.sign(dx) * stepX;
    const stepY = BOT.duckSpeed * delta;
    const dy = this.targetY - this.y;
    this.y += Math.abs(dy) <= stepY ? dy : Math.sign(dy) * stepY;
    const stepZ = BOT.moveSpeed * 0.8 * delta;
    const dz = this.targetZ - this.z;
    this.z += Math.abs(dz) <= stepZ ? dz : Math.sign(dz) * stepZ;
  }

  /** Write the phantom body onto the opponent bus. */
  private pose(delta: number): void {
    this.guardPhase += delta;
    const z = -ARENA_GAP + this.z;

    opponent.headPos.set(this.x, this.y, z);
    // Look toward the player as a STABLE yaw + clamped pitch (no roll). A
    // direct look-at sat right in setFromUnitVectors' antiparallel blind spot
    // — the bot faces +z, its default forward is −z — so the tiniest of your
    // moves swung the rotation axis and the head spun/rolled. atan2 yaw never
    // flips, and the pitch clamp stops it owl-necking up at you.
    _tmp.copy(_head).sub(opponent.headPos);
    const yaw = Math.atan2(-_tmp.x, -_tmp.z);
    const horiz = Math.hypot(_tmp.x, _tmp.z) || 1e-4;
    const pitch = clamp(Math.atan2(_tmp.y, horiz), -BOT.headPitchMax, BOT.headPitchMax);
    _look.setFromAxisAngle(UP, yaw).multiply(_pitchQ.setFromAxisAngle(RIGHT, pitch));
    opponent.headQuat.slerp(_look, Math.min(1, delta * BOT.headTurnSpeed));

    // Boxing guard: fists up in front of the chin, gently pumping; the
    // winding hand pulls back and high.
    for (const hand of [0, 1] as const) {
      const side = hand === 0 ? 1 : -1; // mirrored: their left is your right
      const bob = Math.sin(this.guardPhase * 2.4 + hand * 1.7) * 0.02;
      const winding = this.windup >= 0 && this.windupHand === hand;
      const gx = this.x + side * (winding ? 0.34 : 0.22);
      const gy = this.y - (winding ? 0.05 : 0.18) + bob;
      const gz = z + (winding ? 0.16 : -0.18); // wind back, guard forward
      opponent.handPos[hand].lerp(_tmp.set(gx, gy, gz), Math.min(1, delta * 9));
      opponent.handQuat[hand].copy(opponent.headQuat);
      opponent.fisting[hand] = false;
    }
  }

  /** Cadenced wind-up → throw → recall, alternating fists. */
  private fight(delta: number): void {
    // Recalls.
    for (const hand of [0, 1] as const) {
      if (this.recallTimers[hand] >= 0) {
        this.recallTimers[hand] -= delta;
        if (this.recallTimers[hand] < 0) {
          ballCommands.push({ type: 'recall', hand });
        }
      }
    }

    if (this.windup >= 0) {
      this.windup -= delta;
      if (this.windup < 0) this.release();
      return;
    }

    this.throwTimer -= delta;
    if (this.throwTimer <= 0) {
      this.throwTimer = BOT.throwInterval * (0.8 + Math.random() * 0.5);
      this.windupHand = this.windupHand === 0 ? 1 : 0;
      this.windup = BOT.windup;
      opponent.orbiting[this.windupHand] = true;
    }
  }

  private release(): void {
    const hand = this.windupHand;
    opponent.orbiting[hand] = false;

    // Aim at the player's head with some slop, biased a little low (chest).
    _aim.copy(_head);
    _aim.y -= 0.15;
    _aim.x += (Math.random() - 0.5) * 2 * BOT.aimError;
    _aim.y += (Math.random() - 0.5) * 2 * BOT.aimError;

    const from = opponent.handPos[hand].clone();
    _vel.copy(_aim).sub(from);
    const dist = _vel.length();
    _vel.normalize().multiplyScalar(BOT.throwSpeed);
    // Lead the gravity drop so the arc lands on target.
    _vel.y += 0.5 * FIREBALL.gravity * (dist / BOT.throwSpeed);

    ballCommands.push({ type: 'throw', hand, pos: from, vel: _vel.clone() });
    this.recallTimers[hand] = BOT.recallDelay;
  }
}
