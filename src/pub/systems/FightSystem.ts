/**
 * FIRE FIGHT in the fight hall — the main game's duel, on display for the
 * whole pub. This is meant to be 1:1 with a QUICK MATCH in the real arena
 * (same physics, effects, colours and chosen cosmetics), just running over the
 * pub's room server instead of the 1v1 bout relay — and in pure VR, no
 * passthrough.
 *
 * Flow: pull the trigger at a corner console to claim that platform (you're
 * teleported onto it). When both corners are claimed the server counts down
 * and the fight is ON — everyone else in the social space can gather round
 * the hazard line and watch, or wander back to the pub.
 *
 * The fireball mechanics are the arena's (src/systems/FireballSystem.ts +
 * CollisionSystem.ts), ported onto pub networking:
 *  - hold trigger/grip → the ball ORBITS your fist, spinning up;
 *  - release mid-punch → it FLIES along your swing (aim-assisted toward the
 *    other fighter), arcs under light gravity, dies on the cage — which in
 *    here is pulled in to FIVE yards from the platform rims so the duel
 *    fits indoors;
 *  - trigger while it's away → it RETURNS to your fist (and can connect on the
 *    way home — the recall-through technique — without being spent).
 *
 * Hits are victim-authoritative (you rule on balls hitting YOUR head/torso —
 * three IK spheres solved exactly like the arena's body — same as the arena's
 * net protocol); each fighter streams their two balls at 20 Hz so spectators
 * see the whole exchange. First to 0 hp loses; leaving your platform forfeits.
 *
 * Colours follow the arena, NOT the corner: from a fighter's own eyes their
 * fire always burns orange and their opponent's blue (pure client-side); only
 * spectators see the fixed ember-vs-blue corner tints.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { XROrigin } from '@iwsdk/xr-input';
import { BODY_IK, FIREBALL, teamColor } from '../../config.js';
import { buildBoxer, solveTorso, type BoxerRig } from '../../avatar/boxer.js';
import { applyAvatarSkin, avatarSkin, platformSkin } from '../../avatar/skins.js';
import { customization } from '../../menu/customization.js';
import {
  createFireVisual,
  emberBurst,
  spawnEmber,
  stampTrail,
  updateFirePools,
  type FireVisual,
} from '../../fx/fire.js';
import { spawnDamagePopup, spawnFireImpact } from '../../fx/effects.js';
import * as sfx from '../../audio/sfx.js';
import { pulseHand } from '../../input/haptics.js';
import { FIGHT } from '../config.js';
import { pubSendEvent, pubSendRaw } from '../net.js';
import type { FightNet, FireballNet } from '../protocol.js';
import { bus, pub } from '../state.js';
import { teleportPlayer } from './TeleportSystem.js';

const HANDS = ['left', 'right'] as const;
type Hand = 0 | 1;

// Wire ball states (FireballNet[3]).
const HOVER = 0;
const ORBIT = 1;
const FLYING = 2;
const RETURNING = 3;
const DEAD = 4;

const STREAM_INTERVAL = 0.05; // 20 Hz

/** Ring buffer of recent hand positions → smoothed punch velocity. */
class VelocityTracker {
  private samples: { pos: Vector3; t: number }[] = [];

  push(pos: Vector3, t: number): void {
    this.samples.push({ pos: pos.clone(), t });
    while (this.samples.length > 12) this.samples.shift();
  }

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

interface LocalBall {
  state: number;
  visual: FireVisual;
  pos: Vector3;
  vel: Vector3;
  phase: number;
  spin: number;
  elapsed: number;
  heat: number;
  trailAcc: number;
}

interface RemoteBall {
  visual: FireVisual;
  target: Vector3;
  state: number;
  heat: number;
  trailAcc: number;
  /** Victim-side per-ball re-hit guard. */
  hitCooldown: number;
  /** One connect per return leg — the recall-through guard (arena parity). */
  returnHit: number;
  hasTarget: boolean;
}

const _grip = new Vector3();
const _gripQ = new Quaternion();
const _vel = new Vector3();
const _dir = new Vector3();
const _aim = new Vector3();
const _offset = new Vector3();
const _camQ = new Quaternion();
const _head = new Vector3();
const _headQ = new Quaternion();

export class FightSystem extends createSystem({}) {
  private time = 0;
  private streamTimer = 0;
  private myBalls: [LocalBall, LocalBall] | null = null;
  private trackers: [VelocityTracker, VelocityTracker] = [new VelocityTracker(), new VelocityTracker()];
  /** Remote fighters' streamed balls, keyed by player id. */
  private remoteBalls = new Map<string, [RemoteBall, RemoteBall]>();
  private myHp: number = FIGHT.hpMax;
  private lastPhase: FightNet['phase'] = 'idle';
  private consoleCooldown = 0;
  /** My own iron torso — rendered while I fight (so I see my machine) and
   *  solved each frame for the head/chest/pelvis hit spheres, arena-style. */
  private bodyRig?: BoxerRig;
  private myChest = new Vector3();
  private myPelvis = new Vector3();

