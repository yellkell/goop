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
import { BRAIN, CREATURE } from '../config.js';
import * as sfx from '../audio/sfx.js';
import type { GooFx } from '../fx/splats.js';
import { createGelMaterial, type GelUniforms } from './gelMaterial.js';
import { A, BOXER_POSE } from './poses.js';
import { GoopSim, type PunchResult } from './sim.js';

export type Hand = 'left' | 'right';

interface ActivePunch {
  hand: Hand;
  /** Seconds since the punch began. */
  t: number;
  /** Where the fist is going, creature-local (snapshotted at wind-up). */
  target: Vector3;
  apexFired: boolean;
  onApex?: (fistWorld: Vector3) => void;
  onDone?: () => void;
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

  private punch: ActivePunch | null = null;

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
      this.punch = null;
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

  // ---------------------------------------------------------------- punches

  get isPunching(): boolean {
    return this.punch !== null;
  }

  /**
   * Wind up and throw a straight at a world point. Fires `onApex` at full
   * extension with the fist's world position (the AI checks the hit there).
   */
  throwPunch(hand: Hand, targetWorld: Vector3, onApex?: (fistWorld: Vector3) => void, onDone?: () => void): boolean {
    if (this.punch || this.koTarget > 0 || this.form < 0.7) return false;
    this.group.updateMatrixWorld();
    const target = new Vector3().copy(targetWorld);
    this.group.worldToLocal(target);
    // Cap reach so the arm stretches heroically but not absurdly.
    const shoulder = hand === 'left' ? BOXER_POSE[A.SHOULDER_L] : BOXER_POSE[A.SHOULDER_R];
    _v.set(target.x - shoulder[0], target.y - shoulder[1], target.z - shoulder[2]);
    const reach = _v.length();
    const maxReach = 1.15;
    if (reach > maxReach) {
      _v.multiplyScalar(maxReach / reach);
      target.set(shoulder[0] + _v.x, shoulder[1] + _v.y, shoulder[2] + _v.z);
    }
    this.punch = { hand, t: 0, target, apexFired: false, onApex, onDone };
    sfx.gooCharge(BRAIN.telegraph * this.tempoScale);
    return true;
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

    // Face the face-point (yaw only, springy).
    _v.copy(this.facePoint).sub(this.group.position);
    const targetYaw = Math.atan2(_v.x, _v.z);
    let dYaw = targetYaw - this.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.yaw += dYaw * Math.min(1, dt * (1.5 + this.form * 2.5));
    this.group.rotation.set(0, this.yaw, 0);

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

    // --- punch timeline ---
    this.updatePunch(dt);

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

  private updatePunch(dt: number): void {
    const p = this.punch;
    this.sim.offsets.fill(0);
    this.sim.radiusScale.fill(1);
    if (!p) {
      this.telegraph = Math.max(0, this.telegraph - dt * 6);
      return;
    }

    p.t += dt;
    // Difficulty stretches/squeezes the readable parts; the strike itself
    // stays snappy at every level (a slow punch never looks like a punch).
    const T = BRAIN.telegraph * this.tempoScale;
    const S = BRAIN.strikeTime;
    const R = BRAIN.recoverTime * this.tempoScale;
    const fistI = p.hand === 'left' ? A.FIST_L : A.FIST_R;
    const elbowI = p.hand === 'left' ? A.ELBOW_L : A.ELBOW_R;
    const shoulderI = p.hand === 'left' ? A.SHOULDER_L : A.SHOULDER_R;

    // Where the fist rests in the current pose, and the vector to the target.
    const base = BOXER_POSE[fistI];
    _v.set(p.target.x - base[0], p.target.y - base[1], p.target.z - base[2]);

    let fx = 0, fy = 0, fz = 0, swell = 1;
    if (p.t < T) {
      // Wind-up: fist draws back and down, swelling; the body glows.
      const k = easeOutCubic(p.t / T);
      const aim = _v3.copy(_v).normalize();
      fx = -aim.x * 0.26 * k;
      fy = -0.06 * k;
      fz = -aim.z * 0.26 * k;
      swell = 1 + 0.45 * k;
      this.telegraph = Math.min(1, this.telegraph + dt * 3.5);
    } else if (p.t < T + S) {
      // The strike: launch to full extension.
      const k = easeOutCubic((p.t - T) / S);
      fx = _v.x * k;
      fy = _v.y * k;
      fz = _v.z * k;
      swell = 1.45;
      this.telegraph = Math.max(0, this.telegraph - dt * 10);
      if (!p.apexFired && k > 0.9) {
        p.apexFired = true;
        sfx.gooWhoosh();
        this.fistWorld(p.hand, _v3);
        p.onApex?.(_v3);
      }
    } else if (p.t < T + S + R) {
      // Recover: everything flows back to guard.
      const k = 1 - easeOutCubic((p.t - T - S) / R);
      fx = _v.x * k;
      fy = _v.y * k;
      fz = _v.z * k;
      swell = 1 + 0.45 * k;
    } else {
      const done = p.onDone;
      this.punch = null;
      done?.();
      return;
    }

    // Drive the arm chain: fist leads, elbow and shoulder follow, the torso
    // leans its mass into it.
    const o = this.sim.offsets;
    o[fistI * 3] = fx;
    o[fistI * 3 + 1] = fy;
    o[fistI * 3 + 2] = fz;
    o[elbowI * 3] = fx * 0.55;
    o[elbowI * 3 + 1] = fy * 0.55;
    o[elbowI * 3 + 2] = fz * 0.55;
    o[shoulderI * 3] = fx * 0.25;
    o[shoulderI * 3 + 1] = fy * 0.25;
    o[shoulderI * 3 + 2] = fz * 0.25;
    o[A.CHEST_L * 3 + 2] = fz * 0.1;
    o[A.CHEST_R * 3 + 2] = fz * 0.1;
    o[A.BELLY * 3 + 2] = fz * 0.08;
    this.sim.radiusScale[fistI] = swell;
  }

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
