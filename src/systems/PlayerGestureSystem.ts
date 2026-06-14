/**
 * Social hand gestures in the arena.
 *
 * Clap is local physical feedback. Self fist bumps pop GG when both clenched
 * hands meet. Opponent fist bump works during a match: true fist contact if
 * the hands get close, plus a strict same-lane/extended-forward test because
 * the arena gap makes literal mesh contact impractical.
 */

import { createSystem, InputComponent, Vector3 } from '@iwsdk/core';
import { opponent } from '../combat/opponentBus.js';
import { spawnGestureCue, spawnPopup } from '../fx/effects.js';
import { pulseHand } from '../input/haptics.js';
import { app } from '../menu/appState.js';
import * as sfx from '../audio/sfx.js';
import { ARENA_GAP } from '../config.js';

const CLAP_DISTANCE = 0.16;
const CLAP_CLOSING_SPEED = 0.75;
const CLAP_COMBINED_SPEED = 1.1;
const CLAP_COOLDOWN = 0.55;

const FIST_TOUCH_DISTANCE = 0.32;
const FIST_LANE_RADIUS = 0.36;
const FIST_FORWARD_REACH = 0.45;
const FIST_BUMP_COOLDOWN = 1.25;

const _left = new Vector3();
const _right = new Vector3();
const _mid = new Vector3();

export class PlayerGestureSystem extends createSystem({}) {
  private prevLeft = new Vector3();
  private prevRight = new Vector3();
  private prevDistance = 0;
  private hasPrev = false;
  private clapCooldown = 0;
  private fistBumpCooldown = 0;

  update(delta: number): void {
    const active = app.state === 'playing' || app.state === 'training';
    if (!active) {
      this.hasPrev = false;
      return;
    }

    const leftGrip = this.world.playerSpaceEntities.gripSpaces.left?.object3D;
    const rightGrip = this.world.playerSpaceEntities.gripSpaces.right?.object3D;
    if (!leftGrip || !rightGrip) {
      this.hasPrev = false;
      return;
    }

    leftGrip.getWorldPosition(_left);
    rightGrip.getWorldPosition(_right);
    this.clapCooldown = Math.max(0, this.clapCooldown - delta);
    this.fistBumpCooldown = Math.max(0, this.fistBumpCooldown - delta);

    this.tryClap(delta);
    this.trySelfFistBump(delta);
    this.tryFistBump();

    this.prevLeft.copy(_left);
    this.prevRight.copy(_right);
    this.prevDistance = _left.distanceTo(_right);
    this.hasPrev = true;
  }

  private tryClap(delta: number): void {
    if (!this.hasPrev || this.clapCooldown > 0 || delta <= 0) return;
    if (this.anyPressed(InputComponent.Trigger) || this.anyPressed(InputComponent.Squeeze)) return;

    const distance = _left.distanceTo(_right);
    if (distance > CLAP_DISTANCE) return;
    const closingSpeed = (this.prevDistance - distance) / delta;
    const leftSpeed = _left.distanceTo(this.prevLeft) / delta;
    const rightSpeed = _right.distanceTo(this.prevRight) / delta;
    if (closingSpeed < CLAP_CLOSING_SPEED && leftSpeed + rightSpeed < CLAP_COMBINED_SPEED) return;

    _mid.copy(_left).add(_right).multiplyScalar(0.5);
    spawnGestureCue(this.world, _mid, 0.3);
    sfx.clap();
    pulseHand(this.world.session, 'left', 0.35, 55);
    pulseHand(this.world.session, 'right', 0.35, 55);
    this.clapCooldown = CLAP_COOLDOWN;
  }

  private trySelfFistBump(delta: number): void {
    if (!this.hasPrev || this.fistBumpCooldown > 0 || delta <= 0) return;
    const leftFist = this.pressed('left', InputComponent.Squeeze) && !this.pressed('left', InputComponent.Trigger);
    const rightFist = this.pressed('right', InputComponent.Squeeze) && !this.pressed('right', InputComponent.Trigger);
    if (!leftFist || !rightFist) return;

    const distance = _left.distanceTo(_right);
    if (distance > FIST_TOUCH_DISTANCE) return;
    const closingSpeed = (this.prevDistance - distance) / delta;
    const leftSpeed = _left.distanceTo(this.prevLeft) / delta;
    const rightSpeed = _right.distanceTo(this.prevRight) / delta;
    if (closingSpeed < CLAP_CLOSING_SPEED && leftSpeed + rightSpeed < CLAP_COMBINED_SPEED) return;

    _mid.copy(_left).add(_right).multiplyScalar(0.5);
    this.emitGg(_mid, 'both');
  }

  private tryFistBump(): void {
    // Works in EVERY match phase — the bump you most want is the touch of
    // gloves between rounds and after the final bell, so don't gate it to the
    // live round (that was why "nothing happened" the moment the bell went).
    if (app.state !== 'playing' || !opponent.active || this.fistBumpCooldown > 0) return;

    const localFist: [boolean, boolean] = [
      this.pressed('left', InputComponent.Squeeze) && !this.pressed('left', InputComponent.Trigger),
      this.pressed('right', InputComponent.Squeeze) && !this.pressed('right', InputComponent.Trigger),
    ];

    let best: { local: 0 | 1; remote: 0 | 1; score: number; cue: Vector3 } | null = null;
    for (const local of [0, 1] as const) {
      if (!localFist[local]) continue;
      const localPos = local === 0 ? _left : _right;
      for (const remote of [0, 1] as const) {
        if (!opponent.fisting[remote]) continue;
        const remotePos = opponent.handPos[remote];
        const contactDistance = localPos.distanceTo(remotePos);
        const laneDistance = Math.hypot(localPos.x - remotePos.x, localPos.y - remotePos.y);
        const bothReached =
          localPos.z < -FIST_FORWARD_REACH &&
          remotePos.z > -ARENA_GAP + FIST_FORWARD_REACH &&
          laneDistance < FIST_LANE_RADIUS;
        if (contactDistance > FIST_TOUCH_DISTANCE && !bothReached) continue;
        const score = contactDistance + laneDistance;
        if (!best || score < best.score) {
          best = { local, remote, score, cue: _mid.copy(localPos).add(remotePos).multiplyScalar(0.5).clone() };
        }
      }
    }
    if (!best) return;

    this.emitGg(best.cue, best.local === 0 ? 'left' : 'right');
  }

  private emitGg(cue: Vector3, hands: 'left' | 'right' | 'both'): void {
    spawnGestureCue(this.world, cue, 0.32);
    _mid.copy(cue).y += 0.18;
    spawnPopup(this.world, _mid, 'GG', '#ffffff', 'rgba(255,255,255,0.95)', 2.4);
    sfx.fistBump();
    if (hands === 'both') {
      pulseHand(this.world.session, 'left', 0.55, 80);
      pulseHand(this.world.session, 'right', 0.55, 80);
    } else {
      pulseHand(this.world.session, hands, 0.55, 80);
    }
    this.fistBumpCooldown = FIST_BUMP_COOLDOWN;
  }

  private anyPressed(button: string): boolean {
    return this.pressed('left', button) || this.pressed('right', button);
  }

  private pressed(hand: 'left' | 'right', button: string): boolean {
    return this.input.xr.gamepads[hand]?.getButtonPressed(button) ?? false;
  }
}
