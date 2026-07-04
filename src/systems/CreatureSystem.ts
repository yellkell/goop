/**
 * The creature's brain — owns THE GOOP and drives its whole life:
 *
 *  LOBBY    a curious pet: oozes around its corner, watches you, drips.
 *  FIGHTING loops  roam (low glob, hard to read) → rise (pulls itself into
 *           the boxer) → combo (1–3 telegraphed straights at your head) →
 *           sink (slumps back down) → roam…  Take enough damage while it's
 *           formed up and it STAGGERS back into a puddle early — rewarding
 *           aggression right when it commits.
 *  VERDICT  flattens into the KO puddle if you won; gloats otherwise.
 *
 * The punches are honest: the telegraph is the dodge window (eyes + body
 * flash amber, a bubbling charge whine), the strike snapshots your head at
 * launch, and at full extension we simply check whether the fist blob
 * reached you — duck and it whiffs through empty air.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { gooBlock, gooSlam, gooWhiff } from '../audio/sfx.js';
import { ARENA, ATTACKS, BLOCK, BRAIN, COMBAT, EXHAUST, type AttackName } from '../config.js';
import { GelCreature, type Hand } from '../creature/GelCreature.js';
import { GooFx } from '../fx/splats.js';
import { pulseHand } from '../input/haptics.js';
import { currentDifficulty, getCreature, match, player, setCreature, settings } from '../state.js';

type Mood = 'wander' | 'fight' | 'staggered' | 'exhausted';

const _head = new Vector3();
const _v = new Vector3();

/**
 * The fight book — every combination it knows. Difficulty gates which
 * strikes are in the arsenal and how long a string it will throw:
 * CHILL sticks to the basics, SCRAP boxes properly, RUMBLE is a martial
 * artist with a spinning backfist and a gel-tentacle roundhouse.
 */
const COMBOS: AttackName[][] = [
  ['jab'],
  ['cross'],
  ['jab', 'cross'],
  ['jab', 'jab', 'cross'],
  ['hook'],
  ['cross', 'hook'],
  ['jab', 'uppercut'],
  ['hook', 'uppercut'],
  ['jab', 'jab', 'uppercut'],
  ['overhand'],
  ['jab', 'overhand'],
  ['jab', 'jab', 'overhand'],
  ['backfist'],
  ['jab', 'backfist'],
  ['jab', 'cross', 'backfist'],
  ['roundhouse'],
  ['cross', 'roundhouse'],
  ['jab', 'cross', 'hook'],
  ['hook', 'hook', 'roundhouse'],
];

const TIER_ARSENAL: AttackName[][] = [
  ['jab', 'cross'], // CHILL
  ['jab', 'cross', 'hook', 'uppercut', 'overhand'], // SCRAP
  ['jab', 'cross', 'hook', 'uppercut', 'overhand', 'backfist', 'roundhouse'], // RUMBLE
];

export class CreatureSystem extends createSystem({}) {
  private fx!: GooFx;
  private creature!: GelCreature;

  private mood: Mood = 'wander';
  private moodT = 0;
  private moodDuration = 3;
  private comboQueue: AttackName[] = [];
  private nextHand: Hand = 'left';
  /** HP when the current combo started — the stagger reference. */
  private hpAtCombo = COMBAT.creatureHealth;
  private wanderTarget = new Vector3(ARENA.spawn[0], 0, ARENA.spawn[2]);
  private koApplied = false;
  /** Footwork sway accumulator (drives the lateral circling). */
  private sway = 0;
  /** Seconds until it commits to the next combination. */
  private comboRest = 1.2;
  /** The exhausted collapse fires once per round. */
  private exhaustUsed = false;

  init(): void {
    this.fx = new GooFx();
    this.scene.add(this.fx.group);
    this.creature = new GelCreature(this.fx);
    this.creature.group.position.set(ARENA.spawn[0], ARENA.spawn[1], ARENA.spawn[2]);
    this.world.createTransformEntity(this.creature.group, { persistent: true });
    setCreature(this.creature);
  }

  private setMood(m: Mood, duration = 0): void {
    this.mood = m;
    this.moodT = 0;
    this.moodDuration = duration;
  }

