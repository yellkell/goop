/**
 * The gel simulation — a verlet blob soup that IS the creature's body.
 *
 * ~22 core blobs chase pose anchors on underdamped springs (so everything
 * arrives with a wobble), while transient blobs come and go around them:
 *
 *  - LUMPS: punched clean out of the body, they fly ballistically, splat on
 *    the real floor, sit there quivering, then crawl home and are absorbed —
 *    the smooth-min surface turns that approach into a liquid bridge for free.
 *  - DRIPS: ambient personality; small beads that bud off low points, drop,
 *    and slurp back in.
 *  - DENTS: negative blobs carved at punch impacts; they decay in half a
 *    second as the gel flows back into the crater.
 *
 * Everything is in CREATURE-LOCAL metres (origin at the floor under the
 * creature, +Y up, facing +Z). The renderer reads `blobData()` straight into
 * shader uniforms; hit detection reads `fieldAt` — one signed-distance field,
 * shared by physics, gameplay and pixels, so what you see is what you punch.
 */

import { Vector3 } from 'three';
import { CREATURE, PUNCH } from '../config.js';
import { A, ANCHOR_COUNT, BOXER_POSE, GLOB_POSE, PUDDLE_POSE } from './poses.js';

// Uniform array size shared with the shader. 20 core + 8 lumps + 4 drips —
// the loop bound is a real cost on Quest, so this is sized exactly.
export const MAX_BLOBS = 32;
export const MAX_DENTS = CREATURE.maxDents;

const FLOOR_Y = 0.05; // blob centres never sink below r*rest above this

/** One simulated blob (core body part, knocked-out lump, or drip bead). */
interface Blob {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  /** Current rendered radius (eased toward rTarget each step). */
  r: number;
  rTarget: number;
  /** Volume-conservation scale on core blobs (dips when a lump is stolen). */
  scale: number;
  /** Per-blob wobble phase so the idle motion never syncs up. */
  seed: number;
}

type LumpState = 'flying' | 'resting' | 'returning';

interface Lump extends Blob {
  state: LumpState;
  timer: number;
  /** Core blob index this lump will crawl back into. */
  home: number;
  hasSplatted: boolean;
}

interface Dent {
  x: number;
  y: number;
  z: number;
  rMax: number;
  age: number;
  life: number;
}

export interface SimEvents {
  /** A lump/drip smacked the floor (local pos, lump radius). */
  onSplat?: (pos: Vector3, r: number, hard: boolean) => void;
  /** A lump finished crawling home and merged. */
  onAbsorb?: (pos: Vector3, r: number) => void;
}

export interface PunchResult {
  /** True if the swing actually connected with the surface. */
  hit: boolean;
  /** True if a lump was knocked clean out. */
  lump: boolean;
  /** 0..1 how meaty the connection was (drives damage/sfx/haptics). */
  strength: number;
}

const _v = new Vector3();
const _n = new Vector3();

/** Polynomial smooth-min — the same maths as the shader, so CPU hit tests
 *  agree with what's on screen. */
function smin(a: number, b: number, k: number): number {
  const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
  return b + (a - b) * h - k * h * (1 - h);
}

export class GoopSim {
  private core: Blob[] = [];
  private lumps: Lump[] = [];
  private drips: Lump[] = [];
  private dents: Dent[] = [];

  /** 0 = glob, 1 = boxer. Eased externally (the creature owns pacing). */
  form = 0;
  /** 0 = alive, 1 = fully collapsed into the KO puddle. */
  ko = 0;
  /** Recent-violence level 0..1; the shader roils the surface with it. */
  agitation = 0;
  /**
   * Blend-width multiplier, shared with the shader. Mid-strike the body
   * "tenses" — a wider smooth-min keeps a fully stretched limb reading as
   * one rope of gel instead of beads. The CPU field uses the same value so
   * what you punch stays exactly what you see.
   */
  blendScale = 1;

  /** Extra per-anchor offsets (punch animation drives arm anchors here). */
  readonly offsets: Float32Array = new Float32Array(ANCHOR_COUNT * 3);
  /** Extra per-anchor radius scale (the striking fist swells). */
  readonly radiusScale: Float32Array = new Float32Array(ANCHOR_COUNT).fill(1);

