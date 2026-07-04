/**
 * Goo mess — the transient evidence of violence, all pooled, all cheap:
 *
 *  - SPLATS: flat radial-gradient discs stamped on the real floor where lumps
 *    land; they spread out and fade over a couple of seconds.
 *  - DROPLETS: a single THREE.Points cloud of tiny glowing beads burst from
 *    punch impacts, integrated on the CPU with gravity, dying on the floor.
 *
 * Everything is world-space and owned by the scene, not the creature — goo
 * that has left the body stays where physics put it.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';

const MAX_SPLATS = 14;
const MAX_DROPS = 96;
const DROP_LIFE = 0.85;

function splatTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(84, 214, 100, 0.85)');
  grad.addColorStop(0.55, 'rgba(46, 150, 62, 0.5)');
  grad.addColorStop(1, 'rgba(30, 110, 46, 0)');
  g.fillStyle = grad;
  // A blobby, non-circular splat: main disc + a few satellite dabs.
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.7;
    const rr = 38 + (i % 3) * 12;
    const x = 64 + Math.cos(a) * rr;
    const y = 64 + Math.sin(a) * rr;
    const dab = g.createRadialGradient(x, y, 1, x, y, 12 + (i % 4) * 4);
    dab.addColorStop(0, 'rgba(70, 190, 88, 0.6)');
    dab.addColorStop(1, 'rgba(70, 190, 88, 0)');
    g.fillStyle = dab;
    g.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(c);
}

interface Splat {
  mesh: Mesh;
  age: number;
  life: number;
  size: number;
  active: boolean;
}

export class GooFx {
  readonly group = new Group();

  private splats: Splat[] = [];
  private splatIndex = 0;

  private drops: Points;
  private dropPos: Float32Array;
  private dropVel: Float32Array;
  private dropAge: Float32Array;
  private dropGeo: BufferGeometry;
  private dropCursor = 0;

  constructor() {
    this.group.name = 'goo-fx';

    const tex = splatTexture();
    const geo = new PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_SPLATS; i++) {
      const mat = new MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const mesh = new Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.random() * Math.PI * 2;
      mesh.visible = false;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.splats.push({ mesh, age: 0, life: 2.6, size: 0.3, active: false });
    }

    this.dropPos = new Float32Array(MAX_DROPS * 3);
    this.dropVel = new Float32Array(MAX_DROPS * 3);
    this.dropAge = new Float32Array(MAX_DROPS).fill(DROP_LIFE + 1);
    this.dropGeo = new BufferGeometry();
    this.dropGeo.setAttribute('position', new BufferAttribute(this.dropPos, 3));
    const dropMat = new PointsMaterial({
      color: 0x6fe07c,
      size: 0.028,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    this.drops = new Points(this.dropGeo, dropMat);
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 3;
    this.group.add(this.drops);
  }

  /** Stamp a floor splat at a world position. */
  splat(worldPos: Vector3, size: number): void {
    const s = this.splats[this.splatIndex % MAX_SPLATS];
    this.splatIndex++;
    s.active = true;
    s.age = 0;
    s.size = size;
    s.mesh.visible = true;
    s.mesh.position.set(worldPos.x, 0.005 + (this.splatIndex % 5) * 0.0012, worldPos.z);
    s.mesh.rotation.z = Math.random() * Math.PI * 2;
  }

  /** Burst droplets from a punch impact, biased along the punch direction. */
  burst(worldPos: Vector3, dir: Vector3, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const j = this.dropCursor % MAX_DROPS;
      this.dropCursor++;
      const o = j * 3;
      this.dropPos[o] = worldPos.x;
      this.dropPos[o + 1] = worldPos.y;
      this.dropPos[o + 2] = worldPos.z;
      this.dropVel[o] = dir.x * speed * 0.4 + (Math.random() - 0.5) * 1.6;
      this.dropVel[o + 1] = Math.abs(dir.y * speed * 0.2) + 0.6 + Math.random() * 1.4;
      this.dropVel[o + 2] = dir.z * speed * 0.4 + (Math.random() - 0.5) * 1.6;
      this.dropAge[j] = 0;
    }
  }

  update(dt: number): void {
    for (const s of this.splats) {
      if (!s.active) continue;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const grow = s.size * (0.7 + 0.5 * Math.min(1, t * 4));
      s.mesh.scale.set(grow, grow, grow);
      (s.mesh.material as MeshBasicMaterial).opacity = 0.85 * (1 - t * t);
    }

    let any = false;
    for (let j = 0; j < MAX_DROPS; j++) {
      if (this.dropAge[j] > DROP_LIFE) continue;
      any = true;
      this.dropAge[j] += dt;
      const o = j * 3;
      this.dropVel[o + 1] -= 9.8 * dt;
      this.dropPos[o] += this.dropVel[o] * dt;
      this.dropPos[o + 1] += this.dropVel[o + 1] * dt;
      this.dropPos[o + 2] += this.dropVel[o + 2] * dt;
      if (this.dropPos[o + 1] < 0.01) {
        this.dropAge[j] = DROP_LIFE + 1; // died on the floor
        this.dropPos[o + 1] = -10; // park it out of sight
      }
    }
    if (any) (this.dropGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
}