  init(): void {
    // The local fighter's body: an ember (team 0) torso wearing my avatar
    // skin, exactly like the arena's PlayerBodySystem. Only the torso joins
    // the scene (my gloves are the controllers; my own head stays unseen).
    this.bodyRig = buildBoxer(0);
    this.bodyRig.torso.name = 'pub-fighter-torso';
    this.bodyRig.torso.visible = false;
    applyAvatarSkin(this.bodyRig.torso, avatarSkin(customization.avatar));
    this.scene.add(this.bodyRig.torso);

    this.cleanupFuncs.push(
      bus.on('fight', (f) => this.onFight(f)),
      bus.on('gameEvent', ({ from, ev }) => {
        switch (ev.e) {
          case 'FIGHT_FB':
            this.onRemoteBalls(from, ev.balls);
            break;
          case 'FIGHT_HIT':
            // My ball connected on their side.
            if (this.amFighter() && this.myBalls) {
              const ball = this.myBalls[ev.ball];
              if (ev.ret) {
                // Return-pass: it keeps homing, never spent on the connect.
              } else if (ball.state === FLYING || ball.state === RETURNING) {
                ball.state = DEAD;
                ball.vel.set(0, 0, 0);
              }
              spawnFireImpact(this.world, ball.pos, 0);
              spawnDamagePopup(this.world, ball.pos, FIREBALL.damage);
              sfx.hitDealt();
            }
            break;
          case 'FIGHT_DEFLECT':
            if (this.amFighter() && this.myBalls) {
              const ball = this.myBalls[ev.ball];
              if (ball.state === FLYING) {
                ball.state = DEAD;
                ball.vel.set(0, 0, 0);
              }
              sfx.deflect();
            }
            break;
          case 'FIGHT_CLASH':
            // One of my thrown balls met one of theirs — both die.
            if (this.amFighter() && this.myBalls) {
              const ball = this.myBalls[ev.ball];
              if (ball.state === FLYING || ball.state === RETURNING) {
                ball.state = DEAD;
                ball.vel.set(0, 0, 0);
                emberBurst(ball.pos, 14, false);
                emberBurst(ball.pos, 14, true);
                spawnFireImpact(this.world, ball.pos, 0, 1.2);
                sfx.ballClash();
              }
            }
            break;
          default:
            break;
        }
      }),
      bus.on('left', (id) => this.dropRemote(id)),
    );
    this.renderConsoles();
    this.renderDisplay();
  }

  private rimKey = '';

  /**
   * Dress each platform rim AND slab in its claimant's PLATFORM skin the moment
   * a corner locks in (back to corner colours when it frees up) — your arena
   * cosmetics follow you onto the fight-hall floor.
   */
  private dressRims(): void {
    const rims = pub.refs?.fightRims;
    const slabs = pub.refs?.fightSlabs;
    if (!rims) return;
    const pfFor = (side: 0 | 1): string => {
      const id = pub.fight.sides[side];
      if (!id) return '';
      if (id === pub.myId) return customization.platform;
      return pub.punters.get(id)?.pf ?? '';
    };
    const key = `${pfFor(0)}|${pfFor(1)}`;
    if (key === this.rimKey) return;
    this.rimKey = key;
    ([0, 1] as const).forEach((side) => {
      const pf = pfFor(side);
      const colour = pf ? platformSkin(pf).neon : teamColor(side);
      const mat = rims[side].material as MeshStandardMaterial;
      mat.color.setHex(colour);
      mat.emissive.setHex(colour);
      if (slabs) (slabs[side].material as MeshStandardMaterial).emissive.setHex(colour);
    });
  }

