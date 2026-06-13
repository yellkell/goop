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

import { createSystem, Grabbed, OneHandGrabbable, type Entity, type World } from '@iwsdk/core';
import { Group, Quaternion, Raycaster, Vector3 } from 'three';
import { deflect, throwWhoosh, wallThud } from '../../audio/sfx.js';
import { GLASS, PROP_PHYS, PUB, SURFACES } from '../config.js';
import { pubSendRaw } from '../net.js';
import type { PropKind, QuatT, Vec3T } from '../protocol.js';
import { buildDart, buildPintGlass, fadeOpacity, restoreOpacity, setGlassFill } from '../props.js';
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
}

const UP = new Vector3(0, 1, 0);
const INTO_BOARD = new Vector3(1, 0, 0); // east wall: darts embed pointing +x

const raycaster = new Raycaster();
const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();

const recs: PropRec[] = [];
const byId = new Map<number, PropRec>();

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
      // Standing tip-down in the box, flights up, each leaning a touch its
      // own way so the bundle reads as loose darts rather than soldiers.
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
  // Inactive glasses stay VISIBLE — empties stocked under the counter —
  // just ungrabbable until the barkeep brings them out.
  mesh.visible = active || kind === 'glass';
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
        rec.mode = 'remote';
      }),
      bus.on('propSettled', ({ id, pos, quat }) => {
        const rec = byId.get(id);
        if (!rec) return;
        if (rec.mode === 'held' || rec.mode === 'flight' || rec.mode === 'stuck') {
          // Our optimistic local sim was overruled (rare) — server wins.
        }
        rec.mode = 'rest';
        rec.hasNetTarget = false;
        rec.mesh.position.set(pos[0], pos[1], pos[2]);
        rec.mesh.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
        restoreOpacity(rec.mesh);
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

    for (const rec of recs) {
      switch (rec.mode) {
        case 'held':
          this.sampleRing(rec);
          this.stream(rec, delta);
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
    restoreOpacity(rec.mesh);
    rec.mode = 'held';
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
      deflect();
    }
    if (p.z > wz || p.z < -wz) {
      p.z = Math.max(-wz, Math.min(wz, p.z));
      rec.vel.z *= -PROP_PHYS.restitution;
      deflect();
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
        deflect();
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

    // Stack: snap onto the topmost resting glass under us within reach.
    let bestTop: number | null = null;
    for (const other of recs) {
      if (other === rec || other.kind !== 'glass') continue;
      if (other.mode !== 'rest' && other.mode !== 'remote') continue;
      const op = other.mesh.position;
      const dx = op.x - p.x;
      const dz = op.z - p.z;
      if (dx * dx + dz * dz > GLASS.stackSnap * GLASS.stackSnap) continue;
      const top = op.y + GLASS.stackRise;
      if (Math.abs(p.y - top) < 0.16 && (bestTop === null || top > bestTop)) {
        bestTop = top;
        p.x = op.x;
        p.z = op.z;
      }
    }
    if (bestTop !== null) p.y = bestTop;

    rec.mode = 'rest';
    rec.vel.set(0, 0, 0);
    this.sendSettle(rec);
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
      deflect();
      this.sendSettle(rec);
    }
  }

  private stickDart(rec: PropRec, point: Vector3, surface: string, uv: { x: number; y: number } | null): void {
    rec.mesh.position.copy(point);
    rec.mesh.quaternion.setFromUnitVectors(UP, INTO_BOARD);
    rec.mesh.position.x -= 0.02; // tip buried, flight proud of the board
    rec.stuckTimer = 0;
    rec.fadeTimer = 0;
    rec.mode = 'stuck';
    wallThud();
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
    if (animate) {
      deflect(); // a little glass clink as it's set down
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
    }
  }
}

function scoreForBoard(uv: { x: number; y: number }): { segment: string; score: number } {
  const { score, segment } = scoreFromUV(uv.x, uv.y);
  return { segment, score };
}
