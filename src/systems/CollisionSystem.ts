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
 *  - RETURN-PASS: a RECALLED ball that passes through a body or target on
 *    its way home ALSO connects — once per return (`returnHit` guards it) —
 *    and is NOT spent: it keeps homing back to its fist. Recalling through
 *    your opponent is a real technique.
 */

import { createSystem, Vector3, type Entity } from '@iwsdk/core';
import { BallState, Fireball } from '../components/Fireball.js';
import { Hitbox, HitboxKind } from '../components/Hitbox.js';
import { Health } from '../components/Health.js';
import { Combatant } from '../components/Combatant.js';
import { fighterTeam } from '../combat/fighters.js';
import { localLayout } from '../combat/layout.js';
import { mesh } from '../net/mesh.js';
import { TargetState, TrainingTarget } from '../components/TrainingTarget.js';
import { spawnDamagePopup, spawnFireImpact } from '../fx/effects.js';
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
/** Where the ball under test sat LAST frame — the start of its sweep. */
const _ballPrev = new Vector3();
const _seg = new Vector3();
const _ap = new Vector3();

/** Squared distance from point `p` to the segment `a`→`b`. */
function pointSegDistSq(p: Vector3, a: Vector3, b: Vector3): number {
  _seg.subVectors(b, a);
  const len2 = _seg.lengthSq();
  let t = len2 > 1e-9 ? _ap.subVectors(p, a).dot(_seg) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  _seg.multiplyScalar(t).add(a); // closest point on the segment
  return _seg.distanceToSquared(p);
}