  /**
   * Kinematic pin: while >= 0, that core blob is slammed to pinPos every
   * step instead of spring-chasing it. The strike uses this — a real punch
   * arrives EXACTLY where it was thrown, no spring lag; unpinning lets the
   * spring snap it back with wobble.
   */
  pinIndex = -1;
  readonly pinPos = { x: 0, y: 0, z: 0 };

  events: SimEvents = {};

  /** Packed vec4 [x,y,z,r] per blob, fed straight to the shader. */
  readonly packed = new Float32Array(MAX_BLOBS * 4);
  readonly packedDents = new Float32Array(MAX_DENTS * 4);
  packedCount = 0;
  packedDentCount = 0;

  private time = 0;
  private dripTimer = 2.5;

  constructor() {
    for (let i = 0; i < ANCHOR_COUNT; i++) {
      const [x, y, z, r] = GLOB_POSE[i];
      this.core.push({ x, y, z, px: x, py: y, pz: z, r, rTarget: r, scale: 1, seed: i * 17.37 });
    }
    this.pack();
  }

  // ---------------------------------------------------------------- targets

  /** Blended pose target for one anchor (glob→boxer→puddle + offsets). */
  private target(i: number, out: { x: number; y: number; z: number; r: number }): void {
    const g = GLOB_POSE[i];
    const b = BOXER_POSE[i];
    const p = PUDDLE_POSE[i];
    const f = this.form;
    let x = g[0] + (b[0] - g[0]) * f;
    let y = g[1] + (b[1] - g[1]) * f;
    let z = g[2] + (b[2] - g[2]) * f;
    let r = g[3] + (b[3] - g[3]) * f;
    if (this.ko > 0) {
      x += (p[0] - x) * this.ko;
      y += (p[1] - y) * this.ko;
      z += (p[2] - z) * this.ko;
      r += (p[3] - r) * this.ko;
    }

    // Idle life: slow per-anchor orbits, much rowdier in glob form — the
    // resting dome churns; the boxer holds its shape and just breathes.
    const t = this.time;
    const s = this.core[i].seed;
    const rowdy = 0.045 * (1 - f * 0.8) * (1 - this.ko);
    x += Math.sin(t * 0.9 + s) * rowdy + Math.sin(t * 2.1 + s * 1.7) * rowdy * 0.4;
    y += Math.sin(t * 1.2 + s * 2.3) * rowdy * 0.7 + Math.sin(t * 0.5 + s) * 0.02 * (1 - this.ko);
    z += Math.cos(t * 0.8 + s * 1.3) * rowdy + Math.cos(t * 1.9 + s * 0.7) * rowdy * 0.4;

    // Breathing: the whole mass swells ~3% on a slow cycle.
    r *= 1 + 0.03 * Math.sin(t * 1.1 + s * 0.5);

    x += this.offsets[i * 3];
    y += this.offsets[i * 3 + 1];
    z += this.offsets[i * 3 + 2];
    r *= this.radiusScale[i] * this.core[i].scale;

    out.x = x;
    out.y = y;
    out.z = z;
    out.r = r;
  }

  private readonly _tgt = { x: 0, y: 0, z: 0, r: 0.1 };

  // ------------------------------------------------------------------ field

  /**
   * Signed distance to the gel surface at a local point (negative = inside).
   * Mirrors the shader: smooth-min over core+lumps+drips, dents carved out.
   */
  fieldAt(p: Vector3): number {
    const k = CREATURE.blend * this.blendScale;
    let d = 1e5;
    for (const b of this.core) {
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const dz = p.z - b.z;
      d = smin(d, Math.sqrt(dx * dx + dy * dy + dz * dz) - b.r, k);
    }
    for (const l of this.lumps) {
      const dx = p.x - l.x;
      const dy = p.y - l.y;
      const dz = p.z - l.z;
      d = smin(d, Math.sqrt(dx * dx + dy * dy + dz * dz) - l.r, k * 0.7);
    }
    for (const dr of this.drips) {
      const dx = p.x - dr.x;
      const dy = p.y - dr.y;
      const dz = p.z - dr.z;
      d = smin(d, Math.sqrt(dx * dx + dy * dy + dz * dz) - dr.r, k * 0.5);
    }
    for (const dent of this.dents) {
      const dx = p.x - dent.x;
      const dy = p.y - dent.y;
      const dz = p.z - dent.z;
      const r = dent.rMax * (1 - Math.pow(dent.age / dent.life, 1.5));
      const cut = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
      // Smooth subtraction: carve the dent sphere out of the body.
      d = -smin(-d, cut, 0.1);
    }
    return d;
  }

