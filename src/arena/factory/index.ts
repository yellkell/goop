/**
 * The FACTORY arena — an optional backdrop behind the two platforms, a sibling
 * to the papercraft desert. A big, mostly-enclosed dilapidated works on the edge
 * of the town of GASKET: cracked concrete underfoot (dropped a touch so the
 * platforms stand proud), tall rusted corrugated walls — closed on three sides,
 * with a broken-out window strip on the EAST wall through which the open desert
 * bakes and a lone vulture wheels. A trussed roof with a few smashed panels
 * lets in shafts of light. The shell sits OUTSIDE the arena cage so a thrown
 * ball always bursts on the invisible cage before it can reach a wall.
 *
 * Built once under one Group; DesertSystem shows/hides it and paints the sky
 * opaque so passthrough is replaced (same render-switch trick as the desert).
 * The central space is kept clear of clutter so the bout has room.
 */

import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { ARENA_BOUNDS, ARENA_GAP } from '../../config.js';
import { CONFIG } from '../desert/config.js';
import { buildMesas } from '../desert/rocks.js';
import { makeVulture } from '../desert/birds.js';

export interface Factory {
  root: Group;
  update(delta: number, time: number): void;
  skyColor: Color;
}

const FLOOR_Y = -0.18; // floor dropped just enough that the platforms stand proud
const CENTRE_Z = -ARENA_GAP / 2; // midpoint between the two platforms
// The shell sits a clear margin OUTSIDE the arena cage so balls die before a wall.
const HALL = {
  minX: -(ARENA_BOUNDS.halfWidth + 1.1),
  maxX: ARENA_BOUNDS.halfWidth + 1.1,
  minZ: ARENA_BOUNDS.zFront - 1.1,
  maxZ: ARENA_BOUNDS.zBack + 1.1,
  height: ARENA_BOUNDS.ceiling + 0.9,
};

let seed = 1337;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

// --- procedural textures ----------------------------------------------------

function concreteTexture(): CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#56565a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 220; i++) {
    const r = 6 + rnd() * 60;
    ctx.fillStyle = `rgba(${20 + rnd() * 40 | 0},${20 + rnd() * 40 | 0},${22 + rnd() * 40 | 0},${0.04 + rnd() * 0.1})`;
    ctx.beginPath();
    ctx.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(20,20,24,0.45)';
  ctx.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo((i / 4) * S, 0); ctx.lineTo((i / 4) * S, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, (i / 4) * S); ctx.lineTo(S, (i / 4) * S); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(12,12,14,0.5)';
  for (let i = 0; i < 9; i++) {
    ctx.lineWidth = 1 + rnd() * 1.5;
    ctx.beginPath();
    let x = rnd() * S, y = rnd() * S;
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 90; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Vertical corrugated steel, rusted and streaked — the dilapidated cladding. */
function corrugatedTexture(): CanvasTexture {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < W; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, '#3a3e44'); g.addColorStop(0.5, '#666b72'); g.addColorStop(1, '#3a3e44');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 16, H);
  }
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W;
    ctx.fillStyle = `rgba(${120 + rnd() * 70 | 0},${50 + rnd() * 40 | 0},${20 + rnd() * 20 | 0},${0.08 + rnd() * 0.22})`;
    ctx.fillRect(x, rnd() * H, 2 + rnd() * 5, 20 + rnd() * 120);
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Hand-painted "GASKET" stencilled on a crate face — jittered, brush-edged
 *  letters off a fixed seed so it reads daubed-on, not typeset. */
function gasketCrateTexture(): CanvasTexture {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  // planks
  ctx.fillStyle = '#6b4a28';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(40,26,12,0.5)';
  ctx.lineWidth = 3;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (i / 4) * H); ctx.lineTo(W, (i / 4) * H); ctx.stroke(); }
  ctx.strokeRect(5, 5, W - 10, H - 10);
  // hand-painted GASKET, two short rows so it fills the crate
  let s = 7;
  const r = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  ctx.fillStyle = '#16100a';
  ctx.strokeStyle = '#16100a';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const word = 'GASKET';
  let x = 26;
  for (const ch of word) {
    const px = 40 + Math.round((r() - 0.5) * 8);
    ctx.font = `italic 800 ${px}px 'Arial Narrow', Impact, sans-serif`;
    const cw = ctx.measureText(ch).width;
    ctx.save();
    ctx.translate(x + cw / 2, H / 2 + (r() - 0.5) * 10);
    ctx.rotate((r() - 0.5) * 0.18);
    ctx.fillText(ch, 0, 0);
    ctx.strokeText(ch, 0, 0);
    ctx.restore();
    x += cw + 2 + (r() - 0.5) * 4;
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --- materials --------------------------------------------------------------

const steel = (color: number, rough = 0.6): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, metalness: 0.85, roughness: rough });
const rusty = (): MeshStandardMaterial => new MeshStandardMaterial({ color: 0x6e5038, metalness: 0.5, roughness: 0.85 });

