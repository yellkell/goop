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
import { localLayout } from '../combat/layout.js';
import { app } from '../menu/appState.js';
import { mesh } from '../net/mesh.js';
import { BODY_IK, COMBAT } from '../config.js';

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

  applyRoster();
}

/**
 * Stamp every fighter's team / active flag for the current bout's LOCAL roster
 * (me at slot 0) and refill the health of those in it. Slots beyond the roster
 * go inactive (parked by the systems that read `Combatant.active`).
 */
export function applyRoster(): void {
  const roster = localLayout();
  // In a LIVE mesh bout the other fighters are humans only: a seat with no
  // occupant (a short-handed FFA's empty pad) sits this bout out. Bot bouts and
  // the duel keep every roster slot.
  const liveNet = app.mode === 'net' && app.arcade !== '1v1';
  for (let slot = 0; slot < fighters.length; slot++) {
    const e = fighters[slot];
    if (!e) continue;
    let active = slot < roster.length;
    if (active && liveNet && slot !== 0) active = !!mesh.occupants[roster[slot].canonical];
    e.setValue(Combatant, 'active', active ? 1 : 0);
    e.setValue(Combatant, 'team', slot < roster.length ? roster[slot].team : 1);
    if (active) e.setValue(Health, 'current', e.getValue(Health, 'max') ?? COMBAT.playerHealth);
  }
}

/**
 * Mid-bout reconciliation for a LIVE mesh brawl — run EVERY frame, heals BOTH
 * ways so a fighter's active flag always tracks whether its canonical seat is
 * occupied RIGHT NOW (occupants masks dropped peers to '', so "occupied" means
 * "a live peer is there"):
 *
 *  - occupied but INACTIVE  → ACTIVATE it. This is the self-heal for the FFA
 *    "everyone's a ghost" bug: applyRoster only lights peers on the one
 *    bot→net 'entering' frame, so a peer whose seat filled a beat later — or
 *    one wrongly dropped by a transient occupants gap — used to stay invisible,
 *    un-hittable and nameless for the whole bout (its platform + the timer +
 *    voice all kept working, since none of those read `active`). Its real
 *    health resyncs from the next pose packet.
 *  - occupied → EMPTY/DROPPED → ELIMINATE it (deactivate AND zero). That stops
 *    it being an un-hittable frozen statue, drops it from the HUD, and removes
 *    its (frozen, often full) health from its team's total — so the round
 *    resolves by KO and the bout plays out short-handed, not against a ghost.
 *
 * Only ever touches a fighter's health on an active-flag TRANSITION, so a
 * living, connected peer's pose-synced health is never trampled. No-op outside
 * a live net arcade bout. Returns true if any fighter's state just changed.
 */
export function syncNetRoster(): boolean {
  if (!(app.mode === 'net' && app.arcade !== '1v1')) return false;
  const roster = localLayout();
  let changed = false;
  for (let slot = 1; slot < fighters.length; slot++) {
    const e = fighters[slot];
    if (!e) continue;
    const canonical = slot < roster.length ? roster[slot].canonical : -1;
    const occupied = canonical >= 0 && !!mesh.occupants[canonical];
    const active = (e.getValue(Combatant, 'active') ?? 0) === 1;
    if (occupied === active) continue; // already reconciled
    if (occupied) {
      // A live peer that never lit up (or was wrongly eliminated): bring it in.
      e.setValue(Combatant, 'active', 1);
      e.setValue(Combatant, 'team', roster[slot].team);
      e.setValue(Health, 'current', e.getValue(Health, 'max') ?? COMBAT.playerHealth);
    } else {
      // Its seat emptied or its peer was dropped: eliminate it.
      e.setValue(Combatant, 'active', 0);
      e.setValue(Health, 'current', 0);
    }
    changed = true;
  }
  return changed;
}

/** The combatant entity for a fighter slot (0 = you), if it exists. */
export function fighterAt(slot: number): Entity | undefined {
  return fighters[slot];
}