  /** Surface normal (central differences over the field). */
  normalAt(p: Vector3, out: Vector3): Vector3 {
    const e = 0.015;
    _v.set(p.x + e, p.y, p.z);
    const dx = this.fieldAt(_v);
    _v.set(p.x - e, p.y, p.z);
    const dx2 = this.fieldAt(_v);
    _v.set(p.x, p.y + e, p.z);
    const dy = this.fieldAt(_v);
    _v.set(p.x, p.y - e, p.z);
    const dy2 = this.fieldAt(_v);
    _v.set(p.x, p.y, p.z + e);
    const dz = this.fieldAt(_v);
    _v.set(p.x, p.y, p.z - e);
    const dz2 = this.fieldAt(_v);
    return out.set(dx - dx2, dy - dy2, dz - dz2).normalize();
  }

  /** Current position of a named core blob (for eyes / creature fists). */
  corePos(i: number, out: Vector3): Vector3 {
    const b = this.core[i];
    return out.set(b.x, b.y, b.z);
  }

  /** AABB of all mass + margin for blend/wobble (drives the render bounds). */
  bounds(outCenter: Vector3, outHalf: Vector3): void {
    let minX = 1e5, minY = 1e5, minZ = 1e5, maxX = -1e5, maxY = -1e5, maxZ = -1e5;
    const scan = (b: Blob) => {
      minX = Math.min(minX, b.x - b.r);
      minY = Math.min(minY, b.y - b.r);
      minZ = Math.min(minZ, b.z - b.r);
      maxX = Math.max(maxX, b.x + b.r);
      maxY = Math.max(maxY, b.y + b.r);
      maxZ = Math.max(maxZ, b.z + b.r);
    };
    for (const b of this.core) scan(b);
    for (const l of this.lumps) scan(l);
    for (const d of this.drips) scan(d);
    const margin = CREATURE.blend * 0.8 + 0.05;
    outCenter.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    outHalf.set(
      (maxX - minX) / 2 + margin,
      (maxY - minY) / 2 + margin,
      (maxZ - minZ) / 2 + margin,
    );
  }

  // ----------------------------------------------------------------- punches

  /**
   * A fist arriving at `point` (local) moving along `dir` at `speed` m/s.
   * Shoves nearby blobs, carves a dent, and above the lump threshold tears a
   * chunk right out of the body.
   */
  punchAt(point: Vector3, dir: Vector3, speed: number): PunchResult {
    const d = this.fieldAt(point);
    if (d > 0.06) return { hit: false, lump: false, strength: 0 };

    const strength = Math.min(1, (speed - PUNCH.hitSpeed) / (PUNCH.lumpSpeed * 1.6 - PUNCH.hitSpeed));
    const kick = speed * PUNCH.impulse;

    // Shove every core blob near the contact, falloff by distance.
    for (const b of this.core) {
      const dx = b.x - point.x;
      const dy = b.y - point.y;
      const dz = b.z - point.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > PUNCH.splashRadius) continue;
      const w = 1 - dist / PUNCH.splashRadius;
      const boost = w * w * kick * 0.016; // verlet: shift prev to add velocity
      b.px -= dir.x * boost;
      b.py -= dir.y * boost;
      b.pz -= dir.z * boost;
    }

    // Carve the crater.
    if (this.dents.length >= MAX_DENTS) this.dents.shift();
    this.dents.push({
      x: point.x + dir.x * 0.06,
      y: point.y + dir.y * 0.06,
      z: point.z + dir.z * 0.06,
      rMax: 0.1 + 0.09 * strength,
      age: 0,
      life: PUNCH.dentLife,
    });

    this.agitation = Math.min(1, this.agitation + 0.35 + strength * 0.4);

