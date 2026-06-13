/**
 * UNIT-86 "THE LANDLORD" — the robot barkeep.
 *
 * Same iron-boxer chassis as everyone else (house amber trim), bolted to a
 * wheeled base that runs the aisle behind the bar. You can't interact with
 * him and he never stops working: he wipes the counter, pulls pints at the
 * taps (with a proper pour stream), polishes glasses, and when the server
 * announces a restock (`glassOut`) he trundles a fresh pint over and sets
 * it down right as the real prop lands — up to the house limit of 15.
 *
 * He is pure theatre: entirely client-side, no networking, no collision.
 * The only synchronised part is the glass landing, and PropSystem times
 * that off the same broadcast every client received.
 */

import { createSystem } from '@iwsdk/core';
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { buildBoxer, type BoxerRig } from '../../avatar/boxer.js';
import { PALETTE } from '../../config.js';
import { PUB } from '../config.js';
import { buildPintGlass } from '../props.js';
import { bus, pub } from '../state.js';
import { retintRig } from './PubPlayerSystem.js';

type TaskKind = 'wipe' | 'pour' | 'polish' | 'deliver';

interface Task {
  kind: TaskKind;
  /** Where he stands (x along the aisle). */
  x: number;
  /** Seconds the task runs once he's in position. */
  duration: number;
  /** Deliver only: which glass slot he's heading for. */
  slot?: [number, number, number];
}

const WALK_SPEED = 1.1;
const DELIVER_SPEED = 2.6;
const AISLE_MIN = -2.35;
const AISLE_MAX = 2.35;

const _target = new Vector3();
const _punter = new Vector3();

export class BartenderSystem extends createSystem({}) {
  private root!: Group;
  private rig!: BoxerRig;
  private carryGlass!: Group;
  private pourStream!: Mesh;

  private task: Task | null = null;
  private taskTimer = 0;
  private arrived = false;
  private animTime = 0;
  private bob = 0;

  init(): void {
    this.buildBody();
    this.cleanupFuncs.push(
      bus.on('glassOut', (id) => {
        const slot = pub.refs!.glassSlots[id];
        if (!slot) return;
        // Drop whatever he was doing — a customer needs a glass.
        this.setTask({ kind: 'deliver', x: slot[0], duration: 1.2, slot });
      }),
    );
  }

