/**
 * AIM TRAINING — the heart of getting good at FIRE FIGHT.
 *
 * Classic targets pop up across the gap: bullseye discs and humanoid cutouts.
 * They rise, hold a beat, and sink away; land a ball while one is up to score.
 * Streaks multiply points; letting a target leave untouched breaks the
 * streak. The cadence ramps up over the run.
 *
 * Flip SHOOT BACK on and the cutouts take pot-shots at you with blue fire so
 * you train dodging between throws. Your health regens in training; the run
 * ends at the bell (or early if you go down).
 *
 * THE CLOSING STRETCH: once fewer than TRAINING.bonusWindow seconds remain,
 * gold OCTA DRONES join the spawn mix — small strafing octagon plates (the
 * pub's octa-hunt targets, ported to the range) that demand a led shot and
 * pay a jackpot.
 */

import { createSystem, Vector3, type Entity } from '@iwsdk/core';
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { TargetKind, TargetState, TrainingTarget } from '../components/TrainingTarget.js';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { ballCommands } from '../combat/opponentBus.js';
import { match } from '../combat/matchState.js';
import { app, saveStats, training } from '../menu/appState.js';
import { reportTraining } from '../net/leaderboard.js';
import { emberBurst } from '../fx/fire.js';
import * as sfx from '../audio/sfx.js';
import { ARENA_GAP, FIREBALL, PALETTE, TRAINING } from '../config.js';

const _pos = new Vector3();
const _aim = new Vector3();
const _vel = new Vector3();
const _head = new Vector3();

/** Canvas bullseye: classic red/white rings. */
function discTexture(): CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const rings: Array<[number, string]> = [
    [0.5, '#e8352a'], [0.4, '#f4f6fb'], [0.3, '#e8352a'], [0.2, '#f4f6fb'], [0.1, '#e8352a'],
  ];
  for (const [r, c] of rings) {
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * r, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  }
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  return tex;
}

/** Canvas humanoid cutout: head + shoulders silhouette with a chest bullseye. */
function cutoutTexture(): CanvasTexture {
  const W = 256;
  const H = 384;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#243042';
  // Head.
  ctx.beginPath();
  ctx.arc(W / 2, 70, 52, 0, Math.PI * 2);
  ctx.fill();
  // Shoulders/torso.
  ctx.beginPath();
  ctx.moveTo(18, H);
  ctx.quadraticCurveTo(24, 150, W / 2 - 60, 128);
  ctx.quadraticCurveTo(W / 2, 118, W / 2 + 60, 128);
  ctx.quadraticCurveTo(W - 24, 150, W - 18, H);
  ctx.closePath();
  ctx.fill();
  // Chest bullseye (the scoring zone).
  const cy = 240;
  for (const [r, c] of [[58, '#4fb7ff'], [42, '#f4f6fb'], [26, '#4fb7ff'], [12, '#f4f6fb']] as Array<[number, string]>) {
    ctx.beginPath();
    ctx.arc(W / 2, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  }
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  return tex;
}

/**
 * Canvas octa-target face — pub OCTA HUNT style: concentric gold-and-black
 * octagon rings around a gold centre.
 */
function octaTexture(): CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const octagon = (r: number): void => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = S / 2 + Math.cos(a) * r;
      const y = S / 2 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  const rings: Array<[number, string]> = [
    [0.5, '#ffd700'], [0.38, '#15161a'], [0.27, '#ffd700'], [0.16, '#15161a'], [0.08, '#ffd700'],
  ];
  for (const [r, c] of rings) {
    octagon(S * r);
    ctx.fillStyle = c;
    ctx.fill();
  }
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  return tex;
}

let discTex: CanvasTexture | undefined;
let cutoutTex: CanvasTexture | undefined;
let octaTex: CanvasTexture | undefined;

