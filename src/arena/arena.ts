/**
 * Builds the static arena for FIRE FIGHT. The environment is intentionally
 * just the two platforms floating in your passthrough room:
 *  - a slab pedestal beneath YOU with glowing emissive sides and a neon rim
 *    (ember orange) — you see it underfoot, Blaston-style,
 *  - a matching pedestal across the gap for the opponent (blue fire),
 *  - the FIRE FIGHT title banner hung high behind the opponent (lobby only),
 *  - warm key lighting so the iron and fire read with some form.
 *
 * The guardian-style rim barrier is built and driven by BoundarySystem.
 * These are plain Three.js objects parented under `world.scene` — static
 * set-dressing. Dynamic, interactive objects become ECS entities.
 */

import {
  BufferGeometry,
  Color,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Vector3,
  type Object3D,
} from 'three';
import type { World } from '@iwsdk/core';
import { ARENA_GAP, OCTAGON_VERTICES, PALETTE, PLATFORM } from '../config.js';
import { octagonSlab } from './octagon.js';
import { createTitleBanner } from './banner.js';

/** A glowing outline of the platform rim, just above the floor line. */
function makeRimRing(color: number): Line {
  const pts = OCTAGON_VERTICES.map(([x, z]) => new Vector3(x, PLATFORM.rimLift, z));
  pts.push(pts[0].clone()); // close the loop
  const geo = new BufferGeometry().setFromPoints(pts);
  const ring = new Line(geo, new LineBasicMaterial({ color: new Color(color), transparent: true, opacity: 0.95 }));
  ring.name = 'rim-ring';
  return ring;
}

/**
 * One boxer's pedestal: a slab sunk so its top face sits at floor level
 * (your real floor IS the platform top), with hot emissive sides and a neon
 * rim — it reads as standing on a raised stage without lifting you off your
 * actual floor.
 */
function makePlatform(color: number): Group {
  const group = new Group();

  const slab = new Mesh(
    octagonSlab(OCTAGON_VERTICES, PLATFORM.thickness),
    new MeshStandardMaterial({
      color: PALETTE.charcoal,
      emissive: color,
      emissiveIntensity: 0.55,
      metalness: 0.7,
      roughness: 0.45,
    }),
  );
  // Top face at y=0 (the real floor), body glowing below.
  slab.position.y = -PLATFORM.thickness;
  group.add(slab);

  group.add(makeRimRing(color));
  return group;
}

export function buildArena(world: World): Object3D {
  const scene = world.scene;

  const arena = new Group();
  arena.name = 'arena';

  // Your pedestal: ember orange, underfoot.
  const mine = makePlatform(PALETTE.ember);
  mine.name = 'player-platform';
  arena.add(mine);

  // The opponent's pedestal across the gap — same shape, blue fire.
  const theirs = makePlatform(PALETTE.coolFlame);
  theirs.position.set(0, 0, -ARENA_GAP);
  theirs.name = 'opponent-platform';
  arena.add(theirs);

  // "FIRE FIGHT" signage hung high behind the opponent.
  createTitleBanner(scene);

  // --- Lighting: warm-vs-cool so both fires and the iron read nicely ---
  arena.add(new HemisphereLight(0xcfd8e8, 0xffd9b0, 1.2));
  const key = new PointLight(PALETTE.flame, 7, 14);
  key.position.set(0, 3, -ARENA_GAP / 2);
  arena.add(key);

  scene.add(arena);
  return arena;
}
