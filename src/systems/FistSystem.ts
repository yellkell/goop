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
function buildFist(hand: 'left' | 'right'): Group {
  const g = new Group();
  const leather = new MeshStandardMaterial({ color: 0x1c3a24, roughness: 0.42, metalness: 0.05 });
  const trim = new MeshStandardMaterial({
    color: 0x39d353,
    roughness: 0.35,
    emissive: 0x1d7a2f,
    emissiveIntensity: 0.6,
  });

  // Main mitt — rounded, slightly taller than wide, knuckles forward.
  const mitt = new Mesh(new SphereGeometry(0.062, 20, 16), leather);
  mitt.scale.set(1.05, 1.0, 1.28);
  mitt.position.set(0, 0, -0.015);
  g.add(mitt);
  // Thumb, tucked on the inside.
  const thumb = new Mesh(new SphereGeometry(0.03, 12, 8), leather);
  thumb.scale.set(0.9, 0.8, 1.3);
  thumb.position.set(hand === 'left' ? 0.055 : -0.055, -0.012, -0.02);
  thumb.rotation.y = hand === 'left' ? 0.5 : -0.5;
  g.add(thumb);
  // Cuff at the wrist with the team-green lace band.
  const cuff = new Mesh(new CylinderGeometry(0.048, 0.054, 0.06, 16), leather);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, -0.004, 0.075);
  g.add(cuff);
  const band = new Mesh(new TorusGeometry(0.052, 0.007, 10, 20), trim);
  band.position.set(0, -0.004, 0.104);
  g.add(band);
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
        fist.position.set(0, -0.015, 0.02); // sit ON the fist, not the palm
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
