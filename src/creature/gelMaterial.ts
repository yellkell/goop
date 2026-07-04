/**
 * The gel surface — a raymarched signed-distance field drawn inside one box.
 *
 * The sim hands us up to 40 spheres (body blobs, flying lumps, drips) and up
 * to 4 negative "dent" spheres; a polynomial smooth-min fuses them into a
 * single liquid isosurface that the fragment shader sphere-traces per pixel.
 * That is what makes the creature read as ONE organism: lumps don't pop off,
 * they NECK and tear like taffy, and they merge back with a liquid bridge —
 * all emergent from the field, no keyframes.
 *
 * Shading is built for passthrough AR on Quest 3: no scene lights, no
 * textures, everything analytic —
 *   - fresnel rim + procedural sky/floor reflection tint,
 *   - Beer–Lambert absorption from an approximate view-ray thickness
 *     (thin edges glow lime, the deep body goes dark bottle-green),
 *   - an inner "nucleus" field (the same blobs at ~55% radius) sampled
 *     inside the volume for that dense-organ glow in the middle,
 *   - two analytic key/rim speculars with tight + broad lobes,
 *   - trig-noise surface wobble whose amplitude rides the sim's agitation,
 *     so the surface ROILS for a couple of seconds after you hit it.
 *
 * The march is bounded by the blob AABB (passed as centre+half-extents; the
 * unit-cube geometry is inflated to it in the vertex shader), rendered
 * BackSide so it still works with your face inside the goo, and writes
 * gl_FragDepth from the real hit point so fists and eyeballs sort correctly
 * INTO the gel, not against the bounding box.
 */

import { BackSide, Color, Matrix4, ShaderMaterial, Vector3 } from 'three';
import { CREATURE, GEL_LOOK } from '../config.js';
import { MAX_BLOBS, MAX_DENTS } from './sim.js';

