/**
 * The fire. Ported from the FlamethrowerXR demo and reshaped into a reusable
 * fireball: a molten shader core (simplex-noise flames licking upward), an
 * additive corona that ripples and flickers, and shared GPU particle pools for
 * embers and comet trails. Everything is procedural — no textures, no lights —
 * so four roaring fireballs stay cheap in stereo on a headset.
 *
 * Each ball is tintable per team: your fire burns orange, theirs burns blue
 * (`uCool` mixes the two colour ramps in-shader).
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import { FIREBALL } from '../config.js';

/** 3D simplex noise (Ken Perlin's optimised variant) + 5-octave fbm. */
const NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  float fbm(vec3 p){ float a=0.0,w=0.5; for(int i=0;i<5;i++){ a+=w*snoise(p); p*=2.02; w*=0.5;} return a; }
`;

/** Molten core: noise-driven heat with a 4-stop ramp, orange↔blue by uCool. */
const CORE_FRAG = /* glsl */ `
  uniform float uTime, uHeat, uCool;
  varying vec3 vPos;
  ${NOISE_GLSL}
  void main(){
    vec3 q = vPos * 5.0 / ${FIREBALL.radius.toFixed(3)} * 0.1;
    q.y -= uTime * 1.6;                 // flames lick upward
    float heat = clamp((fbm(q) * 0.5 + 0.65) * uHeat, 0.0, 1.7);
    // Orange ramp: glowing floor → white-hot peaks.
    vec3 warm = vec3(1.0, 0.32, 0.03);
    warm = mix(warm, vec3(1.0, 0.55, 0.08), smoothstep(0.45, 0.85, heat));
    warm = mix(warm, vec3(1.0, 0.80, 0.28), smoothstep(0.85, 1.25, heat));
    warm = mix(warm, vec3(1.0, 0.95, 0.65), smoothstep(1.25, 1.65, heat));
    // Blue ramp for the opponent's fire.
    vec3 cool = vec3(0.05, 0.35, 1.0);
    cool = mix(cool, vec3(0.16, 0.55, 1.0), smoothstep(0.45, 0.85, heat));
    cool = mix(cool, vec3(0.38, 0.78, 1.0), smoothstep(0.85, 1.25, heat));
    cool = mix(cool, vec3(0.75, 0.95, 1.0), smoothstep(1.25, 1.65, heat));
    vec3 col = mix(warm, cool, uCool);
    // Exposure: dark smouldering iron before ignition, full blaze once lit.
    float expo = smoothstep(0.15, 0.7, uHeat);
    gl_FragColor = vec4(col * 1.95 * mix(0.12, 1.0, expo), 1.0);
  }
