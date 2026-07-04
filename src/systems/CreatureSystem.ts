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
import { gooSlam, gooWhiff } from '../audio/sfx.js';
import { ARENA, ATTACKS, BRAIN, COMBAT, EXHAUST, type AttackName } from '../config.js';
import { GelCreature, type Hand } from '../creature/GelCreature.js';
import { GooFx } from '../fx/splats.js';
import { pulseHand } from '../input/haptics.js';
import { currentDifficulty, getCreature, match, setCreature, settings } from '../state.js';

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
  /** Footwork: current step offset along the engagement line + its clock. */
  private stepOffset = 0;
  private stepTimer = 0;
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

  /** Where to stand: engage distance from your head, plus the current
   *  footwork step in or out along the same line. */
  private engagePoint(out: Vector3): Vector3 {
    out.copy(this.creature.position).sub(_head);
    out.y = 0;
    if (out.lengthSq() < 1e-4) out.set(0, 0, -1);
    out.normalize().multiplyScalar(Math.max(0.55, ARENA.engageDistance + this.stepOffset));
    out.add(_head);
    out.y = 0;
    return out;
  }

  private updateFight(delta: number): void {
    const c = this.creature;
    const diff = currentDifficulty();
    c.tempoScale = diff.tempoScale;

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

    switch (this.mood) {
      case 'wander': // entering the fight from the lobby
        this.setMood('fight');
        break;

      case 'fight': {
        c.setFormTarget(1);

        // Footwork: pick a new step (in, out, or hold) every second or so.
        this.stepTimer -= delta;
        if (this.stepTimer <= 0) {
          this.stepTimer = 0.9 + Math.random() * 1.3;
          const r = Math.random();
          this.stepOffset = r < 0.34 ? -0.32 : r < 0.62 ? 0.28 : 0;
        }
        c.moveTo(this.engagePoint(_v));

        // Stagger: eat a burst of damage mid-combo and it wobbles off it.
        if (this.comboQueue.length > 0 && this.hpAtCombo - match.creatureHp >= BRAIN.staggerDamage) {
          this.comboQueue = [];
          c.setFormTarget(1); // stays on its feet — just rocked
          this.setMood('staggered', 1.1);
          break;
        }

        // Combos, with breathing room between them (difficulty paces it).
        if (!c.isPunching) {
          if (this.comboQueue.length > 0) {
            const next = this.comboQueue.shift()!;
            const hand = this.handFor(next);
            c.throwAttack(next, hand, _head, (limbWorld) => this.resolveCreatureHit(next, limbWorld));
          } else {
            this.comboRest -= delta;
            if (this.comboRest <= 0) {
              this.comboQueue = this.pickCombo();
              this.hpAtCombo = match.creatureHp;
              this.comboRest = (0.7 + Math.random() * 1.5) * diff.roamScale;
              this.stepOffset = -0.25; // step IN behind the first strike
              this.stepTimer = 1.2;
              c.moveTo(this.engagePoint(_v));
            }
          }
        }
        break;
      }

      case 'staggered':
        c.moveTo(this.engagePoint(_v));
        if (this.moodT > this.moodDuration) {
          this.comboRest = 0.5;
          this.setMood('fight');
        }
        break;

      case 'exhausted':
        // A quivering puddle where it fell. Finish it.
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

  /** Full extension: did the striking blob actually reach your head? */
  private resolveCreatureHit(name: AttackName, limbWorld: Vector3): void {
    const spec = ATTACKS[name];
    this.playerHead(_v);
    if (limbWorld.distanceTo(_v) < spec.hitRadius && match.phase === 'fighting') {
      match.playerHp = Math.max(0, match.playerHp - spec.damage * currentDifficulty().damageScale);
      match.playerFlash = 1;
      match.boardDirty = true;
      gooSlam();
      pulseHand(this.world.session, 'left', 1, 220);
      pulseHand(this.world.session, 'right', 1, 220);
    } else {
      gooWhiff();
    }
  }
}
