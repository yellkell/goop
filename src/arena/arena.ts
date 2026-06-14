/**
 * Builds the static arena for FIRE FIGHT, styled like a 90s UK robot-wars
 * pit: diamond-plate pedestal slabs with hazard-amber kick-bands, bolted
 * corner studs and a thin team-colour rim glow. The environment is intentionally
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
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  type Object3D,
} from 'three';
import type { World } from '@iwsdk/core';
import { ARENA_GAP, OCTAGON_VERTICES, PALETTE, PLATFORM } from '../config.js';
import { hazardTexture } from '../materials/hazard.js';
import { diamondPlateTextures, type DiamondPlateMaps } from '../materials/diamondPlate.js';
import { octagonSlab } from './octagon.js';
import { createTitleBanner } from './banner.js';

/** Shared diamond-plate maps, built lazily (both pedestals reuse them). */
let plateMaps: DiamondPlateMaps | undefined;

/**
 * Neon rim piping: a bright white-hot core bar along every rim edge wrapped
 * in a fatter additive halo of the team colour — proper neon tubing, not a
 * one-pixel line.
 */
function makeNeonRim(color: number): Group {
  const rim = new Group();
  rim.name = 'rim-ring';
  const core = new MeshBasicMaterial({
    color: new Color(color).lerp(new Color(0xffffff), 0.45),
  });
  core.userData.role = 'neon-core'; // skin recolour target (avatar/skins.ts)
  const halo = new MeshBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0.4,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  halo.userData.role = 'neon-halo';
  const n = OCTAGON_VERTICES.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = OCTAGON_VERTICES[i];
    const [bx, bz] = OCTAGON_VERTICES[(i + 1) % n];
    const len = Math.hypot(bx - ax, bz - az) + 0.012; // overlap the corners
    const midx = (ax + bx) / 2;
    const midz = (az + bz) / 2;
    const yaw = -Math.atan2(bz - az, bx - ax);
    const bar = new Mesh(new BoxGeometry(len, 0.014, 0.014), core);
    bar.position.set(midx, PLATFORM.rimLift, midz);
    bar.rotation.y = yaw;
    rim.add(bar);
    const glow = new Mesh(new BoxGeometry(len, 0.04, 0.04), halo);
    glow.position.copy(bar.position);
    glow.rotation.y = yaw;
    rim.add(glow);
  }
  return rim;
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
    color: 0x202329,
    metalness: 0.96,
    roughness: 0.22,
  });
  for (const [x, z] of OCTAGON_VERTICES) {
    const bolt = new Mesh(geo, mat);
    bolt.position.set(x * 0.97, 0.018, z * 0.97);
    bolts.add(bolt);
  }
  return bolts;
}

/**
 * One boxer's pedestal: a diamond-plate steel slab sunk so its top face sits
 * at floor level (your real floor IS the platform top), hazard banding and
 * corner bolts around the rim, and a thin team-colour glow line on the edge.
 */
function makePlatform(color: number): Group {
  const group = new Group();

  plateMaps ??= diamondPlateTextures();
  // ExtrudeGeometry UVs are in shape units (metres): repeat = tiles per metre.
  plateMaps.map.repeat.set(5, 5);
  plateMaps.bumpMap.repeat.set(5, 5);
  const slabMat = new MeshStandardMaterial({
    color: 0x9aa0ab, // tint over the baked dark-steel tones in the map
    map: plateMaps.map,
    bumpMap: plateMaps.bumpMap,
    bumpScale: 1.1,
    emissive: color,
    emissiveIntensity: 0.08,
    metalness: 0.92, // glistens off scene.environment (RoomEnvironment)
    roughness: 0.28,
  });
  slabMat.userData.role = 'slab';
  const slab = new Mesh(octagonSlab(OCTAGON_VERTICES, PLATFORM.thickness), slabMat);
  // Top face at y=0 (the real floor), body glowing faintly below.
  slab.position.y = -PLATFORM.thickness;
  group.add(slab);

  group.add(makeHazardBand());
  group.add(makeCornerBolts());
  group.add(makeNeonRim(color));

  // --- Per-skin ornaments (hidden; applyPlatformSkin shows one set) ---
  // INFERNO: upright glowing blade fins at every rim vertex.
  const fins = new Group();
  fins.name = 'vertex-fins';
  const finMat = new MeshBasicMaterial({ color: new Color(color).lerp(new Color(0xffffff), 0.45) });
  finMat.userData.role = 'neon-core';
  for (const [x, z] of OCTAGON_VERTICES) {
    const fin = new Mesh(new BoxGeometry(0.018, 0.085, 0.05), finMat);
    fin.position.set(x * 1.02, 0.045, z * 1.02);
    fin.rotation.y = Math.atan2(x, z); // blade faces outward, radially
    fins.add(fin);
  }
  fins.userData.skinTag = 'inferno';
  fins.visible = false;
  group.add(fins);

  // EMBER: the classic look — banding + bolts, no extra furniture.
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