`;

const CORE_VERT = /* glsl */ `
  varying vec3 vPos;
  void main(){ vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Additive corona: rippled rim + white-hot kiss at the centre, flickering. */
const CORONA_FRAG = /* glsl */ `
  uniform float uTime, uHeat, uCool;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    p.y -= 0.08;                        // reaches a touch higher than it hangs
    float r = length(p);
    if (r > 1.0) discard;
    float ang = atan(p.y, p.x);
    float ripple = fbm(vec3(cos(ang), sin(ang), uTime * 0.7) * 1.4);
    float maxR = 0.62 + ripple * 0.22;
    float fall = pow(clamp(1.0 - r / maxR, 0.0, 1.0), 1.6);
    float glow = fall * uHeat;
    glow += pow(max(1.0 - r * 2.4, 0.0), 2.0) * 0.9; // white-hot centre kiss
    vec3 warm = mix(vec3(1.0, 0.36, 0.04), vec3(1.0, 0.82, 0.40), pow(fall, 2.0));
    vec3 cool = mix(vec3(0.10, 0.45, 1.0), vec3(0.55, 0.85, 1.0), pow(fall, 2.0));
    vec3 col = mix(warm, cool, uCool);
    float flick = 0.9 + 0.1 * sin(uTime * 16.0);
    gl_FragColor = vec4(col * glow * flick, min(glow, 1.2));
  }
`;

const CORONA_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** A live fireball visual: position the group, call update() every frame. */
export interface FireVisual {
  group: Group;
  /** time = seconds, heat = 0..1.7, cameraQuat billboards the corona. */
  update(time: number, heat: number, cameraQuat: Quaternion): void;
  dispose(): void;
}

const CORE_GEO = new IcosahedronGeometry(FIREBALL.radius, 3);
const CORONA_GEO = new PlaneGeometry(FIREBALL.radius * 6, FIREBALL.radius * 6);

/** Build a fireball: molten core + billboarded corona. team 1 burns blue. */
export function createFireVisual(team: 0 | 1): FireVisual {
  const cool = team === 1 ? 1 : 0;

  const coreMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0.8 }, uCool: { value: cool } },
    vertexShader: CORE_VERT,
    fragmentShader: CORE_FRAG,
    transparent: true,
    depthWrite: true,
  });
  const core = new Mesh(CORE_GEO, coreMat);
  core.renderOrder = 1;

  const coronaMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0.8 }, uCool: { value: cool } },
    vertexShader: CORONA_VERT,
    fragmentShader: CORONA_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const corona = new Mesh(CORONA_GEO, coronaMat);
  corona.renderOrder = 2;

  const group = new Group();
  group.add(core, corona);

  return {
    group,
    update(time, heat, cameraQuat) {
      coreMat.uniforms.uTime.value = time;
      coreMat.uniforms.uHeat.value = heat;
      coronaMat.uniforms.uTime.value = time;
      coronaMat.uniforms.uHeat.value = heat;
      corona.quaternion.copy(group.quaternion).invert().multiply(cameraQuat);
    },
    dispose() {
      coreMat.dispose();
      coronaMat.dispose();
      group.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------------------
// Particle pools — embers and trails, shared by every fireball in the scene.
// ---------------------------------------------------------------------------

interface PoolOpts {
  maxPx?: number;
  lifeExp?: number;
}

/** Ring-buffer GPU point pool: spawn() writes a slot, update() integrates. */
class ParticlePool {
  readonly points: Points;
  private readonly geo: BufferGeometry;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private cursor = 0;

  constructor(private readonly max: number, opts: PoolOpts = {}) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);

    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('aLife', new BufferAttribute(this.life, 1));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1));

    const mat = new ShaderMaterial({
      uniforms: { uScale: { value: 480 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec3 aColor; attribute float aLife; attribute float aSize;
        varying vec3 vColor; varying float vLife;
        void main(){ vColor=aColor; vLife=aLife;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(aSize * (uScale / -mv.z), 1.0, ${(opts.maxPx ?? 60).toFixed(1)});
          gl_Position = projectionMatrix * mv; }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vLife;
        void main(){ if(vLife<=0.0) discard;
          vec2 d = gl_PointCoord - 0.5; float r = length(d);
          if(r>0.5) discard;
          float a = smoothstep(0.5,0.0,r) * pow(vLife, ${(opts.lifeExp ?? 1).toFixed(1)});
          gl_FragColor = vec4(vColor * (0.7 + vLife*0.6), a); }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(
    p: Vector3,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
    life: number, size: number, grav: number,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = 1;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grav[i] = grav;
  }

  update(dt: number): void {
    const drag = Math.max(0, 1 - 0.5 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.life[i] = Math.max(0, this.life[i] - dt / this.maxLife[i]);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

let emberPool: ParticlePool | undefined;
let trailPool: ParticlePool | undefined;
const _c = new Color();

/** Create the shared pools and add them to the scene. Call once at boot. */
export function initFirePools(scene: Scene): void {
  if (emberPool) return;
  emberPool = new ParticlePool(1024);
  trailPool = new ParticlePool(2048, { maxPx: 800, lifeExp: 2.2 });
  scene.add(emberPool.points, trailPool.points);
}

/** Integrate all live particles. Call once per frame (FXSystem does). */
export function updateFirePools(dt: number): void {
  emberPool?.update(dt);
  trailPool?.update(dt);
}

/** A drifting spark. cool=true gives the opponent's blue fire. */
export function spawnEmber(pos: Vector3, up = 0.4, cool = false): void {
  if (!emberPool) return;
  const hue = cool ? 0.55 + Math.random() * 0.07 : 0.04 + Math.random() * 0.06;
  _c.setHSL(hue, 1.0, 0.5 + Math.random() * 0.08);
  emberPool.spawn(
    pos,
    (Math.random() - 0.5) * 0.7,
    up + Math.random() * 0.7,
    (Math.random() - 0.5) * 0.7,
    _c.r, _c.g, _c.b,
    0.9 + Math.random() * 1.3,
    0.018 + Math.random() * 0.03,
    2.2,
  );
}

/** A shower of sparks (impacts, parries, knockouts). */
export function emberBurst(pos: Vector3, count: number, cool = false): void {
  for (let i = 0; i < count; i++) spawnEmber(pos, 0.8 + Math.random() * 1.4, cool);
}

/**
 * A comet-tail stamp behind a flying ball — the THICK FlamethrowerXR trail:
 * a fat, hot core slug plus a lingering wisp that drifts up off the path.
 * Call as the ball moves.
 */
export function stampTrail(pos: Vector3, cool = false): void {
  if (!trailPool) return;
  const hue = cool ? 0.56 + Math.random() * 0.05 : 0.05 + Math.random() * 0.05;

  // The body of the trail: big, bright, short-lived — overlapping stamps
  // fuse into one continuous molten rope.
  _c.setHSL(hue, 1.0, 0.62);
  trailPool.spawn(
    pos,
    (Math.random() - 0.5) * 0.15,
    (Math.random() - 0.5) * 0.15,
    (Math.random() - 0.5) * 0.15,
    _c.r, _c.g, _c.b,
    0.3 + Math.random() * 0.14,
    0.17 + Math.random() * 0.09,
    0.15,
  );

  // The afterglow: smaller, slower, rises and lingers like flame shed off
  // the comet — gives the rope a licking, smoky edge.
  _c.setHSL(hue, 1.0, 0.5);
  trailPool.spawn(
    pos,
    (Math.random() - 0.5) * 0.4,
    (Math.random() - 0.5) * 0.3 + 0.35,
    (Math.random() - 0.5) * 0.4,
    _c.r, _c.g, _c.b,
    0.55 + Math.random() * 0.3,
    0.07 + Math.random() * 0.05,
    0.5,
  );
}
