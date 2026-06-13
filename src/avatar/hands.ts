/**
 * Articulated VR hands — the traditional kind: a slim steel palm, four
 * two-segment fingers and an opposable thumb, replacing the huge square
 * gauntlets. They start near-black and BLOOM WHITE when the hand is active
 * (trigger/grip squeezed or a ball mid-return), reusing the same
 * `setGloveLit` machinery via userData.leds. Fingers curl with the trigger
 * (index) and grip (the rest), so your virtual hand tracks your real grip.
 *
 * Knuckles point down local -Z, matching the old glove convention — the
 * grip/ray alignment and fireball anchors all carry over unchanged.
 */

import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { PALETTE } from '../config.js';

interface HandJoints {
  /** [knuckle, mid] pivot pair per finger, index first. */
  fingers: [Group, Group][];
  thumb: [Group, Group];
}

export type HandIndex = 0 | 1;

export const HAND_VISUAL_SCALE = 1.18;

const HAND_FORWARD_AXIS = new Vector3(0, 0, 1);

export const HAND_ADDUCTION: [Quaternion, Quaternion] = [
  new Quaternion().setFromAxisAngle(HAND_FORWARD_AXIS, Math.PI / 2),
  new Quaternion().setFromAxisAngle(HAND_FORWARD_AXIS, -Math.PI / 2),
];

/**
 * Build one hand. `side` mirrors the thumb: +1 = left hand (thumb on +x),
 * -1 = right hand (thumb on -x).
 */
export function buildHand(side: 1 | -1): Group {
  const hand = new Group();
  hand.scale.setScalar(HAND_VISUAL_SCALE);

  const mat = new MeshStandardMaterial({
    color: 0x15171c, // near-black steel at rest
    emissive: 0xffffff,
    emissiveIntensity: 0,
    metalness: 0.85,
    roughness: 0.35,
  });
  mat.userData.role = 'hand';
  mat.userData.baseIntensity = 0;
  mat.userData.litIntensity = 1.9; // white-hot when active
  mat.userData.baseColor = new Color(0x000000);
  mat.userData.litColor = new Color(PALETTE.white);
  hand.userData.leds = [mat]; // setGloveLit drives the white bloom

  const palm = new Mesh(new BoxGeometry(0.078, 0.024, 0.09), mat);
  hand.add(palm);
  const cuff = new Mesh(new BoxGeometry(0.07, 0.032, 0.038), mat);
  cuff.position.z = 0.062;
  hand.add(cuff);

  const fingers: [Group, Group][] = [];
  for (let i = 0; i < 4; i++) {
    // Index finger nearest the thumb; slight length variation per finger.
    const x = side * (0.0285 - i * 0.019);
    const len = i === 1 ? 1.08 : i === 3 ? 0.85 : 1;
    const knuckle = new Group();
    knuckle.position.set(x, 0, -0.045);
    hand.add(knuckle);
    const seg1 = new Mesh(new BoxGeometry(0.0155, 0.018, 0.036 * len), mat);
    seg1.position.z = -0.018 * len;
    knuckle.add(seg1);
    const mid = new Group();
    mid.position.z = -0.036 * len;
    knuckle.add(mid);
    const seg2 = new Mesh(new BoxGeometry(0.014, 0.016, 0.03 * len), mat);
    seg2.position.z = -0.015 * len;
    mid.add(seg2);
    fingers.push([knuckle, mid]);
  }

  // Thumb: rooted on the inner edge, angled across the palm.
  const tRoot = new Group();
  tRoot.position.set(side * 0.042, -0.004, -0.012);
  tRoot.rotation.y = side * -0.85;
  hand.add(tRoot);
  const tSeg1 = new Mesh(new BoxGeometry(0.017, 0.018, 0.034), mat);
  tSeg1.position.z = -0.017;
  tRoot.add(tSeg1);
  const tMid = new Group();
  tMid.position.z = -0.034;
  tRoot.add(tMid);
  const tSeg2 = new Mesh(new BoxGeometry(0.015, 0.016, 0.028), mat);
  tSeg2.position.z = -0.014;
  tMid.add(tSeg2);

  hand.userData.joints = { fingers, thumb: [tRoot, tMid] } satisfies HandJoints;
  // Hands that nobody drives (remote punters, the barkeep, the mirror)
  // rest in a natural half-relaxed pose instead of rigor-mortis flat.
  setHandCurl(hand, 0.25, 0.3, 0.45);
  return hand;
}

/**
 * Pose the fingers: 0 = straight, 1 = full fist. `index` follows the
 * trigger, `others` the grip, `thumb` tucks across as either squeezes.
 * Curl is NEGATIVE x rotation: knuckles point -Z and the palm faces -Y,
 * so fingers fold downward toward the palm (positive bent them backwards
 * — genuinely horrifying).
 */
export function setHandCurl(hand: Group, index: number, others: number, thumb: number): void {
  const joints = hand.userData.joints as HandJoints | undefined;
  if (!joints) return;
  joints.fingers.forEach((f, i) => {
    const c = i === 0 ? index : others;
    f[0].rotation.x = -c * 1.15;
    f[1].rotation.x = -c * 1.35;
  });
  joints.thumb[0].rotation.x = -thumb * 0.7;
  joints.thumb[1].rotation.x = -thumb * 0.8;
}
