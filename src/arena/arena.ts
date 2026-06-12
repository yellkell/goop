/**
 * Builds the static arena for FIRE FIGHT, styled like a 90s UK robot-wars
 * pit: gunmetal pedestal slabs with hazard-amber kick-bands, bolted corner
 * studs and a thin team-colour rim glow. The environment is intentionally
 * just the two platforms floating in your passthrough room:
 *  - a slab pedestal beneath YOU (ember rim) — underfoot, Blaston-style,
 *  - a matching pedestal across the gap for the opponent (blue rim),
 *  - the FIRE FIGHT title plate hung high behind the opponent (lobby only),
 *  - warm key lighting so the steel and fire read with some form.
 *
 * The guardian-style rim barrier is built and driven by BoundarySystem.
 * These are plain Three.js objects parented under `world.scene` — static
 * set-dressing. Dynamic, interactive objects become ECS entities.
 */

import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Vector3,
  type Object3D,
} from 'three';
import type { World } from '@iwsdk/core';
import { ARENA_GAP, OCTAGON_VERTICES, PALETTE, PLATFORM } from '../config.js';
import { hazardTexture } from '../materials/hazard.js';
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

/** Flat hazard-striped warning band laid along each rim edge. */
function makeHazardBand(): Group {
  const band = new Group();
  band.name = 'hazard-band';
  const tex = hazardTexture();
  const width = 0.1;
  const n = OCTAGON_VERTICES.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = OCTAGON_VERTICES[i];
    const [bx, bz] = OCTAGON_VERTICES[(i + 1) % n];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    // Inward normal: shift the band just inside the rim line.
    let nx = -dz / len;
    let nz = dx / len;
    const midx = (ax + bx) / 2;
    const midz = (az + bz) / 2;
    if (nx * midx + nz * midz > 0) {
      nx = -nx;
      nz = -nz;
    }
    const geo = new PlaneGeometry(len, width);
    geo.rotateX(-Math.PI / 2); // lie flat in XZ, +X along the edge
    const mat = new MeshBasicMaterial({ map: tex.clone(), transparent: true, opacity: 0.85 });
    mat.map!.repeat.set(Math.max(1, Math.round(len * 6)), 1);
    const strip = new Mesh(geo, mat);
    strip.position.set(midx + nx * (width / 2 + 0.01), PLATFORM.rimLift, midz + nz * (width / 2 + 0.01));
    strip.rotation.y = -Math.atan2(dz, dx);
    band.add(strip);
  }
  return band;
}

/** Bolted corner studs at each rim vertex — armour the silhouette. */
function makeCornerBolts(): Group {
  const bolts = new Group();
  bolts.name = 'corner-bolts';
  const geo = new CylinderGeometry(0.028, 0.035, 0.035, 8);
  const mat = new MeshStandardMaterial({
    color: PALETTE.gunmetal,
    metalness: 0.95,
    roughness: 0.3,
  });
  for (const [x, z] of OCTAGON_VERTICES) {
    const bolt = new Mesh(geo, mat);
    bolt.position.set(x * 0.97, 0.018, z * 0.97);
    bolts.add(bolt);
  }
  return bolts;
}

/**
 * One boxer's pedestal: a gunmetal slab sunk so its top face sits at floor
 * level (your real floor IS the platform top), hazard banding and corner
 * bolts around the rim, and a thin team-colour glow line marking the edge.
 */
function makePlatform(color: number): Group {
  const group = new Group();

  const slab = new Mesh(
    octagonSlab(OCTAGON_VERTICES, PLATFORM.thickness),
    new MeshStandardMaterial({
      color: PALETTE.gunmetalDark,
      emissive: color,
      emissiveIntensity: 0.22,
      metalness: 0.88,
      roughness: 0.38,
    }),
  );
  // Top face at y=0 (the real floor), body glowing faintly below.
  slab.position.y = -PLATFORM.thickness;
  group.add(slab);

  group.add(makeHazardBand());
  group.add(makeCornerBolts());
  group.add(makeRimRing(color));
  return group;
}

export function buildArena(world: World): Object3D {
  const scene = world.scene;

  const arena = new Group();
  arena.name = 'arena';

  // Your pedestal: ember rim, underfoot.
  const mine = makePlatform(PALETTE.ember);
  mine.name = 'player-platform';
  arena.add(mine);

  // The opponent's pedestal across the gap — same shape, blue rim.
  const theirs = makePlatform(PALETTE.coolFlame);
  theirs.position.set(0, 0, -ARENA_GAP);
  theirs.name = 'opponent-platform';
  arena.add(theirs);

  // "FIRE FIGHT" signage hung high behind the opponent.
  createTitleBanner(scene);

  // --- Lighting: warm-vs-cool so both fires and the steel read nicely ---
  arena.add(new HemisphereLight(0xcfd8e8, 0xffd9b0, 1.2));
  const key = new PointLight(PALETTE.flame, 7, 14);
  key.position.set(0, 3, -ARENA_GAP / 2);
  arena.add(key);

  scene.add(arena);
  return arena;
}
