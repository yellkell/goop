/**
 * Flattened paper clouds (adapted from yellkell/DOWN2): a few overlapping
 * faceted blobs per cloud, squashed flat and drifting slowly above the mesas.
 * They cast no shadow and wrap back round when they blow off the far edge.
 */

import { type Group as GroupT, Group, IcosahedronGeometry, Mesh } from 'three';
import { CONFIG } from './config.js';
import { makePaper, makeRng } from './paper.js';

export interface CloudDrift {
  obj: Group;
  speed: number;
  bound: number;
}

/** A clump of squashed paper puffs. */
function makeCloud(rng: () => number): Group {
  const g = new Group();
  const mat = makePaper(CONFIG.palette.cloud, 1.0);
  const puffs = 3 + ((rng() * 3) | 0);
  for (let i = 0; i < puffs; i++) {
    const r = 2.4 + rng() * 3.2;
    const puff = new Mesh(new IcosahedronGeometry(r, 1), mat);
    puff.position.set((rng() - 0.5) * 9, (rng() - 0.5) * 2.4, (rng() - 0.5) * 5);
    puff.scale.y = 0.55;
    g.add(puff);
  }
  return g;
}

/** Drop drifting clouds into the sky; returns their drift handles. */
export function buildClouds(parent: GroupT): CloudDrift[] {
  const rng = makeRng(CONFIG.terrain.seed * 17 + 5);
  const { count, heightMin, heightMax, spread, drift } = CONFIG.clouds;
  const clouds: CloudDrift[] = [];
  for (let i = 0; i < count; i++) {
    const cloud = makeCloud(rng);
    const y = heightMin + rng() * (heightMax - heightMin);
    cloud.position.set((rng() * 2 - 1) * spread, y, (rng() * 2 - 1) * spread);
    parent.add(cloud);
    clouds.push({ obj: cloud, speed: drift * (0.6 + rng() * 0.9), bound: spread + 20 });
  }
  return clouds;
}

/** Drift the clouds along the wind, wrapping them at the far edge. */
export function animateClouds(clouds: CloudDrift[], delta: number): void {
  for (const c of clouds) {
    c.obj.position.x += c.speed * delta;
    if (c.obj.position.x > c.bound) c.obj.position.x = -c.bound;
  }
}
