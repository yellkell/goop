/**
 * Renders the OTHER boxers — the floating-hands iron boxer (head + IK torso +
 * gloves, no legs) — from the opponent pose bus, and keeps each one's three
 * hitbox spheres (head/chest/pelvis) glued to that pose. The bus is written by
 * BotSystem in bot bouts and NetworkSystem in online bouts, so this system
 * neither knows nor cares which one it is fighting for.
 *
 * The classic duel has one rig; arcade 2v2 / FFA light up to MAX_OPPONENTS
 * rigs, one per roster slot, each placed on its own platform and tinted to its
 * team colour.
 */

import { createSystem, Vector3, type Entity } from '@iwsdk/core';
import { Object3D } from 'three';
import { buildBoxer, setAvatarAccent, setGloveLit, solveTorso, type BoxerRig } from '../avatar/boxer.js';
import { HAND_ADDUCTION, setHandCurl } from '../avatar/hands.js';
import {
  AVATAR_SKINS,
  OPPONENT_DEFAULT_AVATAR,
  OPPONENT_DEFAULT_PLATFORM,
  applyAvatarSkin,
  applyPlatformSkin,
  platformSkin,
  resolveAvatarSkin,
  type AvatarSkin,
} from '../avatar/skins.js';
import { platformName } from '../arena/arena.js';
import { Combatant } from '../components/Combatant.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { Health } from '../components/Health.js';
import { Hitbox, HitboxKind } from '../components/Hitbox.js';
import { MAX_OPPONENTS, opponents } from '../combat/opponentBus.js';
import { localLayout } from '../combat/layout.js';
import { app } from '../menu/appState.js';
import { rival } from '../net/leaderboard.js';
import { BODY_IK, hueToColor, teamColor } from '../config.js';

const _chest = new Vector3();
const _pelvis = new Vector3();

interface OppRig {
  rig: BoxerRig;
  hitboxes: { head?: Entity; chest?: Entity; pelvis?: Entity };
  built: boolean;
  appliedSkins: string;
  accentColor: number;
  /** Random skin an arcade bot wears for this bout (re-rolled each bout). */
  botSkin?: AvatarSkin;
}