const VERT = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec3 uHalf;
  varying vec3 vLocal;

  void main() {
    // Unit cube (±1) inflated to the sim's current AABB, in creature space.
    vLocal = uCenter + position * uHalf;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vLocal, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  // three injects viewMatrix + cameraPosition into fragment shaders already;
  // projectionMatrix/modelMatrix we declare ourselves (fragment stage only).
  uniform mat4 projectionMatrix;
  uniform mat4 modelMatrix;
  uniform mat4 uInvModel;

  uniform vec4 uBlobs[${MAX_BLOBS}];
  uniform int uCount;
  uniform vec4 uDents[${MAX_DENTS}];
  uniform int uDentCount;

  uniform vec3 uCenter;
  uniform vec3 uHalf;
  uniform float uTime;
  uniform float uAgitation;
  uniform float uTelegraph;
  uniform float uBlend;
  uniform float uWobble;
  uniform float uWobbleAgitated;
  uniform int uSteps;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uNucleus;
  uniform vec3 uFlash;

  varying vec3 vLocal;

  // Polynomial smooth-min — identical maths to GoopSim.fieldAt on the CPU.
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  // Cheap organic wobble: one drifting trig wave, no texture fetches.
  float wobble(vec3 p, float amp) {
    return sin(p.x * 7.3 + uTime * 2.1) * sin(p.y * 6.1 - uTime * 1.6) * sin(p.z * 7.9 + uTime * 2.6) * amp;
  }

  // The march field: smooth-min over the blobs, dents carved out, wobble
  // applied only within reach of the surface (transcendentals are the
  // second-biggest per-step cost after the blob loop itself).
  float field(vec3 p) {
    float d = 1e5;
    for (int i = 0; i < ${MAX_BLOBS}; i++) {
      if (i >= uCount) break;
      vec4 b = uBlobs[i];
      float di = length(p - b.xyz) - b.w;
      // Far blobs can't affect the blend — plain min is cheaper and identical.
      d = (di - d > uBlend * 2.0) ? d : smin(d, di, uBlend);
    }
    for (int j = 0; j < ${MAX_DENTS}; j++) {
      if (j >= uDentCount) break;
      vec4 n = uDents[j];
      d = -smin(-d, length(p - n.xyz) - n.w, 0.1);
    }
    if (d < 0.12) {
      d -= wobble(p, mix(uWobble, uWobbleAgitated, uAgitation));
    }
    return d;
  }

  // Interior probe: blobs only, no dents, no wobble — for thickness.
  float fieldCheap(vec3 p) {
    float d = 1e5;
    for (int i = 0; i < ${MAX_BLOBS}; i++) {
      if (i >= uCount) break;
      vec4 b = uBlobs[i];
      float di = length(p - b.xyz) - b.w;
      d = (di - d > uBlend * 2.0) ? d : smin(d, di, uBlend);
    }
    return d;
  }

  // Field + ANALYTIC gradient in one pass — replaces the 4-sample
  // tetrahedral normal (4 full blob loops) with ~1.3 loops. The gradient of
  // a sequential polynomial smooth-min is approximated by blending the
  // per-sphere gradients with the same weights as the distances; the
  // dropped dh terms are visually invisible on a surface this soft.
  float fieldGrad(vec3 p, out vec3 grad) {
    float d = 1e5;
    grad = vec3(0.0, 1.0, 0.0);
    for (int i = 0; i < ${MAX_BLOBS}; i++) {
      if (i >= uCount) break;
      vec4 b = uBlobs[i];
      vec3 diff = p - b.xyz;
      float len = max(length(diff), 1e-5);
      float di = len - b.w;
      if (di - d > uBlend * 2.0) continue;
      float h = clamp(0.5 + 0.5 * (d - di) / uBlend, 0.0, 1.0);
      grad = mix(grad, diff / len, h);
      d = mix(d, di, h) - uBlend * h * (1.0 - h);
    }
    for (int j = 0; j < ${MAX_DENTS}; j++) {
      if (j >= uDentCount) break;
      vec4 n = uDents[j];
      vec3 diff = p - n.xyz;
      float len = max(length(diff), 1e-5);
      float cut = len - n.w;
      // d' = -smin(-d, cut, k): blend toward the dent wall's inward normal.
      float h = clamp(0.5 + 0.5 * (cut + d) / 0.1, 0.0, 1.0);
      vec3 gneg = mix(diff / len, -grad, h);
      float dneg = mix(cut, -d, h) - 0.1 * h * (1.0 - h);
      d = -dneg;
      grad = -gneg;
    }
    grad = normalize(grad);
    return d;
  }

  // Ray vs the bounding AABB, in creature-local space.
  vec2 boxRange(vec3 ro, vec3 rd) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (uCenter - uHalf - ro) * inv;
    vec3 t1 = (uCenter + uHalf - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
  }

  void main() {
    vec3 ro = (uInvModel * vec4(cameraPosition, 1.0)).xyz;
    vec3 rd = normalize(vLocal - ro);

    vec2 range = boxRange(ro, rd);
    float t = max(range.x, 0.0);
    float tEnd = range.y;
    if (tEnd <= t) discard;

    // ---- sphere trace ----
    float d = 0.0;
    bool hit = false;
    vec3 p = ro;
    for (int i = 0; i < 96; i++) {
      if (i >= uSteps) break;
      p = ro + rd * t;
      d = field(p);
      if (d < max(0.0018, t * 0.004)) { hit = true; break; }
      t += d; // full-distance steps; the grazing fallback below forgives overshoot
      if (t > tEnd) break;
    }
    // Step-budget mercy: a ray that spent its steps GRAZING the surface
    // (thin necks under an extended fist, clefts in a crouched body) is on
    // the gel for all visual purposes — shading it kills the see-through
    // holes that a hard discard punches through thin features.
    if (!hit && d < 0.045 && t <= tEnd) hit = true;
    if (!hit) discard;

    vec3 n;
    fieldGrad(p, n);
    vec3 v = -rd;
    float ndv = max(dot(n, v), 0.0);
    float fresnel = pow(1.0 - ndv, 3.0);

    // ---- approximate thickness along the view ray ----
    // Two soft density samples (not binary inside/outside) keep the alpha
    // and absorption ramps continuous — no onion-ring banding at the rim.
    float thick = 0.0;
    {
      float f1 = fieldCheap(p + rd * 0.13);
      float f2 = fieldCheap(p + rd * 0.32);
      thick += clamp(-f1 / 0.09, 0.0, 1.0) * 0.5;
      thick += clamp(-f2 / 0.09, 0.0, 1.0) * 0.5;
    }
    float thickN = clamp(thick, 0.0, 1.0);

    // ---- nucleus glow: the deep body shimmers (derived from thickness —
    // a separate inner-field loop is a luxury Quest can't afford) ----
    float nuc = smoothstep(0.35, 0.95, thickN);
    nuc *= 0.7 + 0.3 * sin(uTime * 1.7 + p.y * 9.0 + p.x * 7.0);

    // ---- colour ----
    // Beer–Lambert-ish: thin edges show the bright shallow tint, deep body
    // absorbs toward dark green.
    vec3 body = mix(uShallow, uDeep, pow(thickN, 0.55));
    body = mix(body, uNucleus, nuc * 0.55);

    // Procedural environment tint in the reflection (soft sky above,
    // dim floor below) — sells "wet" without a cubemap.
    vec3 rWorld = normalize(mat3(modelMatrix) * reflect(rd, n));
    vec3 env = mix(vec3(0.10, 0.11, 0.10), vec3(0.72, 0.78, 0.74), smoothstep(-0.35, 0.8, rWorld.y));

    // Two analytic lights: warm key high-front, cool rim behind-left.
    vec3 L1 = normalize(vec3(0.45, 0.85, 0.3));
    vec3 L2 = normalize(vec3(-0.6, 0.2, -0.75));
    vec3 nw = normalize(mat3(modelMatrix) * n);
    vec3 vw = normalize(mat3(modelMatrix) * v);
    vec3 h1 = normalize(L1 + vw);
    vec3 h2 = normalize(L2 + vw);
    float specTight = pow(max(dot(nw, h1), 0.0), 140.0) * 1.6 + pow(max(dot(nw, h2), 0.0), 90.0) * 0.5;
    float sheen = pow(max(dot(nw, h1), 0.0), 10.0) * 0.14;

    // Wrap diffuse — gel scatters, it never goes pitch black on the dark side.
    float wrap = clamp((dot(nw, L1) + 0.6) / 1.6, 0.0, 1.0);

    vec3 col = body * (0.45 + 0.6 * wrap);
    col += env * fresnel * 0.55;
    col += vec3(specTight) + vec3(sheen);
    col += uShallow * fresnel * fresnel * 0.5; // lime rim glow
    col += uNucleus * nuc * 0.35;

    // Telegraph flash: the whole body pulses warm right before it swings.
    col = mix(col, uFlash, uTelegraph * 0.35 * (0.6 + 0.4 * sin(uTime * 18.0)));

    // ---- alpha: more transparent at thin grazing edges, meaty in the body.
    float alpha = clamp(0.44 + 0.38 * thickN + 0.24 * fresnel, 0.0, 0.96);

    gl_FragColor = vec4(col, alpha);

    // ---- true depth so fists/eyes intersect the SURFACE, not the box.
    vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
    float ndcZ = clip.z / clip.w;
    gl_FragDepth = ndcZ * 0.5 + 0.5;
  }
`;

export interface GelUniforms {
  material: ShaderMaterial;
  /** Copy the sim's packed blob/dent arrays + bounds into the uniforms. */
  update(
    packed: Float32Array,
    count: number,
    dents: Float32Array,
    dentCount: number,
    center: Vector3,
    half: Vector3,
    time: number,
    agitation: number,
    telegraph: number,
    invModel: Matrix4,
  ): void;
  /** Scale the march-step budget (1 = full quality; drops with distance). */
  setQuality(q: number): void;
}

export function createGelMaterial(): GelUniforms {
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: true,
    side: BackSide,
    uniforms: {
      uBlobs: { value: new Float32Array(MAX_BLOBS * 4) },
      uCount: { value: 0 },
      uDents: { value: new Float32Array(MAX_DENTS * 4) },
      uDentCount: { value: 0 },
      uCenter: { value: new Vector3(0, 0.6, 0) },
      uHalf: { value: new Vector3(1, 1, 1) },
      uInvModel: { value: new Matrix4() },
      uTime: { value: 0 },
      uAgitation: { value: 0 },
      uTelegraph: { value: 0 },
      uBlend: { value: CREATURE.blend },
      uWobble: { value: GEL_LOOK.wobble },
      uWobbleAgitated: { value: GEL_LOOK.wobbleAgitated },
      uSteps: { value: GEL_LOOK.maxSteps },
      uShallow: { value: new Color(GEL_LOOK.shallowColor) },
      uDeep: { value: new Color(GEL_LOOK.deepColor) },
      uNucleus: { value: new Color(GEL_LOOK.nucleusColor) },
      uFlash: { value: new Color(GEL_LOOK.telegraphColor) },
    },
  });

  return {
    material,
    update(packed, count, dents, dentCount, center, half, time, agitation, telegraph, invModel) {
      const u = material.uniforms;
      (u.uBlobs.value as Float32Array).set(packed);
      u.uCount.value = count;
      (u.uDents.value as Float32Array).set(dents);
      u.uDentCount.value = dentCount;
      (u.uCenter.value as Vector3).copy(center);
      (u.uHalf.value as Vector3).copy(half);
      u.uTime.value = time;
      u.uAgitation.value = agitation;
      u.uTelegraph.value = telegraph;
      (u.uInvModel.value as Matrix4).copy(invModel);
    },
    setQuality(q) {
      material.uniforms.uSteps.value = Math.max(20, Math.round(GEL_LOOK.maxSteps * Math.min(1, q)));
    },
  };
}