    // Hard enough? Tear a lump out.
    let tore = false;
    if (speed >= PUNCH.lumpSpeed && this.lumps.length < CREATURE.maxLumps && this.ko === 0) {
      tore = true;
      const r = 0.085 + 0.05 * strength;
      // Volume theft: the nearest couple of core blobs shrink to pay for it.
      let nearest = 0;
      let nd = 1e5;
      for (let i = 0; i < this.core.length; i++) {
        const b = this.core[i];
        const dist = Math.hypot(b.x - point.x, b.y - point.y, b.z - point.z);
        if (dist < nd) {
          nd = dist;
          nearest = i;
        }
        if (dist < PUNCH.splashRadius * 0.8) b.scale = Math.max(0.62, b.scale * 0.86);
      }
      const vx = dir.x * speed * 0.55 + (Math.random() - 0.5) * 0.8;
      const vy = Math.abs(dir.y * speed * 0.3) + 1.4 + Math.random() * 0.8;
      const vz = dir.z * speed * 0.55 + (Math.random() - 0.5) * 0.8;
      const lx = point.x + dir.x * 0.12;
      const ly = Math.max(0.12, point.y + dir.y * 0.12);
      const lz = point.z + dir.z * 0.12;
      this.lumps.push({
        x: lx, y: ly, z: lz,
        px: lx - vx * 0.016, py: ly - vy * 0.016, pz: lz - vz * 0.016,
        r: r * 0.4, rTarget: r, scale: 1, seed: Math.random() * 100,
        state: 'flying', timer: 0, home: nearest, hasSplatted: false,
      });
    }