  private playerHead(out: Vector3): Vector3 {
    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) {
      headObj.getWorldPosition(out);
      if (out.lengthSq() > 1e-6) return out;
    }
    return out.set(0, 1.6, 0.4); // pre-session fallback
  }

  update(delta: number): void {
    const creature = getCreature();
    if (!creature) return;
    this.fx.update(delta);
    this.playerHead(_head);
    this.moodT += delta;

    creature.faceToward(_head);

    switch (match.phase) {
      case 'lobby':
        this.updateLobby(delta);
        break;
      case 'countdown':
        // Back to the mark, already pulling itself up onto its feet.
        creature.setKo(false);
        creature.setFormTarget(1);
        creature.vulnerable = false;
        creature.moveTo(_v.set(ARENA.spawn[0], 0, ARENA.spawn[2]));
        this.mood = 'fight';
        this.moodT = 0;
        this.comboRest = 1.4;
        this.comboQueue = [];
        this.koApplied = false;
        this.exhaustUsed = false;
        break;
      case 'fighting':
        this.updateFight(delta);
        break;
      case 'roundEnd':
        // Rest period: if you dropped it, it lies there as a puddle until
        // the next countdown; if it took the round, it saunters back to its
        // corner looking pleased with itself.
        creature.vulnerable = false;
        if (match.lastRound === 'player') {
          if (!this.koApplied) {
            this.koApplied = true;
            creature.setKo(true);
          }
        } else {
          creature.setFormTarget(0);
          creature.moveTo(_v.set(ARENA.spawn[0], 0, ARENA.spawn[2]));
        }
        this.mood = 'fight';
        this.moodT = 0;
        break;
      case 'verdict':
        if (match.verdict === 'win' && !this.koApplied) {
          this.koApplied = true;
          creature.setKo(true);
        }
        if (match.verdict !== 'win') {
          // It gloats: slow happy slosh toward its corner.
          creature.setFormTarget(0);
          creature.moveTo(_v.set(ARENA.spawn[0], 0, ARENA.spawn[2]));
        }
        break;
    }

    creature.update(delta, _head);
  }

  // ---------------------------------------------------------------- lobby

  private updateLobby(_delta: number): void {
    const c = this.creature;
    c.setKo(false);
    c.setFormTarget(0);
    if (this.mood !== 'wander') this.setMood('wander', 0);

    // A new ooze-destination every few seconds, inside the roam circle —
    // but never crowding you.
    if (this.moodT > this.moodDuration) {
      this.moodT = 0;
      this.moodDuration = 3.5 + Math.random() * 3.5;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * ARENA.roamRadius;
      this.wanderTarget.set(ARENA.spawn[0] + Math.cos(a) * r, 0, ARENA.spawn[2] + Math.sin(a) * r);
    }
    _v.copy(this.wanderTarget).sub(_head);
    _v.y = 0;
    if (_v.length() < 0.8) {
      // Too close to the player's spot — push the target back out.
      _v.normalize().multiplyScalar(0.9);
      this.wanderTarget.copy(_head).add(_v);
      this.wanderTarget.y = 0;
    }
    c.moveTo(this.wanderTarget);
  }

  // ---------------------------------------------------------------- fight

  /** A spot `distance` from your head along the line to the creature, with a
   *  lateral sway so it circles rather than standing on a rail. */
  private engagePoint(out: Vector3, distance: number, lateral: number): Vector3 {
    out.copy(this.creature.position).sub(_head);
    out.y = 0;
    if (out.lengthSq() < 1e-4) out.set(0, 0, -1);
    out.normalize();
    // Perpendicular (in the floor plane) for the sidestep.
    const px = -out.z;
    const pz = out.x;
    out.multiplyScalar(distance);
    out.x += px * lateral;
    out.z += pz * lateral;
    out.add(_head);
    out.y = 0;
    return out;
  }

  private updateFight(delta: number): void {
    const c = this.creature;
    const diff = currentDifficulty();
    c.tempoScale = diff.tempoScale;
    this.sway += delta;

    // REALLY hurt? It loses its shape — once per round it collapses into an
    // exhausted glob and lies there taking double damage. The finisher.
    if (
      this.mood !== 'exhausted' &&
      !this.exhaustUsed &&
      match.creatureHp > 0 &&
      match.creatureHp <= COMBAT.creatureHealth * EXHAUST.threshold
    ) {
      this.exhaustUsed = true;
      this.comboQueue = [];
      c.setFormTarget(0);
      c.vulnerable = true;
      this.setMood('exhausted', EXHAUST.duration);
      return;
    }

    const lateral = Math.sin(this.sway * 0.7) * 0.35;

    switch (this.mood) {
      case 'wander': // entering the fight from the lobby
        this.setMood('fight');
        break;

      case 'fight': {
        c.setFormTarget(1);
        const committed = c.isPunching || this.comboQueue.length > 0;

        if (committed) {
          // In a combo: LURCH to strike range and keep swinging.
          c.moveSpeedScale = 2.6;
          c.moveTo(this.engagePoint(_v, ARENA.strikeDistance, lateral * 0.3));

          // Stagger: eat a burst of damage mid-combo and it rocks off it.
          if (this.hpAtCombo - match.creatureHp >= BRAIN.staggerDamage) {
            this.comboQueue = [];
            this.setMood('staggered', 1.1);
            break;
          }
          if (!c.isPunching) {
            const next = this.comboQueue.shift()!;
            const hand = this.handFor(next);
            c.throwAttack(next, hand, _head, (limbWorld, apexHand) =>
              this.resolveCreatureHit(next, limbWorld, apexHand),
            );
          }
        } else {
          // Out of a combo: hold at RANGE, circling, winding down the dash.
          c.moveSpeedScale = 1.5;
          c.moveTo(this.engagePoint(_v, ARENA.rangeDistance, lateral));
          this.comboRest -= delta;
          if (this.comboRest <= 0) {
            this.comboQueue = this.pickCombo();
            this.hpAtCombo = match.creatureHp;
            // Longer gaps = more range time; difficulty tightens them.
            this.comboRest = (1.4 + Math.random() * 2.0) * diff.roamScale;
          }
        }
        break;
      }

      case 'staggered':
        c.moveSpeedScale = 1.2;
        c.moveTo(this.engagePoint(_v, ARENA.rangeDistance, lateral));
        if (this.moodT > this.moodDuration) {
          this.comboRest = 0.6;
          this.setMood('fight');
        }
        break;

      case 'exhausted':
        // A quivering puddle where it fell. Finish it.
        c.moveSpeedScale = 1;
        c.moveTo(c.position);
        c.sim.agitation = Math.max(c.sim.agitation, 0.55);
        if (this.moodT > this.moodDuration) {
          c.vulnerable = false;
          c.setFormTarget(1);
          this.comboRest = 1.0;
          this.setMood('fight');
        }
        break;
    }
  }

  /** Draw a combination the current difficulty knows, capped in length. */
  private pickCombo(): AttackName[] {
    const diff = currentDifficulty();
    const arsenal = TIER_ARSENAL[Math.min(TIER_ARSENAL.length - 1, Math.max(0, settings.difficulty))];
    const legal = COMBOS.filter(
      (combo) => combo.length <= diff.comboMax && combo.every((atk) => arsenal.includes(atk)),
    );
    return [...legal[Math.floor(Math.random() * legal.length)]];
  }

  /** Which hand throws which strike: jabs lead, crosses and the spin come
   *  from the power side, the rest alternate. */
  private handFor(name: AttackName): Hand {
    if (name === 'jab') return 'left';
    if (name === 'cross' || name === 'backfist') return 'right';
    const hand = this.nextHand;
    this.nextHand = hand === 'left' ? 'right' : 'left';
    return hand;
  }

  /**
   * Full extension. Did it reach you — and if so, was a glove in the way?
   * Blocking is spatial: a glove parked on the spot his fist lands stops it.
   * A head-high guard covers straights/hooks/overhands; the uppercut comes
   * up UNDER it and the body roundhouse comes around it, so you have to read
   * him. Either way you SEE the contact (a goo flash there) and FEEL it (the
   * hand that blocked, or both when it lands clean).
   */
  private resolveCreatureHit(name: AttackName, limbWorld: Vector3, apexHand: Hand): void {
    if (match.phase !== 'fighting') {
      gooWhiff();
      return;
    }
    const spec = ATTACKS[name];
    this.playerHead(_v);
    if (limbWorld.distanceTo(_v) >= spec.hitRadius) {
      gooWhiff();
      return;
    }

    // Is a glove on the impact point?
    const dL = player.gloves.left.distanceTo(limbWorld);
    const dR = player.gloves.right.distanceTo(limbWorld);
    const blockHand: Hand | null = Math.min(dL, dR) < BLOCK.radius ? (dL < dR ? 'left' : 'right') : null;
    const diffScale = currentDifficulty().damageScale;

    if (blockHand) {
      // BLOCKED — a slap of chip damage leaks, the rest is stopped dead.
      match.playerHp = Math.max(0, match.playerHp - spec.damage * diffScale * BLOCK.chip);
      match.boardDirty = true;
      gooBlock();
      this.fx.flash(limbWorld, 0xbfffca, 0.3); // white-green on the glove
      pulseHand(this.world.session, blockHand, 0.8, 90);
    } else {
      // CLEAN HIT — full damage, red splat where it landed, both hands jolt.
      match.playerHp = Math.max(0, match.playerHp - spec.damage * diffScale);
      match.playerFlash = 1;
      match.boardDirty = true;
      gooSlam();
      this.fx.flash(limbWorld, 0xff5a3c, 0.36);
      this.fx.burst(limbWorld, _v.copy(limbWorld).sub(this.creature.position).normalize(), 10, 3);
      pulseHand(this.world.session, 'left', 1, 220);
      pulseHand(this.world.session, 'right', 1, 220);
    }
    void apexHand;
  }
}
