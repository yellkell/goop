/**
 * The practice bots. A bot does NOT move an entity — it writes an opponent pose
 * bus slot (head/hand poses) like a phantom player and queues ball commands, so
 * downstream (OpponentSystem, FireballSystem, CollisionSystem) treats it exactly
 * like a remote human. That keeps bot bouts and online bouts on one code path.
 *
 * The classic duel runs one bot; arcade 2v2 / FFA run one per other-fighter
 * slot. Each bot strafes and bobs on its own platform, reactively dodges
 * incoming balls, keeps a guard, winds a ball up and hurls it at its NEAREST
 * enemy on a cadence, then recalls it.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { Fireball, BallState } from '../components/Fireball.js';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { ballCommands, opponents } from '../combat/opponentBus.js';
import { fighterTeam } from '../combat/fighters.js';
import { localLayout } from '../combat/layout.js';
import { match } from '../combat/matchState.js';
import { app } from '../menu/appState.js';
import { BOT, FIREBALL } from '../config.js';

const _head = new Vector3(); // local player's head
const _ballPos = new Vector3();
const _aim = new Vector3();
const _vel = new Vector3();
const _look = new Quaternion();
const _pitchQ = new Quaternion();
const _tmp = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _botHead = new Vector3();
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Per-bot drift + cadence state. */
class Bot {
  targetX = 0;
  targetY = BOT.headY;
  targetZ = 0;
  x = 0;
  y = BOT.headY;
  z = 0;
  moveTimer = 1;
  throwTimer = BOT.throwInterval;
  windupHand: 0 | 1 = 0;
  windup = -1; // <0 idle, else counts down to release
  recallTimers: [number, number] = [-1, -1];
  guardPhase = 0;
  constructor(public readonly slot: number) {
    this.throwTimer = BOT.throwInterval * (0.7 + Math.random() * 0.8); // stagger the fire
  }
}

