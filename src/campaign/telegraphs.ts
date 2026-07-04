/**
 * Attack telegraphs for the ARCADE titans — the whole "souls-like" readability
 * contract lives here. Every titan strike marks its kill zone ON THE PLAYER'S
 * PLATFORM while it charges: hazard-amber shapes that fill up and shift to
 * danger-red as the strike arrives (the fill IS the countdown). Three shapes:
 *
 *  - CIRCLE  : a fist slam / mortar shell footprint — step out of the disc.
 *  - BEAM    : a strip the eye-beam will rake — sidestep off the line.
 *  - SWEEP   : a horizontal blade slice across the platform at a marked
 *              height — duck under it (a floor band shows it's coming).
 *
 * All shader-driven planes; cheap, additive, no textures.
 */

import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { CAMPAIGN } from '../config.js';

export interface Telegraph {
  /** Position/rotate this; the shapes live inside. */
  group: Group;
  /** fill: 0..1 charge progress; time: seconds for the pulse. */
  update(fill: number, time: number): void;
  dispose(): void;
}

/** Shared vertex shader — pass UVs through. */
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Hazard amber → danger red as the charge completes, pulsing faster. */
const COMMON = /* glsl */ `
  uniform float uFill, uTime;
  varying vec2 vUv;
  vec3 warnColor(){
    return mix(vec3(1.0, 0.69, 0.0), vec3(0.91, 0.21, 0.16), smoothstep(0.55, 0.95, uFill));
  }
  float pulse(){
    float rate = mix(3.0, 14.0, uFill);
    return 0.82 + 0.18 * sin(uTime * rate);
  }
`;

/** Disc: bold rim ring, hazard ticks, a hot centre dot, and a radial fill
 *  that eats outward — LOUD, because this marks where a fist lands. */
const CIRCLE_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    vec3 col = warnColor();
    float a = 0.0;
    // Rim ring.
    a += smoothstep(0.84, 0.9, r) * (1.0 - smoothstep(0.97, 1.0, r)) * 1.0;
    // Rotating hazard ticks just inside the rim.
    float ang = atan(p.y, p.x) + uTime * 1.2;
    float ticks = step(0.5, fract(ang * 3.8195)); // 24 segments
    a += ticks * smoothstep(0.72, 0.78, r) * (1.0 - smoothstep(0.82, 0.84, r)) * 0.6;
    // Hot centre dot — the exact impact point.
    a += (1.0 - smoothstep(0.05, 0.14, r)) * 0.9;
    // Charge disc growing outward from the centre — solid enough to read
    // against a bright passthrough room.
    a += (1.0 - smoothstep(uFill * 0.85, uFill * 0.9, r)) * 0.6;
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/** Strip: edge rails + a fill front that advances down the line (v: 1 → 0). */
const STRIP_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = 0.0;
    // Side rails.
    float edge = min(vUv.x, 1.0 - vUv.x);
    a += (1.0 - smoothstep(0.04, 0.1, edge)) * 0.9;
    // Chevron dashes marching toward the player while it charges.
    float dash = step(0.5, fract(vUv.y * 9.0 + uTime * 2.2));
    a += dash * 0.18;
    // The advance front: fills from the far (titan) end toward you.
    a += step(1.0 - uFill, vUv.y) * 0.34;
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Nova: the whole disc floods with warning EXCEPT one safe wedge, whose
 * edges are drawn as two bright rays — the one telegraph that means
 * "stand HERE". uAngle = wedge centre (radians), uHalf = wedge half-width.
 */