export class CollisionSystem extends createSystem({
  balls: { required: [Fireball] },
  hitboxes: { required: [Hitbox] },
  targets: { required: [TrainingTarget] },
}) {
  /** Last frame's world position per ball, so a fast ball is tested along the
   *  PATH it travelled (a parry can't be tunnelled through between frames). */
  private prevPos = new Map<Entity, Vector3>();

  update(): void {
    const inMatch = app.state === 'playing' && match.phase === 'playing';
    const inTraining = app.state === 'training';
    if (!inMatch && !inTraining) return;

    const balls = [...this.queries.balls.entities];
    const hitboxes = [...this.queries.hitboxes.entities];
    const seen = new Map<Entity, Vector3>();

    for (const ball of balls) {
      const obj = ball.object3D;
      if (!obj || !obj.visible) continue;
      const state = ball.getValue(Fireball, 'state') ?? 0;
      const returning = state === BallState.Returning;
      if (state !== BallState.Flying && !returning) continue;
      // One connect per recall: a return-pass that already landed is inert.
      if (returning && (ball.getValue(Fireball, 'returnHit') ?? 0) === 1) continue;

      obj.getWorldPosition(_ballPos);
      // Sweep from where this ball sat last frame, so a fast return can't skip
      // past a defending ball between frames — but treat an implausibly large
      // jump (a throw/reset teleport) as a fresh point, not a swept segment.
      const prev = this.prevPos.get(ball);
      if (prev && prev.distanceToSquared(_ballPos) < 2.25) _ballPrev.copy(prev);
      else _ballPrev.copy(_ballPos);
      seen.set(ball, _ballPos.clone());

      const owner = ball.getValue(Fireball, 'owner') ?? 0;
      const ownerTeam = fighterTeam(owner);
      const radius = ball.getValue(Fireball, 'radius') ?? FIREBALL.radius;
      const damage = ball.getValue(Fireball, 'damage') ?? FIREBALL.damage;

      // Defence: any incoming ball that could hurt MY team (someone else's, on
      // a different team) can be parried by your roaring orbit/return — even on
      // its return leg — or cancelled by a mid-air clash with your thrown ball.
      if (owner !== 0 && ownerTeam !== 0) {
        if (this.tryParry(ball, balls, radius)) continue;
        if (!returning && this.tryClash(ball, balls, radius)) continue;
      }

      if (inTraining) {
        // Your balls score targets; the targets' return fire (owner 1) hits you.
        if (owner === 0) this.myBallVsTargets(ball, radius, returning);
        else this.enemyBallVsMe(ball, owner, hitboxes, radius, damage, returning);
      } else if (app.mode === 'net' && app.arcade === '1v1') {
        // Online 1v1: you rule hits against YOURSELF only; your hits on the
        // rival are ruled by THEIR client and arrive as a `hit` message.
        if (owner === 1) this.enemyBallVsMe(ball, owner, hitboxes, radius, damage, returning);
      } else if (app.mode === 'net') {
        // Arcade mesh: same victim authority for any enemy ball; the report
        // names the attacker's seat so only they spend their ball.
        if (owner !== 0 && ownerTeam !== 0) this.enemyBallVsMe(ball, owner, hitboxes, radius, damage, returning);
      } else if (app.mode === 'campaign' && app.arcade === 'raid') {
        // RAID: my sim rules only MY balls vs the titan — every raider
        // reports their own landed hits to the host (rdmg), so a squadmate's
        // RENDERED ball must never also dent my local copy of the boss.
        if (owner === 0) this.resolveLocalHit(ball, owner, ownerTeam, hitboxes, radius, damage, returning);
      } else {
        // Bot bouts (incl. arcade 2v2/FFA): one local sim is authoritative for
        // every fighter — resolve this ball against any enemy-team body.
        this.resolveLocalHit(ball, owner, ownerTeam, hitboxes, radius, damage, returning);
      }
    }

    this.prevPos = seen; // remember this frame's positions for next frame's sweep
  }

  /** An enemy ball (flying, or recalled through me) connecting with my body. */
  private enemyBallVsMe(ball: Entity, owner: number, hitboxes: Entity[], radius: number, damage: number, returning: boolean): void {
    for (const hitbox of hitboxes) {
      if ((hitbox.getValue(Hitbox, 'team') ?? 0) !== 0) continue;
      const hbObj = hitbox.object3D;
      if (!hbObj) continue;
      hbObj.getWorldPosition(_otherPos);
      const reach = radius + (hitbox.getValue(Hitbox, 'radius') ?? 0.2);
      if (_ballPos.distanceToSquared(_otherPos) > reach * reach) continue;

      const actualDamage = this.damageFor(hitbox, damage);
      const me = (hitbox.getValue(Hitbox, 'owner') as Entity | null) ?? hitbox;
      if ((me.getValue(Health, 'current') ?? 1) <= 0) return; // already down — ignore
      this.applyDamage(me, actualDamage);
      // Taking a hit is the loudest moment in the game: oversized burst,
      // extra spark spray, plate-clink sound, hard double-hand buzz. The damage
      // NUMBER is the attacker's read-out, not ours — they spawn it on landing
      // the hit (see myBallVsOpponent / the net `hit` handler), so we don't.
      spawnFireImpact(this.world, _ballPos, 1, 1.7);
      emberBurst(_ballPos, 18, true);
      sfx.hitTaken();
      feedback.playerHitFlash = 1;
      const v = ball.getVectorView(Fireball, 'velocity');
      const len = Math.hypot(v[0], v[1], v[2]) || 1;
      feedback.srcX = -v[0] / len;
      feedback.srcY = -v[1] / len;
      feedback.srcZ = -v[2] / len;
      pulseHand(this.world.session, 'left', 1.0, 160);
      pulseHand(this.world.session, 'right', 1.0, 160);

      // A return-pass keeps flying home; a thrown ball is spent on contact.
      if (returning) ball.setValue(Fireball, 'returnHit', 1);
      else this.spendBall(ball);
      if (app.mode === 'net' && app.state === 'playing') {
        const hand = (ball.getValue(Fireball, 'hand') ?? 0) as 0 | 1;
        const ret = returning ? { ret: true } : {};
        if (app.arcade === '1v1') {
          net.send({ k: 'hit', hand, dmg: actualDamage, ...ret });
        } else {
          // Arcade mesh: tag the attacker's canonical seat so only they act.
          const by = localLayout()[owner]?.canonical ?? owner;
          mesh.send({ k: 'hit', hand, dmg: actualDamage, by, ...ret });
        }
      }
      return;
    }
  }

  /**
   * Local-authority hit (bot bouts, every mode): this ball connects with the
   * BEST body it overlaps on a different team — "best" by `damageScale`, the
   * ARCADE titans' weak-point law (their exposed core sits proud of an armour
   * sphere; a punch that finds it counts as a core hit, a plain armour touch
   * clanks off for nothing). Human/bot hitboxes are all scale 1, so the duel
   * and the brawls behave exactly as before. If that body is YOU, it's a hit
   * taken (vignette + buzz); anyone else, it's a hit dealt (popup), and it
   * counts toward your stats only when the ball is yours.
   */
  private resolveLocalHit(
    ball: Entity,
    owner: number,
    ownerTeam: number,
    hitboxes: Entity[],
    radius: number,
    damage: number,
    returning: boolean,
  ): void {
    let best: Entity | null = null;
    let bestScale = -1;
    for (const hitbox of hitboxes) {
      if ((hitbox.getValue(Hitbox, 'team') ?? 0) === ownerTeam) continue; // same team — no friendly fire
      const hbObj = hitbox.object3D;
      if (!hbObj) continue;
      hbObj.getWorldPosition(_otherPos);
      const reach = radius + (hitbox.getValue(Hitbox, 'radius') ?? 0.2);
      if (_ballPos.distanceToSquared(_otherPos) > reach * reach) continue;
      const victim = (hitbox.getValue(Hitbox, 'owner') as Entity | null) ?? hitbox;
      if ((victim.getValue(Health, 'current') ?? 1) <= 0) continue; // already down
      const scale = hitbox.getValue(Hitbox, 'damageScale') ?? 1;
      if (scale > bestScale) {
        bestScale = scale;
        best = hitbox;
      }
    }
    if (!best) return;

    if (bestScale <= 0) {
      // Titan armour: the ball is spent against the plate — sparks, no damage.
      emberBurst(_ballPos, 10, true);
      sfx.armorClank();
      if (returning) ball.setValue(Fireball, 'returnHit', 1);
      else this.spendBall(ball);
      return;
    }

    {
      const hitbox = best;
      const actualDamage = Math.round(this.damageFor(hitbox, damage) * bestScale);
      const victim = (hitbox.getValue(Hitbox, 'owner') as Entity | null) ?? hitbox;
      this.applyDamage(victim, actualDamage);

      const victimIsMe = (victim.getValue(Combatant, 'slot') ?? -1) === 0;
      if (victimIsMe) {
        spawnFireImpact(this.world, _ballPos, 1, 1.7);
        emberBurst(_ballPos, 18, true);
        sfx.hitTaken();
        feedback.playerHitFlash = 1;
        const v = ball.getVectorView(Fireball, 'velocity');
        const len = Math.hypot(v[0], v[1], v[2]) || 1;
        feedback.srcX = -v[0] / len;
        feedback.srcY = -v[1] / len;
        feedback.srcZ = -v[2] / len;
        pulseHand(this.world.session, 'left', 1.0, 160);
        pulseHand(this.world.session, 'right', 1.0, 160);
      } else {
        spawnFireImpact(this.world, _ballPos, 0);
        spawnDamagePopup(this.world, _ballPos, actualDamage);
        if (bestScale > 1) sfx.coreHit(); // a titan weak point, rung loud
        else sfx.hitDealt();
        if (owner === 0) app.stats.hitsLanded += 1;
      }

      if (returning) ball.setValue(Fireball, 'returnHit', 1);
      else this.spendBall(ball);
      return;
    }
  }

  /** My ball vs the pop-up targets: mark the hit, TrainingSystem scores it. */
  private myBallVsTargets(ball: Entity, radius: number, returning: boolean): void {
    for (const target of this.queries.targets.entities) {
      const state = target.getValue(TrainingTarget, 'state') ?? 0;
      if (state !== TargetState.Rising && state !== TargetState.Holding) continue;
      const tObj = target.object3D;
      if (!tObj) continue;
      // Hit the target where it actually IS — a rising target used to count
      // as fully raised (its hitbox sat at upY) before it visually got there.
      tObj.getWorldPosition(_otherPos);
      const reach = radius + (target.getValue(TrainingTarget, 'radius') ?? 0.18);
      if (_ballPos.distanceToSquared(_otherPos) > reach * reach) continue;

      target.setValue(TrainingTarget, 'state', TargetState.Falling);
      target.setValue(TrainingTarget, 'age', 0);
      spawnFireImpact(this.world, _ballPos, 0);
      sfx.trainingTargetHit((target.getValue(TrainingTarget, 'kind') ?? 0) as 0 | 1 | 2);
      app.stats.hitsLanded += 1;
      if (returning) ball.setValue(Fireball, 'returnHit', 1);
      else this.spendBall(ball);
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
      // Test my defending ball against the enemy ball's whole swept path this
      // frame, not just its current point — that's what lets you block a fast
      // returning ball instead of it tunnelling clean through your guard.
      if (pointSegDistSq(_otherPos, _ballPrev, _ballPos) > reach * reach) continue;

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

  /**
   * Two FLYING balls (one of theirs, one of mine) meeting mid-air block each
   * other: both are spent on the spot with an iron-on-iron clink. Online the
   * peer is told via `clash` so both sims agree both balls died.
   */
  private tryClash(enemyBall: Entity, balls: Entity[], radius: number): boolean {
    for (const mine of balls) {
      if ((mine.getValue(Fireball, 'owner') ?? 0) !== 0) continue;
      if ((mine.getValue(Fireball, 'state') ?? 0) !== BallState.Flying) continue;
      const mObj = mine.object3D;
      if (!mObj || !mObj.visible) continue;
      mObj.getWorldPosition(_otherPos);
      const reach = radius + (mine.getValue(Fireball, 'radius') ?? FIREBALL.radius) + FIREBALL.deflectBonus;
      if (_ballPos.distanceToSquared(_otherPos) > reach * reach) continue;

      // Sparks in both fire colours — the clash belongs to nobody.
      emberBurst(_ballPos, 14, true);
      emberBurst(_ballPos, 14, false);
      spawnFireImpact(this.world, _ballPos, 0, 1.2);
      sfx.ballClash();
      this.spendBall(mine);
      this.spendBall(enemyBall);
      if (app.mode === 'net' && app.state === 'playing') {
        net.send({
          k: 'clash',
          mine: (mine.getValue(Fireball, 'hand') ?? 0) as 0 | 1,
          yours: (enemyBall.getValue(Fireball, 'hand') ?? 0) as 0 | 1,
        });
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
    ball.setValue(Fireball, 'recallLock', FIREBALL.recallLockout);
    const v = ball.getVectorView(Fireball, 'velocity');
    v[0] = 0; v[1] = 0; v[2] = 0;
  }

  private applyDamage(combatant: Entity, damage: number): void {
    if (!combatant.active || !combatant.hasComponent(Health)) return;
    const next = (combatant.getValue(Health, 'current') ?? 0) - damage;
    combatant.setValue(Health, 'current', Math.max(0, next));
  }

  private damageFor(hitbox: Entity, baseDamage: number): number {
    const isHead = (hitbox.getValue(Hitbox, 'kind') ?? HitboxKind.Body) === HitboxKind.Head;
    // A headshot adds a FLAT bonus on top of whatever the ball would deal to
    // the body — the same +5 a normal ball gets (head 25 vs body 20). So an
    // attachment shot to the head is its body damage + 5: a 1/3-damage split
    // shard landing on the head deals body+5 (e.g. 7 → 12), not a near-useless
    // ×1.25 (7 → 9). Per-ball collision means this only lands on the split
    // shards that actually hit the head. Round to a clean whole number.
    const headBonus = FIREBALL.headDamage - FIREBALL.damage; // +5
    const raw = isHead ? baseDamage + headBonus : baseDamage;
    return Math.round(raw);
  }
}