  update(delta: number): void {
    this.time += delta;
    this.consoleCooldown = Math.max(0, this.consoleCooldown - delta);
    updateFirePools(delta);
    this.camera.getWorldQuaternion(_camQ);

    this.checkConsoles();
    this.dressRims();

    const f = pub.fight;
    const fighting = f.phase === 'fighting';
    const live = f.phase === 'starting' || fighting;

    if (this.amFighter() && live) {
      this.solveMyBody();
      this.ensureMyBalls();
      this.updateMyBalls(delta, fighting);
      this.checkForfeit();
      this.checkIncomingHits(fighting);
      this.streamBalls(delta);
    } else {
      if (this.bodyRig) this.bodyRig.torso.visible = false;
      if (this.myBalls && f.phase === 'idle') this.disposeMyBalls();
    }

    // Remote fighters' balls: ease to targets, drive the fire look.
    for (const [id, balls] of this.remoteBalls) {
      if (f.phase === 'idle' || !f.sides.includes(id)) {
        for (const b of balls) b.visual.dispose();
        for (const b of balls) this.scene.remove(b.visual.group);
        this.remoteBalls.delete(id);
        continue;
      }
      const cool = this.teamFor(id) === 1;
      const k = 1 - Math.exp(-16 * delta);
      for (const b of balls) {
        b.hitCooldown = Math.max(0, b.hitCooldown - delta);
        if (b.hasTarget) {
          if (b.visual.group.position.distanceToSquared(b.target) > 9) {
            b.visual.group.position.copy(b.target);
          } else {
            b.visual.group.position.lerp(b.target, k);
          }
        }
        this.driveFireLook(b.visual, b.visual.group.position, b.state, b, delta, cool);
      }
    }
  }

  // --- consoles / lifecycle -----------------------------------------------------

  private mySide(): 0 | 1 | -1 {
    if (pub.fight.sides[0] === pub.myId) return 0;
    if (pub.fight.sides[1] === pub.myId) return 1;
    return -1;
  }

  private amFighter(): boolean {
    return this.mySide() !== -1;
  }

  /**
   * Render team (0 = ember/orange, 1 = blue) for a fighter id FROM MY EYES.
   * A fighter always sees their own fire orange and their foe's blue (arena
   * parity); a spectator sees the fixed corner tints.
   */
  private teamFor(id: string | null): 0 | 1 {
    if (!id) return 0;
    if (this.amFighter()) return id === pub.myId ? 0 : 1;
    return pub.fight.sides[1] === id ? 1 : 0;
  }

  private checkConsoles(): void {
    if (this.consoleCooldown > 0) return;
    let pressed = false;
    for (const hand of HANDS) {
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) pressed = true;
    }
    if (!pressed) return;

    this.player.head.getWorldPosition(_head);
    for (const side of [0, 1] as const) {
      const [cx, , cz] = FIGHT.consoles[side];
      if (Math.hypot(_head.x - cx, _head.z - cz) > 1.3) continue;
      this.consoleCooldown = 0.5;
      if (!pub.online) return; // consoles need the room server
      const f = pub.fight;
      if (f.sides[side] === pub.myId && (f.phase === 'idle' || f.phase === 'starting')) {
        pubSendRaw({ t: 'leave-fight' }); // step back down
        sfx.uiClick();
      } else if (f.sides[side] === null && f.phase === 'idle' && !this.amFighter()) {
        pubSendRaw({ t: 'claim-fight', side });
        sfx.uiClick();
        // Take your corner: feet on the platform, DOWN in the pit, facing
        // your opponent. (Any later teleport restores stands level.)
        const z = side === 0 ? FIGHT.platformZ : -FIGHT.platformZ;
        teleportPlayer(this.player as XROrigin, FIGHT.centerX, z, side === 0 ? Math.PI : 0);
        (this.player as XROrigin).position.y = -FIGHT.pitDepth;
      }
      return;
    }
  }

  private onFight(f: FightNet): void {
    if (f.phase !== this.lastPhase) {
      switch (f.phase) {
        case 'starting':
          sfx.uiClick();
          break;
        case 'fighting':
          sfx.roundBell();
          this.myHp = FIGHT.hpMax;
          if (this.amFighter() && this.myBalls) this.resetMyBalls();
          break;
        case 'over': {
          const iWon = f.winner === pub.myId;
          if (this.amFighter()) sfx.matchEnd(iWon);
          else sfx.roundEnd(true);
          break;
        }
        case 'idle':
          break;
      }
      this.lastPhase = f.phase;
    }
    this.renderConsoles();
    this.renderDisplay();
  }

