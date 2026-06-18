/**
 * Renders the opponent — the floating-hands iron boxer (head + IK torso +
 * gloves, no legs) — from the opponent pose bus, and keeps their three
 * hitbox spheres (head/chest/pelvis) glued to that pose. The bus is written
 * by BotSystem in bot bouts and NetworkSystem in online bouts, so this system
 * neither knows nor cares which one it is fighting for.
 */

import { createSystem, Vector3, type Entity } from '@iwsdk/core';
import { Object3D } from 'three';
import { buildBoxer, setAvatarAccent, setGloveLit, solveTorso, type BoxerRig } from '../avatar/boxer.js';
import { HAND_ADDUCTION, setHandCurl } from '../avatar/hands.js';
import {
  OPPONENT_DEFAULT_AVATAR,
  OPPONENT_DEFAULT_PLATFORM,
  applyAvatarSkin,
  applyPlatformSkin,
  platformSkin,
  resolveAvatarSkin,
} from '../avatar/skins.js';
import { Combatant } from '../components/Combatant.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { Health } from '../components/Health.js';
import { Hitbox, HitboxKind } from '../components/Hitbox.js';
import { opponent } from '../combat/opponentBus.js';
import { app } from '../menu/appState.js';
import { rival } from '../net/leaderboard.js';
import { ARENA_GAP, BODY_IK, hueToColor, teamColor } from '../config.js';

const _chest = new Vector3();
const _pelvis = new Vector3();

export class OpponentSystem extends createSystem({
  combatants: { required: [Combatant, Health] },
  balls: { required: [Fireball] },
}) {
  private rig?: BoxerRig;
  private hitboxes: { head?: Entity; chest?: Entity; pelvis?: Entity } = {};
  private built = false;
  private appliedSkins = '';
  private accentColor = teamColor(1);

  /**
   * Dress the rival the way THEY chose (skins from their `iam` message);
   * bot bouts wear the team-blue default. Visual only — hitboxes untouched.
   */
  private applySkins(rig: BoxerRig): void {
    const net = app.mode === 'net';
    const av = net && rival.avatarSkin ? resolveAvatarSkin(rival.avatarSkin, rival.avColor) : OPPONENT_DEFAULT_AVATAR;
    const pf = net && rival.platformSkin ? platformSkin(rival.platformSkin) : OPPONENT_DEFAULT_PLATFORM;
    const key = `${av.id}|${pf.id}`;
    if (key === this.appliedSkins) return;
    this.appliedSkins = key;
    for (const piece of rig.all) applyAvatarSkin(piece, av);
    const pad = this.scene.getObjectByName('opponent-platform');
    if (pad) applyPlatformSkin(pad, pf);
    this.accentColor = Number.NaN;
  }

  /** True while the opponent's bound ball for this hand is homing back. */
  private ballReturning(hand: 0 | 1): boolean {
    for (const e of this.queries.balls.entities) {
      if (
        (e.getValue(Fireball, 'owner') ?? 0) === 1 &&
        (e.getValue(Fireball, 'hand') ?? 0) === hand &&
        (e.getValue(Fireball, 'transient') ?? 0) === 0
      ) {
        return (e.getValue(Fireball, 'state') ?? 0) === BallState.Returning;
      }
    }
    return false;
  }

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

    this.applySkins(rig);

    // Neon: a remote rival wears their own accent (synced over the wire); the
    // bot keeps the readable house blue. Recolour only when it actually changes.
    const want = app.mode === 'net' && opponent.accentHue >= 0
      ? hueToColor(opponent.accentHue)
      : teamColor(1);
    if (want !== this.accentColor) {
      this.accentColor = want;
      for (const piece of rig.all) setAvatarAccent(piece, want);
    }

    // Head + torso from the bus pose; gloves straight onto the hand poses.
    solveTorso(rig, opponent.headPos, opponent.headQuat, 0, -ARENA_GAP, _chest, _pelvis);
    for (const hand of [0, 1] as const) {
      rig.gloves[hand].position.copy(opponent.handPos[hand]);
      rig.gloves[hand].quaternion.copy(opponent.handQuat[hand]).multiply(HAND_ADDUCTION[hand]);
      // Their squeeze turns their hand white — the tell that fire is winding
      // up, even on a behind-the-back lob — and it stays hot through a
      // recall until the ball is back in it. Fingers fist up when active.
      const active = opponent.orbiting[hand] || this.ballReturning(hand);
      const fisting = opponent.fisting[hand];
      setGloveLit(rig.gloves[hand], active, delta);
      setHandCurl(
        rig.gloves[hand],
        active || fisting ? 1 : 0.35,
        active || fisting ? 1 : 0.4,
        active || fisting ? 0.9 : 0.45,
      );
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

    const make = (radius: number, kind: number): Entity => {
      const seg = this.world.createTransformEntity(new Object3D(), { persistent: true });
      seg.addComponent(Hitbox, { radius, team: 1, kind, owner });
      return seg;
    };
    this.hitboxes.head = make(BODY_IK.headRadius, HitboxKind.Head);
    this.hitboxes.chest = make(BODY_IK.chestRadius, HitboxKind.Body);
    this.hitboxes.pelvis = make(BODY_IK.pelvisRadius, HitboxKind.Body);
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
