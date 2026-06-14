/**
 * Spawns the two boxers' data entities:
 *  - the player combatant (shared Health) plus three head-driven IK body-part
 *    hitboxes (see PlayerBodySystem);
 *  - the opponent combatant (shared Health) — its avatar, hitboxes and pose
 *    are driven by OpponentSystem from the opponent bus (bot or network).
 */

import { Object3D, type World } from '@iwsdk/core';
import { Health } from '../components/Health.js';
import { Hitbox, HitboxKind } from '../components/Hitbox.js';
import { Combatant } from '../components/Combatant.js';
import { BodyPart, PlayerBodyPart } from '../components/PlayerBodyPart.js';
import { BODY_IK, COMBAT } from '../config.js';

export function setupCombatants(world: World): void {
  // --- Player combatant: shared Health pool (no geometry) ---
  const player = world.createTransformEntity(new Object3D(), { persistent: true });
  player.addComponent(Health, { current: COMBAT.playerHealth, max: COMBAT.playerHealth });
  player.addComponent(Combatant, { team: 0 });

  // Three IK body-part hitboxes (invisible), all draining the player's Health.
  const parts: Array<[number, number, number]> = [
    [BodyPart.Head, BODY_IK.headRadius, HitboxKind.Head],
    [BodyPart.Chest, BODY_IK.chestRadius, HitboxKind.Body],
    [BodyPart.Pelvis, BODY_IK.pelvisRadius, HitboxKind.Body],
  ];
  for (const [part, radius, kind] of parts) {
    const seg = world.createTransformEntity(new Object3D(), { persistent: true });
    seg.addComponent(Hitbox, { radius, team: 0, kind, owner: player });
    seg.addComponent(PlayerBodyPart, { part });
  }

  // --- Opponent combatant: Health pool; OpponentSystem owns its hitboxes ---
  const opponent = world.createTransformEntity(new Object3D(), { persistent: true });
  opponent.addComponent(Health, { current: COMBAT.playerHealth, max: COMBAT.playerHealth });
  opponent.addComponent(Combatant, { team: 1 });
}