  /** Fighters must hold their platform — wander off and you forfeit. */
  private checkForfeit(): void {
    const side = this.mySide();
    if (side === -1) return;
    this.player.head.getWorldPosition(_head);
    const z = side === 0 ? FIGHT.platformZ : -FIGHT.platformZ;
    if (Math.hypot(_head.x - FIGHT.centerX, _head.z - z) > FIGHT.forfeitRadius) {
      pubSendRaw({ t: 'leave-fight' });
    }
  }

  /**
   * Solve and show my own torso, mirroring the arena's PlayerBodySystem. The
   * pit drops the rig a level (player.y = -pitDepth), so we lift the head into
   * "floor at 0" space for the pinned-hip solve and drop the result back down.
   */
  private solveMyBody(): void {
    const rig = this.bodyRig;
    if (!rig) return;
    const side = this.mySide();
    if (side === -1) {
      rig.torso.visible = false;
      return;
    }
    rig.torso.visible = true;
    this.player.head.getWorldPosition(_head);
    this.player.head.getWorldQuaternion(_headQ);
    _head.y += FIGHT.pitDepth;
    const z = side === 0 ? FIGHT.platformZ : -FIGHT.platformZ;
    solveTorso(rig, _head, _headQ, FIGHT.centerX, z, this.myChest, this.myPelvis);
    rig.chest.position.y -= FIGHT.pitDepth;
    rig.pelvis.position.y -= FIGHT.pitDepth;
    this.myChest.y -= FIGHT.pitDepth;
    this.myPelvis.y -= FIGHT.pitDepth;
  }

  // --- my fireballs (the arena state machine, pub coordinates) --------------------

  private ensureMyBalls(): void {
    if (this.myBalls) return;
    const team = this.teamFor(pub.myId); // a fighter's own fire is always ember
    const mk = (hand: Hand): LocalBall => {
      const visual = createFireVisual(team);
      this.scene.add(visual.group);
      this.handPose(hand);
      return {
        state: HOVER,
        visual,
        pos: visual.group.position.copy(_grip),
        vel: new Vector3(),
        phase: hand * Math.PI,
        spin: 0,
        elapsed: 0,
        heat: 0.8,
        trailAcc: 0,
      };
    };
    this.myBalls = [mk(0), mk(1)];
    this.trackers[0].reset();
    this.trackers[1].reset();
    sfx.ignite();
  }

  private disposeMyBalls(): void {
    if (!this.myBalls) return;
    for (const b of this.myBalls) {
      this.scene.remove(b.visual.group);
      b.visual.dispose();
    }
    this.myBalls = null;
  }

  private resetMyBalls(): void {
    if (!this.myBalls) return;
    for (const b of this.myBalls) {
      b.state = HOVER;
      b.spin = 0;
      b.elapsed = 0;
    }
  }

  private handPose(hand: Hand): void {
    const grip = this.player.gripSpaces[HANDS[hand]];
    const ray = this.player.raySpaces[HANDS[hand]];
    grip.getWorldPosition(_grip);
    (ray ?? grip).getWorldQuaternion(_gripQ);
  }