  private buildBody(): void {
    this.root = new Group();
    this.root.name = 'unit-86-the-landlord';
    const aisleZ = PUB.bar.aisleZ;
    this.root.position.set(0, 0, aisleZ);
    this.root.rotation.y = Math.PI; // face the room (+z) — front is local −z

    // The boxer chassis in house amber, posed standing (no IK here: the
    // torso pieces are parked at fixed heights on the wheeled base).
    this.rig = buildBoxer(1);
    retintRig(this.rig.all, PALETTE.amber);
    this.rig.head.position.set(0, 1.52, 0);
    this.rig.chest.position.set(0, 1.22, 0);
    this.rig.pelvis.position.set(0, 0.92, 0);
    this.root.add(this.rig.head, this.rig.torso);
    for (const glove of this.rig.gloves) this.root.add(glove);
    this.restGloves();

    // No legs — a wheeled service base, very robot wars.
    const column = new Mesh(
      new CylinderGeometry(0.09, 0.16, 0.72, 8),
      new MeshStandardMaterial({ color: PALETTE.gunmetal, metalness: 0.85, roughness: 0.4 }),
    );
    column.position.y = 0.46;
    this.root.add(column);
    const skirtMat = new MeshStandardMaterial({
      color: PALETTE.gunmetalDark,
      metalness: 0.8,
      roughness: 0.5,
    });
    const base = new Mesh(new CylinderGeometry(0.22, 0.26, 0.1, 10), skirtMat);
    base.position.y = 0.08;
    this.root.add(base);
    for (const side of [-1, 1]) {
      const wheel = new Mesh(new SphereGeometry(0.045, 8, 6), skirtMat);
      wheel.position.set(side * 0.12, 0.045, 0);
      this.root.add(wheel);
    }
    // Hazard stripe across the base — he's plant machinery, technically.
    const stripe = new Mesh(
      new CylinderGeometry(0.225, 0.225, 0.025, 10),
      new MeshStandardMaterial({
        color: PALETTE.amber,
        emissive: PALETTE.amber,
        emissiveIntensity: 0.5,
      }),
    );
    stripe.position.y = 0.135;
    this.root.add(stripe);

    // The pint he carries while pouring/delivering.
    this.carryGlass = buildPintGlass();
    this.carryGlass.visible = false;
    this.carryGlass.position.set(0, -0.06, -0.1);
    this.rig.gloves[0].add(this.carryGlass);

    // Pour stream: a thin amber column under the active tap.
    this.pourStream = new Mesh(
      new CylinderGeometry(0.006, 0.009, 0.22, 6),
      new MeshStandardMaterial({
        color: 0xc97a1e,
        emissive: 0x8a4a10,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.pourStream.visible = false;
    this.scene.add(this.pourStream);

    this.scene.add(this.root);
  }

  update(delta: number): void {
    this.animTime += delta;
    if (!this.task) this.pickNextTask();
    const task = this.task!;

    // --- roll along the aisle toward the task spot ------------------------------
    const speed = task.kind === 'deliver' ? DELIVER_SPEED : WALK_SPEED;
    const dx = task.x - this.root.position.x;
    if (!this.arrived) {
      if (Math.abs(dx) > 0.04) {
        const step = Math.sign(dx) * Math.min(Math.abs(dx), speed * delta);
        this.root.position.x += step;
        this.bob += delta * 9;
        this.root.position.y = Math.abs(Math.sin(this.bob)) * 0.015;
      } else {
        this.arrived = true;
        this.root.position.y = 0;
      }
    }

    // --- act -------------------------------------------------------------------
    if (this.arrived) {
      this.taskTimer -= delta;
      this.animateTask(task, delta);
      if (this.taskTimer <= 0) this.finishTask(task);
    }

    // Head: glance at the nearest punter, otherwise mind the bar.
    this.aimHead(delta);
  }

  // --- the work rota -----------------------------------------------------------

  private pickNextTask(): void {
    const roll = Math.random();
    if (roll < 0.4) {
      this.setTask({
        kind: 'wipe',
        x: AISLE_MIN + Math.random() * (AISLE_MAX - AISLE_MIN),
        duration: 3.5 + Math.random() * 2,
      });
    } else if (roll < 0.75) {
      const tap = PUB.tapXs[Math.floor(Math.random() * PUB.tapXs.length)];
      this.setTask({ kind: 'pour', x: tap, duration: 4.5 });
    } else {
      this.setTask({
        kind: 'polish',
        x: AISLE_MIN + Math.random() * (AISLE_MAX - AISLE_MIN),
        duration: 4,
      });
    }
  }

  private setTask(task: Task): void {
    this.task = task;
    this.taskTimer = task.duration;
    this.arrived = false;
    this.pourStream.visible = false;
    // He carries a glass to the tap and on deliveries.
    this.carryGlass.visible = task.kind === 'pour' || task.kind === 'deliver' || task.kind === 'polish';
  }

  private finishTask(task: Task): void {
    if (task.kind === 'deliver') {
      // The real prop lands via PropSystem on the same broadcast clock —
      // his empty hand sells the hand-off.
      this.carryGlass.visible = false;
    }
    this.pourStream.visible = false;
    this.task = null;
    this.restGloves();
  }

  private restGloves(): void {
    // Knuckles toward the counter (local −z), hands at service height.
    this.rig.gloves[0].position.set(-0.28, 1.02, -0.18);
    this.rig.gloves[1].position.set(0.28, 1.02, -0.18);
    this.rig.gloves[0].rotation.set(0, 0, 0);
    this.rig.gloves[1].rotation.set(0, 0, 0);
  }

  private animateTask(task: Task, delta: number): void {
    const t = this.animTime;
    switch (task.kind) {
      case 'wipe': {
        // Right glove sweeps circles over the counter top.
        this.rig.gloves[1].position.set(
          0.2 + Math.cos(t * 3.2) * 0.16,
          1.06,
          -0.38 + Math.sin(t * 3.2) * 0.1,
        );
        break;
      }
      case 'pour': {
        // Left glove holds the glass under the tap; right rests the handle.
        this.rig.gloves[0].position.set(-0.08, 1.06, -0.42);
        this.rig.gloves[1].position.set(0.16, 1.32, -0.34);
        // Stream runs while the glass is under the spout (world space; the
        // glove's local offset mirrors through the root's 180° yaw).
        this.pourStream.visible = this.taskTimer > 0.8;
        this.pourStream.position.set(task.x + 0.08, 1.21, PUB.bar.aisleZ + 0.42);
        break;
      }
      case 'polish': {
        // Glass in the left, right buffs it in little circles.
        this.rig.gloves[0].position.set(-0.12, 1.18, -0.28);
        this.rig.gloves[1].position.set(
          0.02 + Math.cos(t * 5) * 0.05,
          1.2 + Math.sin(t * 5) * 0.04,
          -0.3,
        );
        break;
      }
      case 'deliver': {
        // Reach out and set the fresh pint down on its slot.
        const k = 1 - Math.max(0, this.taskTimer / task.duration);
        this.rig.gloves[0].position.set(-0.1, 1.18 - k * 0.12, -0.3 - k * 0.25);
        break;
      }
    }
    void delta;
  }

  private aimHead(delta: number): void {
    let best: Vector3 | null = null;
    let bestD = 16; // only bother within 4 m
    this.camera.getWorldPosition(_punter);
    const dSelf = _punter.distanceToSquared(this.root.position);
    if (dSelf < bestD) {
      best = _target.copy(_punter);
      bestD = dSelf;
    }
    for (const p of pub.punters.values()) {
      _punter.set(p.head[0], p.head[1], p.head[2]);
      const d = _punter.distanceToSquared(this.root.position);
      if (d < bestD) {
        best = _target.copy(_punter);
        bestD = d;
      }
    }
    const head = this.rig.head;
    if (best) {
      // Yaw-only glance, eased, clamped so he never owl-necks.
      const local = this.root.worldToLocal(best.clone());
      let yaw = Math.atan2(-(local.x - head.position.x), -(local.z - head.position.z));
      yaw = Math.max(-1.1, Math.min(1.1, yaw));
      head.rotation.y += (yaw - head.rotation.y) * Math.min(1, delta * 5);
    } else {
      head.rotation.y -= head.rotation.y * Math.min(1, delta * 2);
    }
  }
}