    return { hit: true, lump: tore, strength: Math.max(0.15, strength) };
  }

  /** A slow fist resting against/inside the gel — a gentle continuous shove. */
  pokeAt(point: Vector3, dir: Vector3, speed: number): boolean {
    const d = this.fieldAt(point);
    if (d > 0.02) return false;
    for (const b of this.core) {
      const dist = Math.hypot(b.x - point.x, b.y - point.y, b.z - point.z);
      if (dist > 0.35) continue;
      const w = (1 - dist / 0.35) * speed * 0.002;
      b.px -= dir.x * w;
      b.py -= dir.y * w;
      b.pz -= dir.z * w;
    }
    return true;
  }

  /** Root motion inertia: the body lags behind when the creature moves. */
  applyInertia(dvx: number, dvy: number, dvz: number): void {
    for (const b of this.core) {
      // Higher blobs lag more — the base grips the "ground", the top sloshes.
      const lag = 0.35 + 0.5 * Math.min(1, b.y / 1.4);
      b.px += dvx * lag * 0.016;
      b.py += dvy * lag * 0.016;
      b.pz += dvz * lag * 0.016;
    }
  }

  // ------------------------------------------------------------------ drips

  private spawnDrip(): void {
    if (this.drips.length >= 4 || this.ko > 0) return;
    // Bud off a random low-ish blob.
    const candidates = this.core.filter((b) => b.y < 0.75);
    const host = candidates[Math.floor(Math.random() * candidates.length)];
    if (!host) return;
    const ang = Math.random() * Math.PI * 2;
    const x = host.x + Math.cos(ang) * host.r * 0.8;
    const z = host.z + Math.sin(ang) * host.r * 0.8;
    const y = Math.max(0.1, host.y - host.r * 0.3);
    this.drips.push({
      x, y, z, px: x, py: y + 0.002, pz: z, // barely moving, gravity does the rest
      r: 0.01, rTarget: 0.035 + Math.random() * 0.02, scale: 1,
      seed: Math.random() * 100,
      state: 'flying', timer: 0, home: 0, hasSplatted: false,
    });
  }

  // ----------------------------------------------------------------- update

  update(dt: number): void {
    // Fixed-ish step: clamp so a hitch never explodes the springs.
    const h = Math.min(dt, 1 / 45);
    this.time += h;
    this.agitation = Math.max(0, this.agitation - h * 0.8);

    this.dripTimer -= h;
    if (this.dripTimer <= 0) {
      this.dripTimer = 2 + Math.random() * 4;
      this.spawnDrip();
    }

    const damp = Math.pow(0.9, h * 60); // per-frame velocity retention
    const w2 = 120; // spring stiffness (omega^2-ish) toward pose anchors

    // --- core blobs: underdamped springs to their pose targets ---
    for (let i = 0; i < this.core.length; i++) {
      const b = this.core[i];
      this.target(i, this._tgt);
      const vx = (b.x - b.px) * damp;
      const vy = (b.y - b.py) * damp;
      const vz = (b.z - b.pz) * damp;
      const ax = (this._tgt.x - b.x) * w2;
      const ay = (this._tgt.y - b.y) * w2;
      const az = (this._tgt.z - b.z) * w2;
      b.px = b.x;
      b.py = b.y;
      b.pz = b.z;
      b.x += vx + ax * h * h;
      b.y += vy + ay * h * h;
      b.z += vz + az * h * h;
      b.rTarget = this._tgt.r;
      b.r += (b.rTarget - b.r) * Math.min(1, h * 10);
      b.scale = Math.min(1, b.scale + h * 0.25); // stolen volume regrows

      // Floor: gel rests ON the real floor, squashing a little.
      const minY = FLOOR_Y + b.r * 0.55;
      if (b.y < minY) {
        b.y = minY;
        if (b.py > b.y) b.py = b.y + (b.py - b.y) * 0.3; // kill most bounce
      }
    }

    // --- light pairwise separation so the core never collapses to a point ---
    for (let i = 0; i < this.core.length; i++) {
      for (let j = i + 1; j < this.core.length; j++) {
        const a = this.core[i];
        const c = this.core[j];
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const dz = c.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const minDist = (a.r + c.r) * 0.52;
        if (dist < minDist && dist > 1e-4) {
          const push = ((minDist - dist) / dist) * 0.18;
          a.x -= dx * push;
          a.y -= dy * push;
          a.z -= dz * push;
          c.x += dx * push;
          c.y += dy * push;
          c.z += dz * push;
        }
      }
    }

    // Kinematic pin overrides everything (the striking fist): applied after
    // springs AND separation so nothing can nudge it off its line.
    if (this.pinIndex >= 0 && this.pinIndex < this.core.length) {
      const b = this.core[this.pinIndex];
      b.x = this.pinPos.x;
      b.y = this.pinPos.y;
      b.z = this.pinPos.z;
      b.px = b.x;
      b.py = b.y;
      b.pz = b.z;
    }

    // --- lumps: fly, splat, rest, crawl home ---
    for (let li = this.lumps.length - 1; li >= 0; li--) {
      const l = this.lumps[li];
      l.timer += h;
      l.r += (l.rTarget - l.r) * Math.min(1, h * 12);
      const vx = (l.x - l.px) * damp;
      const vy = (l.y - l.py) * damp;
      const vz = (l.z - l.pz) * damp;
      l.px = l.x;
      l.py = l.y;
      l.pz = l.z;

      if (l.state === 'flying') {
        l.x += vx;
        l.y += vy - 9.8 * h * h;
        l.z += vz;
        if (l.y < FLOOR_Y + l.r * 0.5) {
          l.y = FLOOR_Y + l.r * 0.5;
          const speed = Math.hypot(vx, vy, vz) / Math.max(h, 1e-4);
          if (!l.hasSplatted) {
            l.hasSplatted = true;
            l.rTarget *= 1.18; // splats spread a bit
            this.events.onSplat?.(_v.set(l.x, l.y, l.z), l.r, speed > 2);
          }
          l.px = l.x + vx * 0.25; // mostly dead horizontal bounce
          l.py = l.y;
          l.pz = l.z + vz * 0.25;
          if (speed < 0.6) {
            l.state = 'resting';
            l.timer = 0;
          }
        }
      } else if (l.state === 'resting') {
        // Quiver in place, then decide to head home.
        l.x += vx * 0.5 + Math.sin(this.time * 14 + l.seed) * 0.0006;
        l.y = FLOOR_Y + l.r * 0.5 + Math.abs(Math.sin(this.time * 9 + l.seed)) * 0.004;
        l.z += vz * 0.5;
        if (l.timer > 0.7 + (l.seed % 1) * 0.9) {
          l.state = 'returning';
          l.timer = 0;
        }
      } else {
        // Crawl back to its home blob, accelerating as it gets close.
        const home = this.core[l.home];
        const dx = home.x - l.x;
        const dy = home.y - l.y;
        const dz = home.z - l.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const pull = Math.min(3.2, 1.2 + l.timer * 1.8) * h;
        l.x += vx * 0.9 + (dx / (dist + 1e-4)) * pull * dist * 0.5 * h * 30;
        l.y += vy * 0.9 + (dy / (dist + 1e-4)) * pull * dist * 0.5 * h * 30;
        l.z += vz * 0.9 + (dz / (dist + 1e-4)) * pull * dist * 0.5 * h * 30;
        if (l.y < FLOOR_Y + l.r * 0.45) l.y = FLOOR_Y + l.r * 0.45;
        if (dist < home.r * 0.6) {
          // Merged. The absorbing blob swells with the returned volume.
          home.scale = Math.min(1.18, home.scale + l.r * 1.2);
          this.events.onAbsorb?.(_v.set(l.x, l.y, l.z), l.r);
          this.lumps.splice(li, 1);
        }
      }
    }

    // --- drips: same body, tiny and short-lived ---
    for (let di = this.drips.length - 1; di >= 0; di--) {
      const d = this.drips[di];
      d.timer += h;
      d.r += (d.rTarget - d.r) * Math.min(1, h * 6);
      const vx = (d.x - d.px) * damp;
      const vy = (d.y - d.py) * damp;
      const vz = (d.z - d.pz) * damp;
      d.px = d.x;
      d.py = d.y;
      d.pz = d.z;
      if (d.state === 'flying') {
        d.x += vx;
        d.y += vy - 9.8 * h * h * 0.6; // viscous, falls lazily
        d.z += vz;
        if (d.y < FLOOR_Y + d.r * 0.5) {
          d.y = FLOOR_Y + d.r * 0.5;
          if (!d.hasSplatted) {
            d.hasSplatted = true;
            this.events.onSplat?.(_v.set(d.x, d.y, d.z), d.r, false);
          }
          d.state = 'returning';
          d.timer = 0;
          // Home = nearest core blob at floor level.
          let nd = 1e5;
          for (let i = 0; i < this.core.length; i++) {
            const b = this.core[i];
            const dist = Math.hypot(b.x - d.x, b.y - d.y, b.z - d.z);
            if (dist < nd) {
              nd = dist;
              d.home = i;
            }
          }
        }
      } else {
        const home = this.core[d.home];
        _n.set(home.x - d.x, home.y - d.y, home.z - d.z);
        const dist = _n.length();
        _n.normalize();
        const speed = Math.min(1.6, 0.5 + d.timer * 1.2) * h;
        d.x += vx * 0.9 + _n.x * speed;
        d.y += vy * 0.9 + _n.y * speed;
        d.z += vz * 0.9 + _n.z * speed;
        if (d.y < FLOOR_Y + d.r * 0.45) d.y = FLOOR_Y + d.r * 0.45;
        if (dist < home.r * 0.7) this.drips.splice(di, 1);
      }
    }

    // --- dents heal ---
    for (let i = this.dents.length - 1; i >= 0; i--) {
      const dent = this.dents[i];
      dent.age += h;
      if (dent.age >= dent.life) this.dents.splice(i, 1);
    }

    this.pack();
  }

  /** All lumps snap home instantly (round reset). */
  reabsorbAll(): void {
    this.lumps.length = 0;
    this.drips.length = 0;
    this.dents.length = 0;
    for (const b of this.core) b.scale = 1;
  }

  // ------------------------------------------------------------------- pack

  private pack(): void {
    let n = 0;
    const put = (b: Blob) => {
      if (n >= MAX_BLOBS) return;
      const o = n * 4;
      this.packed[o] = b.x;
      this.packed[o + 1] = b.y;
      this.packed[o + 2] = b.z;
      this.packed[o + 3] = Math.max(0.008, b.r);
      n++;
    };
    for (const b of this.core) put(b);
    for (const l of this.lumps) put(l);
    for (const d of this.drips) put(d);
    this.packedCount = n;

    let m = 0;
    for (const dent of this.dents) {
      if (m >= MAX_DENTS) break;
      const r = dent.rMax * (1 - Math.pow(dent.age / dent.life, 1.5));
      if (r < 0.012) continue;
      const o = m * 4;
      this.packedDents[o] = dent.x;
      this.packedDents[o + 1] = dent.y;
      this.packedDents[o + 2] = dent.z;
      this.packedDents[o + 3] = r;
      m++;
    }
    this.packedDentCount = m;
  }

  /** Fist anchors, exposed for the creature's own punches. */
  get fistIndices(): { left: number; right: number } {
    return { left: A.FIST_L, right: A.FIST_R };
  }
}