  private updateMyBalls(delta: number, fighting: boolean): void {
    if (!this.myBalls) return;
    const cool = this.teamFor(pub.myId) === 1; // my own fire (ember from my view)

    for (const hand of [0, 1] as const) {
      const ball = this.myBalls[hand];
      this.handPose(hand);
      this.trackers[hand].push(_grip, this.time);

      const gp = this.input.xr.gamepads[HANDS[hand]];
      const pressedNow =
        (gp?.getButtonPressed(InputComponent.Trigger) ?? false) ||
        (gp?.getButtonPressed(InputComponent.Squeeze) ?? false);
      const down =
        (gp?.getButtonDown(InputComponent.Trigger) ?? false) ||
        (gp?.getButtonDown(InputComponent.Squeeze) ?? false);
      const released =
        (gp?.getButtonUp(InputComponent.Trigger) ?? false) ||
        (gp?.getButtonUp(InputComponent.Squeeze) ?? false);

      if (down) {
        if (ball.state === HOVER || ball.pos.distanceTo(_grip) <= FIREBALL.nearHandRadius) {
          if (ball.state !== ORBIT) {
            ball.state = ORBIT;
            ball.spin = 0;
            sfx.ignite();
            pulseHand(this.world.session, HANDS[hand], 0.4, 60);
          }
        } else if (ball.state === FLYING || ball.state === DEAD) {
          ball.state = RETURNING;
          sfx.recall();
        }
      }

      if (released && ball.state === ORBIT) {
        this.trackers[hand].velocity(_vel, this.time);
        const speed = _vel.length();
        // Throws only count once the bell has gone.
        if (fighting && speed >= FIREBALL.minPunchSpeed) {
          this.throwBall(ball, hand, speed);
        } else {
          ball.state = HOVER;
        }
      }

      if (ball.state === RETURNING && ball.pos.distanceTo(_grip) <= FIREBALL.catchRadius) {
        ball.state = pressedNow ? ORBIT : HOVER;
        ball.spin = 0;
        sfx.catchBall();
        pulseHand(this.world.session, HANDS[hand], 0.5, 70);
      }

      // Integrate.
      switch (ball.state) {
        case HOVER: {
          _offset.set(...FIREBALL.hoverOffset).applyQuaternion(_gripQ);
          const k = 1 - Math.exp(-FIREBALL.hoverLerp * delta);
          ball.pos.lerp(_offset.add(_grip), k);
          break;
        }
        case ORBIT: {
          ball.spin += delta;
          const rate =
            FIREBALL.orbitSpeedMin +
            (FIREBALL.orbitSpeedMax - FIREBALL.orbitSpeedMin) *
              Math.min(1, ball.spin / FIREBALL.orbitSpinUp);
          ball.phase += rate * delta;
          _offset
            .set(Math.cos(ball.phase) * FIREBALL.orbitRadius, Math.sin(ball.phase) * FIREBALL.orbitRadius, 0)
            .applyQuaternion(_gripQ);
          ball.pos.copy(_grip).add(_offset);
          break;
        }
        case FLYING: {
          ball.vel.y -= FIREBALL.gravity * delta;
          ball.pos.addScaledVector(ball.vel, delta);
          if (this.clampToCage(ball.pos)) {
            emberBurst(ball.pos, 14, cool);
            sfx.wallThud();
            ball.state = DEAD;
            ball.vel.set(0, 0, 0);
            break;
          }
          ball.elapsed += delta;
          // The duel floor is the PIT floor, a level below the stands.
          if (ball.elapsed >= FIREBALL.lifetime || ball.pos.y <= FIREBALL.radius - FIGHT.pitDepth) {
            ball.state = DEAD;
            ball.pos.y = Math.max(ball.pos.y, FIREBALL.radius - FIGHT.pitDepth);
          }
          break;
        }
        case RETURNING: {
          _dir.copy(_grip).sub(ball.pos);
          const dist = _dir.length();
          const speed = Math.min(FIREBALL.returnSpeed, 3 + dist * 7);
          ball.pos.addScaledVector(_dir.normalize(), Math.min(speed * delta, dist));
          break;
        }
        case DEAD:
          if (ball.pos.y > FIREBALL.radius - FIGHT.pitDepth) {
            ball.pos.y = Math.max(FIREBALL.radius - FIGHT.pitDepth, ball.pos.y - 2.5 * delta);
          }
          break;
      }

      ball.visual.group.position.copy(ball.pos);
      this.driveFireLook(ball.visual, ball.pos, ball.state, ball, delta, cool);
    }
  }

  private throwBall(ball: LocalBall, hand: Hand, handSpeed: number): void {
    _dir.copy(_vel).normalize();
    // Aim assist: blend toward the other fighter's chest.
    this.opponentChest(_aim);
    _aim.sub(ball.pos).normalize();
    _dir.lerp(_aim, FIREBALL.aimAssist).normalize();
    const speed = Math.min(
      FIREBALL.throwSpeedMax,
      Math.max(FIREBALL.throwSpeedMin, handSpeed * FIREBALL.punchGain),
    );
    ball.vel.copy(_dir).multiplyScalar(speed);
    ball.state = FLYING;
    ball.elapsed = 0;
    sfx.throwWhoosh();
    pulseHand(this.world.session, HANDS[hand], 0.8, 110);
  }

