/**
 * Sphere-vs-sphere collision for everything that burns:
 *
 *  - ENEMY flying balls vs YOUR body hitboxes — always resolved locally
 *    (victim-authoritative online: each client rules on hits against itself,
 *    which keeps dodging fair under latency). On a hit we damage ourselves,
 *    flash the vignette, buzz both hands and tell the thrower (`hit`).
 *  - YOUR flying balls vs the opponent's hitboxes — resolved locally only in
 *    bot bouts; online, the rival's client reports the hit back to us.
 *  - PARRY: an incoming enemy ball that touches one of your ORBITING or
 *    RETURNING balls is slapped out of the air (`deflect` sent online).
 *  - Training: your flying balls vs pop-up targets (handled by marking the
 *    target; TrainingSystem owns scoring/animation).
 */

import { createSystem, Vector3, type Entity } from '@iwsdk/core';
import { BallState, Fireball } from '../components/Fireball.js';
import { Hitbox } from '../components/Hitbox.js';
import { Health } from '../components/Health.js';
import { TargetState, TrainingTarget } from '../components/TrainingTarget.js';
import { spawnFireImpact } from '../fx/effects.js';
import { emberBurst } from '../fx/fire.js';
import { feedback } from '../fx/feedback.js';
import { pulseHand } from '../input/haptics.js';
import { app } from '../menu/appState.js';
import { match } from '../combat/matchState.js';
import { net } from '../net/client.js';
import * as sfx from '../audio/sfx.js';
import { FIREBALL } from '../config.js';

const _ballPos = new Vector3();
const _otherPos = new Vector3();

