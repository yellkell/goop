/**
 * Seat-relative arena layout — the bridge that lets one shared MODE_LAYOUT be
 * rendered correctly from any player's seat.
 *
 * Every client always sees ITSELF at local index 0, standing at the world
 * origin facing -Z, exactly like the classic duel. MODE_LAYOUT is the CANONICAL
 * arrangement everyone agrees on; matchmaking hands each player a canonical seat
 * (`app.mySlot`). `localLayout()` re-expresses the canonical roster in MY frame:
 * me at index 0, the other fighters transformed onto their platforms as seen
 * from my seat, with teams relabelled so my team is 0. For `app.mySlot === 0`
 * (bot bouts, the duel, the mesh host) it returns the canonical roster
 * unchanged, so nothing about a bot bout or 1v1 shifts.
 *
 * `peerPos` / `peerQuat` map a remote player's pose — sent in THEIR own local
 * frame (they are at their origin too) — into my world. For the 1v1 seats this
 * reduces to exactly the old mirror (x,y,z) → (-x, y, -z - ARENA_GAP).
 */

import { Quaternion, Vector3 } from 'three';
import { app } from '../menu/appState.js';
import { MODE_LAYOUT, modeTeams, type FighterSlot } from '../config.js';

/** Local roster entry: canonical seat it came from, plus my-frame transform. */
export interface LocalSlot extends FighterSlot {
  /** Canonical seat (index into MODE_LAYOUT) this fighter occupies. */
  canonical: number;
}

const _q = new Quaternion();

/** Rotate (x,z) by `yaw` about +Y in place into out (y passed through). */
function rotY(out: Vector3, x: number, y: number, z: number, yaw: number): Vector3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // +Y rotation: x' = x·cos + z·sin, z' = -x·sin + z·cos.
  return out.set(x * c + z * s, y, -x * s + z * c);
}

let cacheKey = '';
let cached: LocalSlot[] = MODE_LAYOUT['1v1'].map((s, i) => ({ ...s, canonical: i }));

/** The active mode's roster expressed in MY frame (me at index 0). */
export function localLayout(): LocalSlot[] {
  const key = `${app.arcade}:${app.mySlot}`;
  if (key === cacheKey) return cached;
  cacheKey = key;
  cached = computeLocalLayout();
  return cached;
}

function computeLocalLayout(): LocalSlot[] {
  const canonical = MODE_LAYOUT[app.arcade];
  // Clamp a seat the mode doesn't have to 0 — a mode switch (raid arc → 1v1
  // lobby) can momentarily leave mySlot pointing past the new layout, and
  // indexing off the end here used to THROW mid-frame (the raid-end crash).
  const s = canonical[app.mySlot] ? app.mySlot : 0;
  const binary = modeTeams(app.arcade).length === 2;

  // Local ordering: me first, then the others in canonical order.
  const order = [s, ...canonical.map((_, c) => c).filter((c) => c !== s)];
  const posS = canonical[s]?.pos ?? [0, 0, 0];
  const yawS = canonical[s]?.yaw ?? 0;
  const myTeam = canonical[s]?.team ?? 0;

  const out = new Vector3();
  return order.map((c, localIndex) => {
    const seat = canonical[c];
    // canonical pos → my local frame: rotate (pos - posS) by -yawS.
    rotY(out, seat.pos[0] - posS[0], seat.pos[1] - posS[1], seat.pos[2] - posS[2], -yawS);
    const team = c === s ? 0 : binary ? (seat.team === myTeam ? 0 : 1) : localIndex;
    return { pos: [out.x, out.y, out.z], yaw: seat.yaw - yawS, team, canonical: c };
  });
}

/** Map a canonical seat to my local fighter index (0 = me), or -1 if absent. */
export function localIndexOf(canonical: number): number {
  return localLayout().findIndex((s) => s.canonical === canonical);
}

// --- remote pose transforms (their local frame → my world) ------------------

/**
 * A peer at canonical seat `peerSeat` sent pose (x,y,z) in their own local
 * frame; place it in my world. Derivation: their-local → canonical (T(pos_p)·
 * R(yaw_p)) → my-local (R(-yaw_s)·(· - pos_s)).
 */
export function peerPos(out: Vector3, peerSeat: number, x: number, y: number, z: number): Vector3 {
  const canonical = MODE_LAYOUT[app.arcade];
  const s = app.mySlot;
  const me = canonical[s] ?? { pos: [0, 0, 0], yaw: 0, team: 0 };
  const peer = canonical[peerSeat] ?? me;
  // R(yaw_p) · their_local
  rotY(out, x, y, z, peer.yaw);
  // + (pos_p - pos_s)
  out.x += peer.pos[0] - me.pos[0];
  out.y += peer.pos[1] - me.pos[1];
  out.z += peer.pos[2] - me.pos[2];
  // R(-yaw_s) ·
  return rotY(out, out.x, out.y, out.z, -me.yaw);
}

/**
 * MY-world point → a peer seat's LOCAL frame — the exact inverse of peerPos.
 * (The raid host aims titan strikes in the TARGET's frame; a remote target's
 * head arrives in my world off the pose bus and gets pulled back through
 * this before it rides the wire.)
 */
export function worldToPeer(out: Vector3, peerSeat: number, x: number, y: number, z: number): Vector3 {
  const canonical = MODE_LAYOUT[app.arcade];
  const s = app.mySlot;
  const me = canonical[s] ?? { pos: [0, 0, 0], yaw: 0, team: 0 };
  const peer = canonical[peerSeat] ?? me;
  // R(yaw_s) · w
  rotY(out, x, y, z, me.yaw);
  // + (pos_s - pos_p)
  out.x += me.pos[0] - peer.pos[0];
  out.y += me.pos[1] - peer.pos[1];
  out.z += me.pos[2] - peer.pos[2];
  // R(-yaw_p) ·
  return rotY(out, out.x, out.y, out.z, -peer.yaw);
}

/** Their-local velocity/direction → my world (rotation only, no translation). */
export function peerVel(out: Vector3, peerSeat: number, x: number, y: number, z: number): Vector3 {
  const canonical = MODE_LAYOUT[app.arcade];
  const me = canonical[app.mySlot] ?? { yaw: 0 };
  const peer = canonical[peerSeat] ?? me;
  rotY(out, x, y, z, peer.yaw);
  return rotY(out, out.x, out.y, out.z, -me.yaw);
}

/** Their-local orientation → my world: pre-rotate by (yaw_p - yaw_s) about Y. */
export function peerQuat(out: Quaternion, peerSeat: number, x: number, y: number, z: number, w: number): Quaternion {
  const canonical = MODE_LAYOUT[app.arcade];
  const me = canonical[app.mySlot] ?? { yaw: 0 };
  const peer = canonical[peerSeat] ?? me;
  out.set(x, y, z, w);
  _q.setFromAxisAngle(UP, peer.yaw - me.yaw);
  return out.premultiply(_q);
}

const UP = new Vector3(0, 1, 0);