  private opponentChest(out: Vector3): void {
    const side = this.mySide();
    const oppId = pub.fight.sides[side === 0 ? 1 : 0];
    const opp = oppId ? pub.punters.get(oppId) : null;
    if (opp) {
      out.set(opp.head[0], opp.head[1] - 0.35, opp.head[2]);
    } else {
      out.set(FIGHT.centerX, 1.25, side === 0 ? -FIGHT.platformZ : FIGHT.platformZ);
    }
  }

  /** The 5-yard cage: clamp + report so balls burst on the invisible wall. */
  private clampToCage(p: Vector3): boolean {
    const c = FIGHT.cage;
    let hit = false;
    if (p.x < c.minX) { p.x = c.minX; hit = true; }
    else if (p.x > c.maxX) { p.x = c.maxX; hit = true; }
    if (p.z < c.minZ) { p.z = c.minZ; hit = true; }
    else if (p.z > c.maxZ) { p.z = c.maxZ; hit = true; }
    if (p.y > c.ceiling) { p.y = c.ceiling; hit = true; }
    return hit;
  }

  // --- hits (victim-authoritative, like the arena) --------------------------------

  private checkIncomingHits(fighting: boolean): void {
    if (!fighting) return;
    const side = this.mySide();
    const oppId = pub.fight.sides[side === 0 ? 1 : 0];
    const balls = oppId ? this.remoteBalls.get(oppId) : undefined;
    if (!balls) return;

    this.player.head.getWorldPosition(_head);
    // Head, chest and pelvis spheres — the SAME three IK volumes (and radii)
    // the arena solves, so dodging plays identically.
    const spheres: [Vector3, number][] = [
      [_head, BODY_IK.headRadius],
      [this.myChest, BODY_IK.chestRadius],
      [this.myPelvis, BODY_IK.pelvisRadius],
    ];

    for (const idx of [0, 1] as const) {
      const enemy = balls[idx];
      const returning = enemy.state === RETURNING;
      if (enemy.state !== FLYING && !returning) continue;
      if (!enemy.hasTarget || enemy.hitCooldown > 0) continue;
      // One connect per return leg — a return-pass that already landed is inert.
      if (returning && enemy.returnHit === 1) continue;
      const ePos = enemy.visual.group.position;

      // Clash: my thrown ball meeting theirs cancels both (flying-vs-flying;
      // a returning ball is already leaving).
      if (!returning && this.tryClash(enemy, idx, ePos)) continue;

      // Parry: my orbiting/returning ball knocks it out of the air.
      if (this.tryParry(enemy, idx, ePos)) continue;

      // Body: head/chest/pelvis.
      for (const [centre, radius] of spheres) {
        if (ePos.distanceTo(centre) <= radius + FIREBALL.radius) {
          enemy.hitCooldown = 0.8;
          this.myHp = Math.max(0, this.myHp - FIREBALL.damage);
          // Taking a hit is the loudest moment: oversized fiery burst, damage
          // number, hard double-hand buzz (arena's spawnFireImpact at 1.7).
          spawnFireImpact(this.world, ePos, 1, 1.7);
          spawnDamagePopup(this.world, ePos, FIREBALL.damage);
          sfx.hitTaken();
          pulseHand(this.world.session, 'left', 1, 160);
          pulseHand(this.world.session, 'right', 1, 160);
          // A return-pass keeps homing home; a thrown ball is spent on contact.
          if (returning) {
            enemy.returnHit = 1;
            pubSendEvent({ e: 'FIGHT_HIT', ball: idx, ret: true });
          } else {
            enemy.state = DEAD;
            pubSendEvent({ e: 'FIGHT_HIT', ball: idx });
          }
          pubSendEvent({ e: 'FIGHT_HP', hp: this.myHp });
          break;
        }
      }
    }
  }

  /** My orbiting/returning ball slaps an incoming enemy ball from the air. */
  private tryParry(enemy: RemoteBall, idx: 0 | 1, ePos: Vector3): boolean {
    if (!this.myBalls) return false;
    for (const hand of [0, 1] as const) {
      const mine = this.myBalls[hand];
      if (mine.state !== ORBIT && mine.state !== RETURNING) continue;
      const reach = FIREBALL.radius * 2 + FIREBALL.deflectBonus;
      if (mine.pos.distanceTo(ePos) > reach) continue;
      enemy.hitCooldown = 0.6;
      enemy.state = DEAD;
      emberBurst(ePos, 22, true);
      spawnFireImpact(this.world, ePos, 1);
      sfx.deflect();
      pulseHand(this.world.session, HANDS[hand], 0.9, 120);
      pubSendEvent({ e: 'FIGHT_DEFLECT', ball: idx });
      return true;
    }
    return false;
  }

