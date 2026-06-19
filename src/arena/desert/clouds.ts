/**
 * Flattened paper clouds (adapted from yellkell/DOWN2): a few overlapping
 * faceted blobs per cloud, squashed flat and drifting slowly above the mesas.
 * They cast no shadow.
 *
 * Their travel band runs well wider than the placed spread, and each cloud
 * fades out as it nears the far edge and back in after it wraps round, so a
 * cloud dissolves into the haze and re-forms rather than snapping across the
 * sky — the wrap is never seen.
 */

import { type Group as GroupT, Group, IcosahedronGeometry, Mesh, type MeshStandardMaterial } from 'three';
import { CONFIG } from './config.js';
import { makePaper, makeRng } from './paper.js';

export interface CloudDrift {
  obj: Group;
  mat: MeshStandardMaterial;
  speed: number;
  bound: number; // wrap point (x), out past the placed spread
  fade: number; // width of the fade band at each edge
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** A clump of squashed paper puffs, all sharing one (fade-able) material. */
function makeCloud(rng: () => number, mat: MeshStandardMaterial): Group {
  const g = new Group();
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
  const bound = spread + 50; // wrap well outside the visible band
  const fade = 48; // fade band sits beyond the placed clouds
  const clouds: CloudDrift[] = [];
  for (let i = 0; i < count; i++) {
    const mat = makePaper(CONFIG.palette.cloud, 1.0);
    mat.transparent = true;
    const cloud = makeCloud(rng, mat);
    const y = heightMin + rng() * (heightMax - heightMin);
    cloud.position.set((rng() * 2 - 1) * spread, y, (rng() * 2 - 1) * spread);
    parent.add(cloud);
    clouds.push({ obj: cloud, mat, speed: drift * (0.6 + rng() * 0.9), bound, fade });
  }
  return clouds;
}

/** Drift the clouds along the wind, fading them out/in across the wrap. */
export function animateClouds(clouds: CloudDrift[], delta: number): void {
  for (const c of clouds) {
    c.obj.position.x += c.speed * delta;
    if (c.obj.position.x > c.bound) c.obj.position.x = -c.bound;
    c.mat.opacity = smooth(Math.min(1, Math.max(0, (c.bound - Math.abs(c.obj.position.x)) / c.fade)));
  }
}