export class CollisionSystem extends createSystem({
  balls: { required: [Fireball] },
  hitboxes: { required: [Hitbox] },
  targets: { required: [TrainingTarget] },
}) {
  update(): void {
    const inMatch = app.state === 'playing' && match.phase === 'playing';
    const inTraining = app.state === 'training';
    if (!inMatch && !inTraining) return;

    const balls = [...this.queries.balls.entities];
    const hitboxes = [...this.queries.hitboxes.entities];

    for (const ball of balls) {
      const obj = ball.object3D;
      if (!obj || !obj.visible) continue;
      const state = ball.getValue(Fireball, 'state') ?? 0;
      if (state !== BallState.Flying) continue;

      obj.getWorldPosition(_ballPos);
      const owner = ball.getValue(Fireball, 'owner') ?? 0;
      const radius = ball.getValue(Fireball, 'radius') ?? FIREBALL.radius;
      const damage = ball.getValue(Fireball, 'damage') ?? FIREBALL.damage;

      if (owner === 1) {
        // Parry first: your roaring orbit is also your shield.
        if (this.tryParry(ball, balls, radius)) continue;
        this.enemyBallVsMe(ball, hitboxes, radius, damage);
      } else if (inMatch && app.mode === 'bot') {
        this.myBallVsOpponent(ball, hitboxes, radius, damage);
      } else if (inTraining) {
        this.myBallVsTargets(ball, radius);
      }
      // Online (`mode === 'net'`): hits on the rival are ruled by THEIR
      // client and arrive as a `hit` message — see NetworkSystem.
    }
  }

  /** An enemy ball connecting with one of my body hitboxes. */
  private enemyBallVsMe(ball: Entity, hitboxes: Entity[], radius: number, damage: number): void {
    for (const hitbox of hitboxes) {
      if ((hitbox.getValue(Hitbox, 'team') ?? 0) !== 0) continue;
      const hbObj = hitbox.object3D;
      if (!hbObj) continue;
      hbObj.getWorldPosition(_otherPos);
      const reach = radius + (hitbox.getValue(Hitbox, 'radius') ?? 0.2);
      if (_ballPos.distanceToSquared(_otherPos) > reach * reach) continue;

      const me = (hitbox.getValue(Hitbox, 'owner') as Entity | null) ?? hitbox;
      this.applyDamage(me, damage);
      spawnFireImpact(this.world, _ballPos, 1);
      sfx.hitTaken();
      feedback.playerHitFlash = 1;
      const v = ball.getVectorView(Fireball, 'velocity');
      const len = Math.hypot(v[0], v[1], v[2]) || 1;
      feedback.srcX = -v[0] / len;
      feedback.srcY = -v[1] / len;
      feedback.srcZ = -v[2] / len;
      pulseHand(this.world.session, 'left', 0.7, 110);
      pulseHand(this.world.session, 'right', 0.7, 110);

      this.spendBall(ball);
      if (app.mode === 'net' && app.state === 'playing') {
        net.send({ k: 'hit', hand: (ball.getValue(Fireball, 'hand') ?? 0) as 0 | 1, dmg: damage });
      }
      return;
    }
  }

  /** My ball connecting with the bot's body. */
  private myBallVsOpponent(ball: Entity, hitboxes: Entity[], radius: number, damage: number): void {
    for (const hitbox of hitboxes) {
      if ((hitbox.getValue(Hitbox, 'team') ?? 0) !== 1) continue;
      const hbObj = hitbox.object3D;
      if (!hbObj) continue;
      hbObj.getWorldPosition(_otherPos);
      const reach = radius + (hitbox.getValue(Hitbox, 'radius') ?? 0.2);
      if (_ballPos.distanceToSquared(_otherPos) > reach * reach) continue;

      const them = (hitbox.getValue(Hitbox, 'owner') as Entity | null) ?? hitbox;
      this.applyDamage(them, damage);
      spawnFireImpact(this.world, _ballPos, 0);
      sfx.hitDealt();
      app.stats.hitsLanded += 1;
      this.spendBall(ball);
      return;
    }
  }

  /** My ball vs the pop-up targets: mark the hit, TrainingSystem scores it. */
  private myBallVsTargets(ball: Entity, radius: number): void {
    for (const target of this.queries.targets.entities) {
      const state = target.getValue(TrainingTarget, 'state') ?? 0;
      if (state !== TargetState.Rising && state !== TargetState.Holding) continue;
      const tObj = target.object3D;
      if (!tObj) continue;
      tObj.getWorldPosition(_otherPos);
      _otherPos.y = target.getValue(TrainingTarget, 'upY') ?? _otherPos.y;
      const reach = radius + (target.getValue(TrainingTarget, 'radius') ?? 0.18);
      if (_ballPos.distanceToSquared(_otherPos) > reach * reach) continue;

      target.setValue(TrainingTarget, 'state', TargetState.Falling);
      target.setValue(TrainingTarget, 'age', 0);
      spawnFireImpact(this.world, _ballPos, 0);
      sfx.hitDealt();
      app.stats.hitsLanded += 1;
      this.spendBall(ball);
      return;
    }
  }

  /** Enemy ball vs my orbiting/returning balls → slapped out of the air. */
  private tryParry(enemyBall: Entity, balls: Entity[], radius: number): boolean {
    for (const mine of balls) {
      if ((mine.getValue(Fireball, 'owner') ?? 0) !== 0) continue;
      const st = mine.getValue(Fireball, 'state') ?? 0;
      if (st !== BallState.Orbit && st !== BallState.Returning) continue;
      const mObj = mine.object3D;
      if (!mObj) continue;
      mObj.getWorldPosition(_otherPos);
      const reach = radius + (mine.getValue(Fireball, 'radius') ?? FIREBALL.radius) + FIREBALL.deflectBonus;
      if (_ballPos.distanceToSquared(_otherPos) > reach * reach) continue;

      emberBurst(_ballPos, 22, true);
      spawnFireImpact(this.world, _ballPos, 1);
      sfx.deflect();
      const hand = mine.getValue(Fireball, 'hand') === 0 ? 'left' : 'right';
      pulseHand(this.world.session, hand, 0.9, 120);
      this.spendBall(enemyBall);
      if (app.mode === 'net' && app.state === 'playing') {
        net.send({ k: 'deflect', hand: (enemyBall.getValue(Fireball, 'hand') ?? 0) as 0 | 1 });
      }
      return true;
    }
    return false;
  }

  /** Retire a ball that just connected: transients die, bound balls drop Dead. */
  private spendBall(ball: Entity): void {
    if ((ball.getValue(Fireball, 'transient') ?? 0) === 1) {
      ball.destroy();
      return;
    }
    ball.setValue(Fireball, 'state', BallState.Dead);
    const v = ball.getVectorView(Fireball, 'velocity');
    v[0] = 0; v[1] = 0; v[2] = 0;
  }

  private applyDamage(combatant: Entity, damage: number): void {
    if (!combatant.active || !combatant.hasComponent(Health)) return;
    const next = (combatant.getValue(Health, 'current') ?? 0) - damage;
    combatant.setValue(Health, 'current', Math.max(0, next));
  }
}
