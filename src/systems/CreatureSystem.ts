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
import { ARENA, BRAIN, COMBAT } from '../config.js';
import { GelCreature, type Hand } from '../creature/GelCreature.js';
import { GooFx } from '../fx/splats.js';
import { pulseHand } from '../input/haptics.js';
import { currentDifficulty, getCreature, match, setCreature } from '../state.js';

type Mood = 'wander' | 'roam' | 'rising' | 'combo' | 'sinking' | 'staggered';

const _head = new Vector3();
const _v = new Vector3();

export class CreatureSystem extends createSystem({}) {
  private fx!: GooFx;
  private creature!: GelCreature;

  private mood: Mood = 'wander';
  private moodT = 0;
  private moodDuration = 3;
  private punchesLeft = 0;
  private nextHand: Hand = 'left';
  private hpAtFormUp = COMBAT.creatureHealth;
  private wanderTarget = new Vector3(ARENA.spawn[0], 0, ARENA.spawn[2]);
  private koApplied = false;

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
        // Back to the mark, slumped, watching you.
        creature.setKo(false);
        creature.setFormTarget(0);
        creature.moveTo(_v.set(ARENA.spawn[0], 0, ARENA.spawn[2]));
        this.mood = 'roam';
        this.moodT = 0;
        this.moodDuration = 0.5;
        this.koApplied = false;
        break;
      case 'fighting':
        this.updateFight(delta);
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

  private engagePoint(out: Vector3): Vector3 {
    // Stand at engage distance from the player, on the line back to spawn.
    out.copy(this.creature.position).sub(_head);
    out.y = 0;
    if (out.lengthSq() < 1e-4) out.set(0, 0, -1);
    out.normalize().multiplyScalar(ARENA.engageDistance);
    out.add(_head);
    out.y = 0;
    return out;
  }

  private updateFight(_delta: number): void {
    const c = this.creature;
    const diff = currentDifficulty();
    c.tempoScale = diff.tempoScale;

    // Stagger: hurt it hard while it's committed and it collapses early.
    if ((this.mood === 'rising' || this.mood === 'combo') && this.hpAtFormUp - match.creatureHp >= BRAIN.staggerDamage) {
      c.setFormTarget(0);
      this.setMood('staggered', 1.3);
    }

    switch (this.mood) {
      case 'wander': // entering the fight from the lobby
        this.setMood('roam', BRAIN.roamMin + Math.random() * (BRAIN.roamMax - BRAIN.roamMin));
        break;

      case 'roam':
        c.setFormTarget(0);
        c.moveTo(this.engagePoint(_v));
        if (this.moodT > this.moodDuration * diff.roamScale) {
          this.setMood('rising');
          this.hpAtFormUp = match.creatureHp;
          c.setFormTarget(1);
        }
        break;

      case 'rising':
        c.moveTo(this.engagePoint(_v));
        if (c.formValue > 0.96) {
          this.punchesLeft = BRAIN.comboMin + Math.floor(Math.random() * (diff.comboMax - BRAIN.comboMin + 1));
          this.setMood('combo');
        }
        break;

      case 'combo':
        c.moveTo(this.engagePoint(_v));
        if (!c.isPunching) {
          if (this.punchesLeft <= 0) {
            c.setFormTarget(0);
            this.setMood('sinking');
            break;
          }
          this.punchesLeft--;
          const hand = this.nextHand;
          this.nextHand = hand === 'left' ? 'right' : 'left';
          c.throwPunch(hand, _head, (fistWorld) => this.resolveCreaturePunch(fistWorld));
        }
        break;

      case 'sinking':
        if (c.formValue < 0.05) {
          this.setMood('roam', BRAIN.roamMin + Math.random() * (BRAIN.roamMax - BRAIN.roamMin));
        }
        break;

      case 'staggered':
        if (this.moodT > this.moodDuration) {
          this.setMood('roam', BRAIN.roamMin * 0.7 + Math.random() * 2);
        }
        break;
    }
  }

  /** Full extension: did the gel fist actually reach your head? */
  private resolveCreaturePunch(fistWorld: Vector3): void {
    this.playerHead(_v);
    if (fistWorld.distanceTo(_v) < 0.38 && match.phase === 'fighting') {
      match.playerHp = Math.max(0, match.playerHp - COMBAT.creaturePunchDamage * currentDifficulty().damageScale);
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