export class BotSystem extends createSystem({
  balls: { required: [Fireball] },
  combatants: { required: [Combatant, Health] },
}) {
  private bots: Bot[] = [];

  /** A bot is out once knocked to 0 health this round. */
  private dead(slot: number): boolean {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? -1) === slot) return (e.getValue(Health, 'current') ?? 1) <= 0;
    }
    return false;
  }

  update(delta: number): void {
    if (app.state !== 'playing' || app.mode !== 'bot') return;
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    headObj.getWorldPosition(_head);

    const roster = localLayout();
    for (let slot = 1; slot < roster.length; slot++) {
      const i = slot - 1;
      const pose = opponents[i];
      if (!pose.active) continue;
      // Knocked out: stop throwing/moving and go cold until the round resets.
      if (this.dead(slot)) {
        pose.orbiting[0] = pose.orbiting[1] = false;
        continue;
      }
      const bot = (this.bots[i] ??= new Bot(slot));
      const seat = roster[slot];
      const myTeam = seat.team;

      this.move(bot, seat.pos[0], seat.pos[2], myTeam, delta);
      // Aim/face the nearest enemy; with none in range the bot just guards.
      const target = this.nearestEnemy(bot, seat.pos[0], seat.pos[2], myTeam);
      this.pose(bot, seat.pos[0], seat.pos[2], target, delta);
      if (match.phase === 'playing' && target) {
        this.fight(bot, target, delta);
      } else {
        bot.windup = -1;
        pose.orbiting[0] = pose.orbiting[1] = false;
      }
    }
  }

  /** Nearest fighter on a different team (out param reused via _aim is unsafe —
   *  returns a fresh Vector3 or null). */
  private nearestEnemy(bot: Bot, padX: number, padZ: number, myTeam: number): Vector3 | null {
    _botHead.set(padX + bot.x, bot.y, padZ + bot.z);
    let best: Vector3 | null = null;
    let bestD = Infinity;
    const consider = (pos: Vector3): void => {
      const d = pos.distanceToSquared(_botHead);
      if (d < bestD) {
        bestD = d;
        best = pos.clone();
      }
    };
    if (myTeam !== fighterTeam(0)) consider(_head); // the local player
    const roster = localLayout();
    for (let slot = 1; slot < roster.length; slot++) {
      if (slot === bot.slot) continue;
      const other = opponents[slot - 1];
      if (!other.active || roster[slot].team === myTeam) continue;
      consider(other.headPos);
    }
    return best;
  }

  /** Strafe + duck targets, with reactive dodges off incoming enemy balls. */
  private move(bot: Bot, padX: number, padZ: number, myTeam: number, delta: number): void {
    bot.moveTimer -= delta;
    if (bot.moveTimer <= 0) {
      const r = Math.random();
      if (r < 0.2) bot.targetX = bot.x + (Math.random() * 0.5 - 0.25);
      else if (r < 0.45) bot.targetX = Math.random() * 0.6 - 0.3;
      else bot.targetX = (Math.random() * 2 - 1) * BOT.padHalfWidth;
      bot.targetX = clamp(bot.targetX, -BOT.padHalfWidth, BOT.padHalfWidth);

      const d = Math.random();
      if (d < 0.25) bot.targetY = BOT.headYMin + Math.random() * 0.2;
      else if (d < 0.4) bot.targetY = BOT.headYMax - Math.random() * 0.1;
      else bot.targetY = BOT.headY + (Math.random() * 0.24 - 0.12);
      bot.targetY = clamp(bot.targetY, BOT.headYMin, BOT.headYMax);

      bot.targetZ = clamp((Math.random() * 2 - 1) * 0.5, -0.5, 0.5);
      bot.moveTimer = Math.random() < 0.3 ? 0.35 + Math.random() * 0.5 : 0.9 + Math.random() * 1.1;
    }

    // Reactive dodge: an enemy ball flying near the bot pushes it aside.
    _botHead.set(padX + bot.x, bot.y, padZ + bot.z);
    for (const ball of this.queries.balls.entities) {
      if ((ball.getValue(Fireball, 'state') ?? 0) !== BallState.Flying) continue;
      if (fighterTeam(ball.getValue(Fireball, 'owner') ?? 0) === myTeam) continue;
      const obj = ball.object3D;
      if (!obj) continue;
      obj.getWorldPosition(_ballPos);
      if (_ballPos.distanceTo(_botHead) < BOT.reactDistance) {
        const away = Math.sign(bot.x - (_ballPos.x - padX)) || (Math.random() < 0.5 ? -1 : 1);
        bot.targetX = clamp(bot.x + away * 0.6, -BOT.padHalfWidth, BOT.padHalfWidth);
        bot.targetY = _ballPos.y > bot.y - 0.15 ? BOT.headYMin : BOT.headYMax;
        bot.targetZ = -0.5;
        break;
      }
    }

    const stepX = BOT.moveSpeed * delta;
    const dx = bot.targetX - bot.x;
    bot.x += Math.abs(dx) <= stepX ? dx : Math.sign(dx) * stepX;
    const stepY = BOT.duckSpeed * delta;
    const dy = bot.targetY - bot.y;
    bot.y += Math.abs(dy) <= stepY ? dy : Math.sign(dy) * stepY;
    const stepZ = BOT.moveSpeed * 0.8 * delta;
    const dz = bot.targetZ - bot.z;
    bot.z += Math.abs(dz) <= stepZ ? dz : Math.sign(dz) * stepZ;
  }

  /** Write the phantom body onto the bot's bus slot, facing `target`. */
  private pose(bot: Bot, padX: number, padZ: number, target: Vector3 | null, delta: number): void {
    bot.guardPhase += delta;
    const pose = opponents[bot.slot - 1];
    _botHead.set(padX + bot.x, bot.y, padZ + bot.z);
    pose.headPos.copy(_botHead);

    // Face the target (or straight off the platform if there's none) as a
    // stable yaw + clamped pitch — no roll, no owl-necking.
    if (target) _tmp.copy(target).sub(_botHead);
    else _tmp.set(padX === 0 ? 0 : -padX, 0, padZ === 0 ? -1 : -padZ); // look toward centre
    const yaw = Math.atan2(-_tmp.x, -_tmp.z);
    const horiz = Math.hypot(_tmp.x, _tmp.z) || 1e-4;
    const pitch = clamp(Math.atan2(_tmp.y, horiz), -BOT.headPitchMax, BOT.headPitchMax);
    _look.setFromAxisAngle(UP, yaw).multiply(_pitchQ.setFromAxisAngle(RIGHT, pitch));
    pose.headQuat.slerp(_look, Math.min(1, delta * BOT.headTurnSpeed));

    // Forward/right in the floor plane for placing the guard relative to facing.
    _fwd.set(-_tmp.x, 0, -_tmp.z);
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.set(_fwd.z, 0, -_fwd.x);

    for (const hand of [0, 1] as const) {
      const side = hand === 0 ? -1 : 1;
      const bob = Math.sin(bot.guardPhase * 2.4 + hand * 1.7) * 0.02;
      const winding = bot.windup >= 0 && bot.windupHand === hand;
      const gy = bot.y - (winding ? 0.05 : 0.18) + bob;
      _tmp
        .set(_botHead.x, gy, _botHead.z)
        .addScaledVector(_right, side * (winding ? 0.34 : 0.22))
        .addScaledVector(_fwd, winding ? -0.16 : 0.18); // wind back, guard forward
      pose.handPos[hand].lerp(_tmp, Math.min(1, delta * 9));
      pose.handQuat[hand].copy(pose.headQuat);
      pose.fisting[hand] = false;
    }
  }

  /** Cadenced wind-up → throw → recall, alternating fists. */
  private fight(bot: Bot, target: Vector3, delta: number): void {
    const pose = opponents[bot.slot - 1];
    for (const hand of [0, 1] as const) {
      if (bot.recallTimers[hand] >= 0) {
        bot.recallTimers[hand] -= delta;
        if (bot.recallTimers[hand] < 0) ballCommands.push({ type: 'recall', slot: bot.slot - 1, hand });
      }
    }

    if (bot.windup >= 0) {
      bot.windup -= delta;
      if (bot.windup < 0) this.release(bot, target);
      return;
    }

    bot.throwTimer -= delta;
    if (bot.throwTimer <= 0) {
      bot.throwTimer = BOT.throwInterval * (0.8 + Math.random() * 0.5);
      bot.windupHand = bot.windupHand === 0 ? 1 : 0;
      bot.windup = BOT.windup;
      pose.orbiting[bot.windupHand] = true;
    }
  }

  private release(bot: Bot, target: Vector3): void {
    const hand = bot.windupHand;
    const pose = opponents[bot.slot - 1];
    pose.orbiting[hand] = false;

    _aim.copy(target);
    _aim.y -= 0.15; // bias to the chest
    _aim.x += (Math.random() - 0.5) * 2 * BOT.aimError;
    _aim.y += (Math.random() - 0.5) * 2 * BOT.aimError;

    const from = pose.handPos[hand].clone();
    _vel.copy(_aim).sub(from);
    const dist = _vel.length();
    _vel.normalize().multiplyScalar(BOT.throwSpeed);
    _vel.y += 0.5 * FIREBALL.gravity * (dist / BOT.throwSpeed); // lead the arc

    ballCommands.push({ type: 'throw', slot: bot.slot - 1, hand, pos: from, vel: _vel.clone() });
    bot.recallTimers[hand] = BOT.recallDelay;
  }
}
