/**
 * Agave (adapted from yellkell/DOWN2): a splayed rosette of thin double-sided
 * paper blades. Each blade leans out of a shared pivot, so the whole rosette
 * sways as one when the wind catches it. Scattered through the mid-ground,
 * sparse enough that the far dunes stay clean.
 */

import { ConeGeometry, type Group as GroupT, Group, Mesh } from 'three';
import { CONFIG } from './config.js';
import { makePaperDouble, makeRng } from './paper.js';
import { desertHeight } from './terrain.js';
import { collapseStatic } from '../merge.js';
import type { Swayer } from './index.js';

const P = CONFIG.palette;

/** A rosette of blades splayed out of one base, so the clump sways together. */
function makeAgave(rng: () => number): Group {
  const g = new Group();
  const blades = 7 + ((rng() * 5) | 0);
  for (let i = 0; i < blades; i++) {
    const len = 0.6 + rng() * 0.5;
    const blade = new Mesh(new ConeGeometry(0.07, len, 4), makePaperDouble(P.agave));
    blade.position.y = len * 0.5;
    blade.castShadow = true;

    // Lean each blade outward, then spin it around the rosette.
    const lean = new Group();
    lean.rotation.z = 0.5 + rng() * 0.45;
    lean.add(blade);
    const pivot = new Group();
    pivot.rotation.y = (i / blades) * Math.PI * 2 + rng() * 0.2;
    pivot.add(lean);
    g.add(pivot);
  }
  return g;
}

/** Scatter agave through the mid-ground; returns their sway handles. */
export function buildAgave(parent: GroupT): Swayer[] {
  const rng = makeRng(CONFIG.terrain.seed * 11 + 7);
  const { count, clearRadius, spread } = CONFIG.agave;
  const swayers: Swayer[] = [];

  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    do {
      x = (rng() * 2 - 1) * spread;
      z = (rng() * 2 - 1) * spread;
    } while (Math.hypot(x, z) < clearRadius);

    const agave = makeAgave(rng);
    collapseStatic(agave); // many blades → one mesh; the group still sways as a unit
    agave.position.set(x, desertHeight(x, z), z);
    agave.rotateY(rng() * Math.PI * 2);
    parent.add(agave);
    swayers.push({
      obj: agave,
      phase: rng() * Math.PI * 2,
      amp: 0.04 + rng() * 0.05,
      speed: 0.8 + rng() * 0.6,
    });
  }
  return swayers;
}
