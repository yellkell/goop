/**
 * A tiny shared registry of "resting footprint" circles, so two otherwise
 * independent systems can keep their props from overlapping without
 * importing each other.
 *
 * CoinSystem and PropSystem (pint glasses) each own their props' positions
 * privately — neither can see the other's state. Coins already avoid
 * overlapping OTHER coins (and glasses avoid stacking into other glasses)
 * using their own live data directly; what they CAN'T see is the other
 * system's resting items. So each system registers its own resting props
 * here (namespaced `coin:<id>` / `glass:<id>`) purely for the OTHER system to
 * read, and queries the registry filtered to the other's prefix when it
 * settles something of its own. Same-kind overlap stays handled by each
 * system's own direct, always-fresh iteration — this registry only closes
 * the cross-kind gap.
 */

export interface RestCircle {
  /** Unique id, namespaced by kind, e.g. 'coin:p3:7' or 'glass:4'. */
  id: string;
  x: number;
  y: number;
  z: number;
  /** Horizontal footprint radius (metres). */
  r: number;
}

const circles = new Map<string, RestCircle>();

/** Register (or move) a resting circle. Call again on every reposition. */
export function setRestCircle(id: string, x: number, y: number, z: number, r: number): void {
  circles.set(id, { id, x, y, z, r });
}

/** Remove a circle — call the moment its prop stops resting (grabbed, thrown,
 *  picked up, consumed). A stale entry would wrongly block later props. */
export function clearRestCircle(id: string): void {
  circles.delete(id);
}

/** Every registered circle whose id starts with `prefix` (e.g. 'glass:'). */
export function restCirclesByPrefix(prefix: string): RestCircle[] {
  const out: RestCircle[] = [];
  for (const c of circles.values()) if (c.id.startsWith(prefix)) out.push(c);
  return out;
}

const MAX_PUSH_ITERS = 6;
const PUSH_MARGIN = 0.004; // small clearance so circles don't sit edge-to-edge (z-fighting)

/**
 * Push (x0,z0) out of any overlapping circle in `obstacles`, iterating a few
 * times so a chain of close neighbours all get cleared (push out of one,
 * re-check, push out of the next). `recomputeY`, if given, re-derives the
 * resting height after each nudge — a horizontal push can land the point over
 * a different surface (or off the edge, onto the floor); pass null to keep
 * y fixed. Returns the resolved {x, y, z} — best-effort after MAX_PUSH_ITERS,
 * so a very crowded surface may still end with a little residual overlap
 * rather than searching forever.
 */
export function resolveOverlap(
  x0: number,
  y0: number,
  z0: number,
  r: number,
  obstacles: RestCircle[],
  recomputeY: ((x: number, z: number, fromY: number) => number) | null,
): { x: number; y: number; z: number } {
  let x = x0;
  let y = y0;
  let z = z0;
  for (let iter = 0; iter < MAX_PUSH_ITERS; iter++) {
    if (recomputeY) y = recomputeY(x, z, y);
    let pushedAny = false;
    for (const o of obstacles) {
      if (Math.abs(o.y - y) > 0.05) continue; // a different level — not a collider here
      const dx = x - o.x;
      const dz = z - o.z;
      const minDist = r + o.r + PUSH_MARGIN;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDist * minDist) continue;
      const dist = Math.sqrt(distSq);
      let nx: number;
      let nz: number;
      if (dist < 1e-4) {
        // Exact same spot — a deterministic angle (hashed from the obstacle's
        // id) so the nudge direction doesn't jitter frame to frame.
        const angle = hashAngle(o.id) * Math.PI * 2;
        nx = Math.cos(angle);
        nz = Math.sin(angle);
      } else {
        nx = dx / dist;
        nz = dz / dist;
      }
      x = o.x + nx * minDist;
      z = o.z + nz * minDist;
      pushedAny = true;
      break; // resolve one collision, then re-scan from the top with the new spot
    }
    if (!pushedAny) break;
  }
  if (recomputeY) y = recomputeY(x, z, y);
  return { x, y, z };
}

function hashAngle(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 360) / 360;
}
