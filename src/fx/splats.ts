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
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';

const MAX_SPLATS = 14;
const MAX_DROPS = 96;
const DROP_LIFE = 0.85;
const MAX_FLASHES = 12;
const FLASH_LIFE = 0.36;

/** Soft radial dot for impact/block flashes. */
function flashTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

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
  private dropAlpha: Float32Array;
  private dropGeo: BufferGeometry;
  private dropCursor = 0;

  private flashes: Sprite[] = [];
  private flashAge: number[] = [];
  private flashSize: number[] = [];
  private flashCursor = 0;

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
    this.dropAlpha = new Float32Array(MAX_DROPS); // 0 = dead → clipped offscreen
    this.dropGeo = new BufferGeometry();
    this.dropGeo.setAttribute('position', new BufferAttribute(this.dropPos, 3));
    this.dropGeo.setAttribute('aAlpha', new BufferAttribute(this.dropAlpha, 1));
    // Custom point shader: a dead point (aAlpha <= 0) is pushed outside the
    // clip volume so it draws NOTHING — no more green specks parked under the
    // floor. Living points fade with their alpha and attenuate with distance.
    const dropMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uSize: { value: 14 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vAlpha;
        uniform float uSize;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize / max(-mv.z, 0.05);
          if (aAlpha <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // clipped
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          if (r > 0.5) discard;
          float a = vAlpha * (1.0 - smoothstep(0.28, 0.5, r));
          gl_FragColor = vec4(0.44, 0.88, 0.48, a);
        }
      `,
    });
    this.drops = new Points(this.dropGeo, dropMat);
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 3;
    this.group.add(this.drops);

    // Impact / block flashes — camera-facing sprites, so no billboard math.
    const flashTex = flashTexture();
    for (let i = 0; i < MAX_FLASHES; i++) {
      const mat = new SpriteMaterial({
        map: flashTex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        opacity: 0,
      });
      const sp = new Sprite(mat);
      sp.visible = false;
      sp.renderOrder = 20;
      this.group.add(sp);
      this.flashes.push(sp);
      this.flashAge.push(FLASH_LIFE + 1);
      this.flashSize.push(0.3);
    }
  }

  /** A burst of light at a world point — his fist connecting, or your
   *  glove stopping it. `color` is 0xRRGGBB, `size` the world radius. */
  flash(worldPos: Vector3, color: number, size: number): void {
    const i = this.flashCursor % MAX_FLASHES;
    this.flashCursor++;
    const sp = this.flashes[i];
    sp.position.copy(worldPos);
    (sp.material as SpriteMaterial).color = new Color(color);
    sp.visible = true;
    this.flashAge[i] = 0;
    this.flashSize[i] = size;
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
      this.dropAlpha[j] = 1;
    }
    (this.dropGeo.getAttribute('aAlpha') as BufferAttribute).needsUpdate = true;
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
      // Fade over life; die (alpha 0 → vertex clipped, draws nothing) on the
      // floor or when spent. No more parking specks below the world.
      this.dropAlpha[j] = Math.max(0, 1 - this.dropAge[j] / DROP_LIFE);
      if (this.dropPos[o + 1] < 0.01 || this.dropAge[j] >= DROP_LIFE) {
        this.dropAge[j] = DROP_LIFE + 1;
        this.dropAlpha[j] = 0;
      }
    }
    if (any) {
      (this.dropGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
      (this.dropGeo.getAttribute('aAlpha') as BufferAttribute).needsUpdate = true;
    }

    for (let i = 0; i < MAX_FLASHES; i++) {
      if (this.flashAge[i] > FLASH_LIFE) continue;
      this.flashAge[i] += dt;
      const t = this.flashAge[i] / FLASH_LIFE;
      if (t >= 1) {
        this.flashes[i].visible = false;
        continue;
      }
      const sp = this.flashes[i];
      const s = this.flashSize[i] * (0.6 + 0.8 * t); // pops outward
      sp.scale.set(s, s, s);
      (sp.material as SpriteMaterial).opacity = (1 - t) * (1 - t);
    }
  }
}