export class TrainingSystem extends createSystem({
  targets: { required: [TrainingTarget] },
  combatants: { required: [Combatant, Health] },
}) {
  private spawnTimer = 1.2;
  private elapsed = 0;
  private regenCooldown = 0;
  private wasTraining = false;
  private lastHp = 100;

  update(delta: number): void {
    if (app.state !== 'training') {
      if (this.wasTraining) this.teardown(false);
      return;
    }

    if (!this.wasTraining) this.begin();

    this.elapsed += delta;
    training.timeLeft = Math.max(0, TRAINING.sessionTime - this.elapsed);

    const me = this.me();
    const hp = me?.getValue(Health, 'current') ?? 100;
    if (hp < this.lastHp) this.regenCooldown = TRAINING.regenDelay;
    this.lastHp = hp;

    // Training regen.
    if (me && hp > 0 && hp < (me.getValue(Health, 'max') ?? 100)) {
      this.regenCooldown -= delta;
      if (this.regenCooldown <= 0) {
        me.setValue(
          Health,
          'current',
          Math.min(me.getValue(Health, 'max') ?? 100, hp + TRAINING.regenPerSec * delta),
        );
      }
    }

    // Run over: bell rang or you went down.
    if (training.timeLeft <= 0 || hp <= 0) {
      this.teardown(true);
      return;
    }

    this.spawn(delta);
    this.animate(delta);
  }

  // --- session lifecycle ---------------------------------------------------

  private begin(): void {
    this.wasTraining = true;
    this.elapsed = 0;
    this.spawnTimer = 1.0;
    this.regenCooldown = 0;
    training.active = true;
    training.score = 0;
    training.hits = 0;
    training.thrown = 0;
    training.streak = 0;
    training.bestStreak = 0;
    training.timeLeft = TRAINING.sessionTime;
    const me = this.me();
    me?.setValue(Health, 'current', me.getValue(Health, 'max') ?? 100);
    this.lastHp = 100;
    match.resetCount += 1; // park the fireballs at your fists
    match.message = '';
    sfx.roundBell();
  }

  private teardown(finished: boolean): void {
    this.wasTraining = false;
    training.active = false;
    for (const t of [...this.queries.targets.entities]) this.despawn(t);
    if (finished) {
      training.lastScore = training.score;
      if (training.score > app.stats.trainingBest) {
        app.stats.trainingBest = training.score;
      }
      saveStats();
      reportTraining(training.score); // leaderboard personal best
      sfx.matchEnd(training.score > 0);
      app.state = 'menu';
    }
  }

  // --- target lifecycle ------------------------------------------------------

  private spawn(delta: number): void {
    this.spawnTimer -= delta;
    if (this.spawnTimer > 0) return;

    // Cadence ramps from spawnInterval down to minInterval over rampTime.
    const ramp = Math.min(1, this.elapsed / TRAINING.rampTime);
    const interval = TRAINING.spawnInterval + (TRAINING.minInterval - TRAINING.spawnInterval) * ramp;
    this.spawnTimer = interval * (0.75 + Math.random() * 0.5);

    let live = 0;
    for (const t of this.queries.targets.entities) {
      const st = t.getValue(TrainingTarget, 'state') ?? 0;
      if (st === TargetState.Rising || st === TargetState.Holding) live++;
    }
    if (live >= TRAINING.maxLive) return;

    // The closing stretch mixes gold octa drones in with the regulars.
    const droneWindow = training.timeLeft <= TRAINING.bonusWindow;
    const kind =
      droneWindow && Math.random() < TRAINING.droneChance
        ? TargetKind.Drone
        : Math.random() < 0.5
          ? TargetKind.Disc
          : TargetKind.Cutout;

    const drone = kind === TargetKind.Drone;
    // Keep a drone's whole strafe lane on the range.
    const x = (Math.random() * 2 - 1) * (drone ? 1.3 - TRAINING.droneDriftAmp : 1.3);
    const z = -ARENA_GAP + (Math.random() * 1.6 - 0.5);
    const upY =
      kind === TargetKind.Disc ? 1.0 + Math.random() * 0.9 :
      kind === TargetKind.Cutout ? 1.25 :
      1.35 + Math.random() * 0.5; // drones fly high
    const radius =
      kind === TargetKind.Disc ? TRAINING.discRadius :
      kind === TargetKind.Cutout ? TRAINING.cutoutRadius :
      TRAINING.droneRadius;
    const holdTime = drone
      ? TRAINING.droneHold * (0.9 + Math.random() * 0.3)
      : TRAINING.holdTime * (0.85 + Math.random() * 0.5);

    const e = this.buildTargetEntity(kind);
    const obj = e.object3D!;
    obj.position.set(x, upY - 1.4, z); // start sunken; rises into place
    obj.lookAt(x * 2, upY, ARENA_GAP); // face the player's platform
    e.addComponent(TrainingTarget, {
      kind,
      state: TargetState.Rising,
      age: 0,
      holdTime,
      radius,
      upY,
      shootTimer:
        kind === TargetKind.Cutout && app.shootBack && Math.random() < TRAINING.shootChance
          ? TRAINING.shootDelay
          : -1,
      baseX: x,
      driftAmp: drone ? TRAINING.droneDriftAmp * (0.8 + Math.random() * 0.4) : 0,
      driftRate: drone ? TRAINING.droneDriftRate * (0.85 + Math.random() * 0.4) : 0,
    });
  }

  private animate(delta: number): void {
    for (const t of [...this.queries.targets.entities]) {
      const obj = t.object3D;
      if (!obj) continue;
      const state = t.getValue(TrainingTarget, 'state') ?? 0;
      const age = (t.getValue(TrainingTarget, 'age') ?? 0) + delta;
      t.setValue(TrainingTarget, 'age', age);
      const upY = t.getValue(TrainingTarget, 'upY') ?? 1.3;

      switch (state) {
        case TargetState.Rising: {
          const k = Math.min(1, age / 0.3);
          obj.position.y = upY - 1.4 * (1 - k) * (1 - k);
          if (k >= 1) {
            t.setValue(TrainingTarget, 'state', TargetState.Holding);
            t.setValue(TrainingTarget, 'age', 0);
          }
          break;
        }
        case TargetState.Holding: {
          obj.position.y = upY + Math.sin(age * 3) * 0.02;
          // Octa drones strafe their lane — lead the shot. The plate (the
          // group's first child) twirls around its own axis so the octagon
          // visibly spins without swinging its face off the player.
          const amp = t.getValue(TrainingTarget, 'driftAmp') ?? 0;
          if (amp > 0) {
            const base = t.getValue(TrainingTarget, 'baseX') ?? 0;
            const rate = t.getValue(TrainingTarget, 'driftRate') ?? 0;
            obj.position.x = base + Math.sin(age * rate) * amp;
            obj.children[0].rotation.y += delta * 3;
          }
          this.maybeShoot(t, delta);
          if (age >= (t.getValue(TrainingTarget, 'holdTime') ?? 2.6)) {
            t.setValue(TrainingTarget, 'state', TargetState.Leaving);
            t.setValue(TrainingTarget, 'age', 0);
            // An untouched target breaks the streak.
            training.streak = 0;
          }
          break;
        }
        case TargetState.Leaving: {
          const k = Math.min(1, age / 0.35);
          obj.position.y = upY - 1.4 * k * k;
          if (k >= 1) this.despawn(t);
          break;
        }
        case TargetState.Falling: {
          // Just hit (CollisionSystem set this with age 0): score it once.
          if (age <= delta + 1e-6) this.score(t);
          obj.rotation.x += delta * 5;
          obj.position.y -= delta * 1.8;
          if (age >= 0.6) this.despawn(t);
          break;
        }
      }
    }
  }

  /** Cutouts with a live shootTimer take one blue pot-shot at you. */
  private maybeShoot(t: Entity, delta: number): void {
    const timer = t.getValue(TrainingTarget, 'shootTimer') ?? -1;
    if (timer < 0) return;
    const next = timer - delta;
    t.setValue(TrainingTarget, 'shootTimer', next);
    if (next > 0) return;
    t.setValue(TrainingTarget, 'shootTimer', -1);

    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj || !t.object3D) return;
    headObj.getWorldPosition(_head);
    t.object3D.getWorldPosition(_pos);
    _pos.y = (t.getValue(TrainingTarget, 'upY') ?? 1.3) + 0.1;

    _aim.copy(_head);
    _aim.y -= 0.1;
    _aim.x += (Math.random() - 0.5) * 0.3;
    _vel.copy(_aim).sub(_pos);
    const dist = _vel.length();
    _vel.normalize().multiplyScalar(TRAINING.shotSpeed);
    // Lead the gravity drop so the arc lands on target.
    _vel.y += 0.5 * FIREBALL.gravity * (dist / TRAINING.shotSpeed);

    ballCommands.push({ type: 'transient', pos: _pos.clone(), vel: _vel.clone(), damage: TRAINING.shotDamage });
    sfx.throwWhoosh();
  }

  private score(t: Entity): void {
    const kind = t.getValue(TrainingTarget, 'kind') ?? 0;
    training.hits += 1;
    training.streak += 1;
    training.bestStreak = Math.max(training.bestStreak, training.streak);
    const base =
      kind === TargetKind.Disc ? TRAINING.discPoints :
      kind === TargetKind.Cutout ? TRAINING.cutoutPoints :
      TRAINING.dronePoints;
    training.score += base + TRAINING.streakBonus * (training.streak - 1);
    if (t.object3D) {
      t.object3D.getWorldPosition(_pos);
      // A downed octa drone rains gold.
      emberBurst(_pos, kind === TargetKind.Drone ? 26 : 10, false);
    }
  }

  private despawn(t: Entity): void {
    t.object3D?.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    t.destroy();
  }

  // --- target meshes -----------------------------------------------------------

  private buildTargetEntity(kind: number): Entity {
    const group = new Group();

    if (kind === TargetKind.Drone) {
      // The gold OCTA drone — the pub's octa-hunt target on the range: a flat
      // eight-sided plate (concentric gold/black octagon rings on both faces,
      // glowing gold rim) that hangs in the air with no stick and spins
      // in-plane while it strafes. TrainingSystem drives the motion.
      octaTex ??= octaTexture();
      const plate = new Mesh(
        new CylinderGeometry(TRAINING.droneRadius * 1.2, TRAINING.droneRadius * 1.2, 0.03, 8),
        [
          new MeshStandardMaterial({
            color: PALETTE.iron,
            emissive: 0xffd700,
            emissiveIntensity: 0.9,
            metalness: 0.7,
            roughness: 0.35,
          }),
          new MeshBasicMaterial({ map: octaTex }),
          new MeshBasicMaterial({ map: octaTex }),
        ],
      );
      plate.rotation.x = Math.PI / 2; // cap faces the player
      group.add(plate);
      return this.world.createTransformEntity(group);
    }

    if (kind === TargetKind.Disc) {
      discTex ??= discTexture();
      // A thin drum on a stick: bullseye on the flat faces, iron at the rim.
      const face = new Mesh(
        new CylinderGeometry(TRAINING.discRadius, TRAINING.discRadius, 0.03, 28),
        [
          new MeshStandardMaterial({ color: PALETTE.iron, metalness: 0.7, roughness: 0.4 }),
          new MeshBasicMaterial({ map: discTex }),
          new MeshBasicMaterial({ map: discTex }),
        ],
      );
      face.rotation.x = Math.PI / 2; // cap faces the player
      group.add(face);
      const stick = new Mesh(
        new CylinderGeometry(0.02, 0.02, 1.4, 8),
        new MeshStandardMaterial({ color: PALETTE.iron, metalness: 0.6, roughness: 0.5 }),
      );
      stick.position.y = -0.7;
      group.add(stick);
    } else {
      cutoutTex ??= cutoutTexture();
      // Flat range cutout, 0.5 x 0.75 m; the chest bullseye is drawn at 62.5%
      // down the texture, so shift the board up so that point sits at y = 0.
      const board = new Mesh(
        new PlaneGeometry(0.5, 0.75),
        // alphaTest discards the see-through texels in the depth pass too —
        // without it the whole quad writes depth and a ball flying behind
        // the cutout vanishes inside an invisible square.
        new MeshBasicMaterial({ map: cutoutTex, transparent: true, alphaTest: 0.5, side: DoubleSide }),
      );
      board.position.y = 0.75 * (0.625 - 0.5);
      group.add(board);
      const stick = new Mesh(
        new CylinderGeometry(0.02, 0.02, 1.4, 8),
        new MeshStandardMaterial({ color: PALETTE.iron, metalness: 0.6, roughness: 0.5 }),
      );
      stick.position.y = -0.6;
      group.add(stick);
    }

    return this.world.createTransformEntity(group);
  }

  private me(): Entity | undefined {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'team') ?? 0) === 0) return e;
    }
    return undefined;
  }
}
