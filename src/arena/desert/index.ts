/**
 * Assembles the whole papercraft desert (ported from yellkell/vrenv) under ONE
 * Group so FIRE FIGHT can show/hide it as a single unit — the optional arena
 * backdrop behind the platforms. Unlike the standalone project, the sky and
 * lighting live in this group too (a gradient sky dome instead of the global
 * DomeGradient/IBLGradient components), so toggling the group's visibility
 * flips between the desert and bare AR passthrough cleanly.
 *
 * The opaque sky dome is what hides passthrough: in immersive-AR, opaque
 * geometry replaces the camera feed, so an enclosing dome reads as full VR.
 */

import {
  AmbientLight,
  BackSide,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { CONFIG } from './config.js';
import { makePaperDouble } from './paper.js';
import { buildTerrain } from './terrain.js';
import { buildBoulders, buildMesas } from './rocks.js';
import { buildCacti } from './cactus.js';
import { buildProps } from './props.js';
import { animateTumbleweeds, buildTumbleweeds, type Tumbleweed } from './tumbleweed.js';

export interface Desert {
  /** Everything: terrain, sky, sun, props. Toggle `.visible` to show/hide. */
  root: Group;
  /** Advance the rolling tumbleweeds. Call each frame while visible. */
  update(delta: number, time: number): void;
}

/** A big inward-facing gradient sky sphere — top → horizon → sandy ground. */
function makeSkyDome(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color(CONFIG.sky.top) },
      horizon: { value: new Color(CONFIG.sky.horizon) },
      bottom: { value: new Color(CONFIG.sky.bottom) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top, horizon, bottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0
          ? mix(horizon, top, smoothstep(0.0, 0.45, h))
          : mix(horizon, bottom, smoothstep(0.0, -0.35, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const dome = new Mesh(new SphereGeometry(800, 32, 16), mat);
  dome.renderOrder = -1; // paint the sky first, everything draws over it
  dome.frustumCulled = false;
  return dome;
}

export function buildDesert(): Desert {
  const root = new Group();
  root.name = 'desert-environment';
  root.visible = false;

  root.add(makeSkyDome());

  // The low golden sun — drives long shadows and a flat paper sun disc.
  const e = CONFIG.mood.sunElevation * (Math.PI / 2);
  const sunDir = new Vector3(0.35 * Math.cos(e), Math.sin(e), -0.94 * Math.cos(e)).normalize();

  const sun = new DirectionalLight(new Color('#ffdca0'), 2.4);
  sun.position.copy(sunDir).multiplyScalar(55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0004;
  const cam = sun.shadow.camera;
  cam.near = 8;
  cam.far = 140;
  cam.left = cam.bottom = -42;
  cam.right = cam.top = 42;
  cam.updateProjectionMatrix();
  root.add(sun);
  root.add(sun.target); // target sits at the origin → sun points at the platforms

  root.add(new AmbientLight(new Color('#d8b38a'), 0.5));
  root.add(new HemisphereLight(new Color(CONFIG.ibl.sky), new Color(CONFIG.ibl.ground), 0.6));

  // Stylised paper sun low on the horizon (with a fainter halo behind it).
  const halo = new Mesh(new CircleGeometry(44, 36), makePaperDouble('#ffe7ad', 0.5));
  halo.position.copy(sunDir).multiplyScalar(602);
  halo.lookAt(0, halo.position.y, 0);
  root.add(halo);
  const disc = new Mesh(new CircleGeometry(26, 32), makePaperDouble(CONFIG.palette.sun, 1.1));
  disc.position.copy(sunDir).multiplyScalar(600);
  disc.lookAt(0, disc.position.y, 0);
  root.add(disc);

  // The world itself.
  buildTerrain(root);
  buildMesas(root);
  buildBoulders(root);
  buildCacti(root);
  buildProps(root);
  const weeds: Tumbleweed[] = buildTumbleweeds(root);

  return {
    root,
    update: (delta, time) => animateTumbleweeds(weeds, delta, time),
  };
}
