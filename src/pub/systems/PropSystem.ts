/**
 * Shared manipulatable props — pint glasses and darts.
 *
 * Every prop has ONE simulating owner at a time, brokered by the server:
 *
 *   grab (server grants) → HELD: the grab system moves it in your hand and
 *     you stream its transform; everyone else interpolates.
 *   release → FLIGHT: still yours — you integrate ballistics, stream, and
 *     rule on impacts (glasses bounce/settle/stack, darts stick and score).
 *   settle → REST: you broadcast the final transform and give up ownership;
 *     now anyone may pick it up.
 *
 *   CATCH: a remote prop in flight is still grabbable — grabbing it asks the
 *   server for ownership, which transfers mid-air. That's how you play catch
 *   with a pint (or a dart — mind the point).
 *
 * Throw velocity comes from a 5-frame ring buffer of hand-held positions,
 * the same scheme the old vrstreet darts used — but unlike vrstreet the
 * meshes carry fat invisible grab proxies, so you can actually pick them up.
 */

import { createSystem, Grabbed, InputComponent, OneHandGrabbable, type Entity, type World } from '@iwsdk/core';
import { Group, Object3D, Quaternion, Raycaster, Vector3 } from 'three';
import { dartFloor, dartStick, glassClink, glassTap, throwWhoosh } from '../../audio/sfx.js';
import { GLASS, PROP_PHYS, PUB, SURFACES } from '../config.js';
import { pubSendRaw } from '../net.js';
import type { PropKind, QuatT, Vec3T } from '../protocol.js';
import { buildDart, buildPintGlass, fadeOpacity, restoreOpacity, setGlassFill, setPropHighlight } from '../props.js';
import { clearRestCircle, resolveOverlap, restCirclesByPrefix, setRestCircle, type RestCircle } from '../restCircles.js';
import { bus, pub } from '../state.js';
import { scoreFromUV } from '../textures.js';

type Mode =
  | 'rest' // at home slot or wherever it settled — grabbable
  | 'held' // in MY hand, grab system drives it, I stream
  | 'flight' // mine, I simulate ballistics + impacts
  | 'stuck' // my dart in the board: hold, fade, then respawn to the rack
  | 'remote'; // someone else owns it (held or flying) — interpolate

interface PropRec {
  id: number;
  kind: PropKind;
  entity: Entity;
  mesh: Group;
  /** Glasses start inactive past the opening 8 — hidden and ungrabbable
   *  until the barkeep brings them out. */
  active: boolean;
  mode: Mode;
  vel: Vector3;
  ring: { pos: Vector3; t: number }[];
  stuckTimer: number;
  fadeTimer: number;
  netPos: Vector3;
  netQuat: Quaternion;
  hasNetTarget: boolean;
  streamTimer: number;
  home: [number, number, number];
  /** Manually dispensed from the dart box, outside IWSDK's grabbable handoff. */
  manualHand: Hand | null;
}

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

const RANGE_GRAB_MAX = 1.0;
// A forgiving aim CONE instead of a hairline ray: a prop counts as aimed-at
// when it sits within this half-angle of where the hand points. cos(30°).
const RANGE_GRAB_CONE_COS = Math.cos((30 * Math.PI) / 180);

const UP = new Vector3(0, 1, 0);
// The dartboard hangs on the NORTH wall (faces +z into the room), so a dart
// embeds pointing −z (into the wall) and stands proud toward the throwers.
const INTO_BOARD = new Vector3(0, 0, -1);

const raycaster = new Raycaster();
const _a = new Vector3();
const _b = new Vector3();
const _rayOrigin = new Vector3();
const _rayDir = new Vector3();
const _toProp = new Vector3();
const _q = new Quaternion();

const recs: PropRec[] = [];
const byId = new Map<number, PropRec>();

/** A glass's world-space footprint radius — the wider TOP of the taper, so the
 *  overlap check is conservative (no flared rims clipping a neighbour). */
const GLASS_FOOT_R = GLASS.radiusTop * GLASS.scale;

/** The y a glass standing at (x,z) rests at: a table/bar top if it's over one,
 *  else the floor. A simplified re-snap (no "falling from above" gating) —
 *  used only to re-derive height after a small overlap-avoidance nudge, where
 *  the new spot is almost always still over the same surface. */
function glassLandY(x: number, z: number): number {
  let y = 0;
  for (const s of SURFACES) {
    if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && s.y > y) y = s.y;
  }
  return y;
}

