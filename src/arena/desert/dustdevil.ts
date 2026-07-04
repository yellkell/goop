/**
 * Papercraft dust devils (adapted from yellkell/DOWN2).
 *
 * A devil is a tapering column of little paper scraps — narrow and fast at the
 * base, flaring and lazy at the top. Each horizontal ring of scraps is its own
 * group so the lower rings can whip round faster than the upper ones, giving
 * the whole thing its swirl. The `DustField` owns the lifecycle: it spawns the
 * odd devil, wanders it across the dunes, then scales it away and frees its GPU
 * resources — they come and go endlessly, so they must not leak.
 *
 * Everything lives under the desert's root group, so devils hide and freeze
 * cleanly whenever the player flips back to AR passthrough.
 */

import { type Group as GroupT, Group, Mesh, PlaneGeometry } from 'three';
import { CONFIG } from './config.js';
import { makePaperDouble, makeRng } from './paper.js';
import { desertHeight } from './terrain.js';

const P = CONFIG.palette;

interface Ring {
  group: Group;
  spin: number;
}

interface Devil {
  obj: Group;
  rings: Ring[];
  age: number;
  life: number;
  vx: number;
  vz: number;
  spinDir: number;
  phase: number;
}

/** Build one dust devil: stacked rings of paper flecks, flaring toward the top. */
function makeDevil(rng: () => number): { obj: Group; rings: Ring[] } {
  const obj = new Group();
  const height = 3.4 + rng() * 2.8;
  const ringCount = 9 + ((rng() * 5) | 0);
  const baseR = 0.12 + rng() * 0.1;
  const topR = 0.75 + rng() * 0.6;
  const rings: Ring[] = [];

  for (let i = 0; i < ringCount; i++) {
    const f = i / (ringCount - 1); // 0 at the base, 1 at the top
    const ring = new Group();
    ring.position.y = f * height;
    const r = baseR + Math.pow(f, 0.7) * topR; // flare toward the top

    const flecks = 3 + ((rng() * 4) | 0);
    for (let k = 0; k < flecks; k++) {
      const a = rng() * Math.PI * 2;
      const size = 0.1 + rng() * 0.16 * (0.5 + f);
      const fleck = new Mesh(
        new PlaneGeometry(size, size * (0.6 + rng() * 0.8)),
        makePaperDouble(P.dust[(rng() * P.dust.length) | 0]),
      );
      const rr = r * (0.7 + rng() * 0.5);
      fleck.position.set(Math.cos(a) * rr, (rng() - 0.5) * (height / ringCount), Math.sin(a) * rr);
      fleck.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      ring.add(fleck);
    }
    rings.push({ group: ring, spin: (2.6 - f * 1.6) * (0.8 + rng() * 0.4) });
    obj.add(ring);
  }
  return { obj, rings };
}

/** Free a finished devil's geometries and materials — they spawn endlessly. */
function dispose(root: Group): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
  });
}

export class DustField {
  private readonly rng = makeRng(CONFIG.terrain.seed * 23 + 9);
  private readonly devils: Devil[] = [];
  private nextAt: number = CONFIG.dustDevils.firstAt;

  constructor(private readonly parent: GroupT) {}

  update(delta: number, time: number): void {
    const cfg = CONFIG.dustDevils;
    if (time >= this.nextAt && this.devils.length < cfg.maxActive) {
      this.spawn();
      this.nextAt = time + cfg.intervalMin + this.rng() * (cfg.intervalMax - cfg.intervalMin);
    }

    for (let i = this.devils.length - 1; i >= 0; i--) {
      const d = this.devils[i];
      d.age += delta;
      if (d.age >= d.life) {
        this.parent.remove(d.obj);
        dispose(d.obj);
        this.devils.splice(i, 1);
        continue;
      }

      // Whip the rings around, faster toward the base.
      for (const ring of d.rings) ring.group.rotation.y += ring.spin * d.spinDir * delta;

      // Wander across the dunes, hugging the surface, with a lazy lean.
      const o = d.obj;
      o.position.x += d.vx * delta;
      o.position.z += d.vz * delta;
      o.position.y = desertHeight(o.position.x, o.position.z);
      o.rotation.z = Math.sin(time * 1.3 + d.phase) * 0.07;

      // Spin up out of the ground, hold, then dissipate at the end of life.
      const t = d.age / d.life;
      o.scale.setScalar(Math.max(0, Math.min(1, t / 0.16) * Math.min(1, (1 - t) / 0.16)));
    }
  }

  private spawn(): void {
    const { obj, rings } = makeDevil(this.rng);
    const half = CONFIG.dustDevils.fieldHalf;
    const x = (this.rng() * 2 - 1) * half;
    const z = (this.rng() * 2 - 1) * half;
    obj.position.set(x, desertHeight(x, z), z);
    obj.scale.setScalar(0.001); // grows in from the ground
    this.parent.add(obj);

    const heading = this.rng() * Math.PI * 2;
    const speed = 1.2 + this.rng() * 1.8;
    this.devils.push({
      obj,
      rings,
      age: 0,
      life: 12 + this.rng() * 10,
      vx: Math.cos(heading) * speed,
      vz: Math.sin(heading) * speed,
      spinDir: this.rng() < 0.5 ? 1 : -1,
      phase: this.rng() * Math.PI * 2,
    });
  }
}
