/**
 * The boxing-glove model — a GLB the player wears on each controller. We load
 * it once, normalise it (centre at the wrist-ish origin, scale to a sensible
 * hand size), make the leather a bit SHINY, then hand out per-hand clones. The
 * outer group each `buildGlove` returns is what FistSystem aims down the
 * controller ray every frame; the model sits on an inner group carrying the
 * fixed orientation/tilt so that per-frame aim doesn't clobber it.
 */

import { Box3, Group, Mesh, type MeshStandardMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import gloveUrl from '../assets/models/glove.glb?url';

/** Longest dimension of the finished glove, in metres. */
const TARGET_SIZE = 0.22;
/** Base orientation of the model inside the inner group (knuckles forward,
 *  a touch of downward tilt so they sit on a natural punching line). */
const BASE_YAW = Math.PI / 2;
const BASE_PITCH = -0.14;

let template: Group | null = null;
const waiting: Array<(t: Group) => void> = [];

new GLTFLoader().loadAsync(gloveUrl).then((gltf) => {
  const root = gltf.scene;

  // Shiny leather: keep the baked texture, drop the roughness right down and
  // add a hint of metalness so the directional light throws a wet highlight.
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mat = m.material as MeshStandardMaterial;
    mat.roughness = 0.24;
    mat.metalness = 0.12;
    mat.envMapIntensity = 1.3;
    mat.needsUpdate = true;
  });

  // Normalise: centre the mesh and scale so its longest axis is TARGET_SIZE.
  const box = new Box3().setFromObject(root);
  const size = new Vector3();
  const centre = new Vector3();
  box.getSize(size);
  box.getCenter(centre);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  root.position.sub(centre);
  const wrap = new Group();
  wrap.add(root);
  wrap.scale.setScalar(TARGET_SIZE / maxDim);

  template = wrap;
  for (const cb of waiting) cb(wrap);
  waiting.length = 0;
});

/** One wearable glove for a hand. Returns immediately; the model streams in
 *  when the GLB finishes decoding. */
export function buildGlove(hand: 'left' | 'right'): Group {
  const g = new Group();
  const inner = new Group();
  inner.rotation.set(BASE_PITCH, BASE_YAW, 0);
  g.add(inner);

  const place = (t: Group): void => {
    const model = t.clone(true);
    // Mirror the thumb to the correct side for the other hand.
    if (hand === 'left') model.scale.x *= -1;
    inner.add(model);
  };
  if (template) place(template);
  else waiting.push(place);

  return g;
}
