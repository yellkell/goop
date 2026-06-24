/**
 * The FACTORY arena — an optional backdrop behind the two platforms, a sibling
 * to the papercraft desert. A big dilapidated industrial hall on the edge of the
 * town of GASKET: cracked concrete underfoot (dropped below the platforms so
 * they stand proud on steel daises), tall rusted corrugated walls with broken
 * windows, a trussed roof with smashed skylights raining shafts of light, and —
 * through every gap — the open DESERT and its mesas baking outside.
 *
 * Built once under one Group; DesertSystem shows/hides it and paints the sky
 * opaque so passthrough is replaced (same render-switch trick as the desert).
 * The central ~7 m is kept clear of columns and clutter so the bout has room.
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
  TorusGeometry,
} from 'three';
import { ARENA_GAP } from '../../config.js';
import { CONFIG } from '../desert/config.js';
import { buildMesas } from '../desert/rocks.js';

export interface Factory {
  root: Group;
  update(delta: number, time: number): void;
  skyColor: Color;
}

const FLOOR_Y = -0.42; // the factory floor, dropped so the platforms stand proud
const CENTRE_Z = -ARENA_GAP / 2; // midpoint between the two platforms
// Interior footprint (x, z) and height of the hall shell.
const HALL = { minX: -8.5, maxX: 8.5, minZ: -11, maxZ: 8, height: 7.2 };

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
  ctx.fillStyle = '#5a5a5e';
  ctx.fillRect(0, 0, S, S);
  // mottled stains
  for (let i = 0; i < 240; i++) {
    const r = 6 + rnd() * 60;
    ctx.fillStyle = `rgba(${20 + rnd() * 40 | 0},${20 + rnd() * 40 | 0},${22 + rnd() * 40 | 0},${0.04 + rnd() * 0.1})`;
    ctx.beginPath();
    ctx.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // expansion-joint grid
  ctx.strokeStyle = 'rgba(20,20,24,0.5)';
  ctx.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo((i / 4) * S, 0); ctx.lineTo((i / 4) * S, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, (i / 4) * S); ctx.lineTo(S, (i / 4) * S); ctx.stroke();
  }
  // cracks
  ctx.strokeStyle = 'rgba(12,12,14,0.55)';
  for (let i = 0; i < 10; i++) {
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
  // ribbed base
  for (let x = 0; x < W; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, '#3c4046');
    g.addColorStop(0.5, '#6b7078');
    g.addColorStop(1, '#3c4046');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 16, H);
  }
  // rust streaks + blotches
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

/** A painted/stencilled industrial sign on a steel plate. */
function signTexture(lines: { text: string; size: number; color: string }[], bg = '#2a2d33'): CanvasTexture {
  const W = 1024, H = 320;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // weathering
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(${90 + rnd() * 80 | 0},${40 + rnd() * 40 | 0},20,${0.05 + rnd() * 0.12})`;
    ctx.fillRect(rnd() * W, rnd() * H, 3 + rnd() * 30, 3 + rnd() * 14);
  }
  ctx.strokeStyle = 'rgba(20,20,24,0.8)';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, W - 14, H - 14);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let y = H / 2 - (lines.length - 1) * 0.5 * 70;
  for (const ln of lines) {
    ctx.font = `900 ${ln.size}px 'Arial Narrow', Impact, system-ui, sans-serif`;
    ctx.fillStyle = ln.color;
    ctx.fillText(ln.text, W / 2, y);
    y += ln.size * 0.95;
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

// --- sky (desert outside) ---------------------------------------------------

function skyDome(): Mesh {
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
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top, horizon, bottom; varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, smoothstep(0.0, 0.45, h)) : mix(horizon, bottom, smoothstep(0.0, -0.35, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const dome = new Mesh(new SphereGeometry(800, 32, 16), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

// --- build helpers ----------------------------------------------------------

/** A wall built as horizontal bands so we can leave window gaps in the middle
 *  band — the desert shows through. Returns nothing; adds to `root`. */
function wall(root: Group, mat: MeshStandardMaterial, len: number, cx: number, cz: number, ry: number): void {
  const h = HALL.height;
  const sillH = 1.4; // solid base
  const winH = 2.4; // window band (broken out)
  const topH = h - sillH - winH;
  const band = (bh: number, by: number): void => {
    const m = new Mesh(new PlaneGeometry(len, bh), mat);
    m.position.set(cx, FLOOR_Y + by + bh / 2, cz);
    m.rotation.y = ry;
    root.add(m);
  };
  band(sillH, 0); // base
  band(topH, sillH + winH); // top strip above the windows
  // Window band: a row of mullions with gaps, plus a few intact dirty panes.
  const panes = Math.max(3, Math.round(len / 2.4));
  const pw = len / panes;
  for (let i = 0; i <= panes; i++) {
    const mull = new Mesh(new BoxGeometry(0.12, winH, 0.12), steel(0x2c2f34, 0.7));
    const off = -len / 2 + i * pw;
    mull.position.set(cx + Math.cos(ry) * off, FLOOR_Y + sillH + winH / 2, cz - Math.sin(ry) * off);
    mull.rotation.y = ry;
    root.add(mull);
    // ~1 in 4 panes keeps a grimy cracked glass sheet; the rest are smashed out.
    if (i < panes && rnd() < 0.28) {
      const glass = new Mesh(
        new PlaneGeometry(pw * 0.9, winH * 0.92),
        new MeshStandardMaterial({ color: 0x8aa0a4, transparent: true, opacity: 0.18, roughness: 0.4, metalness: 0.1, side: DoubleSide }),
      );
      const goff = off + pw / 2;
      glass.position.set(cx + Math.cos(ry) * goff, FLOOR_Y + sillH + winH / 2, cz - Math.sin(ry) * goff);
      glass.rotation.y = ry;
      root.add(glass);
    }
  }
}

/** A caged work lamp on a drop cord — warm pool of light, gently swinging. */
function workLamp(root: Group, x: number, z: number): { pivot: Object3D; phase: number } {
  const pivot = new Object3D();
  pivot.position.set(x, HALL.height + FLOOR_Y, z);
  const cordLen = 1.4;
  const cord = new Mesh(new CylinderGeometry(0.015, 0.015, cordLen, 5), steel(0x111114, 0.8));
  cord.position.y = -cordLen / 2;
  pivot.add(cord);
  const shade = new Mesh(new CylinderGeometry(0.18, 0.1, 0.2, 10, 1, true), steel(0x3a2c20, 0.7));
  shade.position.y = -cordLen - 0.05;
  pivot.add(shade);
  const bulb = new Mesh(new SphereGeometry(0.06, 8, 8), new MeshStandardMaterial({ color: 0xffd28a, emissive: 0xffc070, emissiveIntensity: 1.6 }));
  bulb.position.y = -cordLen - 0.12;
  pivot.add(bulb);
  const light = new PointLight(0xffcaa0, 9, 9, 1.8);
  light.position.y = -cordLen - 0.12;
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

  // --- lighting: warm desert sun raking through the windows + fill ----------
  const sun = new DirectionalLight(new Color('#ffcf9a'), 1.5);
  sun.position.set(-18, 16, 10);
  sun.target.position.set(0, 0, CENTRE_Z);
  root.add(sun, sun.target);
  root.add(new AmbientLight(new Color('#6b6470'), 0.42));
  root.add(new HemisphereLight(new Color(CONFIG.ibl.sky), new Color('#3a2f28'), 0.55));

  // --- the desert outside: a vast sand floor + distant mesas ----------------
  const sand = new Mesh(
    new PlaneGeometry(600, 600),
    new MeshStandardMaterial({ color: new Color(CONFIG.palette.sandLight), roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = FLOOR_Y - 0.02;
  root.add(sand);
  buildMesas(root); // reuse the desert's horizon silhouettes — seen through the windows

  // --- factory floor (cracked concrete over the interior footprint) ---------
  const concrete = new MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95, metalness: 0.05 });
  (concrete.map as CanvasTexture).repeat.set(8, 8);
  const floor = new Mesh(new PlaneGeometry(HALL.maxX - HALL.minX, HALL.maxZ - HALL.minZ), concrete);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((HALL.minX + HALL.maxX) / 2, FLOOR_Y, (HALL.minZ + HALL.maxZ) / 2);
  root.add(floor);

  // --- raised steel daises so each platform stands PROUD of the dropped floor
  for (const pz of [0, -ARENA_GAP]) {
    const h = -FLOOR_Y; // from the floor up to y≈0 (the platform top)
    const dais = new Mesh(new CylinderGeometry(1.18, 1.3, h, 16), steel(0x44474d, 0.6));
    dais.position.set(0, FLOOR_Y + h / 2, pz);
    root.add(dais);
    // hazard kick-band around the dais lip
    const band = new Mesh(new CylinderGeometry(1.21, 1.21, 0.12, 16, 1, true), new MeshStandardMaterial({ color: 0xd8a01e, roughness: 0.6, metalness: 0.3 }));
    band.position.set(0, -0.09, pz);
    root.add(band);
  }

  // --- the shell: corrugated walls with broken windows ----------------------
  const clad = new MeshStandardMaterial({ map: corrugatedTexture(), metalness: 0.7, roughness: 0.7, side: DoubleSide });
  (clad.map as CanvasTexture).repeat.set(8, 3);
  const w = HALL.maxX - HALL.minX;
  const d = HALL.maxZ - HALL.minZ;
  wall(root, clad, w, (HALL.minX + HALL.maxX) / 2, HALL.minZ, 0); // far (north)
  wall(root, clad, w, (HALL.minX + HALL.maxX) / 2, HALL.maxZ, Math.PI); // near (behind the player)
  wall(root, clad, d, HALL.minX, (HALL.minZ + HALL.maxZ) / 2, Math.PI / 2); // west
  wall(root, clad, d, HALL.maxX, (HALL.minZ + HALL.maxZ) / 2, -Math.PI / 2); // east

  // --- roof: trusses, corrugated panels with smashed skylights --------------
  const beamMat = steel(0x33363c, 0.6);
  const roofY = FLOOR_Y + HALL.height;
  for (let z = HALL.minZ + 1.5; z <= HALL.maxZ - 1.5; z += 2.6) {
    // a simple lattice truss spanning the width
    const chordTop = new Mesh(new BoxGeometry(w, 0.16, 0.16), beamMat);
    chordTop.position.set(0, roofY - 0.1, z);
    root.add(chordTop);
    const chordBot = new Mesh(new BoxGeometry(w, 0.12, 0.12), beamMat);
    chordBot.position.set(0, roofY - 0.6, z);
    root.add(chordBot);
    for (let x = -w / 2 + 0.6; x < w / 2; x += 1.4) {
      const dia = new Mesh(new BoxGeometry(0.07, 0.62, 0.07), beamMat);
      dia.position.set(x, roofY - 0.35, z);
      dia.rotation.z = (x % 2.8 < 1.4 ? 1 : -1) * 0.6;
      root.add(dia);
    }
  }
  // Corrugated roof panels with a few gaps (smashed skylights → light shafts).
  const roofMat = new MeshStandardMaterial({ map: corrugatedTexture(), metalness: 0.6, roughness: 0.75, side: DoubleSide });
  (roofMat.map as CanvasTexture).repeat.set(8, 8);
  const panelsX = 6, panelsZ = 7;
  for (let i = 0; i < panelsX; i++) {
    for (let j = 0; j < panelsZ; j++) {
      if (rnd() < 0.16) continue; // a missing panel — daylight pours in
      const px = HALL.minX + (i + 0.5) * (w / panelsX);
      const pz = HALL.minZ + (j + 0.5) * (d / panelsZ);
      const panel = new Mesh(new PlaneGeometry(w / panelsX + 0.05, d / panelsZ + 0.05), roofMat);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(px, roofY, pz);
      root.add(panel);
    }
  }

  // --- perimeter columns (kept OUT of the central fight zone) ----------------
  const inCentre = (x: number, z: number): boolean => Math.abs(x) < 3.6 && z > CENTRE_Z - 4 && z < CENTRE_Z + 3;
  const colMat = steel(0x3c3f45, 0.55);
  for (const cx of [HALL.minX + 1.2, HALL.maxX - 1.2]) {
    for (let z = HALL.minZ + 1.4; z <= HALL.maxZ - 1.4; z += 3.4) {
      if (inCentre(cx, z)) continue;
      const col = new Mesh(new BoxGeometry(0.34, HALL.height, 0.34), colMat);
      col.position.set(cx, FLOOR_Y + HALL.height / 2, z);
      root.add(col);
      // rusty bolted base
      const base = new Mesh(new BoxGeometry(0.5, 0.18, 0.5), rusty());
      base.position.set(cx, FLOOR_Y + 0.09, z);
      root.add(base);
    }
  }

  // --- dilapidated machinery + debris around the edges ----------------------
  const clutter = new Group();
  const tank = (x: number, z: number, r: number, hgt: number): void => {
    const t = new Mesh(new CylinderGeometry(r, r, hgt, 14), rusty());
    t.position.set(x, FLOOR_Y + hgt / 2, z);
    clutter.add(t);
    const cap = new Mesh(new SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), rusty());
    cap.position.set(x, FLOOR_Y + hgt, z);
    clutter.add(cap);
  };
  const barrel = (x: number, z: number, tip = false): void => {
    const b = new Mesh(new CylinderGeometry(0.28, 0.28, 0.88, 12), steel(rnd() < 0.5 ? 0x7a4a2a : 0x375a4a, 0.85));
    if (tip) { b.rotation.z = Math.PI / 2; b.position.set(x, FLOOR_Y + 0.28, z); }
    else b.position.set(x, FLOOR_Y + 0.44, z);
    clutter.add(b);
  };
  const crate = (x: number, z: number, s: number, stencil: boolean): void => {
    const mat = stencil
      ? new MeshStandardMaterial({ map: signTexture([{ text: 'GASKET', size: 150, color: '#1a1206' }], '#6b4a28'), roughness: 0.9 })
      : new MeshStandardMaterial({ color: 0x6b4a28, roughness: 0.9 });
    const box = new Mesh(new BoxGeometry(s, s * 0.8, s), mat);
    box.position.set(x, FLOOR_Y + s * 0.4, z);
    box.rotation.y = (rnd() - 0.5) * 0.4;
    clutter.add(box);
  };
  const pipe = (x: number, z: number, len: number, y: number): void => {
    const p = new Mesh(new CylinderGeometry(0.1, 0.1, len, 10), rusty());
    p.rotation.z = Math.PI / 2;
    p.position.set(x, FLOOR_Y + y, z);
    clutter.add(p);
  };
  // big storage tanks in two corners
  tank(HALL.minX + 1.8, HALL.minZ + 2.2, 1.1, 3.6);
  tank(HALL.maxX - 2.0, HALL.minZ + 2.6, 0.9, 2.8);
  // wall pipes
  pipe(HALL.minX + 0.4, HALL.minZ + 5, 8, 4.2);
  pipe(HALL.maxX - 0.4, CENTRE_Z + 4, 6, 3.4);
  // scattered barrels, crates, rubble around the perimeter (never centre)
  for (let i = 0; i < 26; i++) {
    const x = HALL.minX + 0.8 + rnd() * (w - 1.6);
    const z = HALL.minZ + 0.8 + rnd() * (d - 1.6);
    if (inCentre(x, z)) continue;
    const k = rnd();
    if (k < 0.34) barrel(x, z, rnd() < 0.3);
    else if (k < 0.6) crate(x, z, 0.5 + rnd() * 0.5, rnd() < 0.5);
    else {
      const rub = new Mesh(new BoxGeometry(0.2 + rnd() * 0.5, 0.1 + rnd() * 0.2, 0.2 + rnd() * 0.5), steel(0x474443, 0.95));
      rub.position.set(x, FLOOR_Y + 0.07, z);
      rub.rotation.y = rnd() * Math.PI;
      clutter.add(rub);
    }
  }
  root.add(clutter);

  // --- hanging chains here and there (dilapidation) -------------------------
  const chains: { pivot: Object3D; phase: number }[] = [];
  for (const [cx, cz] of [[HALL.minX + 3, HALL.minZ + 3], [HALL.maxX - 3, CENTRE_Z + 5], [HALL.maxX - 4, HALL.minZ + 2]]) {
    if (inCentre(cx, cz)) continue;
    const pivot = new Object3D();
    pivot.position.set(cx, roofY - 0.6, cz);
    for (let i = 0; i < 7; i++) {
      const link = new Mesh(new TorusGeometry(0.06, 0.02, 6, 10), steel(0x2a2622, 0.8));
      link.position.y = -i * 0.1;
      link.rotation.x = i % 2 ? Math.PI / 2 : 0;
      pivot.add(link);
    }
    root.add(pivot);
    chains.push({ pivot, phase: rnd() * Math.PI * 2 });
  }

  // --- TOWN OF GASKET signage -----------------------------------------------
  // Big foundry sign high on the far wall, facing the player.
  const bigSign = new Mesh(
    new PlaneGeometry(6, 1.9),
    new MeshStandardMaterial({
      map: signTexture([
        { text: 'GASKET FOUNDRY № 7', size: 150, color: '#e8b53a' },
        { text: 'TOWN OF GASKET · EST. 2226', size: 64, color: '#c9c2b4' },
      ]),
      roughness: 0.8,
      metalness: 0.2,
    }),
  );
  bigSign.position.set(0, FLOOR_Y + 5.2, HALL.minZ + 0.08);
  root.add(bigSign);
  // A hanging "WELCOME TO GASKET" board near the player's back wall.
  const welcome = new Mesh(
    new PlaneGeometry(3.2, 0.9),
    new MeshStandardMaterial({ map: signTexture([{ text: 'WELCOME TO GASKET', size: 120, color: '#d8d0c0' }], '#43321f'), roughness: 0.85, side: DoubleSide }),
  );
  welcome.position.set(-4.5, FLOOR_Y + 3.4, HALL.maxZ - 0.1);
  welcome.rotation.y = Math.PI;
  root.add(welcome);
  // A rusted hazard plate by the east wall.
  const hazard = new Mesh(
    new PlaneGeometry(1.6, 1.0),
    new MeshStandardMaterial({ map: signTexture([{ text: 'DANGER', size: 130, color: '#e23b2c' }, { text: 'NO TRESPASS', size: 60, color: '#e8e2d4' }], '#1c1d20'), roughness: 0.8, side: DoubleSide }),
  );
  hazard.position.set(HALL.maxX - 0.06, FLOOR_Y + 2.2, CENTRE_Z - 2);
  hazard.rotation.y = -Math.PI / 2;
  root.add(hazard);

  // A water tower with GASKET on it, standing OUTSIDE, seen through the windows.
  const tower = new Group();
  tower.position.set(-22, 0, HALL.minZ - 14);
  const legs = steel(0x4a4136, 0.8);
  for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    const leg = new Mesh(new CylinderGeometry(0.18, 0.22, 9, 8), legs);
    leg.position.set(lx, FLOOR_Y + 4.5, lz);
    leg.rotation.z = (lx > 0 ? -1 : 1) * 0.08;
    tower.add(leg);
  }
  const tankBody = new Mesh(new CylinderGeometry(3, 3, 4, 18), rusty());
  tankBody.position.y = FLOOR_Y + 11;
  tower.add(tankBody);
  const cone = new Mesh(new CylinderGeometry(0, 3.2, 1.6, 18), rusty());
  cone.position.y = FLOOR_Y + 13.6;
  tower.add(cone);
  const towerSign = new Mesh(new PlaneGeometry(5, 2.2), new MeshStandardMaterial({ map: signTexture([{ text: 'GASKET', size: 220, color: '#1a1206' }], '#b9a06a'), roughness: 0.9, side: DoubleSide }));
  towerSign.position.set(0, FLOOR_Y + 11, 3.02);
  tower.add(towerSign);
  root.add(tower);

  // --- working lamps over the action + perimeter ----------------------------
  const lamps = [
    workLamp(root, 0, CENTRE_Z),
    workLamp(root, -3.2, CENTRE_Z + 2),
    workLamp(root, 3.2, CENTRE_Z - 1),
    workLamp(root, HALL.minX + 3, HALL.minZ + 3),
  ];

  return {
    root,
    skyColor,
    update: (_delta, time) => {
      for (const l of lamps) l.pivot.rotation.z = Math.sin(time * 0.6 + l.phase) * 0.04;
      for (const c of chains) c.pivot.rotation.x = Math.sin(time * 0.5 + c.phase) * 0.06;
    },
  };
}