function skyDome(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color(CONFIG.sky.top) },
      horizon: { value: new Color(CONFIG.sky.horizon) },
      bottom: { value: new Color(CONFIG.sky.bottom) },
    },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top, horizon, bottom; varying vec3 vDir;
      void main(){ float h=vDir.y; vec3 c = h>0.0 ? mix(horizon,top,smoothstep(0.0,0.45,h)) : mix(horizon,bottom,smoothstep(0.0,-0.35,h)); gl_FragColor=vec4(c,1.0); }`,
  });
  const dome = new Mesh(new SphereGeometry(800, 32, 16), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

/** A solid corrugated wall, or (windowed) one with a broken-out window strip. */
function wall(root: Group, mat: MeshStandardMaterial, len: number, cx: number, cz: number, ry: number, windowed: boolean): void {
  const h = HALL.height;
  if (!windowed) {
    const m = new Mesh(new PlaneGeometry(len, h), mat);
    m.position.set(cx, FLOOR_Y + h / 2, cz);
    m.rotation.y = ry;
    root.add(m);
    return;
  }
  const sillH = 1.2;
  const winH = 2.6;
  const topH = h - sillH - winH;
  const band = (bh: number, by: number): void => {
    const m = new Mesh(new PlaneGeometry(len, bh), mat);
    m.position.set(cx, FLOOR_Y + by + bh / 2, cz);
    m.rotation.y = ry;
    root.add(m);
  };
  band(sillH, 0);
  band(topH, sillH + winH);
  const panes = Math.max(4, Math.round(len / 2.6));
  const pw = len / panes;
  for (let i = 0; i <= panes; i++) {
    const mull = new Mesh(new BoxGeometry(0.12, winH, 0.12), steel(0x2c2f34, 0.7));
    const off = -len / 2 + i * pw;
    mull.position.set(cx + Math.cos(ry) * off, FLOOR_Y + sillH + winH / 2, cz - Math.sin(ry) * off);
    mull.rotation.y = ry;
    root.add(mull);
    if (i < panes && rnd() < 0.25) {
      const glass = new Mesh(
        new PlaneGeometry(pw * 0.9, winH * 0.9),
        new MeshStandardMaterial({ color: 0x8aa0a4, transparent: true, opacity: 0.16, roughness: 0.4, metalness: 0.1, side: DoubleSide }),
      );
      const goff = off + pw / 2;
      glass.position.set(cx + Math.cos(ry) * goff, FLOOR_Y + sillH + winH / 2, cz - Math.sin(ry) * goff);
      glass.rotation.y = ry;
      root.add(glass);
    }
  }
}

function workLamp(root: Group, x: number, z: number): { pivot: Object3D; phase: number } {
  const pivot = new Object3D();
  pivot.position.set(x, HALL.height + FLOOR_Y, z);
  const cordLen = 1.6;
  const cord = new Mesh(new CylinderGeometry(0.015, 0.015, cordLen, 5), steel(0x111114, 0.8));
  cord.position.y = -cordLen / 2;
  pivot.add(cord);
  const shade = new Mesh(new CylinderGeometry(0.2, 0.11, 0.22, 10, 1, true), steel(0x3a2c20, 0.7));
  shade.position.y = -cordLen - 0.05;
  pivot.add(shade);
  const bulb = new Mesh(new SphereGeometry(0.07, 8, 8), new MeshStandardMaterial({ color: 0xffd28a, emissive: 0xffc070, emissiveIntensity: 1.7 }));
  bulb.position.y = -cordLen - 0.13;
  pivot.add(bulb);
  const light = new PointLight(0xffcaa0, 12, 13, 1.7);
  light.position.y = -cordLen - 0.13;
  pivot.add(light);
  root.add(pivot);
  return { pivot, phase: rnd() * Math.PI * 2 };
}

export function buildFactory(): Factory {
  seed = 1337;
  const root = new Group();
  root.name = 'factory-environment';
  root.visible = false;

  const skyColor = new Color(CONFIG.sky.horizon);
  root.add(skyDome());

  // Warm desert sun raking in through the east window + soft fill.
  const sun = new DirectionalLight(new Color('#ffcf9a'), 1.35);
  sun.position.set(26, 16, 6);
  sun.target.position.set(0, 0, CENTRE_Z);
  root.add(sun, sun.target);
  root.add(new AmbientLight(new Color('#6b6470'), 0.5));
  root.add(new HemisphereLight(new Color(CONFIG.ibl.sky), new Color('#3a2f28'), 0.6));

  // The desert outside: a vast sand floor + the desert's own horizon mesas.
  const sand = new Mesh(new PlaneGeometry(700, 700), new MeshStandardMaterial({ color: new Color(CONFIG.palette.sandLight), roughness: 1 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = FLOOR_Y - 0.02;
  root.add(sand);
  buildMesas(root);

  // Cracked concrete floor over the interior footprint.
  const concrete = new MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95, metalness: 0.05 });
  (concrete.map as CanvasTexture).repeat.set(10, 11);
  const floor = new Mesh(new PlaneGeometry(HALL.maxX - HALL.minX, HALL.maxZ - HALL.minZ), concrete);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((HALL.minX + HALL.maxX) / 2, FLOOR_Y, (HALL.minZ + HALL.maxZ) / 2);
  root.add(floor);

  // The shell: EAST wall windowed (desert beyond), the other three closed.
  const clad = new MeshStandardMaterial({ map: corrugatedTexture(), metalness: 0.7, roughness: 0.72, side: DoubleSide });
  (clad.map as CanvasTexture).repeat.set(10, 4);
  const w = HALL.maxX - HALL.minX;
  const d = HALL.maxZ - HALL.minZ;
  wall(root, clad, w, (HALL.minX + HALL.maxX) / 2, HALL.minZ, 0, false); // far (north) — closed
  wall(root, clad, w, (HALL.minX + HALL.maxX) / 2, HALL.maxZ, Math.PI, false); // near — closed
  wall(root, clad, d, HALL.minX, (HALL.minZ + HALL.maxZ) / 2, Math.PI / 2, false); // west — closed
  wall(root, clad, d, HALL.maxX, (HALL.minZ + HALL.maxZ) / 2, -Math.PI / 2, true); // EAST — windowed

  // Roof: trusses + corrugated panels with a few smashed-out skylights.
  const beamMat = steel(0x33363c, 0.6);
  const roofY = FLOOR_Y + HALL.height;
  for (let z = HALL.minZ + 2; z <= HALL.maxZ - 2; z += 3.2) {
    const chordTop = new Mesh(new BoxGeometry(w, 0.18, 0.18), beamMat);
    chordTop.position.set(0, roofY - 0.12, z);
    root.add(chordTop);
    const chordBot = new Mesh(new BoxGeometry(w, 0.12, 0.12), beamMat);
    chordBot.position.set(0, roofY - 0.7, z);
    root.add(chordBot);
    for (let x = -w / 2 + 1; x < w / 2; x += 2) {
      const dia = new Mesh(new BoxGeometry(0.08, 0.72, 0.08), beamMat);
      dia.position.set(x, roofY - 0.4, z);
      dia.rotation.z = (x % 4 < 2 ? 1 : -1) * 0.6;
      root.add(dia);
    }
  }
  const roofMat = new MeshStandardMaterial({ map: corrugatedTexture(), metalness: 0.6, roughness: 0.75, side: DoubleSide });
  (roofMat.map as CanvasTexture).repeat.set(8, 8);
  const panelsX = 7, panelsZ = 8;
  for (let i = 0; i < panelsX; i++) {
    for (let j = 0; j < panelsZ; j++) {
      if (rnd() < 0.13) continue; // a missing panel — daylight pours in
      const px = HALL.minX + (i + 0.5) * (w / panelsX);
      const pz = HALL.minZ + (j + 0.5) * (d / panelsZ);
      const panel = new Mesh(new PlaneGeometry(w / panelsX + 0.05, d / panelsZ + 0.05), roofMat);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(px, roofY, pz);
      root.add(panel);
    }
  }

  // Perimeter columns along the long walls — well clear of the centre already
  // (they hug x = ±halfWidth, far from the platforms at x≈0).
  const colMat = steel(0x3c3f45, 0.55);
  for (const cx of [HALL.minX + 0.5, HALL.maxX - 0.5]) {
    for (let z = HALL.minZ + 2.5; z <= HALL.maxZ - 2.5; z += 5) {
      const col = new Mesh(new BoxGeometry(0.4, HALL.height, 0.4), colMat);
      col.position.set(cx, FLOOR_Y + HALL.height / 2, z);
      root.add(col);
    }
  }

  // Deliberate, tidy clutter in the FAR corners only — never strewn about.
  const tank = (x: number, z: number, r: number, hgt: number): void => {
    const t = new Mesh(new CylinderGeometry(r, r, hgt, 16), rusty());
    t.position.set(x, FLOOR_Y + hgt / 2, z);
    root.add(t);
    const cap = new Mesh(new SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), rusty());
    cap.position.set(x, FLOOR_Y + hgt, z);
    root.add(cap);
  };
  tank(HALL.minX + 2.2, HALL.minZ + 2.6, 1.3, 4);
  tank(HALL.minX + 5.2, HALL.minZ + 2.4, 1.0, 3);
  // A neat stack of GASKET crates against the closed far wall.
  const crateMat = new MeshStandardMaterial({ map: gasketCrateTexture(), roughness: 0.9 });
  const crate = (x: number, y: number, z: number, sz: number): void => {
    const box = new Mesh(new BoxGeometry(sz, sz, sz), crateMat);
    box.position.set(x, FLOOR_Y + y + sz / 2, z);
    box.rotation.y = (rnd() - 0.5) * 0.12;
    root.add(box);
  };
  const cbx = HALL.maxX - 2.4;
  crate(cbx, 0, HALL.minZ + 1.6, 0.8);
  crate(cbx + 0.95, 0, HALL.minZ + 1.7, 0.8);
  crate(cbx + 0.4, 0.8, HALL.minZ + 1.6, 0.8);
  crate(cbx - 0.9, 0, HALL.minZ + 1.5, 0.7);
  // A couple of steel drums beside them (rusty/blue — no lone green tubes).
  for (const [dx, dz, col] of [[cbx + 1.9, HALL.minZ + 1.4, 0x7a4a2a], [cbx + 2.4, HALL.minZ + 2.1, 0x355a78]] as const) {
    const drum = new Mesh(new CylinderGeometry(0.3, 0.3, 0.9, 14), steel(col, 0.8));
    drum.position.set(dx, FLOOR_Y + 0.45, dz);
    root.add(drum);
  }

  // Work lamps over the action + a couple deep in the hall.
  const lamps = [
    workLamp(root, 0, CENTRE_Z),
    workLamp(root, -3.4, CENTRE_Z + 2.4),
    workLamp(root, 3.4, CENTRE_Z - 1.6),
    workLamp(root, 0, HALL.minZ + 4),
  ];

  // A lone vulture wheeling OUTSIDE the east window — caught now and then.
  const bird = makeVulture(rnd);
  root.add(bird.obj);
  const dihedral = bird.wings[0].rotation.z;
  const BIRD = { cx: HALL.maxX + 11, cz: CENTRE_Z, r: 7, y: FLOOR_Y + 2.7 };

  return {
    root,
    skyColor,
    update: (_delta, time) => {
      for (const l of lamps) l.pivot.rotation.z = Math.sin(time * 0.6 + l.phase) * 0.04;
      // wheel the bird on a slow lazy loop, banking into the turn + trimming.
      const ang = time * 0.16;
      const bx = BIRD.cx + Math.cos(ang) * BIRD.r;
      const bz = BIRD.cz + Math.sin(ang) * BIRD.r;
      const by = BIRD.y + Math.sin(time * 0.5) * 1.1;
      bird.obj.position.set(bx, by, bz);
      const a2 = ang + 0.06;
      const dx = BIRD.cx + Math.cos(a2) * BIRD.r - bx;
      const dz = BIRD.cz + Math.sin(a2) * BIRD.r - bz;
      bird.obj.rotation.set(0, Math.atan2(dx, dz), 0.32);
      const flex = Math.sin(time * 1.1) * 0.05;
      bird.wings[0].rotation.z = dihedral + flex;
      bird.wings[1].rotation.z = -(dihedral + flex);
    },
  };
}
