/**
 * Static-geometry merge helper — collapses a subtree of many small meshes into
 * one mesh per distinct material LOOK, baked into the subtree's local space.
 *
 * The arenas are built from hundreds of individual papercraft meshes (cacti,
 * agave, mesas…). Each is its own draw call, and the desert alone ran ~400.
 * Since the scenery never changes shape, we can bake it down once at build time:
 * the GPU draws the exact same triangles, materials and positions — pixel for
 * pixel identical — but as a handful of big batches instead of hundreds of
 * little ones.
 *
 * Two ways to use it:
 *  - on a single prop group that still needs to MOVE as a unit (a swaying plant)
 *    — its sub-meshes collapse to 1–2, and the group keeps its transform so it
 *    still sways;
 *  - on a throwaway group holding many STATIC props — they all merge together,
 *    across props, into a few meshes for the whole field.
 *
 * Materials are keyed by their visible properties (not object identity), so the
 * per-instance materials the builders create still merge into one batch.
 */

import { type BufferGeometry, Matrix4, Mesh, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A stable key for "these materials render identically", so meshes built with
 *  their own material instances still share one merged batch. */
function materialKey(m: Material): string {
  const s = m as Material & {
    color?: { getHexString(): string };
    emissive?: { getHexString(): string };
    roughness?: number;
    metalness?: number;
    flatShading?: boolean;
    envMapIntensity?: number;
    map?: { uuid: string } | null;
  };
  return [
    m.type,
    s.color?.getHexString?.() ?? '',
    s.emissive?.getHexString?.() ?? '',
    s.roughness ?? '',
    s.metalness ?? '',
    s.flatShading ?? '',
    s.envMapIntensity ?? '',
    m.side,
    m.transparent,
    m.opacity,
    s.map?.uuid ?? '', // never merge two different textures together
  ].join('|');
}

interface Bucket {
  mat: Material;
  geos: BufferGeometry[];
  cast: boolean;
  recv: boolean;
}

/**
 * Merge every descendant mesh of `root` into one mesh per material look, baked
 * into `root`'s local space, then replace `root`'s children with those merged
 * meshes. `root` keeps its own transform, so a group that animates (a swaying
 * plant) still animates. Visually identical; far fewer draw calls.
 */
export function collapseStatic(root: Object3D): void {
  root.updateMatrixWorld(true);
  const invRoot = new Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, Bucket>();

  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || Array.isArray(m.material) || !m.geometry) return;
    const mat = m.material as Material;
    const key = materialKey(mat);
    let b = buckets.get(key);
    if (!b) {
      b = { mat, geos: [], cast: false, recv: false };
      buckets.set(key, b);
    }
    // Clone, drop the index (so indexed + non-indexed primitives can mix), and
    // bake the mesh's transform — relative to root — into the vertices.
    let geo = m.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    geo.applyMatrix4(new Matrix4().copy(invRoot).multiply(m.matrixWorld));
    // Keep only the attributes every primitive shares, so the merge never trips.
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    b.geos.push(geo);
    b.cast ||= m.castShadow;
    b.recv ||= m.receiveShadow;
  });

  root.clear();
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    root.add(mesh);
  }
}
