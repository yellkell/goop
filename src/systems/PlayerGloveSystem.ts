/**
 * Your boxing gloves: an ember-orange glove locked to each controller grip
 * whenever you're in the arena (bout or training). The fists are aimed along
 * the controller's POINTING ray (not the tilted grip pose, which left the
 * knuckles facing the ceiling), their LEDs flare while you squeeze trigger or
 * grip, and they squash slightly under the squeeze. Hidden in the lobby so
 * the menu lasers read clearly.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Quaternion, type Group } from 'three';
import { setGloveLit } from '../avatar/boxer.js';
import { buildHand, HAND_ADDUCTION, setHandCurl } from '../avatar/hands.js';
import { applyAvatarSkin, avatarSkin } from '../avatar/skins.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { app } from '../menu/appState.js';
import { customization } from '../menu/customization.js';

const HANDS = ['left', 'right'] as const;

const _gripQ = new Quaternion();
const _rayQ = new Quaternion();

export class PlayerGloveSystem extends createSystem({
  balls: { required: [Fireball] },
}) {
  private gloves: Partial<Record<'left' | 'right', Group>> = {};

  /** True while this hand's bound ball is homing back to it. */
  private ballReturning(hand: 0 | 1): boolean {
    for (const e of this.queries.balls.entities) {
      if (
        (e.getValue(Fireball, 'owner') ?? 0) === 0 &&
        (e.getValue(Fireball, 'hand') ?? 0) === hand &&
        (e.getValue(Fireball, 'transient') ?? 0) === 0
      ) {
        return (e.getValue(Fireball, 'state') ?? 0) === BallState.Returning;
      }
    }
    return false;
  }

  update(delta: number): void {
    const show = app.state === 'playing' || app.state === 'training';
    for (const hand of HANDS) {
      const grip = this.world.playerSpaceEntities.gripSpaces[hand]?.object3D;
      if (!grip) continue;

      let glove = this.gloves[hand];
      if (!glove) {
        glove = buildHand(hand === 'left' ? 1 : -1);
        glove.name = `player-glove-${hand}`;
        applyAvatarSkin(glove, avatarSkin(customization.avatar));
        grip.add(glove);
        this.gloves[hand] = glove;
      }
      glove.visible = show;
      if (!show) continue;

      // Knuckles down the pointing ray: cancel the grip tilt, take the ray's
      // orientation (the glove model punches along its local -Z).
      const ray = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
      if (ray) {
        grip.getWorldQuaternion(_gripQ);
        ray.getWorldQuaternion(_rayQ);
        glove.quaternion.copy(_gripQ).invert().multiply(_rayQ).multiply(HAND_ADDUCTION[hand === 'left' ? 0 : 1]);
      }

      // Trigger and grip are one action — either one ignites the fist. The
      // white bloom also stays hot through a RETURN: a tapped recall keeps
      // the hand visibly active until the ball is back in it.
      const gp = this.input.xr.gamepads[hand];
      const trig = gp?.getButtonValue(InputComponent.Trigger) ?? 0;
      const sq = gp?.getButtonValue(InputComponent.Squeeze) ?? 0;
      const squeezing = trig > 0.5 || sq > 0.5;
      setGloveLit(glove, squeezing || this.ballReturning(hand === 'left' ? 0 : 1), delta);

      // Fingers track the real squeeze: trigger curls the index, grip the
      // rest, thumb tucks across as either closes.
      setHandCurl(
        glove,
        Math.max(trig, sq * 0.6),
        Math.max(sq, trig * 0.45),
        0.35 + Math.max(trig, sq) * 0.55,
      );
    }
  }
}