export class OpponentSystem extends createSystem({
  combatants: { required: [Combatant, Health] },
  balls: { required: [Fireball] },
}) {
  private rigs: OppRig[] = [];

  init(): void {
    for (let i = 0; i < MAX_OPPONENTS; i++) {
      const rig = buildBoxer(1);
      for (const piece of rig.all) {
        piece.visible = false;
        this.scene.add(piece);
      }
      this.rigs[i] = { rig, hitboxes: {}, built: false, appliedSkins: '', accentColor: teamColor(1) };
    }
  }

  update(delta: number): void {
    const playing = app.state === 'playing';
    const roster = localLayout();

    for (let i = 0; i < MAX_OPPONENTS; i++) {
      const slot = i + 1;
      const seat = roster[slot];
      const r = this.rigs[i];
      if (!r) continue;
      if (!r.built) this.buildHitboxes(i, slot);

      const combatant = this.findCombatant(slot);
      const active = playing && !!seat && (combatant?.getValue(Combatant, 'active') ?? 0) === 1;
      const pose = opponents[i];
      pose.active = active;
      for (const piece of r.rig.all) piece.visible = active;
      if (!active || !seat) {
        // Idle: forget this rig's bout skin so the next bout re-rolls it.
        r.botSkin = undefined;
        r.appliedSkins = '';
        this.parkHitboxes(i);
        continue;
      }

      // Keep the hitboxes' team in step with the combatant (it shifts per mode).
      const team = combatant?.getValue(Combatant, 'team') ?? seat.team;
      for (const e of [r.hitboxes.head, r.hitboxes.chest, r.hitboxes.pelvis]) {
        if (e && (e.getValue(Hitbox, 'team') ?? -1) !== team) e.setValue(Hitbox, 'team', team);
      }

      this.applySkins(r, slot);

      // Neon: an online rival wears their own synced accent; everyone else (the
      // ally, the bots) wears their team tint. Recolour only on a real change.
      const want =
        app.mode === 'net' && slot === 1 && pose.accentHue >= 0 ? hueToColor(pose.accentHue) : teamColor(team);
      if (want !== r.accentColor) {
        r.accentColor = want;
        for (const piece of r.rig.all) setAvatarAccent(piece, want);
      }

      // Head + torso from the bus pose, anchored on this fighter's platform.
      solveTorso(r.rig, pose.headPos, pose.headQuat, seat.pos[0], seat.pos[2], _chest, _pelvis);
      for (const hand of [0, 1] as const) {
        r.rig.gloves[hand].position.copy(pose.handPos[hand]);
        r.rig.gloves[hand].quaternion.copy(pose.handQuat[hand]).multiply(HAND_ADDUCTION[hand]);
        const lit = pose.orbiting[hand] || this.ballReturning(slot, hand);
        const fisting = pose.fisting[hand];
        setGloveLit(r.rig.gloves[hand], lit, delta);
        setHandCurl(
          r.rig.gloves[hand],
          lit || fisting ? 1 : 0.35,
          lit || fisting ? 1 : 0.4,
          lit || fisting ? 0.9 : 0.45,
        );
      }

      r.hitboxes.head?.object3D?.position.copy(pose.headPos);
      r.hitboxes.chest?.object3D?.position.copy(_chest);
      r.hitboxes.pelvis?.object3D?.position.copy(_pelvis);
    }
  }

  /**
   * Dress the primary rival the way THEY chose (skins from their `iam`
   * message); allies and bots wear the team default. Visual only.
   */
  private applySkins(r: OppRig, slot: number): void {
    const net = app.mode === 'net' && slot === 1;
    // Arcade bots wear a random head/chassis skin (team-colour accent still
    // applied below, so teams stay readable); the rival wears their own; 1v1
    // and the default keep the house look.
    let av: AvatarSkin;
    if (net && rival.avatarSkin) av = resolveAvatarSkin(rival.avatarSkin, rival.avColor);
    else if (app.mode !== 'net' && app.arcade !== '1v1') {
      r.botSkin ??= AVATAR_SKINS[Math.floor(Math.random() * AVATAR_SKINS.length)];
      av = r.botSkin;
    } else av = OPPONENT_DEFAULT_AVATAR;
    // Only a genuine online rival overrides their platform skin; allies and
    // bots keep the team tint applyArenaLayout painted (so FFA pads stay
    // colour-coded), so the skin key folds the platform in only for the rival.
    const pf = net && rival.platformSkin ? platformSkin(rival.platformSkin) : OPPONENT_DEFAULT_PLATFORM;
    const key = `${av.id}|${net ? pf.id : 'tint'}`;
    if (key === r.appliedSkins) return;
    r.appliedSkins = key;
    for (const piece of r.rig.all) applyAvatarSkin(piece, av);
    if (net) {
      const pad = this.scene.getObjectByName(platformName(slot));
      if (pad) applyPlatformSkin(pad, pf);
    }
    r.accentColor = Number.NaN; // force the accent recolour next frame
  }

  /** True while this fighter's bound ball for `hand` is homing back. */
  private ballReturning(slot: number, hand: 0 | 1): boolean {
    for (const e of this.queries.balls.entities) {
      if (
        (e.getValue(Fireball, 'owner') ?? 0) === slot &&
        (e.getValue(Fireball, 'hand') ?? 0) === hand &&
        (e.getValue(Fireball, 'transient') ?? 0) === 0
      ) {
        return (e.getValue(Fireball, 'state') ?? 0) === BallState.Returning;
      }
    }
    return false;
  }

  private findCombatant(slot: number): Entity | undefined {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? 0) === slot) return e;
    }
    return undefined;
  }

  private buildHitboxes(i: number, slot: number): void {
    const owner = this.findCombatant(slot);
    if (!owner) return;
    const r = this.rigs[i];
    const team = owner.getValue(Combatant, 'team') ?? 1;
    const make = (radius: number, kind: number): Entity => {
      const seg = this.world.createTransformEntity(new Object3D(), { persistent: true });
      seg.addComponent(Hitbox, { radius, team, kind, owner });
      return seg;
    };
    r.hitboxes.head = make(BODY_IK.headRadius, HitboxKind.Head);
    r.hitboxes.chest = make(BODY_IK.chestRadius, HitboxKind.Body);
    r.hitboxes.pelvis = make(BODY_IK.pelvisRadius, HitboxKind.Body);
    this.parkHitboxes(i);
    r.built = true;
  }

  /** Move a rig's hitboxes far away so nothing can connect while it's idle. */
  private parkHitboxes(i: number): void {
    const r = this.rigs[i];
    if (!r) return;
    for (const e of [r.hitboxes.head, r.hitboxes.chest, r.hitboxes.pelvis]) {
      e?.object3D?.position.set(0, -100, 0);
    }
  }
}
