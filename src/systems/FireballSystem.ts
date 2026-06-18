/**
 * The fireball state machine — the whole game in one system.
 *
 * YOUR two balls (owner 0), one bonded to each fist:
 *  - HOVER: floats over your knuckles, smouldering.
 *  - trigger held → ORBIT: roars in a circle around your fist, spinning up.
 *  - trigger released mid-punch → FLYING: launches along your swing
 *    (blended slightly toward the opponent — aim assist), arcs with light
 *    gravity, burns out after a few seconds → DEAD on the floor.
 *  - trigger pulled while the ball is away → RETURNING: homes back to the
 *    fist; on catch it resumes ORBIT (trigger still held) or HOVER.
 *
 * THEIR two balls (owner 1) anchor to the opponent-bus hand poses and obey
 * queued commands (throw/recall/spend) from BotSystem or NetworkSystem, but
 * share the same physics below. Transient balls (training return fire) are
 * spawned by TrainingSystem and only ever FLY, then die.
 */

import { createSystem, InputComponent, Quaternion, Vector3, type Entity } from '@iwsdk/core';
import { BallState, Fireball } from '../components/Fireball.js';
import { createFireVisual, emberBurst, spawnEmber, stampTrail, type FireVisual } from '../fx/fire.js';
import { ballCommands, opponent } from '../combat/opponentBus.js';
import { match } from '../combat/matchState.js';
import { app, training } from '../menu/appState.js';
import { net } from '../net/client.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';
import { ARENA_BOUNDS, ARENA_GAP, ATTACH, FIREBALL, NET } from '../config.js';

const HANDS = ['left', 'right'] as const;
type Hand = 0 | 1;

/** Ring buffer of recent hand positions → smoothed punch velocity. */
class VelocityTracker {
  private samples: { pos: Vector3; t: number }[] = [];

  push(pos: Vector3, t: number): void {
    this.samples.push({ pos: pos.clone(), t });
    while (this.samples.length > 12) this.samples.shift();
  }

  /** Average velocity over the last ~0.1 s (out param). */
  velocity(out: Vector3, now: number): Vector3 {
    out.set(0, 0, 0);
    const newest = this.samples[this.samples.length - 1];
    if (!newest) return out;
    let oldest = newest;
    for (const s of this.samples) {
      if (now - s.t <= 0.11) {
        oldest = s;
        break;
      }
    }
    const dt = newest.t - oldest.t;
    if (dt < 1e-3) return out;
    return out.copy(newest.pos).sub(oldest.pos).multiplyScalar(1 / dt);
  }

  reset(): void {
    this.samples.length = 0;
  }
}

const _grip = new Vector3();
const _gripQ = new Quaternion();
const _anchor = new Vector3();
const _vel = new Vector3();
const _dir = new Vector3();
const _aim = new Vector3();
const _offset = new Vector3();
const _camQ = new Quaternion();
const _target = new Vector3();
const _perp1 = new Vector3();
const _perp2 = new Vector3();

interface AttachEffect {
  att: number;
  dmg: number;
  scl: number;
}
const NO_ATTACH: AttachEffect = { att: 0, dmg: FIREBALL.damage, scl: 1 };