/** Build all props at their home slots. Called from main.ts after the pub. */
export function buildProps(world: World): void {
  const refs = pub.refs!;
  let id = 0;
  for (const slot of refs.glassSlots) {
    // Every pint starts EMPTY, parked under the counter; the barkeep pulls
    // them out one at a time between his other jobs and pours on arrival.
    const active = id < PUB.glassStart;
    addProp(world, id++, 'glass', buildPintGlass(), slot, active, (mesh) => {
      if (active) {
        mesh.position.set(...slot);
      } else {
        mesh.position.set(slot[0], 0.55, PUB.bar.z - 0.35); // under-bar shelf
        setGlassFill(mesh, 0);
      }
    });
  }
  let dartIdx = 0;
  for (const slot of refs.dartRackSlots) {
    const lean = dartIdx++;
    addProp(world, id++, 'dart', buildDart(), slot, true, (mesh) => {
      mesh.position.set(...slot);
      // Standing tip-down in the box — kept HIDDEN at rest (the crate reads
      // "GRAB DARTS" instead), so this pose only shows for the split second a
      // dart respawns before the next throw plucks it out.
      mesh.rotation.set(Math.PI - 0.12 + (lean % 2) * 0.1, 0, ((lean % 3) - 1) * 0.14);
    });
  }
}

function addProp(
  world: World,
  id: number,
  kind: PropKind,
  mesh: Group,
  home: [number, number, number],
  active: boolean,
  place: (mesh: Group) => void,
): void {
  place(mesh);
  // Darts begin tucked in the box, so they start HIDDEN (the crate reads
  // "GRAB DARTS"); the update loop reveals one the moment it leaves the box.
  // Inactive glasses stay VISIBLE — empties stocked under the counter — just
  // ungrabbable until the barkeep brings them out.
  mesh.visible = kind === 'dart' ? false : active || kind === 'glass';
  world.scene.add(mesh);
  const entity = world.createTransformEntity(mesh);
  // Inactive glasses get their grab handle only when they come out — the
  // invisible grab proxy would otherwise let you grab thin air.
  if (active) entity.addComponent(OneHandGrabbable, { rotate: true });
  const rec: PropRec = {
    id,
    kind,
    entity,
    mesh,
    active,
    mode: 'rest',
    vel: new Vector3(),
    ring: [],
    stuckTimer: 0,
    fadeTimer: 0,
    netPos: new Vector3(),
    netQuat: new Quaternion(),
    hasNetTarget: false,
    streamTimer: 0,
    home,
    manualHand: null,
  };
  recs.push(rec);
  byId.set(id, rec);
}

/** The next glass still waiting in the back, if any (offline restocking). */
export function nextInactiveGlassId(): number | null {
  const rec = recs.find((r) => r.kind === 'glass' && !r.active);
  return rec ? rec.id : null;
}

