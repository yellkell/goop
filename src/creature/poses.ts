/**
 * The creature's body plan — one set of named blob anchors, two shapes.
 *
 * The same 22 blobs make up the creature in every mood; only their target
 * positions and radii change. GLOB packs them into a restless dome of gel;
 * BOXER stretches them up into a man-sized fighter (head at ~1.75 m) whose
 * legs deliberately melt into a puddle-skirt pedestal — the thing never fully
 * commits to having feet. Because the mapping is 1:1, morphing between the
 * shapes is a plain per-anchor lerp and the smooth-min surface does the rest:
 * mid-morph the creature genuinely LOOKS like gel pouring itself into a man.
 *
 * Local space: origin on the floor at the creature's centre, +Y up, and the
 * creature faces +Z (the group is yawed to face the player in the world).
 */

/** Anchor indices — sim, animation and eye placement all key off these. */
export const A = {
  HEAD: 0,
  NECK: 1,
  CHEST_L: 2,
  CHEST_R: 3,
  BELLY: 4,
  PELVIS: 5,
  SHOULDER_L: 6,
  SHOULDER_R: 7,
  ELBOW_L: 8,
  ELBOW_R: 9,
  FIST_L: 10,
  FIST_R: 11,
  HIP_L: 12,
  HIP_R: 13,
  KNEE_L: 14,
  KNEE_R: 15,
  BASE_L: 16,
  BASE_R: 17,
  BASE_F: 18,
  BASE_B: 19,
  CORE_A: 20,
  CORE_B: 21,
} as const;

export const ANCHOR_COUNT = 22;

/** [x, y, z, radius] per anchor. */
export type Pose = ReadonlyArray<readonly [number, number, number, number]>;

/**
 * BOXER — upright guard stance. Arms up, fists floating in front of the
 * chest, lower body flowing into a wide base mound.
 */
export const BOXER_POSE: Pose = [
  [0.0, 1.6, 0.02, 0.155], // HEAD
  [0.0, 1.42, 0.01, 0.125], // NECK
  [-0.13, 1.27, 0.02, 0.165], // CHEST_L
  [0.13, 1.27, 0.02, 0.165], // CHEST_R
  [0.0, 1.02, 0.03, 0.195], // BELLY
  [0.0, 0.78, 0.0, 0.185], // PELVIS
  [-0.27, 1.37, 0.02, 0.125], // SHOULDER_L
  [0.27, 1.37, 0.02, 0.125], // SHOULDER_R
  [-0.34, 1.15, 0.18, 0.105], // ELBOW_L
  [0.34, 1.15, 0.18, 0.105], // ELBOW_R
  [-0.22, 1.31, 0.38, 0.125], // FIST_L — guard, lead hand a touch higher
  [0.24, 1.23, 0.34, 0.125], // FIST_R
  [-0.14, 0.6, 0.0, 0.15], // HIP_L
  [0.14, 0.6, 0.0, 0.15], // HIP_R
  [-0.17, 0.34, 0.02, 0.14], // KNEE_L
  [0.17, 0.34, 0.02, 0.14], // KNEE_R
  [-0.23, 0.14, 0.0, 0.17], // BASE_L
  [0.23, 0.14, 0.0, 0.17], // BASE_R
  [0.0, 0.12, 0.21, 0.19], // BASE_F
  [0.0, 0.12, -0.18, 0.19], // BASE_B
  [-0.05, 1.15, -0.04, 0.13], // CORE_A — interior filler, keeps the torso dense
  [0.06, 0.92, -0.03, 0.13], // CORE_B
];

/**
 * GLOB — the resting dome. Same blobs slumped into a rough hemisphere,
 * bigger radii (the mass spreads), nothing where you'd expect anatomy.
 */
export const GLOB_POSE: Pose = [
  [0.0, 0.72, 0.05, 0.17], // HEAD — the crown of the dome
  [-0.18, 0.58, -0.12, 0.16], // NECK
  [-0.3, 0.35, 0.12, 0.21], // CHEST_L
  [0.28, 0.38, 0.1, 0.21], // CHEST_R
  [0.0, 0.3, 0.0, 0.27], // BELLY — the fat heart of the puddle
  [0.05, 0.5, -0.18, 0.22], // PELVIS
  [-0.35, 0.2, -0.18, 0.18], // SHOULDER_L
  [0.4, 0.22, -0.12, 0.18], // SHOULDER_R
  [-0.15, 0.2, 0.32, 0.16], // ELBOW_L
  [0.2, 0.18, 0.3, 0.16], // ELBOW_R
  [-0.42, 0.25, 0.2, 0.17], // FIST_L
  [0.45, 0.28, 0.16, 0.17], // FIST_R
  [-0.2, 0.55, 0.15, 0.15], // HIP_L
  [0.22, 0.52, 0.18, 0.15], // HIP_R
  [-0.3, 0.16, -0.3, 0.16], // KNEE_L
  [0.3, 0.14, -0.32, 0.16], // KNEE_R
  [-0.45, 0.14, 0.02, 0.19], // BASE_L
  [0.45, 0.13, 0.0, 0.19], // BASE_R
  [0.02, 0.13, 0.42, 0.2], // BASE_F
  [0.0, 0.14, -0.42, 0.2], // BASE_B
  [-0.1, 0.4, -0.05, 0.18], // CORE_A
  [0.12, 0.35, 0.08, 0.18], // CORE_B
];

/**
 * PUDDLE — knocked out. Generated from GLOB: everything collapses to ankle
 * height and spreads ~1.6x wider. The bell rings, the creature is a doormat.
 */
export const PUDDLE_POSE: Pose = GLOB_POSE.map(([x, y, z, r], i) => {
  void y;
  const spread = 1.55 + (i % 3) * 0.12;
  return [x * spread, 0.07 + (i % 4) * 0.015, z * spread, r * 0.88] as const;
});
