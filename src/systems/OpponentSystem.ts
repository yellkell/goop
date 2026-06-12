/**
 * Renders the opponent — the floating-hands iron boxer (head + IK torso +
 * gloves, no legs) — from the opponent pose bus, and keeps their three
 * hitbox spheres (head/chest/pelvis) glued to that pose. The bus is written
 * by BotSystem in bot bouts and NetworkSystem in online bouts, so this system
 * neither knows nor cares which one it is fighting for.
 */

import { createSystem, Vector3, type Entity } from '@iwsdk/core';
import { Object3D } from 'three';
import { buildBoxer, setGloveLit, solveTorso, type BoxerRig } from '../avatar/boxer.js';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { Hitbox } from '../components/Hitbox.js';
import { opponent } from '../combat/opponentBus.js';
import { app } from '../menu/appState.js';
import { ARENA_GAP, BODY_IK } from '../config.js';

const _chest = new Vector3();
const _pelvis = new Vector3();

export class OpponentSystem extends createSystem({
  combatants: { required: [Combatant, Health] },
}) {
  private rig?: BoxerRig;
  private hitboxes: { head?: Entity; chest?: Entity; pelvis?: Entity } = {};
  private built = false;

  init(): void {
    this.rig = buildBoxer(1);
    for (const piece of this.rig.all) {
      piece.visible = false;
      this.scene.add(piece);
    }
  }

  update(delta: number): void {
    const rig = this.rig;
    if (!rig) return;

    // Lazily create the hitboxes once the opponent combatant entity exists.
    if (!this.built) this.buildHitboxes();

    const fighting = app.state === 'playing';
    opponent.active = fighting;
    for (const piece of rig.all) piece.visible = fighting;
    if (!fighting) {
      this.parkHitboxes();
      return;
    }

    // Head + torso from the bus pose; gloves straight onto the hand poses.
    solveTorso(rig, opponent.headPos, opponent.headQuat, 0, -ARENA_GAP, _chest, _pelvis);
    for (const hand of [0, 1] as const) {
      rig.gloves[hand].position.copy(opponent.handPos[hand]);
      rig.gloves[hand].quaternion.copy(opponent.handQuat[hand]);
      // Their squeeze flares their LEDs — the tell that fire is winding up,
      // even when they're lining up a behind-the-back lob.
      setGloveLit(rig.gloves[hand], opponent.orbiting[hand], delta);
    }

    this.hitboxes.head?.object3D?.position.copy(opponent.headPos);
    this.hitboxes.chest?.object3D?.position.copy(_chest);
    this.hitboxes.pelvis?.object3D?.position.copy(_pelvis);
  }

  private buildHitboxes(): void {
    let owner: Entity | undefined;
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'team') ?? 0) === 1) owner = e;
    }
    if (!owner) return;

    const make = (radius: number): Entity => {
      const seg = this.world.createTransformEntity(new Object3D(), { persistent: true });
      seg.addComponent(Hitbox, { radius, team: 1, owner });
      return seg;
    };
    this.hitboxes.head = make(BODY_IK.headRadius);
    this.hitboxes.chest = make(BODY_IK.chestRadius);
    this.hitboxes.pelvis = make(BODY_IK.pelvisRadius);
    this.parkHitboxes();
    this.built = true;
  }

  /** Move hitboxes far away while no bout is live so nothing can connect. */
  private parkHitboxes(): void {
    for (const e of [this.hitboxes.head, this.hitboxes.chest, this.hitboxes.pelvis]) {
      e?.object3D?.position.set(0, -100, 0);
    }
  }
}
