/**
 * Cacti, papercraft style (ported from yellkell/vrenv): armed saguaros, squat
 * barrel cacti and stacked prickly-pear pads, all low-poly capsules/spheres
 * with flat shading so they read as folded paper.
 */

import { CapsuleGeometry, type Group as GroupT, Group, IcosahedronGeometry, type Material, Mesh } from 'three';
import { CONFIG } from './config.js';
import { makePaper, makeRng } from './paper.js';
import { desertHeight } from './terrain.js';

const P = CONFIG.palette;

/** One bent arm of a saguaro: a stub out to the side, then a turn skyward. */
function makeArm(mat: Material, side: number, atHeight: number, len: number): Group {
  const arm = new Group();
  const r = 0.16;
  const stub = new Mesh(new CapsuleGeometry(r, 0.5, 3, 7), mat);
  stub.rotation.z = side * Math.PI * 0.5;
  stub.position.set(side * 0.45, 0, 0);
  const up = new Mesh(new CapsuleGeometry(r, len, 3, 7), mat);
  up.position.set(side * 0.7, len * 0.5 + 0.2, 0);
  arm.add(stub, up);
  arm.position.y = atHeight;
  return arm;
}

/** The classic tall armed saguaro. */
function makeSaguaro(rng: () => number): Group {
  const g = new Group();
  const mat = makePaper(rng() < 0.5 ? P.cactus : P.cactusDark, 0.98);
  const trunkH = 2.2 + rng() * 1.8;
  const trunk = new Mesh(new CapsuleGeometry(0.32, trunkH, 3, 7), mat);
  trunk.position.y = trunkH * 0.5 + 0.32;
  g.add(trunk);

  const arms = (rng() * 3) | 0;
  for (let i = 0; i < arms; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const h = trunkH * (0.45 + rng() * 0.3);
    g.add(makeArm(mat, side, h, 0.8 + rng() * 0.7));
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** A squat barrel cactus with a little flower on top. */
function makeBarrel(rng: () => number): Group {
  const g = new Group();
  const mat = makePaper(P.cactus, 0.98);
  const h = 0.5 + rng() * 0.5;
  const body = new Mesh(new CapsuleGeometry(0.45, h, 3, 8), mat);
  body.position.y = 0.45 + h * 0.3;
  g.add(body);
  const flower = new Mesh(new IcosahedronGeometry(0.12, 0), makePaper(P.flower, 0.9));
  flower.position.y = body.position.y + 0.45 + h * 0.5;
  g.add(flower);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Stacked prickly-pear pads (flattened spheres). */
function makePricklyPear(rng: () => number): Group {
  const g = new Group();
  const mat = makePaper(P.cactusDark, 0.98);
  const pads = 2 + ((rng() * 3) | 0);
  let px = 0;
  let py = 0.35;
  for (let i = 0; i < pads; i++) {
    const pad = new Mesh(new IcosahedronGeometry(0.35 + rng() * 0.12, 1), mat);
    pad.scale.set(1, 1.25, 0.32);
    pad.rotation.y = rng() * Math.PI;
    pad.rotation.z = (rng() - 0.5) * 0.6;
    pad.position.set(px, py, 0);
    g.add(pad);
    px += (rng() - 0.5) * 0.4;
    py += 0.4 + rng() * 0.2;
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Scatter cacti across the desert, clear of the platforms. */
export function buildCacti(parent: GroupT): void {
  const rng = makeRng(CONFIG.terrain.seed * 5 + 2);
  const half = CONFIG.terrain.size / 2 - 8;
  const clear = CONFIG.cacti.clearRadius;

  const place = (g: Group): void => {
    let x = 0;
    let z = 0;
    do {
      x = (rng() * 2 - 1) * half;
      z = (rng() * 2 - 1) * half;
    } while (Math.hypot(x, z) < clear);
    g.position.set(x, desertHeight(x, z), z);
    g.rotateY(rng() * Math.PI * 2);
    parent.add(g);
  };

  for (let i = 0; i < CONFIG.cacti.saguaro; i++) place(makeSaguaro(rng));
  for (let i = 0; i < CONFIG.cacti.barrel; i++) place(makeBarrel(rng));
  for (let i = 0; i < CONFIG.cacti.pricklyPear; i++) place(makePricklyPear(rng));
}
