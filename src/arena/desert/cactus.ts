/**
 * Cacti, papercraft style (ported from yellkell/vrenv): armed saguaros, squat
 * barrel cacti and stacked prickly-pear pads, all low-poly capsules/spheres
 * with flat shading so they read as folded paper.
 */

import { CapsuleGeometry, type Group as GroupT, Group, IcosahedronGeometry, type Material, Mesh, SphereGeometry } from 'three';
import { CONFIG } from './config.js';
import { makePaper, makeRng } from './paper.js';
import { desertHeight } from './terrain.js';
import type { Swayer } from './index.js';

const P = CONFIG.palette;

/** A little squashed bloom for a growth tip. */
function makeBloom(r: number): Mesh {
  const bloom = new Mesh(new IcosahedronGeometry(r, 0), makePaper(P.flower, 0.9));
  bloom.scale.y = 0.7;
  return bloom;
}

/**
 * One arm of a saguaro: a short stub angled out of the trunk that bends back
 * skyward, with a rounded elbow and a domed growth tip — the classic "arms up"
 * silhouette instead of a stub poking sideways. The whole arm is spun about
 * the trunk by the caller so arms ring the plant at any angle.
 */
function makeArm(mat: Material, atHeight: number, len: number): Group {
  const arm = new Group();
  const r = 0.15;
  const reach = 0.42; // how far the stub leans out before turning up

  const stub = new Mesh(new CapsuleGeometry(r, 0.55, 3, 7), mat);
  stub.rotation.z = Math.PI * 0.42; // lean outward, not flat
  stub.position.set(reach * 0.5, 0.16, 0);

  const elbow = new Mesh(new SphereGeometry(r, 7, 5), mat);
  elbow.position.set(reach, 0.34, 0);

  const up = new Mesh(new CapsuleGeometry(r, len, 3, 7), mat);
  up.position.set(reach, len * 0.5 + 0.34, 0);

  const tip = new Mesh(new SphereGeometry(r * 0.92, 7, 5), mat);
  tip.position.set(reach, len + 0.34, 0);

  arm.add(stub, elbow, up, tip);
  arm.position.y = atHeight;
  return arm;
}

/** The classic tall armed saguaro: ribbed trunk, domed crown, raised arms. */
function makeSaguaro(rng: () => number): Group {
  const g = new Group();
  const mat = makePaper(rng() < 0.5 ? P.cactus : P.cactusDark, 0.98);
  const trunkH = 2.2 + rng() * 1.8;
  const r = 0.3 + rng() * 0.06;
  const trunk = new Mesh(new CapsuleGeometry(r, trunkH, 3, 9), mat);
  trunk.position.y = trunkH * 0.5 + r;
  g.add(trunk);

  // Domed crown so the trunk reads as grown, not sawn off.
  const crown = new Mesh(new SphereGeometry(r * 0.96, 9, 6), mat);
  crown.position.y = trunkH + r;
  g.add(crown);

  const arms = (rng() * 3) | 0;
  for (let i = 0; i < arms; i++) {
    const arm = makeArm(mat, trunkH * (0.42 + rng() * 0.28), 0.8 + rng() * 0.7);
    arm.rotation.y = rng() * Math.PI * 2;
    g.add(arm);
  }

  // The odd saguaro flowers at its tips in spring.
  if (rng() < 0.45) {
    const bloom = makeBloom(0.13);
    bloom.position.y = trunkH + r * 1.5;
    g.add(bloom);
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

/** Stacked prickly-pear pads (flattened spheres), some tipped with blooms. */
function makePricklyPear(rng: () => number): Group {
  const g = new Group();
  const mat = makePaper(P.cactusDark, 0.98);
  const pads = 2 + ((rng() * 3) | 0);
  let px = 0;
  let py = 0.35;
  for (let i = 0; i < pads; i++) {
    const rad = 0.35 + rng() * 0.12;
    const pad = new Mesh(new IcosahedronGeometry(rad, 1), mat);
    pad.scale.set(1, 1.25, 0.32);
    pad.rotation.y = rng() * Math.PI;
    pad.rotation.z = (rng() - 0.5) * 0.6;
    pad.position.set(px, py, 0);
    g.add(pad);
    // A bloom riding the top edge of an upper pad.
    if (i >= pads - 2 && rng() < 0.5) {
      const bloom = makeBloom(0.07);
      bloom.position.set(px + (rng() - 0.5) * 0.2, py + rad * 1.2, 0);
      g.add(bloom);
    }
    px += (rng() - 0.5) * 0.4;
    py += 0.4 + rng() * 0.2;
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/**
 * Scatter cacti across the desert, clear of the platforms. Returns the saguaro
 * sway handles — tall cacti get a barely-there lean so the scene isn't frozen,
 * while the squat barrels and pears stay put.
 */
export function buildCacti(parent: GroupT): Swayer[] {
  const rng = makeRng(CONFIG.terrain.seed * 5 + 2);
  const half = CONFIG.terrain.size / 2 - 8;
  const clear = CONFIG.cacti.clearRadius;
  const swayers: Swayer[] = [];

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

  for (let i = 0; i < CONFIG.cacti.saguaro; i++) {
    const s = makeSaguaro(rng);
    place(s);
    swayers.push({ obj: s, phase: rng() * Math.PI * 2, amp: 0.012 + rng() * 0.012, speed: 0.4 + rng() * 0.3 });
  }
  for (let i = 0; i < CONFIG.cacti.barrel; i++) place(makeBarrel(rng));
  for (let i = 0; i < CONFIG.cacti.pricklyPear; i++) place(makePricklyPear(rng));
  return swayers;
}
