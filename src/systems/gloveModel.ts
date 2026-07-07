/**
 * The boxing-glove model — a GLB the player wears on each controller. We load
 * it once, normalise it (centre at the wrist-ish origin, scale to a real
 * glove size), make the leather a bit SHINY, then hand out per-hand clones.
 * The outer group each `buildGlove` returns is what FistSystem aims down the
 * controller ray every frame; everything fixed lives on nested inner groups:
 *
 *   outer (per-frame aim) → tilt (pitch) → roll (thumb up on top) → base (yaw)
 *
 * The roll sits AFTER the yaw in the hierarchy so it turns the glove around
 * its own punch axis — that's what brings the thumb pad up to where your real
 * thumb rests on top of the controller.
 */

import { Box3, Group, Mesh, type MeshStandardMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import gloveUrl from '../assets/models/glove.glb?url';

/** Longest dimension of the finished glove, in metres — real-glove chunky. */
const TARGET_SIZE = 0.31;
/** Model → punch-axis orientation inside the roll group. */
const BASE_YAW = Math.PI / 2;
/** Downward pitch so the knuckles sit on a natural punching line. */
const BASE_PITCH = -0.14;
/** Roll around the punch axis, bringing the thumb pad from the inner side up
 *  to the TOP of the glove (where your thumb actually is on the controller).
 *  Mirrored per hand. */
const THUMB_ROLL = 1.35;
/** Where the glove body sits relative to the grip: nudged up and back so the
 *  controller is buried inside the glove instead of resting on its back. */
const OFFSET = new Vector3(0, 0.015, 0.02);

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
  const tilt = new Group();
  tilt.rotation.x = BASE_PITCH;
  tilt.position.copy(OFFSET);
  g.add(tilt);
  const roll = new Group();
  roll.rotation.z = hand === 'left' ? THUMB_ROLL : -THUMB_ROLL;
  tilt.add(roll);
  const base = new Group();
  base.rotation.y = BASE_YAW;
  roll.add(base);

  const place = (t: Group): void => {
    const model = t.clone(true);
    // Mirror the thumb to the correct side for the other hand.
    if (hand === 'left') model.scale.x *= -1;
    base.add(model);
  };
  if (template) place(template);
  else waiting.push(place);

  return g;
}
