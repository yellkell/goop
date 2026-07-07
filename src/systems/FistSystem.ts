/**
 * Your fists — the entire input surface of the game.
 *
 * A compact wrapped-knuckle fist rides each controller grip. Every frame we
 * measure its world velocity and probe the creature's signed-distance field
 * at the knuckles:
 *
 *  - fast + touching  → a real punch: impulse into the blobs, a dent, maybe
 *    a lump torn clean out; squelch scaled to impact, haptics to match, and
 *    damage if a bout is on (or warm-up credit in the lobby);
 *  - slow + touching  → a poke: the gel shoves aside and quivers — free
 *    flubber therapy between rounds.
 *
 * Velocity is smoothed over two frames so Quest tracking jitter doesn't
 * fake punches, and each hand has a short cooldown so one swing is one hit.
 */

import { createSystem } from '@iwsdk/core';
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { squelch, wobble } from '../audio/sfx.js';
import { EXHAUST, PUNCH } from '../config.js';
import { pulseHand } from '../input/haptics.js';
import { getCreature, match, player } from '../state.js';

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

const _pos = new Vector3();
const _dir = new Vector3();
const _gripQ = new Quaternion();
const _rayQ = new Quaternion();

/**
 * A proper compact boxing glove, built along its punch axis: knuckles at
 * -Z, cuff wrapping the wrist at +Z. Aimed down the controller's POINTING
 * ray each frame (not the tilted grip pose — that left the old fists
 * skew-whiff against the forearm).
 */
export function buildFist(hand: 'left' | 'right'): Group {
  const g = new Group();
  // The outer group gets the per-frame ray aim (its quaternion is overwritten
  // every update), so any baked-in tilt lives on this inner group: a small
  // downward pitch so the knuckles sit on a natural punching line instead of
  // pointing slightly high.
  const inner = new Group();
  inner.rotation.x = -0.14;
  g.add(inner);

  // Classic RED boxing leather with a pale lace band.
  const leather = new MeshStandardMaterial({ color: 0xc42026, roughness: 0.45, metalness: 0.04 });
  const trim = new MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.5, metalness: 0.02 });

  // ONE clean rounded glove — the padded fist.
  const mitt = new Mesh(new SphereGeometry(0.095, 24, 18), leather);
  mitt.scale.set(1.04, 1.12, 1.16);
  mitt.position.set(0, 0.004, -0.012);
  inner.add(mitt);
  // Thumb ON TOP — a chunky rounded thumb wrapped over the top-inner front of
  // the fist, poking forward so it clearly reads as a thumb.
  const thumb = new Mesh(new SphereGeometry(0.052, 16, 12), leather);
  thumb.scale.set(1.0, 0.92, 1.3);
  thumb.position.set(hand === 'left' ? 0.046 : -0.046, 0.052, -0.052);
  inner.add(thumb);
  // Wrist cuff — sits UP around the wrist (not beneath or inside it) and wraps
  // wider than it is deep, so it reads as a cuff rather than a peg into the arm.
  const cuff = new Mesh(new CylinderGeometry(0.062, 0.073, 0.072, 20), leather);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, 0.008, 0.082);
  inner.add(cuff);
  const band = new Mesh(new TorusGeometry(0.07, 0.012, 10, 24), trim);
  band.position.set(0, 0.008, 0.11);
  inner.add(band);
  return g;
}

export class FistSystem extends createSystem({}) {
  private fists: Partial<Record<Hand, Group>> = {};
  private prevPos: Partial<Record<Hand, Vector3>> = {};
  private vel: Record<Hand, Vector3> = { left: new Vector3(), right: new Vector3() };
  private cooldown: Record<Hand, number> = { left: 0, right: 0 };
  private pokeNoise = 0;

  update(delta: number): void {
    const creature = getCreature();
    this.pokeNoise = Math.max(0, this.pokeNoise - delta);

    // Share the head pose for the creature's block/hit resolution.
    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) headObj.getWorldPosition(player.head);

    for (const hand of HANDS) {
      const grip = this.world.playerSpaceEntities.gripSpaces[hand]?.object3D;
      if (!grip) continue;

      let fist = this.fists[hand];
      if (!fist) {
        fist = buildFist(hand);
        fist.name = `goop-fist-${hand}`;
        fist.position.set(0, -0.008, 0.02); // sit ON the fist, not the palm
        grip.add(fist);
        this.fists[hand] = fist;
      }

      // Knuckles down the POINTING ray: cancel the grip's natural tilt so
      // the glove lines up with the forearm (FIRE FIGHT's glove trick).
      const ray = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
      if (ray) {
        grip.getWorldQuaternion(_gripQ);
        ray.getWorldQuaternion(_rayQ);
        fist.quaternion.copy(_gripQ).invert().multiply(_rayQ);
      }

      fist.getWorldPosition(_pos);
      player.gloves[hand].copy(_pos); // share for the creature's block checks
      const prev = this.prevPos[hand];
      if (!prev) {
        this.prevPos[hand] = new Vector3().copy(_pos);
        continue;
      }
      if (delta > 1e-4) {
        // Half-life smoothing: believable punch speeds, no tracking spikes.
        _dir.copy(_pos).sub(prev).divideScalar(delta);
        this.vel[hand].lerp(_dir, 0.55);
      }
      prev.copy(_pos);

      this.cooldown[hand] = Math.max(0, this.cooldown[hand] - delta);
      if (!creature || creature.isKo) continue;

      const d = creature.fieldAtWorld(_pos);
      if (d > 0.06) continue;

      const speed = this.vel[hand].length();
      if (speed >= PUNCH.hitSpeed && this.cooldown[hand] <= 0) {
        _dir.copy(this.vel[hand]).normalize();
        const res = creature.receivePunchWorld(_pos, _dir, speed);
        if (!res.hit) continue;
        this.cooldown[hand] = PUNCH.cooldown;

        squelch(res.strength);
        pulseHand(this.world.session, hand, 0.35 + 0.65 * res.strength, 55 + 90 * res.strength);

        if (match.phase === 'fighting') {
          let dmg = PUNCH.damage * (0.6 + res.strength) + (res.lump ? PUNCH.lumpBonus : 0);
          // It's down and it's a puddle — finish it.
          if (creature.vulnerable) dmg *= EXHAUST.vulnerability;
          match.creatureHp = Math.max(0, match.creatureHp - dmg);
          // A BIG punch (a torn lump, or a hard clean connect) is what can
          // knock a already-hurt goop out of its shape — CreatureSystem reads
          // this the same frame.
          if (res.lump || res.strength > 0.65) match.bigHit = true;
          match.boardDirty = true;
        }
      } else if (speed < PUNCH.hitSpeed && d < 0.02) {
        // Leaning into it — continuous gentle shove.
        _dir.copy(this.vel[hand]);
        const s = _dir.length();
        if (s > 0.05) {
          _dir.normalize();
          creature.pokeWorld(_pos, _dir, s);
          if (this.pokeNoise <= 0 && s > 0.35) {
            this.pokeNoise = 0.5;
            wobble(Math.min(1, s));
            pulseHand(this.world.session, hand, 0.12, 25);
          }
        }
      }
    }
  }
}
