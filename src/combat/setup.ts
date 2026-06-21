/**
 * Spawns the boxers' data entities:
 *  - the local player combatant (slot 0, shared Health) plus three head-driven
 *    IK body-part hitboxes (see PlayerBodySystem);
 *  - up to MAX_OPPONENTS other-fighter combatants (slots 1..3) — their avatars,
 *    hitboxes and poses are driven by OpponentSystem from the opponent bus
 *    (bot or network). Most modes leave the spare slots inactive.
 *
 * `applyRoster(mode)` re-stamps the team and active flag of every fighter for
 * the bout's layout: the classic duel lights slots 0 and 1 (you vs the rival),
 * 2v2 lights all four across two teams, FFA lights all four on their own teams.
 */

import { Object3D, type Entity, type World } from '@iwsdk/core';
import { Health } from '../components/Health.js';
import { Hitbox, HitboxKind } from '../components/Hitbox.js';
import { Combatant } from '../components/Combatant.js';
import { BodyPart, PlayerBodyPart } from '../components/PlayerBodyPart.js';
import { MAX_OPPONENTS } from '../combat/opponentBus.js';
import { BODY_IK, COMBAT, MODE_LAYOUT, type ArcadeMode } from '../config.js';

/** One combatant entity per fighter slot (index === slot; 0 is the local player). */
const fighters: Entity[] = [];

export function setupCombatants(world: World): void {
  fighters.length = 0;

  // --- Local player: slot 0, shared Health pool (no geometry) ---
  const player = world.createTransformEntity(new Object3D(), { persistent: true });
  player.addComponent(Health, { current: COMBAT.playerHealth, max: COMBAT.playerHealth });
  player.addComponent(Combatant, { team: 0, slot: 0, active: 1 });
  fighters[0] = player;

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

  // --- Other fighters: slots 1..MAX_OPPONENTS. OpponentSystem owns their
  //     avatars and hitboxes; they start inactive and are lit by applyRoster. ---
  for (let slot = 1; slot <= MAX_OPPONENTS; slot++) {
    const other = world.createTransformEntity(new Object3D(), { persistent: true });
    other.addComponent(Health, { current: COMBAT.playerHealth, max: COMBAT.playerHealth });
    other.addComponent(Combatant, { team: 1, slot, active: 0 });
    fighters[slot] = other;
  }

  applyRoster('1v1');
}

/**
 * Stamp every fighter's team / active flag for the given mode and refill the
 * health of those in the roster. Slots beyond the roster go inactive (parked by
 * the systems that read `Combatant.active`).
 */
export function applyRoster(mode: ArcadeMode): void {
  const roster = MODE_LAYOUT[mode];
  for (let slot = 0; slot < fighters.length; slot++) {
    const e = fighters[slot];
    if (!e) continue;
    const inRoster = slot < roster.length;
    e.setValue(Combatant, 'active', inRoster ? 1 : 0);
    e.setValue(Combatant, 'team', inRoster ? roster[slot].team : 1);
    if (inRoster) e.setValue(Health, 'current', e.getValue(Health, 'max') ?? COMBAT.playerHealth);
  }
}

/** The combatant entity for a fighter slot (0 = you), if it exists. */
export function fighterAt(slot: number): Entity | undefined {
  return fighters[slot];
}
