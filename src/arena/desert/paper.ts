/**
 * Papercraft material toolkit + tiny deterministic helpers (ported from
 * yellkell/vrenv). The look is "folded construction paper": flat-shaded
 * low-poly geometry wearing completely matte materials — cheap, holds frame
 * rate on Quest.
 */

import { Color, MeshStandardMaterial } from 'three';

/** A sheet of matte paper. `flat` gives the folded-facet look (default on). */
export function makePaper(hex: string, roughness = 0.97, flat = true): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(hex),
    roughness,
    metalness: 0.0,
    flatShading: flat,
    envMapIntensity: 0.35, // a touch of sky bounce, but stays papery
  });
}

/** Paper visible from both sides (cactus pads, the sun disc). */
export function makePaperDouble(hex: string, emissive = 0): MeshStandardMaterial {
  const c = new Color(hex);
  const mat = makePaper(hex);
  mat.side = 2; // THREE.DoubleSide
  if (emissive > 0) {
    mat.emissive = c.clone().multiplyScalar(emissive);
  }
  return mat;
}

/** Deterministic PRNG (mulberry32) — same seed → same desert every reload. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise on a 2D grid — gives the dunes their rolling shape. */
export function valueNoise2D(rng: () => number, size: number): (x: number, y: number) => number {
  const grid: number[] = new Array((size + 1) * (size + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const at = (xi: number, yi: number): number => {
    const cx = ((xi % size) + size) % size;
    const cy = ((yi % size) + size) % size;
    return grid[cy * (size + 1) + cx];
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };
}
