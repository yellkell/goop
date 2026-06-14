/**
 * Rolling plants (ported from yellkell/vrenv, ECS swapped for a plain array so
 * the whole desert lives under one toggleable Group). Each tumbleweed is a
 * tangled ball of paper twigs the wind blows across the dunes; `animate` moves
 * them, rolls them about the travel axis, bounces them over the sand and wraps
 * them to the far edge when they blow out of bounds.
 */

import { type Group as GroupT, Group, Mesh, TorusGeometry, Vector3 } from 'three';
import { CONFIG } from './config.js';
import { makePaper, makeRng } from './paper.js';
import { desertHeight } from './terrain.js';

export interface Tumbleweed {
  obj: Group;
  dx: number;
  dz: number;
  speed: number;
  radius: number;
  phase: number;
}

/** A tangled ball of paper twigs. */
function makeBall(rng: () => number): Group {
  const g = new Group();
  const cols = CONFIG.palette.tumbleweed;
  const r = CONFIG.tumbleweeds.radius;
  for (let i = 0; i < 7; i++) {
    const ring = new Mesh(
      new TorusGeometry(r * (0.7 + rng() * 0.3), 0.03, 4, 7),
      makePaper(cols[(rng() * cols.length) | 0], 0.98),
    );
    ring.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    g.add(ring);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export function buildTumbleweeds(parent: GroupT): Tumbleweed[] {
  const rng = makeRng(CONFIG.terrain.seed * 19 + 4);
  const half = CONFIG.terrain.size / 2 - 4;
  const weeds: Tumbleweed[] = [];
  for (let i = 0; i < CONFIG.tumbleweeds.count; i++) {
    const ball = makeBall(rng);
    const x = (rng() * 2 - 1) * half;
    const z = (rng() * 2 - 1) * half;
    ball.position.set(x, desertHeight(x, z) + CONFIG.tumbleweeds.radius, z);
    parent.add(ball);
    const theta = (rng() - 0.5) * 0.6; // wind mostly along +X
    weeds.push({
      obj: ball,
      dx: Math.cos(theta),
      dz: Math.sin(theta),
      speed: CONFIG.tumbleweeds.windSpeed * (0.7 + rng() * 0.6),
      radius: CONFIG.tumbleweeds.radius,
      phase: rng() * Math.PI * 2,
    });
  }
  return weeds;
}

const _axis = new Vector3();

/** Blow the tumbleweeds along the wind. Call each frame while the desert shows. */
export function animateTumbleweeds(weeds: Tumbleweed[], delta: number, time: number): void {
  const half = CONFIG.terrain.size / 2 - 4;
  for (const w of weeds) {
    const obj = w.obj;
    let x = obj.position.x + w.dx * w.speed * delta;
    let z = obj.position.z + w.dz * w.speed * delta;
    // A little sideways wander so they don't travel dead-straight.
    x += -w.dz * Math.sin(time * 0.8 + w.phase) * delta * 0.6;
    z += w.dx * Math.sin(time * 0.8 + w.phase) * delta * 0.6;

    if (x > half) x = -half;
    else if (x < -half) x = half;
    if (z > half) z = -half;
    else if (z < -half) z = half;

    const ground = desertHeight(x, z) + w.radius;
    const bounce = Math.abs(Math.sin(time * 3 + w.phase)) * 0.15;
    obj.position.set(x, ground + bounce, z);

    _axis.set(-w.dz, 0, w.dx).normalize();
    obj.rotateOnWorldAxis(_axis, (w.speed * delta) / w.radius);
  }
}
