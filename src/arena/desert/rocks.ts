/**
 * Rocks of the desert (ported from yellkell/vrenv): faceted boulders scattered
 * across the sand in one instanced draw, plus the big layered-cardstock mesas
 * that make the classic western horizon. (The grab-able paper rocks from the
 * original are dropped — the arena has no grab system.)
 */

import {
  Color,
  CylinderGeometry,
  type Group as GroupT,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  Object3D,
} from 'three';
import { CONFIG } from './config.js';
import { makePaper, makeRng } from './paper.js';
import { desertHeight } from './terrain.js';
import { collapseStatic } from '../merge.js';

const P = CONFIG.palette;
const dummy = new Object3D();

function trs(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number): Object3D['matrix'] {
  dummy.position.set(x, y, z);
  dummy.scale.set(sx, sy, sz);
  dummy.rotation.set(0, ry, 0);
  dummy.updateMatrix();
  return dummy.matrix;
}

/** Faceted boulders strewn across the dunes. */
export function buildBoulders(parent: GroupT): void {
  const rng = makeRng(CONFIG.terrain.seed * 7 + 1);
  const n = CONFIG.rocks.boulders;
  const half = CONFIG.terrain.size / 2 - 6;
  const cols = P.boulder.map((c) => new Color(c));
  const mesh = new InstancedMesh(new IcosahedronGeometry(1, 0), makePaper('#ffffff', 0.98), n);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  for (let i = 0; i < n; i++) {
    const x = (rng() * 2 - 1) * half;
    const z = (rng() * 2 - 1) * half;
    const s = 0.4 + rng() * rng() * 2.2;
    const y = desertHeight(x, z) + s * 0.45;
    mesh.setMatrixAt(i, trs(x, y, z, s, s * (0.7 + rng() * 0.4), s, rng() * Math.PI));
    mesh.setColorAt(i, cols[(rng() * cols.length) | 0]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  parent.add(mesh);
}

/** A single layered-strata mesa (stacked faceted slabs, flat top). */
function makeMesa(rng: () => number, height: number): Group {
  const g = new Group();
  const layers = 4 + ((rng() * 3) | 0);
  let y = 0;
  let radius = height * (0.45 + rng() * 0.2);
  for (let i = 0; i < layers; i++) {
    const h = height / layers;
    const slab = new Mesh(
      new CylinderGeometry(radius * 0.92, radius, h, 6 + ((rng() * 2) | 0)),
      makePaper(P.rockStrata[i % P.rockStrata.length], 0.98),
    );
    slab.position.y = y + h / 2;
    slab.rotation.y = rng() * Math.PI;
    slab.castShadow = true;
    g.add(slab);
    y += h;
    radius *= 0.82 + rng() * 0.08;
  }
  return g;
}

/** A ring of mesas out toward the horizon — the western silhouette. */
export function buildMesas(parent: GroupT): void {
  const rng = makeRng(CONFIG.terrain.seed * 13 + 3);
  const { mesas, mesaRingMin, mesaRingMax } = CONFIG.rocks;
  // Mesas never move and their strata colours repeat, so the whole ring merges
  // down to one mesh per strata colour instead of ~5 slabs each.
  const ring = new Group();
  for (let i = 0; i < mesas; i++) {
    const a = (i / mesas) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const r = mesaRingMin + rng() * (mesaRingMax - mesaRingMin);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const height = 16 + rng() * 26;
    const mesa = makeMesa(rng, height);
    mesa.position.set(x, desertHeight(x, z) - 1, z);
    ring.add(mesa);
  }
  collapseStatic(ring);
  parent.add(ring);
}
