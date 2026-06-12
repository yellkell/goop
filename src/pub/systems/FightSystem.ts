/**
 * FIRE FIGHT in the fight hall — the main game's duel, on display for the
 * whole pub.
 *
 * Flow: pull the trigger at a corner console to claim that platform (you're
 * teleported onto it). When both corners are claimed the server counts down
 * and the fight is ON — everyone else in the social space can gather round
 * the hazard line and watch, or wander back to the pub.
 *
 * The fireball mechanics are the arena's, ported onto pub networking:
 *  - hold trigger/grip → the ball ORBITS your fist, spinning up;
 *  - release mid-punch → it FLIES along your swing (aim-assisted toward the
 *    other fighter), arcs under light gravity, dies on the cage — which in
 *    here is pulled in to FIVE yards from the platform rims so the duel
 *    fits indoors;
 *  - trigger while it's away → it RETURNS to your fist.
 *
 * Hits are victim-authoritative (you rule on balls hitting YOUR head/torso,
 * exactly like the arena's net protocol); each fighter streams their two
 * balls at 20 Hz so spectators see the whole exchange. First to 0 hp loses;
 * leaving your platform forfeits.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Quaternion, Vector3 } from 'three';
import type { XROrigin } from '@iwsdk/xr-input';
import { BODY_IK, FIREBALL } from '../../config.js';
import {
  createFireVisual,
  emberBurst,
  spawnEmber,
  stampTrail,
  updateFirePools,
  type FireVisual,
} from '../../fx/fire.js';
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
const _body = new Vector3();

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

  init(): void {
    this.cleanupFuncs.push(
      bus.on('fight', (f) => this.onFight(f)),
      bus.on('gameEvent', ({ from, ev }) => {
        switch (ev.e) {
          case 'FIGHT_FB':
            this.onRemoteBalls(from, ev.balls);
            break;
          case 'FIGHT_HIT':
            // My ball connected on their side — it's spent.
            if (this.amFighter() && this.myBalls) {
              const ball = this.myBalls[ev.ball];
              if (ball.state === FLYING || ball.state === RETURNING) {
                ball.state = DEAD;
                emberBurst(ball.pos, 14, this.mySide() === 1);
              }
              sfx.hitDealt();
            }
            break;
          case 'FIGHT_DEFLECT':
            if (this.amFighter() && this.myBalls) {
              const ball = this.myBalls[ev.ball];
              if (ball.state === FLYING) ball.state = DEAD;
              sfx.deflect();
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

  update(delta: number): void {
    this.time += delta;
    this.consoleCooldown = Math.max(0, this.consoleCooldown - delta);
    updateFirePools(delta);
    this.camera.getWorldQuaternion(_camQ);

    this.checkConsoles();

    const f = pub.fight;
    const fighting = f.phase === 'fighting';
    const live = f.phase === 'starting' || fighting;

    if (this.amFighter() && live) {
      this.ensureMyBalls();
      this.updateMyBalls(delta, fighting);
      this.checkForfeit();
      this.checkIncomingHits(fighting);
      this.streamBalls(delta);
    } else if (this.myBalls && f.phase === 'idle') {
      this.disposeMyBalls();
    }

    // Remote fighters' balls: ease to targets, drive the fire look.
    for (const [id, balls] of this.remoteBalls) {
      if (f.phase === 'idle' || !f.sides.includes(id)) {
        for (const b of balls) b.visual.dispose();
        for (const b of balls) this.scene.remove(b.visual.group);
        this.remoteBalls.delete(id);
        continue;
      }
      const side = f.sides[1] === id ? 1 : 0;
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
        this.driveFireLook(b.visual, b.visual.group.position, b.state, b, delta, side === 1);
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
        // Take your corner: feet on the platform, facing your opponent.
        const z = side === 0 ? FIGHT.platformZ : -FIGHT.platformZ;
        teleportPlayer(this.player as XROrigin, FIGHT.centerX, z, side === 0 ? Math.PI : 0);
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

  // --- my fireballs (the arena state machine, pub coordinates) --------------------

  private ensureMyBalls(): void {
    if (this.myBalls) return;
    const side = this.mySide();
    const mk = (hand: Hand): LocalBall => {
      const visual = createFireVisual(side === 1 ? 1 : 0);
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
    const side = this.mySide();
    const cool = side === 1;

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
          if (ball.elapsed >= FIREBALL.lifetime || ball.pos.y <= FIREBALL.radius) {
            ball.state = DEAD;
            ball.pos.y = Math.max(ball.pos.y, FIREBALL.radius);
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
          if (ball.pos.y > FIREBALL.radius) {
            ball.pos.y = Math.max(FIREBALL.radius, ball.pos.y - 2.5 * delta);
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
    // Head, chest and pelvis spheres hung under the tracked head — the same
    // proportions the arena's IK hitboxes use.
    const spheres: [Vector3, number][] = [
      [_head, BODY_IK.headRadius],
      [_body.copy(_head).setY(Math.max(0.4, _head.y - 0.45)), BODY_IK.chestRadius],
    ];

    for (const idx of [0, 1] as const) {
      const enemy = balls[idx];
      if (enemy.state !== FLYING || enemy.hitCooldown > 0 || !enemy.hasTarget) continue;

      // Parry first: my orbiting/returning ball knocks it out of the air.
      if (this.myBalls) {
        for (const mine of this.myBalls) {
          if (mine.state !== ORBIT && mine.state !== RETURNING) continue;
          const r = FIREBALL.radius * 2 + FIREBALL.deflectBonus;
          if (mine.pos.distanceTo(enemy.visual.group.position) <= r) {
            enemy.hitCooldown = 0.6;
            enemy.state = DEAD;
            emberBurst(enemy.visual.group.position, 10, true);
            sfx.deflect();
            pubSendEvent({ e: 'FIGHT_DEFLECT', ball: idx });
            break;
          }
        }
        if (enemy.hitCooldown > 0) continue;
      }

      for (const [centre, radius] of spheres) {
        if (enemy.visual.group.position.distanceTo(centre) <= radius + FIREBALL.radius) {
          enemy.hitCooldown = 0.8;
          enemy.state = DEAD;
          this.myHp = Math.max(0, this.myHp - FIREBALL.damage);
          emberBurst(enemy.visual.group.position, 16, true);
          sfx.hitTaken();
          pulseHand(this.world.session, 'left', 1, 120);
          pulseHand(this.world.session, 'right', 1, 120);
          pubSendEvent({ e: 'FIGHT_HIT', ball: idx });
          pubSendEvent({ e: 'FIGHT_HP', hp: this.myHp });
          break;
        }
      }
    }
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
      const side = pub.fight.sides[1] === from ? 1 : 0;
      const mk = (): RemoteBall => {
        const visual = createFireVisual(side === 1 ? 1 : 0);
        this.scene.add(visual.group);
        return {
          visual,
          target: new Vector3(),
          state: HOVER,
          heat: 0.8,
          trailAcc: 0,
          hitCooldown: 0,
          hasTarget: false,
        };
      };
      rec = [mk(), mk()];
      this.remoteBalls.set(from, rec);
    }
    for (const idx of [0, 1] as const) {
      const [x, y, z, state] = balls[idx];
      rec[idx].target.set(x, y, z);
      if (!rec[idx].hasTarget) {
        rec[idx].visual.group.position.set(x, y, z);
        rec[idx].hasTarget = true;
      }
      // Don't resurrect a ball we already ruled dead (hit/parry) until the
      // owner's stream agrees it's back in play.
      if (!(rec[idx].state === DEAD && state === FLYING && rec[idx].hitCooldown > 0)) {
        rec[idx].state = state;
      }
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
      if (rec.trailAcc >= 0.012) {
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
    const panel = pub.refs?.fightDisplay;
    if (!panel) return;
    const f = pub.fight;
    panel.draw((ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.font = '900 120px "Arial Black", system-ui, sans-serif';
      ctx.fillStyle = '#ffb000';
      ctx.fillText('FIRE FIGHT', w / 2, 150);

      const names = [this.nameOf(f.sides[0]), this.nameOf(f.sides[1])];
      const colours = ['#ff7a18', '#4fb7ff'];
      const barW = w * 0.38;
      for (const side of [0, 1] as const) {
        const x = side === 0 ? w * 0.06 : w * 0.56;
        ctx.textAlign = side === 0 ? 'left' : 'right';
        ctx.font = '900 64px "Arial Black", system-ui, sans-serif';
        ctx.fillStyle = colours[side];
        ctx.fillText(names[side].toUpperCase().slice(0, 12), side === 0 ? x : x + barW, 280);
        // HP bar.
        ctx.fillStyle = 'rgba(172,182,198,0.25)';
        ctx.fillRect(x, 320, barW, 52);
        const hp = Math.max(0, f.hp[side]) / FIGHT.hpMax;
        ctx.fillStyle = colours[side];
        const fillW = barW * hp;
        ctx.fillRect(side === 0 ? x : x + barW - fillW, 320, fillW, 52);
        ctx.strokeStyle = 'rgba(232,236,242,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, 320, barW, 52);
      }

      ctx.textAlign = 'center';
      ctx.font = '900 72px "Arial Black", system-ui, sans-serif';
      const status =
        f.phase === 'idle'
          ? 'CHALLENGERS WANTED'
          : f.phase === 'starting'
            ? 'FIGHTERS READY…'
            : f.phase === 'fighting'
              ? 'FIGHT!'
              : `${this.nameOf(f.winner).toUpperCase()} WINS`;
      ctx.fillStyle = f.phase === 'fighting' ? '#e8352a' : '#e8ecf2';
      ctx.fillText(status, w / 2, h - 130);
    });
  }
}
