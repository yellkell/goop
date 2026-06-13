/**
 * The manipulatable props — pint glasses and darts — as grabbable meshes.
 *
 * Both get an invisible spherical GRAB PROXY child: the grab system finds
 * targets by raycasting the entity's meshes, and a 5 mm dart shaft is
 * effectively impossible to point at (this is the bug that killed the darts
 * in our old vrstreet build — the geometry was never hittable). The proxy
 * makes the whole hand-sized region around a prop grabbable while the
 * visible mesh stays slim.
 */

import {
  CylinderGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { PALETTE } from '../config.js';
import { GLASS } from './config.js';

function grabProxy(radius: number, y = 0): Mesh {
  const proxy = new Mesh(
    new SphereGeometry(radius, 8, 6),
    new MeshBasicMaterial({ visible: false }),
  );
  proxy.position.y = y;
  proxy.name = 'grab-proxy';
  return proxy;
}

/**
 * A dimpled pub pint glass — slightly tapered, with a faint amber "beer"
 * fill so it reads at a glance across the room. Origin at the BASE so a
 * glass at y=0 sits on the surface.
 */
export function buildPintGlass(): Group {
  const g = new Group();
  g.name = 'pint-glass';

  const glassMat = new MeshStandardMaterial({
    color: 0xc9d6e2,
    metalness: 0.1,
    roughness: 0.08,
    transparent: true,
    opacity: 0.3,
    // Don't write depth: a transparent wall must never occlude the beer
    // behind it. Without this the column sorts in front at some head angles
    // and depth-rejects the beer fragments, so the pint appears to vanish.
    depthWrite: false,
  });
  const wall = new Mesh(
    new CylinderGeometry(GLASS.radiusTop, GLASS.radiusBottom, GLASS.height, 12, 1, true),
    glassMat,
  );
  wall.position.y = GLASS.height / 2;
  g.add(wall);

  const base = new Mesh(
    new CylinderGeometry(GLASS.radiusBottom, GLASS.radiusBottom * 1.04, 0.012, 12),
    new MeshStandardMaterial({ color: 0xaebccb, metalness: 0.15, roughness: 0.15, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  base.position.y = 0.006;
  g.add(base);

  // The pint itself: amber column with a pale head.
  const beer = new Mesh(
    new CylinderGeometry(GLASS.radiusTop * 0.88, GLASS.radiusBottom * 0.88, GLASS.height * 0.72, 12),
    new MeshStandardMaterial({
      color: 0xc97a1e,
      emissive: 0x4a2605,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      transparent: true,
      opacity: 0.88,
    }),
  );
  beer.name = 'beer';
  beer.position.y = 0.012 + (GLASS.height * 0.72) / 2;
  g.add(beer);
  const head = new Mesh(
    new CylinderGeometry(GLASS.radiusTop * 0.89, GLASS.radiusTop * 0.85, 0.018, 12),
    new MeshStandardMaterial({ color: 0xf2e9d4, roughness: 0.8 }),
  );
  head.name = 'beer-head';
  head.position.y = 0.012 + GLASS.height * 0.72 + 0.009;
  g.add(head);

  g.add(grabProxy(0.085, GLASS.height / 2));
  return g;
}

/**
 * Set how full a pint is (0 = empty, 1 = full): the amber column scales up
 * from the glass base and the foam head rides on top. PropSystem animates
 * this as a fresh pour settles.
 */
export function setGlassFill(glass: Group, f: number): void {
  const beer = glass.getObjectByName('beer');
  const head = glass.getObjectByName('beer-head');
  const fill = Math.max(0.0001, Math.min(1, f));
  if (beer) {
    beer.scale.y = fill;
    beer.position.y = 0.012 + (GLASS.height * 0.72 * fill) / 2;
    beer.visible = f > 0.02;
  }
  if (head) {
    head.position.y = 0.012 + GLASS.height * 0.72 * fill + 0.009;
    head.visible = f > 0.1;
  }
}

/**
 * A steel pub dart, tip along +Y (matching the flight maths in PropSystem).
 * Flights in hazard amber — house darts for an iron house.
 */
export function buildDart(): Group {
  const g = new Group();
  g.name = 'dart';
  const steel = new MeshStandardMaterial({ color: 0xc8d0da, metalness: 0.9, roughness: 0.25 });
  const barrelMat = new MeshStandardMaterial({ color: PALETTE.gunmetal, metalness: 0.85, roughness: 0.35 });

  const barrel = new Mesh(new CylinderGeometry(0.006, 0.008, 0.07, 8), barrelMat);
  barrel.position.y = 0.02;
  g.add(barrel);
  const shaft = new Mesh(new CylinderGeometry(0.0035, 0.005, 0.1, 6), steel);
  shaft.position.y = -0.05;
  g.add(shaft);
  const tip = new Mesh(new ConeGeometry(0.004, 0.045, 6), steel);
  tip.position.y = 0.078;
  g.add(tip);
  const flight = new Mesh(
    new ConeGeometry(0.02, 0.055, 4),
    new MeshStandardMaterial({
      color: PALETTE.amber,
      emissive: PALETTE.amber,
      emissiveIntensity: 0.35,
      roughness: 0.6,
    }),
  );
  flight.position.y = -0.115;
  flight.rotation.x = Math.PI;
  g.add(flight);

  g.add(grabProxy(0.07));
  return g;
}

/** Restore full opacity after a stuck-dart fade-out. */
export function restoreOpacity(group: Group): void {
  group.traverse((o) => {
    const mesh = o as Mesh;
    const m = mesh.material as (MeshStandardMaterial & { userData: { baseOpacity?: number } }) | undefined;
    if (!m || !m.isMaterial || mesh.name === 'grab-proxy') return;
    if (m.userData.baseOpacity === undefined) {
      m.userData.baseOpacity = m.transparent ? m.opacity : 1;
    }
    m.opacity = m.userData.baseOpacity;
    m.transparent = m.userData.baseOpacity < 1;
  });
}

/** Scale a prop's opacity toward zero (k = 1 → full, 0 → gone). */
export function fadeOpacity(group: Group, k: number): void {
  group.traverse((o) => {
    const mesh = o as Mesh;
    const m = mesh.material as (MeshStandardMaterial & { userData: { baseOpacity?: number } }) | undefined;
    if (!m || !m.isMaterial || mesh.name === 'grab-proxy') return;
    if (m.userData.baseOpacity === undefined) {
      m.userData.baseOpacity = m.transparent ? m.opacity : 1;
    }
    m.transparent = true;
    m.opacity = m.userData.baseOpacity * k;
  });
}