export class FireballSystem extends createSystem({
  balls: { required: [Fireball] },
}) {
  private visuals = new Map<Entity, FireVisual>();
  private trackers: [VelocityTracker, VelocityTracker] = [new VelocityTracker(), new VelocityTracker()];
  private time = 0;
  private lastReset = -1;
  private trailAcc = new Map<Entity, number>();
  private emberAcc = 0;
  /**
   * Per-ball positional offset from a remote throw handoff: visual pos =
   * authoritative trajectory + offset, decayed to zero over ~a third of a
   * second so the launch never pops (see drainCommands / integrate Flying).
   */
  private netBlend = new Map<Entity, Vector3>();

  init(): void {
    // Your pair (orange) and the opponent's pair (blue), one per fist each.
    for (const owner of [0, 1] as const) {
      for (const hand of [0, 1] as const) {
        this.createBall(owner, hand);
      }
    }
  }

  // --- attachments (the BALL LOADOUT) ------------------------------------

  /**
   * Apply YOUR ball's equipped attachment at the moment of a live recall, and
   * return the effect to broadcast. Scaling reads `_grip` (set by the caller).
   */
  private applyAttachment(ball: Entity, hand: Hand): AttachEffect {
    const type = app.ballAttach[hand] ?? 0;
    if (!type) return NO_ATTACH;
    const dist = ball.object3D!.position.distanceTo(_grip);
    const eff = this.computeEffect(type, dist);
    this.equip(ball, 0, hand, eff);
    return eff;
  }

  /** Apply the rival's broadcast attachment onto our copy of their ball. */
  private applyAttachmentRemote(ball: Entity, hand: Hand, att: number, dmg: number, scl: number): void {
    this.equip(ball, 1, hand, { att, dmg, scl });
  }

  /** Damage/size for an attachment given the recall distance. */
  private computeEffect(type: number, dist: number): AttachEffect {
    if (type === ATTACH.split) {
      return { att: ATTACH.split, dmg: FIREBALL.damage / ATTACH.splitCount, scl: ATTACH.splitSize };
    }
    const t = Math.min(1, Math.max(0, dist / ATTACH.fullRange));
    if (type === ATTACH.grow) {
      return { att: ATTACH.grow, dmg: FIREBALL.damage - ATTACH.damageSwing * t, scl: 1 + (ATTACH.growSize - 1) * t };
    }
    return { att: ATTACH.shrink, dmg: FIREBALL.damage + ATTACH.damageSwing * t, scl: 1 - (1 - ATTACH.shrinkSize) * t };
  }

  /** Stamp an effect onto a main ball and spawn the extra balls for a split. */
  private equip(ball: Entity, owner: 0 | 1, hand: Hand, eff: AttachEffect): void {
    ball.setValue(Fireball, 'attach', eff.att);
    ball.setValue(Fireball, 'damage', eff.dmg);
    ball.setValue(Fireball, 'radius', FIREBALL.radius * eff.scl);
    ball.setValue(Fireball, 'shardIndex', 0);
    if (eff.att === ATTACH.split) {
      const pos = ball.object3D!.position;
      for (let i = 1; i < ATTACH.splitCount; i++) {
        this.spawnShard(owner, hand, i, pos, eff.dmg, FIREBALL.radius * eff.scl);
      }
    }
  }

  /** One extra split ball, born mid-air already homing for the fist. */
  private spawnShard(owner: 0 | 1, hand: Hand, index: number, pos: Vector3, damage: number, radius: number): void {
    const e = this.createBall(owner, hand);
    e.setValue(Fireball, 'shard', 1);
    e.setValue(Fireball, 'shardIndex', index);
    e.setValue(Fireball, 'attach', ATTACH.split);
    e.setValue(Fireball, 'damage', damage);
    e.setValue(Fireball, 'radius', radius);
    e.setValue(Fireball, 'state', BallState.Returning);
    e.setValue(Fireball, 'returnHit', 0);
    e.object3D!.position.copy(pos);
    e.object3D!.visible = true;
  }

  /** Recall complete (or round reset): make a main ball whole and normal. */
  private revertBall(ball: Entity): void {
    ball.setValue(Fireball, 'attach', 0);
    ball.setValue(Fireball, 'shardIndex', 0);
    ball.setValue(Fireball, 'damage', FIREBALL.damage);
    ball.setValue(Fireball, 'radius', FIREBALL.radius);
    ball.object3D?.scale.setScalar(1);
  }

  /** Destroy any split shards bound to this owner+hand. */
  private destroyShards(owner: number, hand: Hand): void {
    for (const e of [...this.queries.balls.entities]) {
      if (
        (e.getValue(Fireball, 'shard') ?? 0) === 1 &&
        (e.getValue(Fireball, 'owner') ?? 0) === owner &&
        (e.getValue(Fireball, 'hand') ?? 0) === hand
      ) {
        this.destroyBall(e);
      }
    }
  }

  /** Spawn a transient enemy ball (training return fire). */
  spawnTransient(pos: Vector3, vel: Vector3, damage: number): void {
    const e = this.createBall(1, 0);
    e.setValue(Fireball, 'transient', 1);
    e.setValue(Fireball, 'state', BallState.Flying);
    e.setValue(Fireball, 'damage', damage);
    e.object3D!.position.copy(pos);
    const v = e.getVectorView(Fireball, 'velocity');
    v[0] = vel.x; v[1] = vel.y; v[2] = vel.z;
  }

  update(delta: number): void {
    this.time += delta;
    const live = app.state === 'playing' || app.state === 'training';

    // Fresh round / mode change: park everything back at the fists.
    if (match.resetCount !== this.lastReset) {
      this.lastReset = match.resetCount;
      this.resetBalls();
    }

    this.world.camera.getWorldQuaternion(_camQ);
    this.drainCommands();

    const balls = [...this.queries.balls.entities];
    for (const ball of balls) {
      const obj = ball.object3D;
      if (!obj) continue;
      const owner = ball.getValue(Fireball, 'owner') ?? 0;
      const hand = (ball.getValue(Fireball, 'hand') ?? 0) as Hand;
      const transient = (ball.getValue(Fireball, 'transient') ?? 0) === 1;
      const shard = (ball.getValue(Fireball, 'shard') ?? 0) === 1;

      // The opponent's bound pair only exists while an opponent does.
      const visible = live && (owner === 0 || transient || (app.state === 'playing' && opponent.active));
      obj.visible = visible;
      if (!visible) {
        if (transient || shard) this.destroyBall(ball);
        continue;
      }

      const recallLock = ball.getValue(Fireball, 'recallLock') ?? 0;
      if (recallLock > 0) ball.setValue(Fireball, 'recallLock', Math.max(0, recallLock - delta));
      // Only the two bound main balls answer the trigger; shards just fly home.
      if (owner === 0 && !shard) this.updateLocalControl(ball, hand, delta);
      this.integrate(ball, hand, owner, transient, delta);
      this.updateVisual(ball, delta);
    }
  }

  // --- local player control --------------------------------------------

  private updateLocalControl(ball: Entity, hand: Hand, delta: number): void {
    const spaces = this.world.playerSpaceEntities;
    const grip = spaces.gripSpaces[HANDS[hand]]?.object3D;
    if (!grip) return;
    grip.getWorldPosition(_grip);
    grip.getWorldQuaternion(_gripQ);

    const tracker = this.trackers[hand];
    tracker.push(_grip, this.time);

    // Trigger and grip are one action: either squeeze holds the orbit.
    // Edges are PER BUTTON: many players rest a finger on the grip the
    // whole bout — a combined-state edge would swallow every trigger tap
    // (recalls silently doing nothing).
    const gp = this.input.xr.gamepads[HANDS[hand]];
    const pressed =
      (gp?.getButtonPressed(InputComponent.Trigger) ?? false) ||
      (gp?.getButtonPressed(InputComponent.Squeeze) ?? false);
    const down =
      (gp?.getButtonDown(InputComponent.Trigger) ?? false) ||
      (gp?.getButtonDown(InputComponent.Squeeze) ?? false);
    const released =
      (gp?.getButtonUp(InputComponent.Trigger) ?? false) ||
      (gp?.getButtonUp(InputComponent.Squeeze) ?? false);

    const obj = ball.object3D!;
    const state = ball.getValue(Fireball, 'state') ?? BallState.Hover;
    // Balls only come alive during a live round — no charging (or throwing) in
    // the off time between rounds / after the match. Training has no rounds.
    const roundLive = app.state === 'training' || match.phase === 'playing';

    if (down) {
      if (
        roundLive &&
        (state === BallState.Hover ||
          (state !== BallState.Dead && obj.position.distanceTo(_grip) <= FIREBALL.nearHandRadius))
      ) {
        if (state !== BallState.Orbit) {
          ball.setValue(Fireball, 'state', BallState.Orbit);
          ball.setValue(Fireball, 'spin', 0);
          sfx.ignite();
          pulseHand(this.world.session, HANDS[hand], 0.4, 60);
        }
      } else if (
        state === BallState.Flying ||
        (state === BallState.Dead && (ball.getValue(Fireball, 'recallLock') ?? 0) <= 0)
      ) {
        // Attachments only fire on a LIVE recall — a dead ball returns plain.
        const eff = state === BallState.Flying ? this.applyAttachment(ball, hand) : NO_ATTACH;
        ball.setValue(Fireball, 'state', BallState.Returning);
        ball.setValue(Fireball, 'recallLock', 0);
        // Fresh return-pass window — but ONLY for a ball recalled mid-
        // flight. A DEAD ball just landed on someone: letting its return
        // leg connect again read as an awful instant double hit.
        ball.setValue(Fireball, 'returnHit', state === BallState.Dead ? 1 : 0);
        sfx.recall();
        net.send(
          eff.att
            ? { k: 'recall', hand, att: eff.att, dmg: eff.dmg, scl: eff.scl }
            : { k: 'recall', hand },
        );
      }
    }

    if (released && state === BallState.Orbit) {
      tracker.velocity(_vel, this.time);
      const speed = _vel.length();
      if (roundLive && speed >= FIREBALL.minPunchSpeed) {
        this.throwBall(ball, hand, speed);
      } else {
        ball.setValue(Fireball, 'state', BallState.Hover);
      }
    }

    // Keep the catch check here where we know the grip pose.
    const st = ball.getValue(Fireball, 'state') ?? 0;
    if (st === BallState.Returning && obj.position.distanceTo(_grip) <= FIREBALL.catchRadius) {
      // Recall complete: the ball is whole and normal again, shards retired.
      this.revertBall(ball);
      this.destroyShards(0, hand);
      ball.setValue(Fireball, 'state', pressed ? BallState.Orbit : BallState.Hover);
      ball.setValue(Fireball, 'spin', 0);
      sfx.catchBall();
      pulseHand(this.world.session, HANDS[hand], 0.5, 70);
    }

    // Orbit spin-up timer.
    if (st === BallState.Orbit) {
      ball.setValue(Fireball, 'spin', (ball.getValue(Fireball, 'spin') ?? 0) + delta);
    }
  }

  private throwBall(ball: Entity, hand: Hand, handSpeed: number): void {
    const obj = ball.object3D!;
    _dir.copy(_vel).normalize();

    // Aim assist: blend the swing toward the opponent's chest.
    _aim.set(0, 1.25, -ARENA_GAP).sub(obj.position).normalize();
    _dir.lerp(_aim, FIREBALL.aimAssist).normalize();

    const speed = Math.min(
      FIREBALL.throwSpeedMax,
      Math.max(FIREBALL.throwSpeedMin, handSpeed * FIREBALL.punchGain),
    );
    const v = ball.getVectorView(Fireball, 'velocity');
    v[0] = _dir.x * speed;
    v[1] = _dir.y * speed;
    v[2] = _dir.z * speed;
    ball.setValue(Fireball, 'state', BallState.Flying);
    ball.setValue(Fireball, 'elapsed', 0);
    ball.setValue(Fireball, 'recallLock', 0);

    sfx.throwWhoosh();
    pulseHand(this.world.session, HANDS[hand], 0.8, 110);
    app.stats.ballsThrown += 1;
    if (app.state === 'training') training.thrown += 1;

    net.send({
      k: 'throw',
      hand,
      pos: [obj.position.x, obj.position.y, obj.position.z],
      vel: [v[0], v[1], v[2]],
    });
  }

  // --- shared physics ----------------------------------------------------

  private integrate(ball: Entity, hand: Hand, owner: number, transient: boolean, delta: number): void {
    const obj = ball.object3D!;
    const state = ball.getValue(Fireball, 'state') ?? 0;

    switch (state) {
      case BallState.Hover: {
        this.anchorFor(owner, hand);
        const k = 1 - Math.exp(-FIREBALL.hoverLerp * delta);
        obj.position.lerp(_anchor, k);
        break;
      }
      case BallState.Orbit: {
        const spin = ball.getValue(Fireball, 'spin') ?? 0;
        const rate =
          FIREBALL.orbitSpeedMin +
          (FIREBALL.orbitSpeedMax - FIREBALL.orbitSpeedMin) * Math.min(1, spin / FIREBALL.orbitSpinUp);
        const phase = (ball.getValue(Fireball, 'phase') ?? 0) + rate * delta;
        ball.setValue(Fireball, 'phase', phase);
        this.handPose(owner, hand);
        // Circle in the fist's local XY plane, tilted by the fist itself.
        _offset.set(Math.cos(phase) * FIREBALL.orbitRadius, Math.sin(phase) * FIREBALL.orbitRadius, 0);
        _offset.applyQuaternion(_gripQ);
        obj.position.copy(_grip).add(_offset);
        break;
      }
      case BallState.Flying: {
        const v = ball.getVectorView(Fireball, 'velocity');
        v[1] -= FIREBALL.gravity * delta;
        obj.position.x += v[0] * delta;
        obj.position.y += v[1] * delta;
        obj.position.z += v[2] * delta;
        // Remote-throw handoff: bleed the launch offset away so the visual
        // path eases onto the sender's authoritative trajectory.
        const off = this.netBlend.get(ball);
        if (off) {
          const k = 1 - Math.exp(-NET.throwBlend * delta);
          obj.position.addScaledVector(off, -k);
          off.multiplyScalar(1 - k);
          if (off.lengthSq() < 1e-6) this.netBlend.delete(ball);
        }
        // The invisible cage ~10 yards out from the platforms: a ball that
        // reaches it bursts against the wall and dies right there.
        if (this.clampToCage(obj.position)) {
          emberBurst(obj.position, 14, owner === 1);
          sfx.wallThud();
          if (transient) {
            this.destroyBall(ball);
          } else {
            this.spendBall(ball);
            v[0] = 0; v[1] = 0; v[2] = 0;
          }
          break;
        }
        const elapsed = (ball.getValue(Fireball, 'elapsed') ?? 0) + delta;
        ball.setValue(Fireball, 'elapsed', elapsed);
        if (elapsed >= FIREBALL.lifetime || obj.position.y <= FIREBALL.radius) {
          if (transient) {
            this.destroyBall(ball);
          } else {
            this.spendBall(ball);
            obj.position.y = Math.max(obj.position.y, FIREBALL.radius);
          }
        }
        break;
      }
      case BallState.Returning: {
        this.handPose(owner, hand);
        const shard = (ball.getValue(Fireball, 'shard') ?? 0) === 1;
        const attach = ball.getValue(Fireball, 'attach') ?? 0;

        // Home toward the hand. Split balls fan out around the return path,
        // the fan collapsing to the fist as they close so they read as three.
        _target.copy(_grip);
        if (attach === ATTACH.split) {
          _dir.copy(_grip).sub(obj.position);
          const d = _dir.length();
          if (d > 1e-3) {
            _dir.multiplyScalar(1 / d);
            _perp1.set(0, 1, 0).cross(_dir);
            if (_perp1.lengthSq() < 1e-4) _perp1.set(1, 0, 0);
            _perp1.normalize();
            _perp2.copy(_dir).cross(_perp1).normalize();
            const idx = ball.getValue(Fireball, 'shardIndex') ?? 0;
            const ang = (idx * Math.PI * 2) / ATTACH.splitCount;
            const fan = ATTACH.splitSpread * Math.min(1, d / ATTACH.splitSpreadRange);
            _target
              .addScaledVector(_perp1, Math.cos(ang) * fan)
              .addScaledVector(_perp2, Math.sin(ang) * fan);
          }
        }

        _dir.copy(_target).sub(obj.position);
        const dist = _dir.length();
        const speed = Math.min(FIREBALL.returnSpeed, 3 + dist * 7);
        obj.position.addScaledVector(_dir.normalize(), Math.min(speed * delta, dist));

        // Catch: a shard just vanishes; an opponent main ball settles back to
        // normal (your own main balls catch in updateLocalControl, where the
        // trigger state decides hover vs. orbit).
        if (obj.position.distanceTo(_grip) <= FIREBALL.catchRadius) {
          if (shard) {
            this.destroyBall(ball);
          } else if (owner === 1) {
            this.revertBall(ball);
            this.destroyShards(1, hand);
            ball.setValue(Fireball, 'state', BallState.Hover);
          }
        }
        break;
      }
      case BallState.Dead: {
        // Smoulder where it fell; gentle settle onto the floor.
        if (obj.position.y > FIREBALL.radius) {
          obj.position.y = Math.max(FIREBALL.radius, obj.position.y - 2.5 * delta);
        }
        break;
      }
    }
  }

  /** True if the position crossed the arena cage; clamps it onto the wall. */
  private clampToCage(p: Vector3): boolean {
    let hit = false;
    if (p.x < -ARENA_BOUNDS.halfWidth) { p.x = -ARENA_BOUNDS.halfWidth; hit = true; }
    else if (p.x > ARENA_BOUNDS.halfWidth) { p.x = ARENA_BOUNDS.halfWidth; hit = true; }
    if (p.z > ARENA_BOUNDS.zBack) { p.z = ARENA_BOUNDS.zBack; hit = true; }
    else if (p.z < ARENA_BOUNDS.zFront) { p.z = ARENA_BOUNDS.zFront; hit = true; }
    if (p.y > ARENA_BOUNDS.ceiling) { p.y = ARENA_BOUNDS.ceiling; hit = true; }
    return hit;
  }

  /** Where this ball idles: just over the owner's knuckles. */
  private anchorFor(owner: number, hand: Hand): void {
    this.handPose(owner, hand);
    _offset.set(...FIREBALL.hoverOffset);
    _offset.applyQuaternion(_gripQ);
    _anchor.copy(_grip).add(_offset);
  }

  /** Fill _grip/_gripQ with the owner's hand pose (local rig or the bus). */
  private handPose(owner: number, hand: Hand): void {
    if (owner === 0) {
      // Position from the fist, orientation from the pointing ray — the same
      // frame the gloves are aimed in, so hover/orbit sit over the knuckles.
      const grip = this.world.playerSpaceEntities.gripSpaces[HANDS[hand]]?.object3D;
      const ray = this.world.playerSpaceEntities.raySpaces[HANDS[hand]]?.object3D;
      if (grip) {
        grip.getWorldPosition(_grip);
        (ray ?? grip).getWorldQuaternion(_gripQ);
      }
    } else {
      _grip.copy(opponent.handPos[hand]);
      _gripQ.copy(opponent.handQuat[hand]);
    }
  }

  // --- opponent commands (bot / network) ---------------------------------

  private drainCommands(): void {
    const roundLive = app.state === 'training' || match.phase === 'playing';
    for (const cmd of ballCommands.splice(0)) {
      if (cmd.type === 'transient') {
        this.spawnTransient(cmd.pos, cmd.vel, cmd.damage);
        continue;
      }
      if (!roundLive && (cmd.type === 'throw' || cmd.type === 'recall')) continue;
      const ball = this.findBall(1, cmd.hand);
      if (!ball) continue;
      switch (cmd.type) {
        case 'throw': {
          // Don't teleport to the sender's launch point: our smoothed copy
          // of their hand LAGS the real one, so the gap can be ~30 cm at
          // punch speed. Keep the ball where OUR sim shows it and let
          // `integrate` decay the offset onto the authoritative trajectory.
          const obj = ball.object3D!;
          _offset.copy(obj.position).sub(cmd.pos);
          if (obj.visible && _offset.lengthSq() < 1) {
            this.netBlend.set(ball, _offset.clone());
          } else {
            // Hidden or wildly out of place — snap, nothing to blend from.
            obj.position.copy(cmd.pos);
            this.netBlend.delete(ball);
          }
          const v = ball.getVectorView(Fireball, 'velocity');
          v[0] = cmd.vel.x; v[1] = cmd.vel.y; v[2] = cmd.vel.z;
          ball.setValue(Fireball, 'state', BallState.Flying);
          ball.setValue(Fireball, 'elapsed', 0);
          sfx.throwWhoosh();
          break;
        }
        case 'recall': {
          // A DEAD ball just landed its hit — its return leg flies inert,
          // otherwise recalling off a fresh hit double-scored on the way out.
          const st = ball.getValue(Fireball, 'state') ?? 0;
          ball.setValue(Fireball, 'state', BallState.Returning);
          ball.setValue(Fireball, 'recallLock', 0);
          ball.setValue(Fireball, 'returnHit', st === BallState.Dead ? 1 : 0);
          this.netBlend.delete(ball);
          // Mirror the rival's fired attachment onto our copy of their ball so
          // it splits/scales and deals matching damage when it reaches us.
          if (cmd.att) {
            this.applyAttachmentRemote(ball, cmd.hand, cmd.att, cmd.dmg ?? FIREBALL.damage, cmd.scl ?? 1);
          }
          break;
        }
        case 'spend':
          // Their sim says this ball is finished (it hit us / was parried
          // on their side) — retire it where it is.
          this.spendBall(ball);
          this.netBlend.delete(ball);
          break;
      }
    }
    // Orbit flags from the bus drive their bound pair's hover/orbit look.
    for (const hand of [0, 1] as const) {
      const ball = this.findBall(1, hand);
      if (!ball) continue;
      const st = ball.getValue(Fireball, 'state') ?? 0;
      if (!roundLive) {
        if (st === BallState.Orbit) ball.setValue(Fireball, 'state', BallState.Hover);
        continue;
      }
      if (opponent.orbiting[hand] && st === BallState.Hover) {
        ball.setValue(Fireball, 'state', BallState.Orbit);
        ball.setValue(Fireball, 'spin', 0);
      } else if (!opponent.orbiting[hand] && st === BallState.Orbit) {
        ball.setValue(Fireball, 'state', BallState.Hover);
      }
      if (st === BallState.Orbit) {
        ball.setValue(Fireball, 'spin', (ball.getValue(Fireball, 'spin') ?? 0) + 0.016);
      }
    }
  }

  // --- visuals -------------------------------------------------------------

  private updateVisual(ball: Entity, delta: number): void {
    const visual = this.visuals.get(ball);
    const obj = ball.object3D;
    if (!visual || !obj) return;

    // Size tracks the (possibly attachment-scaled) radius; 1.0 for normal balls.
    const r = ball.getValue(Fireball, 'radius') ?? FIREBALL.radius;
    obj.scale.setScalar(r / FIREBALL.radius);

    const state = ball.getValue(Fireball, 'state') ?? 0;
    const target =
      state === BallState.Orbit ? 1.45 :
      state === BallState.Flying ? 1.25 :
      state === BallState.Returning ? 1.35 :
      state === BallState.Dead ? 0.18 : 0.8;
    const heat = (ball.getValue(Fireball, 'heat') ?? 0.8) + (target - (ball.getValue(Fireball, 'heat') ?? 0.8)) * Math.min(1, delta * 6);
    ball.setValue(Fireball, 'heat', heat);
    visual.update(this.time, heat, _camQ);

    const cool = (ball.getValue(Fireball, 'owner') ?? 0) === 1;

    // Comet trail while moving fast — stamped densely so the fat core
    // particles overlap into one thick molten rope (see fx/fire.ts).
    if (state === BallState.Flying || state === BallState.Returning) {
      const acc = (this.trailAcc.get(ball) ?? 0) + delta;
      if (acc >= 0.009) {
        this.trailAcc.set(ball, 0);
        stampTrail(obj.position, cool);
      } else {
        this.trailAcc.set(ball, acc);
      }
    }

    // Lazy embers while orbiting.
    if (state === BallState.Orbit) {
      this.emberAcc += delta;
      if (this.emberAcc >= 0.09) {
        this.emberAcc = 0;
        spawnEmber(obj.position, 0.5, cool);
      }
    }
  }

  // --- lifecycle helpers ----------------------------------------------------

  private createBall(owner: 0 | 1, hand: 0 | 1): Entity {
    const visual = createFireVisual(owner);
    const e = this.world.createTransformEntity(visual.group, { persistent: true });
    e.addComponent(Fireball, { owner, hand, damage: FIREBALL.damage, radius: FIREBALL.radius });
    e.object3D!.visible = false;
    e.object3D!.position.set(hand === 0 ? -0.25 : 0.25, 1.0, owner === 0 ? -0.3 : -ARENA_GAP + 0.3);
    this.visuals.set(e, visual);
    return e;
  }

  private destroyBall(ball: Entity): void {
    this.visuals.get(ball)?.dispose();
    this.visuals.delete(ball);
    this.trailAcc.delete(ball);
    this.netBlend.delete(ball);
    ball.destroy();
  }

  /** A bound (non-transient, non-shard) ball by owner+hand. */
  private findBall(owner: number, hand: number): Entity | undefined {
    for (const e of this.queries.balls.entities) {
      if (
        (e.getValue(Fireball, 'owner') ?? 0) === owner &&
        (e.getValue(Fireball, 'hand') ?? 0) === hand &&
        (e.getValue(Fireball, 'transient') ?? 0) === 0 &&
        (e.getValue(Fireball, 'shard') ?? 0) === 0
      ) {
        return e;
      }
    }
    return undefined;
  }

  private resetBalls(): void {
    for (const ball of [...this.queries.balls.entities]) {
      if ((ball.getValue(Fireball, 'transient') ?? 0) === 1 || (ball.getValue(Fireball, 'shard') ?? 0) === 1) {
        this.destroyBall(ball);
        continue;
      }
      ball.setValue(Fireball, 'state', BallState.Hover);
      ball.setValue(Fireball, 'spin', 0);
      ball.setValue(Fireball, 'elapsed', 0);
      ball.setValue(Fireball, 'returnHit', 0);
      ball.setValue(Fireball, 'recallLock', 0);
      this.revertBall(ball);
    }
    this.netBlend.clear();
    this.trackers[0].reset();
    this.trackers[1].reset();
  }

  private spendBall(ball: Entity): void {
    ball.setValue(Fireball, 'state', BallState.Dead);
    ball.setValue(Fireball, 'recallLock', FIREBALL.recallLockout);
    const v = ball.getVectorView(Fireball, 'velocity');
    v[0] = 0; v[1] = 0; v[2] = 0;
  }
}
