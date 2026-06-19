/**
 * Vultures (or something like them) wheeling high over the desert.
 *
 * They're meant to be glimpsed, not watched: a few dark paper silhouettes way
 * off in the distance, each riding a slow, lazy loop high in the sky — banking
 * into the turn the way a soaring bird tips its wings, drifting up and down on
 * the thermals. Up close they'd be crude, but at this range the eye only reads
 * the broad swept wings held in a shallow V, so that's all we build.
 *
 * Orbit centres are flung far out and spread around the compass, so the player
 * only catches one now and then when they happen to look up the right way —
 * never the whole flock at once.
 */

import {
  BufferGeometry,
  CapsuleGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  type Group as GroupT,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { CONFIG } from './config.js';
import { makeRng } from './paper.js';

const P = CONFIG.palette;
const V = CONFIG.vultures;

interface Vulture {
  obj: Group;
  wings: Group[]; // [right, left] pivots, for the wing flex
  cx: number;
  cz: number;
  radius: number;
  baseY: number;
  omega: number;
  dir: number; // +1 / -1 orbit direction
  phase: number;
  bobAmp: number;
  bobSpeed: number;
  bobPhase: number;
  dihedral: number;
  flexAmp: number;
  flexSpeed: number;
  flexPhase: number;
  // Soar → glide down → rest (hidden) → climb back, on a per-bird clock.
  soar: number;
  rest: number;
  glide: number;
  cycleLen: number;
  cycleOffset: number;
}

/** Altitude a resting bird drops to before it hides — low and far, out of view. */
const PERCH_Y = 3;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * One broad, swept, faintly fingered wing, built flat (in the X–Z plane) from a
 * handful of triangles. The root sits at the body; the tip sweeps back and
 * stays blunt, the way a vulture's does, rather than tapering to a point.
 */
function makeWingGeometry(span: number, chord: number): BufferGeometry {
  const S = span / 2; // half-span: this wing reaches from the body out to +X
  // Outline points (x out along the wing, z fore/aft, +z forward).
  const A = [0, 0, chord * 0.45]; // root, leading edge
  const B = [0, 0, -chord * 0.55]; // root, trailing edge
  const C = [S * 0.55, 0, chord * 0.28]; // mid, leading
  const D = [S * 0.55, 0, -chord * 0.42]; // mid, trailing
  const E = [S * 0.96, 0, -chord * 0.02]; // tip, leading
  const F = [S * 1.0, 0, -chord * 0.34]; // tip, trailing (blunt)
  const tris = [A, C, B, B, C, D, C, E, D, D, E, F];
  const pos: number[] = [];
  for (const v of tris) pos.push(v[0], v[1], v[2]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeVulture(rng: () => number): { obj: Group; wings: Group[] } {
  const bird = new Group();
  const span = V.wingspan * (0.85 + rng() * 0.3);
  const chord = span * 0.18;
  // Unlit so the birds stay flat black against the bright sky however the warm
  // sun happens to fall — they're meant to read as silhouettes, not shaded
  // paper. Double-sided so the wings hold their colour as the bird banks over.
  const mat = new MeshBasicMaterial({ color: P.bird, side: DoubleSide });
  const wingGeo = makeWingGeometry(span, chord);
  const dihedral = 0.13 + rng() * 0.05; // shallow soaring V

  // Right wing reaches +X; left is the same geometry mirrored across X. Each
  // hangs off its own pivot so the wings can flex about the body.
  const wings: Group[] = [];
  for (const side of [1, -1]) {
    const wing = new Mesh(wingGeo, mat);
    wing.scale.x = side;
    const pivot = new Group();
    pivot.add(wing);
    pivot.rotation.z = side * dihedral;
    bird.add(pivot);
    wings.push(pivot);
  }

  // A slim spindle of a body so the wings aren't joined to nothing.
  const body = new Mesh(new CapsuleGeometry(chord * 0.09, chord * 1.1, 2, 5), mat);
  body.rotation.x = Math.PI / 2; // lie it along the fore/aft axis
  bird.add(body);

  bird.traverse((o) => (o.castShadow = false));
  return { obj: bird, wings };
}

/** Loose the flock onto their distant orbits; returns the animation handles. */
export function buildVultures(parent: GroupT): Vulture[] {
  const rng = makeRng(CONFIG.terrain.seed * 29 + 11);
  const birds: Vulture[] = [];
  for (let i = 0; i < V.count; i++) {
    const { obj, wings } = makeVulture(rng);
    // Spread the orbit centres into separate compass sectors so they don't
    // clump — one bird per arc of the sky, plus a little jitter.
    const bearing = (i / V.count) * Math.PI * 2 + (rng() - 0.5) * 0.8;
    const dist = V.centerMin + rng() * (V.centerMax - V.centerMin);
    const dihedral = wings[0].rotation.z; // right pivot carries +dihedral
    const soar = V.soarMin + rng() * (V.soarMax - V.soarMin);
    const rest = V.restMin + rng() * (V.restMax - V.restMin);
    const cycleLen = soar + 2 * V.glide + rest;
    birds.push({
      obj,
      wings,
      cx: Math.cos(bearing) * dist,
      cz: Math.sin(bearing) * dist,
      radius: V.radiusMin + rng() * (V.radiusMax - V.radiusMin),
      baseY: V.heightMin + rng() * (V.heightMax - V.heightMin),
      omega: V.omegaMin + rng() * (V.omegaMax - V.omegaMin),
      dir: rng() < 0.5 ? 1 : -1,
      phase: rng() * Math.PI * 2,
      bobAmp: V.bobAmp * (0.6 + rng() * 0.7),
      bobSpeed: 0.08 + rng() * 0.07,
      bobPhase: rng() * Math.PI * 2,
      dihedral,
      flexAmp: 0.05 + rng() * 0.04,
      flexSpeed: 0.9 + rng() * 0.6,
      flexPhase: rng() * Math.PI * 2,
      soar,
      rest,
      glide: V.glide,
      cycleLen,
      cycleOffset: rng() * cycleLen, // stagger so they don't rest in unison
    });
    parent.add(obj);
  }
  return birds;
}

const _rot = new Euler(0, 0, 0, 'YXZ');

/** Wheel the birds along their loops, banking and flexing — and resting. */
export function animateVultures(birds: Vulture[], time: number): void {
  for (const b of birds) {
    // Where in its soar/rest cycle is this bird? `climb` is 1 while soaring,
    // eases to 0 as it glides down to rest, and back to 1 as it returns.
    const localT = ((time + b.cycleOffset) % b.cycleLen + b.cycleLen) % b.cycleLen;
    let climb: number;
    if (localT < b.soar) {
      climb = 1; // aloft
    } else if (localT < b.soar + b.glide) {
      climb = 1 - smooth((localT - b.soar) / b.glide); // gliding down
    } else if (localT < b.soar + b.glide + b.rest) {
      b.obj.visible = false; // perched out of sight
      continue;
    } else {
      climb = smooth((localT - b.soar - b.glide - b.rest) / b.glide); // climbing back
    }
    b.obj.visible = true;

    const ang = b.phase + b.dir * b.omega * time;
    const bob = (t: number) => b.baseY + Math.sin(t * b.bobSpeed + b.bobPhase) * b.bobAmp;
    const x = b.cx + Math.cos(ang) * b.radius;
    const z = b.cz + Math.sin(ang) * b.radius;
    // Spiral down toward the perch as it leaves, climb as it returns, and
    // shrink to a vanishing speck at the hand-off so it never pops in or out.
    const y = PERCH_Y + (bob(time) - PERCH_Y) * climb;
    b.obj.position.set(x, y, z);
    b.obj.scale.setScalar(0.05 + 0.95 * climb);

    // Aim a touch further along the loop so the bird faces its travel (+Z).
    const a2 = ang + b.dir * 0.06;
    const dx = b.cx + Math.cos(a2) * b.radius - x;
    const dz = b.cz + Math.sin(a2) * b.radius - z;
    const dy = (bob(time + 0.2) - PERCH_Y) * climb + PERCH_Y - y;
    const horiz = Math.hypot(dx, dz) || 1e-3;
    _rot.set(-Math.atan2(dy, horiz) * 0.5, Math.atan2(dx, dz), b.dir * V.bank);
    b.obj.setRotationFromEuler(_rot);

    // Gentle, continuous wing flex about the soaring dihedral — soaring birds
    // trim constantly rather than flap.
    const flex = Math.sin(time * b.flexSpeed + b.flexPhase) * b.flexAmp;
    b.wings[0].rotation.z = b.dihedral + flex;
    b.wings[1].rotation.z = -(b.dihedral + flex);
  }
}