  /** Two thrown balls (one mine, one theirs) meeting mid-air block each other. */
  private tryClash(enemy: RemoteBall, idx: 0 | 1, ePos: Vector3): boolean {
    if (!this.myBalls) return false;
    for (const mine of this.myBalls) {
      if (mine.state !== FLYING) continue;
      const reach = FIREBALL.radius * 2 + FIREBALL.deflectBonus;
      if (mine.pos.distanceTo(ePos) > reach) continue;
      // Both balls die where they met — iron on iron, sparks in both colours.
      mine.state = DEAD;
      mine.vel.set(0, 0, 0);
      enemy.hitCooldown = 0.6;
      enemy.state = DEAD;
      emberBurst(ePos, 14, true);
      emberBurst(ePos, 14, false);
      spawnFireImpact(this.world, ePos, 0, 1.2);
      sfx.ballClash();
      // Their copy of MY ball dies via my stream; tell them THEIR ball clashed.
      pubSendEvent({ e: 'FIGHT_CLASH', ball: idx });
      return true;
    }
    return false;
  }

  // --- streaming + remote rendering -------------------------------------------------

  private streamBalls(delta: number): void {
    if (!pub.online || !this.myBalls) return;
    this.streamTimer += delta;
    if (this.streamTimer < STREAM_INTERVAL) return;
    this.streamTimer = 0;
    const pack = (b: LocalBall): FireballNet => [b.pos.x, b.pos.y, b.pos.z, b.state];
    pubSendEvent({ e: 'FIGHT_FB', balls: [pack(this.myBalls[0]), pack(this.myBalls[1])] });
  }

  private onRemoteBalls(from: string, balls: [FireballNet, FireballNet]): void {
    if (from === pub.myId) return;
    let rec = this.remoteBalls.get(from);
    if (!rec) {
      const team = this.teamFor(from);
      const mk = (): RemoteBall => {
        const visual = createFireVisual(team);
        this.scene.add(visual.group);
        return {
          visual,
          target: new Vector3(),
          state: HOVER,
          heat: 0.8,
          trailAcc: 0,
          hitCooldown: 0,
          returnHit: 0,
          hasTarget: false,
        };
      };
      rec = [mk(), mk()];
      this.remoteBalls.set(from, rec);
    }
    for (const idx of [0, 1] as const) {
      const [x, y, z, state] = balls[idx];
      const prev = rec[idx].state;
      rec[idx].target.set(x, y, z);
      if (!rec[idx].hasTarget) {
        rec[idx].visual.group.position.set(x, y, z);
        rec[idx].hasTarget = true;
      }
      // Don't resurrect a ball we already ruled dead (hit/parry/clash) until the
      // owner's stream agrees it's back in play.
      if (!(prev === DEAD && state === FLYING && rec[idx].hitCooldown > 0)) {
        rec[idx].state = state;
      }
      // A fresh return leg re-arms the recall-through hit.
      if (rec[idx].state === RETURNING && prev !== RETURNING) rec[idx].returnHit = 0;
    }
  }

  private dropRemote(id: string): void {
    const balls = this.remoteBalls.get(id);
    if (!balls) return;
    for (const b of balls) {
      this.scene.remove(b.visual.group);
      b.visual.dispose();
    }
    this.remoteBalls.delete(id);
  }

  /** Shared heat/trail/ember styling for any ball, local or streamed. */
  private driveFireLook(
    visual: FireVisual,
    pos: Vector3,
    state: number,
    rec: { heat: number; trailAcc: number },
    delta: number,
    cool: boolean,
  ): void {
    const target =
      state === ORBIT ? 1.45 : state === FLYING ? 1.25 : state === RETURNING ? 1.35 : state === DEAD ? 0.18 : 0.8;
    rec.heat += (target - rec.heat) * Math.min(1, delta * 6);
    visual.update(this.time, rec.heat, _camQ);

    if (state === FLYING || state === RETURNING) {
      rec.trailAcc += delta;
      // Dense stamp (arena cadence) so the fat core particles overlap into one
      // thick molten rope.
      if (rec.trailAcc >= 0.009) {
        rec.trailAcc = 0;
        stampTrail(pos, cool);
      }
    } else if (state === ORBIT) {
      rec.trailAcc += delta;
      if (rec.trailAcc >= 0.09) {
        rec.trailAcc = 0;
        spawnEmber(pos, 0.5, cool);
      }
    }
  }

