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
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { squelch, wobble } from '../audio/sfx.js';
import { PUNCH } from '../config.js';
import { pulseHand } from '../input/haptics.js';
import { getCreature, match } from '../state.js';

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

const _pos = new Vector3();
const _dir = new Vector3();

function buildFist(): Group {
  const g = new Group();
  const skin = new MeshStandardMaterial({ color: 0x2b2f2c, roughness: 0.55, metalness: 0.1 });
  const fist = new Mesh(new SphereGeometry(0.075, 20, 16), skin);
  fist.scale.set(1.1, 0.92, 1.25);
  g.add(fist);
  // Knuckle ridge.
  const ridge = new Mesh(new SphereGeometry(0.05, 12, 10), skin);
  ridge.position.set(0, 0.035, -0.045);
  ridge.scale.set(1.5, 0.7, 0.9);
  g.add(ridge);
  // Wrist wrap with a slime-green band — the one splash of team colour.
  const wrist = new Mesh(new CylinderGeometry(0.045, 0.052, 0.07, 16), skin);
  wrist.rotation.x = Math.PI / 2.6;
  wrist.position.set(0, -0.01, 0.09);
  g.add(wrist);
  const band = new Mesh(
    new TorusGeometry(0.049, 0.008, 10, 20),
    new MeshStandardMaterial({ color: 0x39d353, roughness: 0.35, emissive: 0x1d7a2f, emissiveIntensity: 0.7 }),
  );
  band.rotation.x = Math.PI / 2.6 + Math.PI / 2;
  band.position.copy(wrist.position);
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

    for (const hand of HANDS) {
      const grip = this.world.playerSpaceEntities.gripSpaces[hand]?.object3D;
      if (!grip) continue;

      let fist = this.fists[hand];
      if (!fist) {
        fist = buildFist();
        fist.name = `goop-fist-${hand}`;
        grip.add(fist);
        this.fists[hand] = fist;
      }

      fist.getWorldPosition(_pos);
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
          const dmg = PUNCH.damage * (0.6 + res.strength) + (res.lump ? PUNCH.lumpBonus : 0);
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
