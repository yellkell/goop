/**
 * The folded-paper desert floor (ported from yellkell/vrenv): a low-poly plane
 * pushed into gentle dunes, flat-shaded, lighter on the crests and darker in
 * the hollows. A flat clearing around the origin keeps the FIRE FIGHT platforms
 * on level ground.
 *
 * `desertHeight(x, z)` is exported so rocks/cacti/tumbleweeds rest on the sand.
 */

import { Color, Float32BufferAttribute, type Group, Mesh, PlaneGeometry } from 'three';
import { CONFIG } from './config.js';
import { makePaper, makeRng, valueNoise2D } from './paper.js';

const T = CONFIG.terrain;
const rng = makeRng(T.seed);
const noise = valueNoise2D(rng, 16);

/** Ground height at world (x, z). Flat near the platforms, dunes beyond. */
export function desertHeight(x: number, z: number): number {
  const big = noise(x / 42 + 10, z / 42 + 10);
  const small = noise(x / 14 + 4, z / 14 + 4);
  const dune = (big - 0.45) * T.duneHeight + (small - 0.5) * T.duneHeight * 0.3;
  const d = Math.hypot(x, z);
  const falloff = Math.min(1, Math.max(0, (d - T.flatRadius) / T.flatRadius));
  return dune * falloff;
}

export function buildTerrain(parent: Group): void {
  const geo = new PlaneGeometry(T.size, T.size, T.segments, T.segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const light = new Color(CONFIG.palette.sandLight);
  const dark = new Color(CONFIG.palette.sandDark);
  const colors: number[] = [];
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = desertHeight(x, z);
    pos.setY(i, y);
    const t = Math.min(1, Math.max(0, y / (T.duneHeight * 0.8) + 0.4));
    tmp.copy(dark).lerp(light, t);
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = makePaper(CONFIG.palette.sandLight, 1.0);
  mat.vertexColors = true;

  const ground = new Mesh(geo, mat);
  ground.receiveShadow = true;
  parent.add(ground);
}