  // --- panels -------------------------------------------------------------------------

  private nameOf(id: string | null): string {
    if (!id) return '—';
    if (id === pub.myId) return pub.myName || 'YOU';
    return pub.punters.get(id)?.name ?? '???';
  }

  private renderConsoles(): void {
    const refs = pub.refs;
    if (!refs) return;
    const f = pub.fight;
    for (const side of [0, 1] as const) {
      const holder = f.sides[side];
      const corner = side === 0 ? 'EMBER CORNER' : 'BLUE CORNER';
      const colour = side === 0 ? '#ff7a18' : '#4fb7ff';
      const lines = [{ text: corner, size: 44, colour, bold: true }];
      if (!pub.online) {
        lines.push({ text: 'SERVER OFFLINE', size: 30, colour: '#e8352a', bold: false });
      } else if (holder) {
        lines.push({ text: this.nameOf(holder).toUpperCase(), size: 34, colour: '#e8ecf2', bold: true });
        if (holder === pub.myId && f.phase === 'idle') {
          lines.push({ text: 'TRIGGER TO STEP DOWN', size: 22, colour: '#9aa3b2', bold: false });
        }
      } else if (f.phase === 'idle') {
        lines.push({ text: 'PULL TRIGGER', size: 30, colour: '#ffb000', bold: true });
        lines.push({ text: 'TO TAKE THIS CORNER', size: 22, colour: '#9aa3b2', bold: false });
      } else {
        lines.push({ text: 'BOUT IN PROGRESS', size: 26, colour: '#9aa3b2', bold: false });
      }
      refs.consolePanels[side].setLines(lines);
    }
  }

  private renderDisplay(): void {
    // Both scoreboards (far wall + above the door) show the same thing — the
    // IRON BALLS sign hangs above each as its own image, so no title here,
    // just the two health bars and the status line, laid out by fraction so
    // it fits whatever panel height it's drawn on.
    for (const panel of [pub.refs?.fightDisplay, pub.refs?.fightDisplay2]) {
      if (panel) this.drawBoard(panel);
    }
  }

  private drawBoard(panel: import('../panel.js').Panel): void {
    const f = pub.fight;
    panel.draw((ctx, w, h) => {
      const names = [this.nameOf(f.sides[0]), this.nameOf(f.sides[1])];
      const colours = ['#ff7a18', '#4fb7ff'];
      const barW = w * 0.4;
      const nameY = h * 0.28;
      const barY = h * 0.38;
      const barH = h * 0.2;
      for (const side of [0, 1] as const) {
        const x = side === 0 ? w * 0.05 : w * 0.55;
        ctx.textAlign = side === 0 ? 'left' : 'right';
        ctx.font = `900 ${Math.round(h * 0.14)}px "Arial Black", system-ui, sans-serif`;
        ctx.fillStyle = colours[side];
        ctx.fillText(names[side].toUpperCase().slice(0, 12), side === 0 ? x : x + barW, nameY);
        ctx.fillStyle = 'rgba(172,182,198,0.25)';
        ctx.fillRect(x, barY, barW, barH);
        const hp = Math.max(0, f.hp[side]) / FIGHT.hpMax;
        ctx.fillStyle = colours[side];
        const fillW = barW * hp;
        ctx.fillRect(side === 0 ? x : x + barW - fillW, barY, fillW, barH);
        ctx.strokeStyle = 'rgba(232,236,242,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, barY, barW, barH);
      }

      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.round(h * 0.17)}px "Arial Black", system-ui, sans-serif`;
      const status =
        f.phase === 'idle'
          ? 'CHALLENGERS WANTED'
          : f.phase === 'starting'
            ? 'FIGHTERS READY…'
            : f.phase === 'fighting'
              ? 'FIGHT!'
              : `${this.nameOf(f.winner).toUpperCase()} WINS`;
      ctx.fillStyle = f.phase === 'fighting' ? '#e8352a' : '#e8ecf2';
      ctx.fillText(status, w / 2, h * 0.82);
    });
  }
}
