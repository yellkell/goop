/**
 * THE GOOP — the whole creature as one self-contained Three.js citizen.
 *
 * Owns the blob sim, the raymarched gel mesh, the pair of eyes, the contact
 * shadow, its own body-noises, and the punch-throwing animation. Knows
 * nothing about IWSDK, XR or the fight rules: systems above feed it a player
 * head position and steering targets, and ask it to form up, swing, or take
 * a punch. That separation is what lets the flat-screen workbench (dev.html)
 * drive the identical creature you box in passthrough.
 *
 * The eyes are the personality trick: two glossy beads that float wherever
 * the gel surface currently is (found by walking the SDF outward from the
 * head blob toward whatever they're looking at), so they ride every wobble,
 * sink into the dome in glob mode, and surface again as the boxer forms.
 */

import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { ATTACKS, CREATURE, type AttackName } from '../config.js';
import * as sfx from '../audio/sfx.js';
import type { GooFx } from '../fx/splats.js';
import { createGelMaterial, type GelUniforms } from './gelMaterial.js';
import { A, BOXER_POSE } from './poses.js';
import { GoopSim, type PunchResult } from './sim.js';

export type Hand = 'left' | 'right';

interface ActiveAttack {
  name: AttackName;
  hand: Hand;
  /** Seconds since the attack began. */
  t: number;
  /** Where the strike is going, creature-local (snapshotted at wind-up). */
  target: Vector3;
  apexFired: boolean;
  whooshFired: boolean;
  onApex?: (limbWorld: Vector3) => void;
  onDone?: () => void;
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Quadratic bezier, written out (no allocs in the strike loop). */
function bez(a: number, b: number, c: number, t: number): number {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(6, 14, 8, 0.55)');
  grad.addColorStop(0.7, 'rgba(6, 14, 8, 0.28)');
  grad.addColorStop(1, 'rgba(6, 14, 8, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

export class GelCreature {
  readonly group = new Group();
  readonly sim = new GoopSim();

  private gel: GelUniforms;
  private gelMesh: Mesh;
  private shadow: Mesh;

  private eyeL: Group;
  private eyeR: Group;
  private eyeMats: MeshBasicMaterial[] = [];
  private blinkTimer = 3;
  private blink = 0; // 0 open .. 1 shut

  /** 0 glob .. 1 boxer (the eased live value; target set by AI). */
  private form = 0;
  private formTarget = 0;
  private koVal = 0;
  private koTarget = 0;

  /** Telegraph glow 0..1 (drives shader flash + eye colour). */
  private telegraph = 0;

  /** Difficulty tempo: scales the telegraph + recovery (1 = SCRAP). */
  tempoScale = 1;
  /** True while it's an exhausted puddle — hits do double (see EXHAUST). */
  vulnerable = false;

  private attack: ActiveAttack | null = null;
  /** Extra body yaw layered over face-tracking — the spinning backfist. */
  private extraYaw = 0;

  private rootTarget = new Vector3();
  private facePoint = new Vector3();
  private prevPos = new Vector3();
  private prevVel = new Vector3();
  private yaw = 0;

  private playerLocal = new Vector3(0, 1.6, 2);
  private time = 0;

  constructor(private fx: GooFx) {
    this.group.name = 'the-goop';

    this.gel = createGelMaterial();
    this.gelMesh = new Mesh(new BoxGeometry(2, 2, 2), this.gel.material);
    this.gelMesh.frustumCulled = false;
    this.gelMesh.renderOrder = 2; // after opaque eyes so blending sees them
    this.group.add(this.gelMesh);

    // Contact shadow — grounds the creature on the REAL floor in passthrough.
    this.shadow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.003;
    this.shadow.renderOrder = 0;
    this.group.add(this.shadow);

    const mkEye = (): Group => {
      const g = new Group();
      const ball = new MeshBasicMaterial({ color: 0x101b10 });
      this.eyeMats.push(ball);
      const eye = new Mesh(new SphereGeometry(0.046, 16, 12), ball);
      const glint = new Mesh(
        new SphereGeometry(0.013, 8, 6),
        new MeshBasicMaterial({ color: 0xf4fff2 }),
      );
      glint.position.set(0.015, 0.017, 0.035);
      g.add(eye);
      g.add(glint);
      this.group.add(g);
      return g;
    };
    this.eyeL = mkEye();
    this.eyeR = mkEye();

    // The sim narrates; the creature makes the noises and the mess.
    this.sim.events = {
      onSplat: (pos, r, hard) => {
        this.group.updateMatrixWorld();
        _v3.copy(pos);
        this.group.localToWorld(_v3);
        this.fx.splat(_v3, Math.max(0.16, r * 3.2));
        sfx.splat(hard ? 0.8 : Math.min(0.6, r * 5));
      },
      onAbsorb: () => sfx.slurp(),
    };
  }

  // ------------------------------------------------------------ public state

  get formValue(): number {
    return this.form;
  }

  get isKo(): boolean {
    return this.koTarget > 0.5;
  }

  /** Ask it to become the boxer (1) or slump back into the glob (0). */
  setFormTarget(f: 0 | 1): void {
    if (this.formTarget === f || this.koTarget > 0) return;
    this.formTarget = f;
    if (f === 1) sfx.gooRise();
    else sfx.gooSink();
  }

  /** Knock it out (or stand it back up for the rematch). */
  setKo(down: boolean): void {
    if (down === this.koTarget > 0.5) return;
    this.koTarget = down ? 1 : 0;
    if (down) {
      this.attack = null;
      this.extraYaw = 0;
      this.telegraph = 0;
      sfx.koSplat();
    } else {
      this.sim.reabsorbAll();
      sfx.gooRise();
    }
  }

  /** Steering: where the body should ooze/step to (world). */
  moveTo(worldPos: Vector3): void {
    this.rootTarget.copy(worldPos);
    this.rootTarget.y = 0;
  }

  /** What it should face (world) — normally the player's head. */
  faceToward(worldPos: Vector3): void {
    this.facePoint.copy(worldPos);
  }

  /** World-space position of the creature root. */
  get position(): Vector3 {
    return this.group.position;
  }

  headWorld(out: Vector3): Vector3 {
    this.sim.corePos(A.HEAD, out);
    this.group.updateMatrixWorld();
    return this.group.localToWorld(out);
  }

  fistWorld(hand: Hand, out: Vector3): Vector3 {
    this.sim.corePos(hand === 'left' ? A.FIST_L : A.FIST_R, out);
    this.group.updateMatrixWorld();
    return this.group.localToWorld(out);
  }

  /** Signed distance from a world point to the gel surface. */
  fieldAtWorld(p: Vector3): number {
    this.group.updateMatrixWorld();
    _v.copy(p);
    this.group.worldToLocal(_v);
    return this.sim.fieldAt(_v);
  }

  // ---------------------------------------------------------------- attacks

  get isPunching(): boolean {
    return this.attack !== null;
  }

  /**
   * Wind up and deliver a named strike at a world point. Fires `onApex` at
   * full extension with the striking blob's world position (the AI checks
   * the hit there). Every attack telegraphs in its own readable silhouette —
   * that IS the dodge language.
   */
  throwAttack(
    name: AttackName,
    hand: Hand,
    targetWorld: Vector3,
    onApex?: (limbWorld: Vector3) => void,
    onDone?: () => void,
  ): boolean {
    if (this.attack || this.koTarget > 0 || this.form < 0.7) return false;
    this.group.updateMatrixWorld();
    const target = new Vector3().copy(targetWorld);
    this.group.worldToLocal(target);
    // Cap reach so the limb stretches heroically but not absurdly.
    const shoulder = hand === 'left' ? BOXER_POSE[A.SHOULDER_L] : BOXER_POSE[A.SHOULDER_R];
    _v.set(target.x - shoulder[0], target.y - shoulder[1], target.z - shoulder[2]);
    const reach = _v.length();
    const maxReach = name === 'roundhouse' ? 1.4 : 1.25;
    if (reach > maxReach) {
      _v.multiplyScalar(maxReach / reach);
      target.set(shoulder[0] + _v.x, shoulder[1] + _v.y, shoulder[2] + _v.z);
    }
    // A kick lands at chest/chin height, not orbit.
    if (name === 'roundhouse') target.y = Math.min(target.y, 1.45);
    this.attack = { name, hand, t: 0, target, apexFired: false, whooshFired: false, onApex, onDone };
    sfx.gooCharge(ATTACKS[name].telegraph * this.tempoScale);
    return true;
  }

  /** Legacy alias — a plain cross (the workbench key drives this). */
  throwPunch(hand: Hand, targetWorld: Vector3, onApex?: (fistWorld: Vector3) => void, onDone?: () => void): boolean {
    return this.throwAttack('cross', hand, targetWorld, onApex, onDone);
  }

  /** A player fist arriving. Returns what the gel made of it. */
  receivePunchWorld(point: Vector3, dir: Vector3, speed: number): PunchResult {
    this.group.updateMatrixWorld();
    _v.copy(point);
    this.group.worldToLocal(_v);
    _q.copy(this.group.quaternion).invert();
    _v2.copy(dir).applyQuaternion(_q);
    const res = this.sim.punchAt(_v, _v2, speed);
    if (res.hit) {
      this.fx.burst(point, dir, 8 + Math.round(res.strength * 16), speed);
      if (res.lump) sfx.tear();
    }
    return res;
  }

  /** A slow fist pressing into it — gentle shove, playful wobble. */
  pokeWorld(point: Vector3, dir: Vector3, speed: number): boolean {
    this.group.updateMatrixWorld();
    _v.copy(point);
    this.group.worldToLocal(_v);
    _q.copy(this.group.quaternion).invert();
    _v2.copy(dir).applyQuaternion(_q);
    return this.sim.pokeAt(_v, _v2, speed);
  }

  // ----------------------------------------------------------------- update

  update(dt: number, playerHeadWorld: Vector3): void {
    this.time += dt;

    // Ease form + KO.
    const formRate = dt / CREATURE.formTime;
    this.form += Math.sign(this.formTarget - this.form) * Math.min(formRate, Math.abs(this.formTarget - this.form));
    const koRate = dt / 0.7; // collapse is fast, standing up uses form time
    const koStep = this.koTarget > this.koVal ? koRate : dt / CREATURE.formTime;
    this.koVal += Math.sign(this.koTarget - this.koVal) * Math.min(koStep, Math.abs(this.koTarget - this.koVal));
    this.sim.form = this.form;
    this.sim.ko = this.koVal;

    // --- root motion: ooze toward the steering target ---
    const speed = this.koTarget > 0 ? 0 : 0.45 + this.form * 0.4;
    _v.copy(this.rootTarget).sub(this.group.position);
    _v.y = 0;
    const dist = _v.length();
    if (dist > 0.02) {
      const step = Math.min(dist, speed * dt * Math.min(1, dist * 2.2));
      this.group.position.addScaledVector(_v.normalize(), step);
    }

    // Face the face-point (yaw only, springy) — unless mid-spin: the
    // backfist owns the body's rotation while it's coiling/whipping.
    if (this.attack?.name !== 'backfist') {
      _v.copy(this.facePoint).sub(this.group.position);
      const targetYaw = Math.atan2(_v.x, _v.z);
      let dYaw = targetYaw - this.yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      this.yaw += dYaw * Math.min(1, dt * (1.5 + this.form * 2.5));
    }
    this.group.rotation.set(0, this.yaw + this.extraYaw, 0);

    // Inertia: the gel lags when the root accelerates.
    if (dt > 1e-4) {
      _v.copy(this.group.position).sub(this.prevPos).divideScalar(dt);
      _v2.copy(_v).sub(this.prevVel);
      this.prevVel.copy(_v);
      this.prevPos.copy(this.group.position);
      _q.copy(this.group.quaternion).invert();
      _v2.applyQuaternion(_q);
      const cap = 6;
      _v2.clampLength(0, cap);
      this.sim.applyInertia(-_v2.x * 0.5, -_v2.y * 0.5, -_v2.z * 0.5);
    }

    // Player position in creature space (eyes + punch aim live here).
    this.group.updateMatrixWorld();
    this.playerLocal.copy(playerHeadWorld);
    this.group.worldToLocal(this.playerLocal);

    // --- attack timeline ---
    this.updateAttack(dt);

    // --- simulate the body ---
    this.sim.update(dt);

    // --- feed the renderer ---
    this.sim.bounds(_v, _v2);
    this.gelMesh.updateMatrixWorld();
    _m.copy(this.gelMesh.matrixWorld).invert();
    this.gel.update(
      this.sim.packed,
      this.sim.packedCount,
      this.sim.packedDents,
      this.sim.packedDentCount,
      _v,
      _v2,
      this.time,
      this.sim.agitation,
      this.telegraph,
      _m,
    );
    // Strike-time blend widening (see sim.blendScale) — shader stays in
    // lock-step with the CPU field.
    this.gel.material.uniforms.uBlend.value = CREATURE.blend * this.sim.blendScale;

    // Shadow hugs the current mass footprint.
    const spread = Math.max(_v2.x, _v2.z) * 2.4;
    this.shadow.scale.set(spread, spread, 1);
    this.shadow.position.x = _v.x;
    this.shadow.position.z = _v.z;
    (this.shadow.material as MeshBasicMaterial).opacity = 0.5 + this.koVal * 0.2;

    // Distance LOD: past ~3.5 m the full step budget is invisible — shed it.
    const camDist = this.group.position.distanceTo(playerHeadWorld);
    this.gel.setQuality(camDist < 3.5 ? 1 : 3.5 / camDist);

    this.updateEyes(dt, playerHeadWorld);
  }

  /**
   * The moveset choreography. Every attack is telegraph → strike → recover:
   * the telegraph is offset-driven (springy, organic, READABLE — each move
   * has its own silhouette), the strike PINS the striking blob to a
   * kinematic path (a spring can't chase a 0.2 s strike; without the pin
   * every swing whiffs), and recovery hands the extended limb back to the
   * spring for the snap-back wobble.
   */
  private updateAttack(dt: number): void {
    const a = this.attack;
    this.sim.offsets.fill(0);
    this.sim.radiusScale.fill(1);
    if (!a) {
      this.sim.pinIndex = -1;
      this.extraYaw = 0;
      this.sim.blendScale = 1;
      this.telegraph = Math.max(0, this.telegraph - dt * 6);
      return;
    }

    a.t += dt;
    this.sim.pinIndex = -1; // the strike phase below re-pins each frame
    const spec = ATTACKS[a.name];
    // Difficulty stretches the readable parts; the strike stays snappy.
    const T = spec.telegraph * this.tempoScale;
    const S = spec.strike;
    const R = spec.recover * this.tempoScale;

    const left = a.hand === 'left';
    const kick = a.name === 'roundhouse';
    const limbI = kick ? (left ? A.KNEE_L : A.KNEE_R) : left ? A.FIST_L : A.FIST_R;
    const elbowI = left ? A.ELBOW_L : A.ELBOW_R;
    const shoulderI = left ? A.SHOULDER_L : A.SHOULDER_R;
    const hipI = left ? A.HIP_L : A.HIP_R;
    const baseI = left ? A.BASE_L : A.BASE_R;
    const side = left ? -1 : 1; // this limb's outward X
    const base = BOXER_POSE[limbI];

    // Aim from the limb's rest pose to the snapshotted target.
    _v.set(a.target.x - base[0], a.target.y - base[1], a.target.z - base[2]);
    const aimLen = Math.max(_v.length(), 1e-4);
    const ax = _v.x / aimLen;
    const ay = _v.y / aimLen;
    const az = _v.z / aimLen;

    // Target's horizontal bearing from the body centre (spin + kick paths).
    const hd = Math.max(Math.hypot(a.target.x, a.target.z), 1e-4);
    const dirX = a.target.x / hd;
    const dirZ = a.target.z / hd;

    const o = this.sim.offsets;
    const put = (i: number, x: number, y: number, z: number): void => {
      o[i * 3] += x;
      o[i * 3 + 1] += y;
      o[i * 3 + 2] += z;
    };

    /** The strike path — where the striking blob is at strike-phase k. */
    const pathAt = (k: number, out: { x: number; y: number; z: number }): void => {
      const e = easeOutCubic(k);
      switch (a.name) {
        case 'jab':
        case 'cross': {
          // Straight line from the windup pullback to the target.
          const w = a.name === 'jab' ? 0.14 : 0.26;
          out.x = base[0] - ax * w + (a.target.x - base[0] + ax * w) * e;
          out.y = base[1] - ay * w + (a.target.y - base[1] + ay * w) * e;
          out.z = base[2] - az * w + (a.target.z - base[2] + az * w) * e;
          break;
        }
        case 'hook': {
          // Wide horizontal arc: out to the side, then curving in.
          out.x = bez(base[0] + side * 0.38, (base[0] + a.target.x) / 2 + side * 0.5, a.target.x, e);
          out.y = bez(base[1] + 0.08, (base[1] + a.target.y) / 2 + 0.06, a.target.y, e);
          out.z = bez(base[2] - 0.1, (base[2] + a.target.z) / 2, a.target.z, e);
          break;
        }
        case 'uppercut': {
          // Drop low, then rocket up through the chin.
          out.x = bez(base[0], a.target.x, a.target.x, e);
          out.y = bez(base[1] - 0.5, a.target.y - 0.45, a.target.y + 0.08, e);
          out.z = bez(base[2] + 0.02, a.target.z - 0.12, a.target.z, e);
          break;
        }
        case 'overhand': {
          // The big looping right: high and back, over the top, crashing
          // DOWN onto the head at the end of the arc.
          out.x = bez(base[0] + side * 0.12, (base[0] + a.target.x) / 2 + side * 0.15, a.target.x, e);
          out.y = bez(base[1] + 0.48, Math.max(base[1] + 0.62, a.target.y + 0.5), a.target.y - 0.04, e);
          out.z = bez(base[2] - 0.28, (base[2] + a.target.z) / 2, a.target.z, e);
          break;
        }
        case 'backfist': {
          // Arm held rigid at extension; the BODY's spin delivers it.
          const ext = Math.min(Math.max(hd, 0.55), 1.0);
          out.x = dirX * ext;
          out.y = a.target.y;
          out.z = dirZ * ext;
          break;
        }
        case 'roundhouse': {
          // The puddle skirt whips up into a leg sweeping a horizontal arc.
          const theta = side * 1.9 * (1 - e);
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          const r = 0.5 + (Math.min(hd, 1.35) - 0.5) * e;
          out.x = (dirX * cos + dirZ * sin) * r;
          out.z = (-dirX * sin + dirZ * cos) * r;
          out.y = 0.3 + (a.target.y - 0.3) * e;
          break;
        }
      }
    };

    let fx = 0;
    let fy = 0;
    let fz = 0;
    let swell = 1;
    let midSwell = 1; // the elbow/hip fattens with the stretch — keeps the
    // extended limb one continuous rope instead of beads on a string

    if (a.t < T) {
      // ---- telegraph: each attack's own readable silhouette ----
      const k = easeOutCubic(a.t / T);
      this.telegraph = Math.min(1, this.telegraph + dt * 3.5);
      switch (a.name) {
        case 'jab':
          fx = -ax * 0.14 * k;
          fy = -ay * 0.14 * k;
          fz = -az * 0.14 * k;
          swell = 1 + 0.25 * k;
          break;
        case 'cross':
          fx = -ax * 0.26 * k;
          fy = -0.06 * k;
          fz = -az * 0.26 * k;
          swell = 1 + 0.45 * k;
          break;
        case 'hook':
          fx = side * 0.38 * k;
          fy = 0.08 * k;
          fz = -0.1 * k;
          swell = 1 + 0.4 * k;
          put(elbowI, side * 0.3 * k, 0.16 * k, -0.05 * k);
          break;
        case 'uppercut':
          fy = -0.5 * k;
          fz = 0.02 * k;
          swell = 1 + 0.4 * k;
          put(elbowI, 0, -0.3 * k, 0);
          break;
        case 'overhand':
          // Fist climbs high behind the shoulder; the body rears back.
          fx = side * 0.12 * k;
          fy = 0.48 * k;
          fz = -0.28 * k;
          swell = 1 + 0.45 * k;
          put(elbowI, side * 0.1 * k, 0.3 * k, -0.18 * k);
          put(A.CHEST_L, 0, 0.03 * k, -0.07 * k);
          put(A.CHEST_R, 0, 0.03 * k, -0.07 * k);
          break;
        case 'backfist':
          // Coil the whole body the wrong way — the unmistakable wind-up.
          this.extraYaw = -0.9 * side * k;
          fx = -side * 0.3 * k;
          fy = 0.05 * k;
          fz = -0.08 * k;
          swell = 1 + 0.35 * k;
          put(shoulderI, -side * 0.12 * k, 0, 0);
          break;
        case 'roundhouse':
          // Mass shifts off the kicking side; the skirt gathers.
          fx = -side * 0.12 * k;
          fy = 0.05 * k;
          fz = -0.15 * k;
          swell = 1 + 0.5 * k;
          put(hipI, -side * 0.08 * k, 0.05 * k, -0.08 * k);
          put(A.CHEST_L, -side * 0.1 * k, 0, 0);
          put(A.CHEST_R, -side * 0.1 * k, 0, 0);
          break;
      }
    } else if (a.t < T + S) {
      // ---- strike: pin the limb to the path ----
      const k = (a.t - T) / S;
      this.telegraph = Math.max(0, this.telegraph - dt * 10);
      if (!a.whooshFired) {
        a.whooshFired = true;
        if (a.name === 'backfist') sfx.spinWhoosh();
        else if (a.name === 'roundhouse') sfx.kickWhoosh();
        else sfx.gooWhoosh();
      }
      if (a.name === 'backfist') {
        // The spin itself: coil releases through a full rotation.
        this.extraYaw = side * (-0.9 + (Math.PI * 2 + 0.9) * easeInOut(k));
      }
      pathAt(k, this._pin);
      fx = this._pin.x - base[0];
      fy = this._pin.y - base[1];
      fz = this._pin.z - base[2];
      swell = kick ? 1.35 : 1.45;
      midSwell = 1.5;
      this.sim.blendScale = 1.35;
      this.sim.pinIndex = limbI;
      this.sim.pinPos.x = this._pin.x;
      this.sim.pinPos.y = this._pin.y;
      this.sim.pinPos.z = this._pin.z;
      const apexK = a.name === 'backfist' ? 0.93 : 0.9;
      if (!a.apexFired && k > apexK) {
        a.apexFired = true;
        // Report the path END (full extension), not last frame's blob.
        pathAt(1, this._pin);
        _v3.set(this._pin.x, this._pin.y, this._pin.z);
        this.group.updateMatrixWorld();
        this.group.localToWorld(_v3);
        a.onApex?.(_v3);
      }
    } else if (a.t < T + S + R) {
      // ---- recover: hand the extended limb back to the springs ----
      const k = 1 - easeOutCubic((a.t - T - S) / R);
      this.extraYaw = 0; // 2π ≡ 0 — the spin lands facing you again
      pathAt(1, this._pin);
      fx = (this._pin.x - base[0]) * k;
      fy = (this._pin.y - base[1]) * k;
      fz = (this._pin.z - base[2]) * k;
      swell = 1 + (kick ? 0.4 : 0.45) * k;
      midSwell = 1 + 0.5 * k;
      this.sim.blendScale = 1 + 0.35 * k;
    } else {
      const done = a.onDone;
      this.attack = null;
      this.extraYaw = 0;
      done?.();
      return;
    }

    // Drive the chain. Joints interpolate ALONG THE LINE from their root to
    // the strike point — fraction-of-offset following detaches the arm at
    // full extension (the smooth-min can only bridge so far); a joint ladder
    // keeps the limb one connected rope of gel however far it stretches.
    put(limbI, fx, fy, fz);
    const px = base[0] + fx;
    const py = base[1] + fy;
    const pz = base[2] + fz;
    const ladder = (jointI: number, rootI: number, frac: number, lift = 0): void => {
      const jb = BOXER_POSE[jointI];
      const rb = BOXER_POSE[rootI];
      o[jointI * 3] += rb[0] + (px - rb[0]) * frac - jb[0];
      o[jointI * 3 + 1] += rb[1] + (py - rb[1]) * frac - jb[1] + lift;
      o[jointI * 3 + 2] += rb[2] + (pz - rb[2]) * frac - jb[2];
    };
    if (kick) {
      ladder(hipI, hipI, 0.52);
      ladder(baseI, baseI, 0.24, 0.05);
    } else {
      ladder(elbowI, shoulderI, 0.6);
      ladder(shoulderI, shoulderI, 0.24);
    }
    put(A.CHEST_L, 0, 0, fz * 0.1);
    put(A.CHEST_R, 0, 0, fz * 0.1);
    put(A.BELLY, 0, 0, fz * 0.08);
    this.sim.radiusScale[limbI] = swell;
    this.sim.radiusScale[kick ? hipI : elbowI] = midSwell;
  }

  private readonly _pin = { x: 0, y: 0, z: 0 };

  private updateEyes(dt: number, playerHeadWorld: Vector3): void {
    // Blink clock.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.2 + Math.random() * 3.4;
      this.blink = 1;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const lid = this.koVal > 0.5 ? 0.12 : 1 - Math.min(1, this.blink * 1.6) * 0.92;

    // Eyes ride the surface: from the head blob, walk the field toward the
    // player until we pop out of the gel.
    this.sim.corePos(A.HEAD, _v);
    _v3.copy(this.playerLocal).sub(_v);
    _v3.y *= 0.4; // eyes stay level-ish rather than craning
    _v3.normalize();

    const place = (eye: Group, side: number) => {
      // Rotate the gaze direction a little left/right for each eye.
      const ang = 0.3 * side;
      const dx = _v3.x * Math.cos(ang) - _v3.z * Math.sin(ang);
      const dz = _v3.x * Math.sin(ang) + _v3.z * Math.cos(ang);
      _v2.set(dx, _v3.y, dz);
      let s = 0.05;
      for (let i = 0; i < 9; i++) {
        _v.set(
          this.sim.packed[A.HEAD * 4] + _v2.x * s,
          this.sim.packed[A.HEAD * 4 + 1] + _v2.y * s,
          this.sim.packed[A.HEAD * 4 + 2] + _v2.z * s,
        );
        if (this.sim.fieldAt(_v) > -0.02) break;
        s += 0.045;
      }
      eye.position.set(_v.x - _v2.x * 0.02, _v.y - _v2.y * 0.02, _v.z - _v2.z * 0.02);
      eye.scale.set(1, lid, 1);
      eye.lookAt(playerHeadWorld);
    };
    place(this.eyeL, 1);
    place(this.eyeR, -1);

    // Telegraph turns the eyes hot amber.
    const flash = this.telegraph;
    for (const m of this.eyeMats) {
      m.color.setRGB(
        0.06 + flash * 0.95,
        0.1 + flash * 0.55,
        0.06,
      );
    }
  }
}