const NOVA_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uAngle, uHalf;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    // World-space angle: the plane is rotated flat, so uv v runs down −z.
    float ang = atan(p.x, -p.y);
    float d = abs(mod(ang - uAngle + 3.14159, 6.28318) - 3.14159);
    float inWedge = step(d, uHalf);
    vec3 col = warnColor();
    float a = 0.0;
    // The flood: everything OUTSIDE the wedge fills and pulses.
    a += (1.0 - inWedge) * (0.16 + 0.5 * uFill);
    // Rim ring all the way round, dimmer through the wedge.
    a += smoothstep(0.9, 0.95, r) * (1.0 - smoothstep(0.98, 1.0, r)) * (1.0 - inWedge * 0.7);
    // The wedge's edge rays — the doorposts of the safe ground.
    float edge = smoothstep(0.06, 0.0, abs(d - uHalf));
    a += edge * 0.9;
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/** Blade: a horizontal slice hanging in the air — bright core line, soft body. */
const BLADE_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float mid = 1.0 - abs(vUv.y * 2.0 - 1.0); // 1 at the slice centre line
    float a = pow(mid, 3.0) * 0.75 + mid * 0.12;
    // Fill sweeps across the width as the swing charges.
    a *= 0.35 + 0.65 * step(vUv.x, uFill);
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

function warnMat(frag: string, extra: Record<string, { value: number }> = {}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uFill: { value: 0 }, uTime: { value: 0 }, ...extra },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

function makeTelegraph(meshes: Mesh[], mats: ShaderMaterial[]): Telegraph {
  const group = new Group();
  for (const m of meshes) {
    // Draw after the deck furniture — a warning that loses the depth fight
    // to a rim bolt is a warning nobody saw.
    m.renderOrder = 20;
    group.add(m);
  }
  return {
    group,
    update(fill, time) {
      for (const mat of mats) {
        mat.uniforms.uFill.value = fill;
        mat.uniforms.uTime.value = time;
      }
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const mat of mats) mat.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * GOLIATH's nova: a platform-covering disc where everything floods with
 * warning EXCEPT the safe wedge centred on `angle` (world radians, atan2(x,z)
 * around the platform centre), `halfAngle` wide each side. Place the group
 * at the platform centre on the floor.
 */
export function novaTelegraph(radius: number, angle: number, halfAngle: number): Telegraph {
  const mat = warnMat(NOVA_FRAG, { uAngle: { value: angle }, uHalf: { value: halfAngle } });
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/** A slam / mortar footprint. Place the group at the zone centre, y≈floor. */
export function circleTelegraph(radius: number): Telegraph {
  const mat = warnMat(CIRCLE_FRAG);
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/**
 * A beam strip `length` long and `2*halfWidth` wide, flat on the floor,
 * running along the group's local −Z (v=1 is the far end, where the fill
 * front starts). Place the group at the NEAR end centre and yaw it.
 */
export function beamTelegraph(halfWidth: number, length: number): Telegraph {
  const mat = warnMat(STRIP_FRAG);
  const strip = new Mesh(new PlaneGeometry(halfWidth * 2, length), mat);
  strip.rotation.x = -Math.PI / 2; // plane +v now points down local −Z
  strip.position.z = -length / 2;
  return makeTelegraph([strip], [mat]);
}

/**
 * A horizontal sweep slice: a glowing blade plane hanging at the strike
 * height `bladeY` (duck under it!) plus a dimmer band on the floor beneath so
 * the platform itself carries the warning. Place the group at the platform
 * centre on the floor; `width` spans the endangered lane, `depth` the floor
 * band's front-to-back reach.
 */
export function sweepTelegraph(width: number, depth: number, bladeY: number, thickness: number): Telegraph {
  const bladeMat = warnMat(BLADE_FRAG);
  const blade = new Mesh(new PlaneGeometry(width, thickness * 2), bladeMat);
  blade.position.y = bladeY;
  const bandMat = warnMat(BLADE_FRAG);
  const band = new Mesh(new PlaneGeometry(width, depth), bandMat);
  band.rotation.x = -Math.PI / 2;
  band.position.y = CAMPAIGN.decalY;
  return makeTelegraph([blade, band], [bladeMat, bandMat]);
}