export class PropSystem extends createSystem({
  grabbedProps: { required: [OneHandGrabbable, Grabbed] },
}) {
  /** Glasses announced by the barkeep, landing after the delivery delay. */
  private pendingGlasses: { rec: PropRec; t: number }[] = [];
  /** Fresh pours mid-rise (fill 0 → 1 over a few seconds). */
  private fills: { rec: PropRec; f: number }[] = [];
  private offlineRestock = 0;
  /** The prop the empty hand is currently aimed at — it glows until grabbed. */
  private highlighted: PropRec | null = null;
  /** Eased glow on the dart-crate walls while a hand can pull a dart (0..1). */
  private dartGlow = 0;

  init(): void {
    this.queries.grabbedProps.subscribers.qualify.add((e: Entity) => this.onGrab(e));
    this.queries.grabbedProps.subscribers.disqualify.add((e: Entity) => this.onRelease(e));

    this.cleanupFuncs.push(
      // Late-join: adopt whatever state the room is already in.
      bus.on('connected', () => this.applyServerState()),
      // The barkeep is walking a fresh glass over — it lands when he does.
      bus.on('glassOut', (id) => {
        const rec = byId.get(id);
        if (rec && !rec.active && !this.pendingGlasses.some((p) => p.rec === rec)) {
          this.pendingGlasses.push({ rec, t: PUB.glassDeliverDelay });
        }
      }),
      bus.on('propGrabbed', ({ id, holder }) => {
        const rec = byId.get(id);
        if (!rec) return;
        if (holder === pub.myId) return; // our own grant echoing back
        // Someone else has it — including the case where we optimistically
        // grabbed and lost the race: yield and let the network drive it.
        if (rec.mesh.parent !== this.scene) this.scene.attach(rec.mesh);
        rec.manualHand = null;
        if (rec.kind === 'glass') clearRestCircle(`glass:${rec.id}`); // no longer resting
        rec.mode = 'remote';
        restoreOpacity(rec.mesh);
      }),
      bus.on('propMoved', ({ id, pos, quat }) => {
        const rec = byId.get(id);
        if (!rec || rec.mode === 'held' || rec.mode === 'flight' || rec.mode === 'stuck') return;
        rec.netPos.set(pos[0], pos[1], pos[2]);
        rec.netQuat.set(quat[0], quat[1], quat[2], quat[3]);
        if (!rec.hasNetTarget) {
          rec.mesh.position.copy(rec.netPos);
          rec.mesh.quaternion.copy(rec.netQuat);
          rec.hasNetTarget = true;
        }
        if (rec.kind === 'glass') clearRestCircle(`glass:${rec.id}`); // moving, not resting
        rec.mode = 'remote';
      }),
      bus.on('propSettled', ({ id, pos, quat }) => {
        const rec = byId.get(id);
        if (!rec) return;
        if (rec.mode === 'held' || rec.mode === 'flight' || rec.mode === 'stuck') {
          // Our optimistic local sim was overruled (rare) — server wins.
        }
        if (rec.mesh.parent !== this.scene) this.scene.attach(rec.mesh);
        rec.manualHand = null;
        rec.mode = 'rest';
        rec.hasNetTarget = false;
        rec.mesh.position.set(pos[0], pos[1], pos[2]);
        rec.mesh.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
        restoreOpacity(rec.mesh);
        // The owner already resolved overlap before sending this — mirror
        // their final resting spot so coins (CoinSystem) know to avoid it.
        if (rec.kind === 'glass') setRestCircle(`glass:${rec.id}`, pos[0], pos[1], pos[2], GLASS_FOOT_R);
      }),
    );
  }

  update(delta: number): void {
    // Fresh pours settle: the amber rises over ~3 s, head last.
    for (let i = this.fills.length - 1; i >= 0; i--) {
      const p = this.fills[i];
      p.f += delta / 3;
      setGlassFill(p.rec.mesh, p.f);
      if (p.f >= 1) this.fills.splice(i, 1);
    }

    // Glasses in transit from the back land once the barkeep gets there.
    for (let i = this.pendingGlasses.length - 1; i >= 0; i--) {
      const p = this.pendingGlasses[i];
      p.t -= delta;
      if (p.t <= 0) {
        this.activateGlass(p.rec);
        this.pendingGlasses.splice(i, 1);
      }
    }

    // Offline the barkeep restocks on a local clock (online the server does).
    if (!pub.online) {
      this.offlineRestock += delta;
      if (this.offlineRestock >= PUB.glassRestockInterval) {
        this.offlineRestock = 0;
        const id = nextInactiveGlassId();
        if (id !== null) bus.emit('glassOut', id);
      }
    }

    const didRangeGrab = this.updateRangeGrab();
    if (!didRangeGrab) this.tryDartBoxDispense();
    this.updateDartBoxGlow(delta);

    for (const rec of recs) {
      switch (rec.mode) {
        case 'held':
          this.sampleRing(rec);
          this.stream(rec, delta);
          if (rec.manualHand && !this.gripHeld(rec.manualHand)) this.releaseHeld(rec);
          break;
        case 'flight':
          this.stepFlight(rec, delta);
          this.stream(rec, delta);
          break;
        case 'stuck':
          rec.stuckTimer += delta;
          if (rec.stuckTimer > PROP_PHYS.dartStuckLifetime) {
            rec.fadeTimer += delta;
            fadeOpacity(rec.mesh, Math.max(0, 1 - rec.fadeTimer / PROP_PHYS.dartFadeTime));
            if (rec.fadeTimer >= PROP_PHYS.dartFadeTime) this.respawnDart(rec);
          }
          break;
        case 'remote':
          if (rec.hasNetTarget) {
            // Snap when way off (teleports), otherwise smooth.
            if (rec.mesh.position.distanceToSquared(rec.netPos) > 4) {
              rec.mesh.position.copy(rec.netPos);
              rec.mesh.quaternion.copy(rec.netQuat);
            } else {
              const k = 1 - Math.exp(-18 * delta);
              rec.mesh.position.lerp(rec.netPos, k);
              rec.mesh.quaternion.slerp(rec.netQuat, k);
            }
          }
          break;
        case 'rest':
          break;
      }
    }

    // Darts resting in the box are HIDDEN — the crate just reads "GRAB DARTS";
    // a dart only appears once it's pulled out (held/flight/stuck) or is lying
    // out in the room. Driven off state so it stays right for remote darts too.
    // A boxed dart is ALSO taken off IWSDK's near-grab (pointerEvents 'none'):
    // the reach-in dispense is the only way to draw one, so the grab pointer
    // can't pluck a SECOND dart on the same squeeze. (The pointer system ignores
    // `visible`, so hiding the dart alone wouldn't stop it.)
    for (const rec of recs) {
      if (rec.kind !== 'dart') continue;
      const inBox = rec.mode === 'rest' && this.inDartBox(rec.mesh.position);
      const show = !inBox;
      if (rec.mesh.visible !== show) rec.mesh.visible = show;
      const pe = inBox ? 'none' : undefined;
      if (rec.mesh.pointerEvents !== pe) rec.mesh.pointerEvents = pe;
    }
  }

  // --- grab / release ---------------------------------------------------------

  private findRec(e: Entity): PropRec | undefined {
    return recs.find((r) => r.entity === e || r.mesh === e.object3D);
  }

  private onGrab(e: Entity): void {
    const rec = this.findRec(e);
    if (!rec) return;
    // Can't pluck a dart out of the board mid-fade or wrestle a held prop —
    // but a REMOTE prop in flight (or at rest) is fair game: that's a catch.
    if (rec.mode === 'stuck') return;
    this.clearHighlight(rec);
    restoreOpacity(rec.mesh);
    if (rec.kind === 'glass') clearRestCircle(`glass:${rec.id}`); // no longer resting
    rec.mode = 'held';
    rec.manualHand = null;
    rec.hasNetTarget = false;
    rec.ring = [];
    rec.stuckTimer = 0;
    rec.fadeTimer = 0;
    pubSendRaw({ t: 'grab', id: rec.id });
  }

  private sampleRing(rec: PropRec): void {
    rec.mesh.getWorldPosition(_a);
    rec.ring.push({ pos: _a.clone(), t: performance.now() / 1000 });
    if (rec.ring.length > 5) rec.ring.shift();
  }

  private onRelease(e: Entity): void {
    const rec = this.findRec(e);
    if (!rec || rec.mode !== 'held') return;
    rec.manualHand = null;
    this.releaseHeld(rec);
  }

  private updateRangeGrab(): boolean {
    const target = this.findRangeTarget();
    this.highlight(target?.rec ?? null);
    if (!target) return false;

    const gp = this.input.xr.gamepads[target.hand];
    const grip = this.player?.gripSpaces[target.hand];
    if (!gp || !grip || !gp.getButtonDown(InputComponent.Squeeze)) return false;

    this.grabPropFromRange(target.rec, target.hand, grip);
    this.highlight(null);
    return true;
  }

  /**
   * The prop an empty hand is aimed at, chosen by a forgiving CONE rather than
   * a hairline ray: any in-range prop within RANGE_GRAB_CONE_COS of the hand's
   * forward axis qualifies, and we pick the one nearest the aim (ties broken
   * toward the closer prop). No silhouette-precise pointing required.
   */
  private findRangeTarget(): { rec: PropRec; hand: Hand } | null {
    if (!this.player) return null;
    const candidates = recs.filter((rec) => this.canRangeGrab(rec));
    if (!candidates.length) return null;

    let best: { rec: PropRec; hand: Hand; score: number } | null = null;
    for (const hand of HANDS) {
      if (this.handBusy(hand)) continue;
      const ray = this.player.raySpaces[hand];
      if (!ray) continue;
      ray.getWorldPosition(_rayOrigin);
      ray.getWorldQuaternion(_q);
      _rayDir.set(0, 0, -1).applyQuaternion(_q).normalize();

      for (const rec of candidates) {
        this.propCenter(rec, _toProp).sub(_rayOrigin);
        const dist = _toProp.length();
        if (dist < 1e-3 || dist > RANGE_GRAB_MAX) continue;
        const aim = _toProp.divideScalar(dist).dot(_rayDir);
        if (aim < RANGE_GRAB_CONE_COS) continue; // outside the aim cone
        // Most on-axis wins; a small distance nudge favours the nearer prop.
        const score = aim - dist * 0.1;
        if (!best || score > best.score) best = { rec, hand, score };
      }
    }
    return best ? { rec: best.rec, hand: best.hand } : null;
  }

  /** Grab point of a prop: glass centre rides above its base. */
  private propCenter(rec: PropRec, out: Vector3): Vector3 {
    rec.mesh.getWorldPosition(out);
    if (rec.kind === 'glass') out.y += (GLASS.height * GLASS.scale) / 2;
    return out;
  }

  private canRangeGrab(rec: PropRec): boolean {
    if (!rec.active || !rec.mesh.visible || rec.mode !== 'rest') return false;
    const net = pub.props.get(rec.id);
    if (net?.holder && net.holder !== pub.myId) return false;
    if (net && net.mode !== 'rest' && net.holder !== pub.myId) return false;
    return true;
  }

  private handBusy(hand: Hand): boolean {
    return recs.some((rec) => rec.mode === 'held' && rec.manualHand === hand);
  }

  /** Make `rec` the lit grab target (or none), gently glowing the prop itself. */
  private highlight(rec: PropRec | null): void {
    if (this.highlighted === rec) return;
    if (this.highlighted) setPropHighlight(this.highlighted.mesh, false);
    this.highlighted = rec;
    if (rec) setPropHighlight(rec.mesh, true);
  }

  /** Drop the glow off a specific prop the instant it's grabbed by any path. */
  private clearHighlight(rec: PropRec): void {
    setPropHighlight(rec.mesh, false);
    if (this.highlighted === rec) this.highlighted = null;
  }

  private grabPropFromRange(rec: PropRec, hand: Hand, grip: Object3D): void {
    this.beginManualGrab(rec, hand, grip);
  }

  private tryDartBoxDispense(): void {
    const refs = pub.refs;
    const player = this.player;
    if (!refs || !player) return;
    for (const hand of HANDS) {
      if (this.handBusy(hand)) continue; // a full hand can't draw a second dart
      const gp = this.input.xr.gamepads[hand];
      const grip = player.gripSpaces[hand];
      if (!gp || !grip || !gp.getButtonDown(InputComponent.Squeeze)) continue;
      grip.getWorldPosition(_a);
      if (!this.inDartBox(_a)) continue;
      const rec = this.nextBoxDart();
      if (!rec) continue;
      this.grabDartFromBox(rec, hand, grip);
    }
  }

  /** Glow the whole dart crate amber when an empty hand is in reach to pull a
   *  dart — the box's own "you can grab here" cue, like the pints lighting up. */
  private updateDartBoxGlow(delta: number): void {
    const mat = pub.refs?.dartBoxMat;
    if (!mat) return;
    const k = 1 - Math.exp(-12 * delta);
    this.dartGlow += ((this.boxActionable() ? 1 : 0) - this.dartGlow) * k;
    mat.emissiveIntensity = this.dartGlow * 0.9;
  }

  /** An empty hand is near enough the stocked crate to pull a dart from it. */
  private boxActionable(): boolean {
    const player = this.player;
    const box = pub.refs?.dartBox;
    if (!player || !box || !this.nextBoxDart()) return false;
    const [cx, cy, cz] = box.center;
    const [hx, hy, hz] = box.half;
    const m = 0.18; // forgiving margin so it lights as a hand approaches
    for (const hand of HANDS) {
      if (this.handBusy(hand)) continue;
      const grip = player.gripSpaces[hand];
      if (!grip) continue;
      grip.getWorldPosition(_a);
      if (Math.abs(_a.x - cx) <= hx + m && Math.abs(_a.y - cy) <= hy + m && Math.abs(_a.z - cz) <= hz + m) {
        return true;
      }
    }
    return false;
  }

  private inDartBox(pos: Vector3): boolean {
    const box = pub.refs?.dartBox;
    if (!box) return false;
    const [cx, cy, cz] = box.center;
    const [hx, hy, hz] = box.half;
    return (
      Math.abs(pos.x - cx) <= hx &&
      Math.abs(pos.y - cy) <= hy &&
      Math.abs(pos.z - cz) <= hz
    );
  }

  private nextBoxDart(): PropRec | null {
    const resting = recs.filter((r) => r.kind === 'dart' && r.active && r.mode === 'rest');
    if (!resting.length) return null;
    return resting.find((r) => r.mesh.position.distanceToSquared(_a.set(r.home[0], r.home[1], r.home[2])) < 0.16) ?? resting[0];
  }

  private grabDartFromBox(rec: PropRec, hand: Hand, grip: Object3D): void {
    this.beginManualGrab(rec, hand, grip);
  }

  private beginManualGrab(rec: PropRec, hand: Hand, grip: Object3D): void {
    this.clearHighlight(rec);
    restoreOpacity(rec.mesh);
    rec.mesh.visible = true; // a dart pulled from the box appears in-hand now
    if (rec.kind === 'glass') clearRestCircle(`glass:${rec.id}`); // no longer resting
    rec.mode = 'held';
    rec.manualHand = hand;
    rec.hasNetTarget = false;
    rec.ring = [];
    rec.stuckTimer = 0;
    rec.fadeTimer = 0;
    rec.vel.set(0, 0, 0);
    grip.attach(rec.mesh);
    if (rec.kind === 'dart') {
      // Tip points along controller forward, sitting just proud of the palm.
      rec.mesh.position.set(0, -0.015, -0.085);
      rec.mesh.quaternion.setFromUnitVectors(UP, _a.set(0, 0, -1));
    } else {
      // Pint origin is the base; tuck it slightly below and forward of grip.
      rec.mesh.position.set(0, -0.09, -0.065);
      rec.mesh.quaternion.identity();
    }
    this.sampleRing(rec);
    pubSendRaw({ t: 'grab', id: rec.id });
  }

  private gripHeld(hand: Hand): boolean {
    return (this.input.xr.gamepads[hand]?.getButtonPressed(InputComponent.Squeeze) ?? false);
  }

  private releaseHeld(rec: PropRec): void {
    // If the grab system reparented the mesh to a hand, put it back in the
    // scene without moving it.
    if (rec.mesh.parent !== this.scene) this.scene.attach(rec.mesh);

    if (rec.ring.length >= 2) {
      const first = rec.ring[0];
      const last = rec.ring[rec.ring.length - 1];
      const dt = Math.max(last.t - first.t, 1 / 90);
      rec.vel.copy(last.pos).sub(first.pos).divideScalar(dt);
      // Darts get a wrist-flick boost so they leave the hand with zip.
      if (rec.kind === 'dart') rec.vel.multiplyScalar(PROP_PHYS.dartThrowGain);
      const cap = rec.kind === 'dart' ? PROP_PHYS.dartMaxSpeed : PROP_PHYS.maxThrowSpeed;
      if (rec.vel.length() > cap) rec.vel.setLength(cap);
    } else {
      rec.vel.set(0, 0, 0);
    }

    rec.mode = 'flight';
    rec.manualHand = null;
    if (rec.vel.lengthSq() > 4) throwWhoosh();
    pubSendRaw({ t: 'release', id: rec.id });
  }

  // --- owner-side flight simulation --------------------------------------------

  private stepFlight(rec: PropRec, delta: number): void {
    // Darts are light and fast — they drop less than a heavy pint glass.
    rec.vel.y -= (rec.kind === 'dart' ? PROP_PHYS.dartGravity : PROP_PHYS.gravity) * delta;
    const step = _b.copy(rec.vel).multiplyScalar(delta);
    const p = rec.mesh.position;

    if (rec.kind === 'dart') {
      this.stepDart(rec, step);
      return;
    }

    // --- pint glass: bounce around the room, then settle ---
    const prevY = p.y;
    p.add(step);

    // Walls.
    const wx = PUB.halfWidth - 0.06;
    const wz = PUB.halfDepth - 0.06;
    if (p.x > wx || p.x < -wx) {
      p.x = Math.max(-wx, Math.min(wx, p.x));
      rec.vel.x *= -PROP_PHYS.restitution;
      glassTap(true);
    }
    if (p.z > wz || p.z < -wz) {
      p.z = Math.max(-wz, Math.min(wz, p.z));
      rec.vel.z *= -PROP_PHYS.restitution;
      glassTap(true);
    }
    if (p.y > PUB.ceiling - 0.08) {
      p.y = PUB.ceiling - 0.08;
      rec.vel.y *= -PROP_PHYS.restitution;
    }

    // Floor + table/bar tops (glass origin is its base).
    if (rec.vel.y <= 0) {
      let landY: number | null = null;
      for (const s of SURFACES) {
        if (p.x >= s.minX && p.x <= s.maxX && p.z >= s.minZ && p.z <= s.maxZ) {
          if (prevY >= s.y - 0.01 && p.y <= s.y) landY = Math.max(landY ?? -1, s.y);
        }
      }
      if (landY === null && p.y <= 0) landY = 0;
      // Land on TOP of a resting glass we're dropping onto — that's how a pint
      // stacks. Nest on the highest one in the column so a glass piles onto the
      // top of a stack rather than passing through it to the table.
      const stackTop = this.glassStackTopUnder(rec, prevY);
      if (stackTop !== null) landY = Math.max(landY ?? -1, stackTop);
      if (landY !== null) {
        p.y = landY;
        const speed = rec.vel.length();
        if (speed < PROP_PHYS.settleSpeed) {
          this.settleGlass(rec);
          return;
        }
        rec.vel.y = -rec.vel.y * PROP_PHYS.restitution;
        rec.vel.x *= 0.6;
        rec.vel.z *= 0.6;
        glassTap(true);
      }
    }

    // A thrown pint tumbles a little.
    if (rec.vel.lengthSq() > 0.5) {
      rec.mesh.rotation.x += delta * rec.vel.z * 2;
      rec.mesh.rotation.z -= delta * rec.vel.x * 2;
    }
  }

  /** Settle a glass: stand it upright, stack it if it landed on another. */
  private settleGlass(rec: PropRec): void {
    const p = rec.mesh.position;
    rec.mesh.quaternion.identity();

    // Stack: if we settled within reach of a glass column, sit on TOP of its
    // HIGHEST glass — crown the stack, never wedge into a mid-level slot. Only
    // when we came to rest at or above the column's base, so a glass on the
    // floor beneath a shelved one doesn't leap up to it.
    let topBase: number | null = null;
    let topX = 0;
    let topZ = 0;
    let lowBase = Infinity;
    for (const other of recs) {
      if (other === rec || other.kind !== 'glass') continue;
      if (other.mode !== 'rest' && other.mode !== 'remote') continue;
      const op = other.mesh.position;
      const dx = op.x - p.x;
      const dz = op.z - p.z;
      if (dx * dx + dz * dz > GLASS.stackSnap * GLASS.stackSnap) continue;
      if (op.y < lowBase) lowBase = op.y;
      if (topBase === null || op.y > topBase) {
        topBase = op.y;
        topX = op.x;
        topZ = op.z;
      }
    }
    const stacked = topBase !== null && p.y >= lowBase - GLASS.stackRise;
    if (stacked) {
      p.x = topX;
      p.z = topZ;
      p.y = topBase! + GLASS.stackRise;
    } else {
      // Not stacking — clear it of any neighbour sitting at the SAME level
      // instead of letting it clip: another glass just outside stack-snap
      // range, or a resting coin (coin positions live in PropSystem's sibling
      // module, CoinSystem, so read them from the shared registry).
      const obstacles: RestCircle[] = [];
      for (const other of recs) {
        if (other === rec || other.kind !== 'glass') continue;
        if (other.mode !== 'rest' && other.mode !== 'remote') continue;
        obstacles.push({ id: `glass:${other.id}`, x: other.mesh.position.x, y: other.mesh.position.y, z: other.mesh.position.z, r: GLASS_FOOT_R });
      }
      obstacles.push(...restCirclesByPrefix('coin:'));
      const resolved = resolveOverlap(p.x, p.y, p.z, GLASS_FOOT_R, obstacles, (x, z) => glassLandY(x, z));
      p.x = resolved.x;
      p.y = resolved.y;
      p.z = resolved.z;
    }
    setRestCircle(`glass:${rec.id}`, p.x, p.y, p.z, GLASS_FOOT_R);
    // Glass-on-glass clinks; glass-on-surface gives a soft tap.
    if (stacked) glassClink();
    else glassTap(false);

    rec.mode = 'rest';
    rec.vel.set(0, 0, 0);
    this.sendSettle(rec);
  }

  /** Base height a falling glass should nest at if a resting glass sits in its
   *  column (within stackSnap XZ) and it's descending onto it — the highest
   *  such support, so it tops a tall stack. Null if there's nothing to stack on. */
  private glassStackTopUnder(rec: PropRec, prevY: number): number | null {
    const p = rec.mesh.position;
    let best: number | null = null;
    for (const other of recs) {
      if (other === rec || other.kind !== 'glass') continue;
      if (other.mode !== 'rest' && other.mode !== 'remote') continue;
      const op = other.mesh.position;
      const dx = op.x - p.x;
      const dz = op.z - p.z;
      if (dx * dx + dz * dz > GLASS.stackSnap * GLASS.stackSnap) continue;
      const top = op.y + GLASS.stackRise;
      if (prevY >= top - 0.02 && p.y <= top && (best === null || top > best)) best = top;
    }
    return best;
  }

  private stepDart(rec: PropRec, step: Vector3): void {
    const refs = pub.refs!;
    const p = rec.mesh.position;
    const dist = step.length();

    if (dist > 0) {
      raycaster.set(p, _a.copy(step).normalize());
      raycaster.far = dist + 0.06;
      const hits = raycaster.intersectObjects(
        [refs.dartboard, refs.corkSurround, ...refs.dartCatchers],
        false,
      );
      if (hits.length > 0) {
        const hit = hits[0];
        this.stickDart(rec, hit.point, hit.object.name, hit.uv ?? null);
        return;
      }
    }

    p.add(step);
    // Point along the velocity.
    if (rec.vel.lengthSq() > 0.001) {
      rec.mesh.quaternion.setFromUnitVectors(UP, _a.copy(rec.vel).normalize());
    }

    // Floor or out of the room → clatter down where it lies.
    if (p.y <= 0.02 || Math.abs(p.x) > PUB.halfWidth || Math.abs(p.z) > PUB.halfDepth) {
      p.y = 0.02;
      p.x = Math.max(-PUB.halfWidth + 0.1, Math.min(PUB.halfWidth - 0.1, p.x));
      p.z = Math.max(-PUB.halfDepth + 0.1, Math.min(PUB.halfDepth - 0.1, p.z));
      rec.mesh.quaternion.setFromAxisAngle(_a.set(0, 0, 1), Math.PI / 2);
      rec.mode = 'rest';
      dartFloor();
      this.sendSettle(rec);
    }
  }

  private stickDart(rec: PropRec, point: Vector3, surface: string, uv: { x: number; y: number } | null): void {
    rec.mesh.position.copy(point);
    rec.mesh.quaternion.setFromUnitVectors(UP, INTO_BOARD);
    // Pull it 2 cm back out of the board so the tip stays buried but the shaft
    // and flight sit PROUD, pointing straight out at the thrower (not flat).
    rec.mesh.position.addScaledVector(INTO_BOARD, -0.02);
    rec.stuckTimer = 0;
    rec.fadeTimer = 0;
    rec.mode = 'stuck';
    dartStick();
    this.stream(rec, 1); // push the final stuck transform immediately

    if (surface === 'dartboard' && uv) {
      bus.emit('dartScored', scoreForBoard(uv));
    }
  }

  /** Stuck lifetime over: dart melts back to its rack slot for the next thrower. */
  private respawnDart(rec: PropRec): void {
    rec.mode = 'rest';
    rec.stuckTimer = 0;
    rec.fadeTimer = 0;
    restoreOpacity(rec.mesh);
    rec.mesh.position.set(...rec.home);
    rec.mesh.rotation.set(0, 0, Math.PI / 2);
    this.sendSettle(rec);
  }

  // --- network helpers -----------------------------------------------------------

  private stream(rec: PropRec, delta: number): void {
    if (!pub.online) return;
    rec.streamTimer += delta;
    if (rec.streamTimer < 1 / PROP_PHYS.streamHz) return;
    rec.streamTimer = 0;
    rec.mesh.getWorldPosition(_a);
    rec.mesh.getWorldQuaternion(_q);
    pubSendRaw({
      t: 'prop',
      id: rec.id,
      pos: [_a.x, _a.y, _a.z] as Vec3T,
      quat: [_q.x, _q.y, _q.z, _q.w] as QuatT,
    });
  }

  private sendSettle(rec: PropRec): void {
    if (!pub.online) return;
    const p = rec.mesh.position;
    const q = rec.mesh.quaternion;
    pubSendRaw({
      t: 'settle',
      id: rec.id,
      pos: [p.x, p.y, p.z] as Vec3T,
      quat: [q.x, q.y, q.z, q.w] as QuatT,
    });
  }

  /** A fresh pint lands on the bar, visible and grabbable. `animate` runs
   *  the pour-rise (the barkeep just brought THIS one out); off = already
   *  full (a late joiner adopting glasses the barkeep poured before they
   *  arrived — those must NOT all re-fill at once). */
  private activateGlass(rec: PropRec, animate = true): void {
    if (rec.active) return;
    rec.active = true;
    rec.mesh.visible = true;
    rec.mesh.position.set(...rec.home);
    rec.mesh.quaternion.identity();
    rec.mode = 'rest';
    rec.entity.addComponent(OneHandGrabbable, { rotate: true });
    setRestCircle(`glass:${rec.id}`, rec.mesh.position.x, rec.mesh.position.y, rec.mesh.position.z, GLASS_FOOT_R);
    if (animate) {
      glassTap(false); // a soft glass clink as it's set down
      setGlassFill(rec.mesh, 0);
      if (!this.fills.some((p) => p.rec === rec)) this.fills.push({ rec, f: 0 });
    } else {
      setGlassFill(rec.mesh, 1);
    }
  }

  /** On welcome: place every prop where the room already has it. */
  private applyServerState(): void {
    for (const [id, net] of pub.props) {
      const rec = byId.get(id);
      if (!rec) continue;
      // Glasses already out appear instantly FULL for a late joiner — no
      // batch fill animation. Only glasses poured while you're here rise.
      if (net.active && !rec.active) this.activateGlass(rec, false);
      if (!rec.active) continue;
      if (net.pos && net.quat) {
        rec.mesh.position.set(net.pos[0], net.pos[1], net.pos[2]);
        rec.mesh.quaternion.set(net.quat[0], net.quat[1], net.quat[2], net.quat[3]);
      }
      rec.mode = net.holder && net.holder !== pub.myId ? 'remote' : 'rest';
      if (rec.kind === 'glass') {
        if (rec.mode === 'rest') {
          setRestCircle(`glass:${rec.id}`, rec.mesh.position.x, rec.mesh.position.y, rec.mesh.position.z, GLASS_FOOT_R);
        } else {
          clearRestCircle(`glass:${rec.id}`);
        }
      }
    }
  }
}

function scoreForBoard(uv: { x: number; y: number }): { segment: string; score: number } {
  const { score, segment } = scoreFromUV(uv.x, uv.y);
  return { segment, score };
}
