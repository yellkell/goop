/**
 * THE FACTORY STADIUM — an optional VR backdrop (toggle under ARENA, alongside
 * AR passthrough and the papercraft desert). Based on the procedural industrial
 * hall from yellkell/vrenv, but reworked into a DARK, neon-lit fight stadium:
 *
 *  - the grimy daylit factory is dropped for a near-black hall so the fire and
 *    the neon pop;
 *  - the central work floor is left completely clear for the platforms (every
 *    mode — 1v1, 2v2, FFA, Aim Training — fits inside the pit);
 *  - tiered STANDS ring the pit, a lighting truss + screens hang overhead, and
 *    a neon pit barrier + a FIRE FIGHT sign give it the arena feel;
 *  - emissive neon (house ember/amber/cool palette) does the heavy lifting so
 *    we need almost no real-time lights — cheap on the Quest.
 *
 * Like the desert it's built ONCE, hidden, and shown/hidden as a render switch
 * (opaque geometry paints out AR passthrough). It's also static, so after the
 * build we bake the matrices and turn off per-frame matrix updates — only a few
 * neon materials pulse in update(), no transforms move.
 */

import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  SRGBColorSpace,
  type Object3D,
} from 'three';
import { GAME_TITLE, PALETTE } from '../../config.js';
import { stencilFont } from '../../ui/industrial.js';

const ROOM = {
  half: 18, // 36m × 36m hall
  height: 11,
  wallT: 0.4,
  pitHalf: 6, // clear play floor radius (the arena + boundary fit well inside)
  standTiers: 7,
  tierRise: 0.5,
  tierDepth: 0.95,
  standSpan: 30, // how far a stand runs along its wall
  catwalkY: 6.4,
  trussY: 8.6,
};

// The hall floor sits this far BELOW the platforms: the whole hall drops by
// FLOOR_DROP and a raised central stage brings the play area back up to y=0, so
// the platforms read as a lit stage standing proud of a sunken arena floor.
const FLOOR_DROP = 0.7;
const STAGE_HALF = 5; // raised stage covers every mode's platforms with margin

export interface Factory {
  root: Group;
  update(delta: number, time: number): void;
}

// --- shared materials -------------------------------------------------------

const dark = (color: number, roughness = 0.85, metalness = 0.25): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, roughness, metalness });

/** A glowing neon material — its emissive does the lighting, so it reads bright
 *  in the near-black hall without a real light. */
const neon = (color: number, intensity = 2.4): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.1 });

function box(w: number, h: number, d: number, m: MeshStandardMaterial | MeshBasicMaterial): Mesh {
  return new Mesh(new BoxGeometry(w, h, d), m);
}

function place<T extends Object3D>(parent: Object3D, child: T, x: number, y: number, z: number): T {
  child.position.set(x, y, z);
  parent.add(child);
  return child;
}

/** A canvas-textured emissive panel — the big screens and the FIRE FIGHT sign. */
function screenTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 512, h = 256): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  return tex;
}

/** Grimy diagonal hazard-tape stripes (faded amber on black), tileable. */
function hazardTexture(): CanvasTexture {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#14130d';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#9c8326'; // faded, grimy safety yellow
  ctx.lineWidth = 0;
  for (let i = -1; i < 4; i++) {
    ctx.beginPath();
    const o = i * (s / 2);
    ctx.moveTo(o, 0);
    ctx.lineTo(o + s / 4, 0);
    ctx.lineTo(o + s / 4 - s, s);
    ctx.lineTo(o - s, s);
    ctx.closePath();
    ctx.fill();
  }
  // A little grime/wear over the stripes.
  ctx.fillStyle = 'rgba(10,9,7,0.28)';
  for (let i = 0; i < 60; i++) ctx.fillRect(Math.random() * s, Math.random() * s, Math.random() * 14, Math.random() * 6);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(10, 1);
  return tex;
}

export function buildFactory(): Factory {
  const root = new Group();
  root.name = 'factory-stadium';

  // Materials reused across the build (fewer GPU state changes).
  const M = {
    concrete: dark(0x101218, 0.92, 0.1),
    floor: dark(0x0d0f14, 0.9, 0.15),
    wall: dark(0x0e1015, 0.88, 0.2),
    wainscot: dark(0x070809, 0.9, 0.2),
    steel: dark(0x1a1d24, 0.55, 0.7),
    steelDark: dark(0x0b0d11, 0.6, 0.6),
    stand: dark(0x14161d, 0.82, 0.2),
    standRiser: dark(0x0a0b10, 0.85, 0.2),
    glass: dark(0x0a141c, 0.5, 0.3),
    rust: dark(0x4a2c18, 0.95, 0.1),
    ember: neon(PALETTE.ember, 2.6),
    amber: neon(PALETTE.amber, 2.4),
    cool: neon(PALETTE.coolFlame, 2.4),
    coolDim: neon(PALETTE.coolFlame, 1.4),
    emberDim: neon(PALETTE.ember, 1.5),
  };

  // Neon materials that breathe in update().
  const pulse: Array<{ mat: MeshStandardMaterial; base: number; amp: number; speed: number; phase: number }> = [
    { mat: M.ember, base: 2.6, amp: 0.5, speed: 1.7, phase: 0 },
    { mat: M.cool, base: 2.4, amp: 0.45, speed: 1.3, phase: 1.6 },
    { mat: M.amber, base: 2.4, amp: 0.35, speed: 0.9, phase: 3.1 },
  ];

  const hazardMat = new MeshStandardMaterial({ map: hazardTexture(), roughness: 0.78, metalness: 0.15 });

  buildShell(root);
  buildFloor(root, M);
  buildStage(root, M, hazardMat);
  buildPitBarrier(root, M);
  buildWalls(root, M);
  buildStands(root, M, hazardMat);
  buildColumns(root, M);
  buildCatwalk(root, M);
  buildTrussRig(root, M);
  buildSign(root);
  buildScreens(root);
  const lamps = buildLights(root);

  // Drop the whole hall so its floor sits below the platforms (the stage brings
  // the play area back to y=0). Then bake world matrices once and stop the
  // per-frame matrix walk — update() only tweaks emissive intensity, no moves.
  root.position.y = -FLOOR_DROP;
  root.updateMatrixWorld(true);
  root.matrixWorldAutoUpdate = false;

  return {
    root,
    update: (_delta, time) => {
      for (const p of pulse) p.mat.emissiveIntensity = p.base + p.amp * Math.sin(time * p.speed + p.phase);
      // The two coloured pit lights breathe in counterpoint for a live feel.
      lamps.ember.intensity = 5.5 + 1.5 * Math.sin(time * 1.7);
      lamps.cool.intensity = 5.0 + 1.3 * Math.sin(time * 1.3 + 1.6);
    },
  };
}

// --- the enclosing void + floor --------------------------------------------

function buildShell(root: Group): void {
  // A big inward-facing near-black box paints out the AR passthrough.
  const shell = new Mesh(
    new BoxGeometry(140, 90, 140),
    new MeshBasicMaterial({ color: 0x05060a, side: BackSide }),
  );
  shell.position.set(0, 25, 0);
  root.add(shell);
}

function buildFloor(root: Group, M: Mats): void {
  const span = ROOM.half * 2;
  place(root, box(span, 0.2, span, M.floor), 0, -0.1, 0);
  // A faint inner pit slab (slightly different dark) to frame the play area.
  const pit = box(ROOM.pitHalf * 2 + 1.2, 0.21, ROOM.pitHalf * 2 + 1.2, M.concrete);
  place(root, pit, 0, -0.095, 0);
}

/** The raised central STAGE the platforms stand on — its top is at world y=0
 *  (so platforms sit flush) while the surrounding hall floor is FLOOR_DROP
 *  lower. Hazard tape wraps the riser; a neon line rims the top edge. */
function buildStage(root: Group, M: Mats, hazard: MeshStandardMaterial): void {
  const half = STAGE_HALF;
  // Raised slab: spans local y 0 → FLOOR_DROP (top = world 0 after the drop).
  place(root, box(half * 2, FLOOR_DROP, half * 2, M.concrete), 0, FLOOR_DROP / 2, 0);
  // Hazard-taped riser band around all four vertical faces.
  const band = 0.42;
  const bandY = FLOOR_DROP - band / 2;
  for (const [w, d, x, z] of [
    [half * 2, 0.08, 0, -half],
    [half * 2, 0.08, 0, half],
    [0.08, half * 2, -half, 0],
    [0.08, half * 2, half, 0],
  ] as Array<[number, number, number, number]>) {
    place(root, box(w, band, d, hazard), x, bandY, z);
  }
  // Neon rim line along the top edge (ember front/back, cool sides).
  place(root, box(half * 2, 0.05, 0.08, M.ember), 0, FLOOR_DROP + 0.01, -half);
  place(root, box(half * 2, 0.05, 0.08, M.ember), 0, FLOOR_DROP + 0.01, half);
  place(root, box(0.08, 0.05, half * 2, M.cool), -half, FLOOR_DROP + 0.01, 0);
  place(root, box(0.08, 0.05, half * 2, M.cool), half, FLOOR_DROP + 0.01, 0);
}

/** A neon-edged ring at the sunken-floor boundary to the stands. */
function buildPitBarrier(root: Group, M: Mats): void {
  const r = ROOM.pitHalf;
  // Glowing ground line on all four edges (ember front/back, cool sides).
  const line = (w: number, d: number, x: number, z: number, m: MeshStandardMaterial): void => {
    place(root, box(w, 0.05, d, m), x, 0.03, z);
  };
  line(r * 2, 0.12, 0, -r, M.ember); // far edge (behind opponent)
  line(r * 2, 0.12, 0, r, M.ember); // near edge (behind player)
  line(0.12, r * 2, -r, 0, M.cool);
  line(0.12, r * 2, r, 0, M.cool);

  // Low kerb posts with neon caps around the ring corners + midpoints.
  const post = (x: number, z: number): void => {
    place(root, box(0.16, 0.34, 0.16, M.steelDark), x, 0.17, z);
    place(root, box(0.2, 0.05, 0.2, M.amber), x, 0.36, z);
  };
  for (const s of [-1, 1]) {
    post(s * r, -r);
    post(s * r, r);
    post(s * r, 0);
    post(0, s * r);
  }
}

// --- ribbed dark walls with a neon crown + clerestory glow ------------------

function buildWalls(root: Group, M: Mats): void {
  const h = ROOM.half;
  const buildWall = (len: number, x: number, z: number, rotY: number, accent: MeshStandardMaterial): void => {
    const g = new Group();
    g.add(box(len, 1.6, ROOM.wallT, M.wainscot).translateY(0.8));
    g.add(box(len, ROOM.height - 1.6, ROOM.wallT, M.wall).translateY(1.6 + (ROOM.height - 1.6) / 2));
    // Sparse vertical ribs.
    const ribs = Math.floor(len / 3);
    for (let i = 0; i <= ribs; i++) {
      const rx = -len / 2 + (i / ribs) * len;
      g.add(box(0.14, ROOM.height - 1.8, 0.1, M.steelDark).translateX(rx).translateY(ROOM.height / 2 + 0.2).translateZ(ROOM.wallT / 2));
    }
    // Rust streaks weeping down the cladding for a grimy, used look.
    for (let i = 0; i < Math.floor(len / 5); i++) {
      const rx = -len / 2 + ((i + 0.5) / Math.floor(len / 5)) * len + (i % 2 ? 1.3 : -0.8);
      const sh = 2 + (i % 3);
      g.add(box(0.18 + (i % 2) * 0.12, sh, 0.04, M.rust).translateX(rx).translateY(2 + sh / 2).translateZ(ROOM.wallT / 2 + 0.02));
    }
    // Neon crown strip running the top of the wall, and a clerestory glow band.
    g.add(box(len, 0.12, 0.12, accent).translateY(ROOM.height - 0.3).translateZ(ROOM.wallT / 2));
    g.add(box(len - 1, 0.5, 0.06, M.glass).translateY(ROOM.height - 1.4).translateZ(ROOM.wallT / 2 + 0.02));
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    root.add(g);
  };
  buildWall(h * 2, 0, -h, 0, M.ember); // far wall (behind opponent) — ember crown
  buildWall(h * 2, 0, h, 0, M.ember); // near wall (behind player)
  buildWall(h * 2, -h, 0, Math.PI / 2, M.cool);
  buildWall(h * 2, h, 0, Math.PI / 2, M.cool);
  // Flat dark ceiling deck.
  place(root, box(h * 2, 0.3, h * 2, M.steelDark), 0, ROOM.height, 0);
}

// --- tiered stands ringing the pit ------------------------------------------

function buildStands(root: Group, M: Mats, hazard: MeshStandardMaterial): void {
  const { pitHalf, standTiers, tierRise, tierDepth, standSpan } = ROOM;
  const accentFor = (dir: string): MeshStandardMaterial => (dir === 'n' || dir === 's' ? M.emberDim : M.coolDim);
  for (const dir of ['n', 's', 'e', 'w'] as const) {
    const accent = accentFor(dir);
    const long = dir === 'n' || dir === 's'; // tiers run along x (n/s) or z (e/w)
    const sign = dir === 'n' || dir === 'w' ? -1 : 1;
    // Hazard-taped kick-plate along the foot of the stand, facing the pit.
    const kickFront = pitHalf + 0.4 - tierDepth / 2;
    place(
      root,
      box(long ? standSpan : 0.06, 0.55, long ? 0.06 : standSpan, hazard),
      long ? 0 : sign * kickFront,
      0.18,
      long ? sign * kickFront : 0,
    );
    for (let i = 0; i < standTiers; i++) {
      const y = 0.35 + i * tierRise;
      const back = pitHalf + 0.4 + i * tierDepth; // distance from centre to this tier
      const w = long ? standSpan : tierDepth;
      const d = long ? tierDepth : standSpan;
      const x = long ? 0 : sign * back;
      const z = long ? sign * back : 0;
      place(root, box(w, tierRise + 0.12, d, i % 2 ? M.stand : M.standRiser), x, y, z);
      // Neon nosing along the pit-facing top edge of the tier.
      const noseFront = back - tierDepth / 2; // edge nearest the pit
      const nose = box(long ? standSpan : 0.07, 0.07, long ? 0.07 : standSpan, accent);
      place(root, nose, long ? 0 : sign * noseFront, y + tierRise / 2 + 0.06, long ? sign * noseFront : 0);
    }
    // A dark back wall closing off the top of the stand.
    const topBack = pitHalf + 0.4 + standTiers * tierDepth;
    const backH = 1.4;
    const bw = long ? standSpan : 0.3;
    const bd = long ? 0.3 : standSpan;
    place(root, box(bw, backH, bd, M.wainscot), long ? 0 : sign * topBack, 0.35 + standTiers * tierRise + backH / 2 - 0.4, long ? sign * topBack : 0);
  }
}

// --- structural dressing: I-beam columns + a high catwalk band --------------

function buildColumns(root: Group, M: Mats): void {
  const r = ROOM.half - 0.8;
  const beam = (x: number, z: number): void => {
    const g = new Group();
    g.add(box(0.1, ROOM.height, 0.36, M.steel));
    g.add(box(0.42, ROOM.height, 0.1, M.steel).translateZ(0.16));
    g.add(box(0.42, ROOM.height, 0.1, M.steel).translateZ(-0.16));
    place(root, g, x, ROOM.height / 2, z);
  };
  for (const i of [-2, 0, 2]) {
    beam(i * 7, -r);
    beam(i * 7, r);
  }
  for (const i of [-1, 1]) {
    beam(-r, i * 7);
    beam(r, i * 7);
  }
}

function buildCatwalk(root: Group, M: Mats): void {
  const h = ROOM.half;
  const y = ROOM.catwalkY;
  const depth = 1.8;
  const deck = (len: number, x: number, z: number, rotY: number, accent: MeshStandardMaterial): void => {
    const g = new Group();
    g.add(box(len, 0.16, depth, M.steelDark));
    // Neon handrail along the inner edge.
    g.add(box(len, 0.07, 0.07, accent).translateY(0.6).translateZ(-depth / 2));
    g.add(box(len, 0.05, 0.05, M.steel).translateY(0.3).translateZ(-depth / 2));
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    root.add(g);
  };
  deck(h * 2, 0, -h + depth / 2, 0, M.amber);
  deck(h * 2, 0, h - depth / 2, 0, M.amber);
  deck(h * 2, -h + depth / 2, 0, Math.PI / 2, M.amber);
  deck(h * 2, h - depth / 2, 0, Math.PI / 2, M.amber);
}

// --- overhead lighting truss + housings -------------------------------------

function buildTrussRig(root: Group, M: Mats): void {
  const y = ROOM.trussY;
  const r = ROOM.pitHalf + 1.5;
  // A square truss ring over the pit.
  const member = (len: number, x: number, z: number, rotY: number): void => {
    const g = new Group();
    g.add(box(len, 0.16, 0.16, M.steelDark));
    g.add(box(len, 0.16, 0.16, M.steelDark).translateY(0.5));
    const bays = Math.floor(len / 2.6);
    for (let i = 0; i <= bays; i++) g.add(box(0.08, 0.5, 0.08, M.steelDark).translateX(-len / 2 + (i / bays) * len).translateY(0.25));
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    root.add(g);
  };
  member(r * 2, 0, -r, 0);
  member(r * 2, 0, r, 0);
  member(r * 2, -r, 0, Math.PI / 2);
  member(r * 2, r, 0, Math.PI / 2);
  // Lamp housings hanging off the ring, aimed in at the pit (amber glow discs).
  for (const [x, z] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, -r], [0, r]] as Array<[number, number]>) {
    place(root, box(0.5, 0.3, 0.5, M.steelDark), x, y - 0.2, z);
    const lens = new Mesh(new CylinderGeometry(0.22, 0.22, 0.04, 16), M.amber);
    lens.rotation.x = Math.PI / 2;
    place(root, lens, x, y - 0.37, z);
  }
}

// --- the FIRE FIGHT neon sign on the far wall (behind the opponent) ---------

function buildSign(root: Group): void {
  const tex = screenTexture((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = stencilFont(120);
    ctx.lineWidth = 16;
    ctx.strokeStyle = 'rgba(4,3,2,0.9)';
    ctx.strokeText(GAME_TITLE, w / 2, h / 2);
    ctx.shadowColor = '#ff7a18';
    ctx.shadowBlur = 40;
    ctx.fillStyle = '#ffb37a';
    ctx.fillText(GAME_TITLE, w / 2, h / 2);
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#fff2e6';
    ctx.fillText(GAME_TITLE, w / 2, h / 2);
  }, 1024, 256);
  const sign = new Mesh(
    new PlaneGeometry(7, 1.75),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide }),
  );
  sign.position.set(0, 6.6, -ROOM.half + 0.5);
  root.add(sign);
}

// --- two big wall screens on the side walls ---------------------------------

function buildScreens(root: Group): void {
  const tex = screenTexture((ctx, w, h) => {
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(79,183,255,0.5)';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = stencilFont(70);
    ctx.fillStyle = '#9fe2ff';
    ctx.shadowColor = '#4fb7ff';
    ctx.shadowBlur = 24;
    ctx.fillText('IRON BALLS', w / 2, h * 0.36);
    ctx.font = "700 40px 'Arial Narrow', system-ui, sans-serif";
    ctx.fillStyle = '#ffb000';
    ctx.shadowColor = '#ff7a18';
    ctx.fillText('— NOW FIGHTING —', w / 2, h * 0.68);
    ctx.shadowBlur = 0;
  }, 640, 320);
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  for (const sx of [-1, 1]) {
    const screen = new Mesh(new PlaneGeometry(4, 2), mat);
    screen.position.set(sx * (ROOM.half - 0.5), 6.2, 0);
    screen.rotation.y = -sx * (Math.PI / 2);
    root.add(screen);
  }
}

// --- lighting: dark, with two coloured pit lights ---------------------------

interface PitLights {
  ember: PointLight;
  cool: PointLight;
}

function buildLights(root: Group): PitLights {
  root.add(new HemisphereLight(0x3a4654, 0x05060a, 0.32));
  root.add(new AmbientLight(0x2a3038, 0.14));
  // A soft top-down key for form (no shadow — keeps it cheap).
  const key = new DirectionalLight(0xbfd0e0, 0.4);
  key.position.set(2, 14, 4);
  key.castShadow = false;
  root.add(key);
  // Two coloured lights wash the pit — ember from the far side, cool from near.
  const ember = new PointLight(PALETTE.ember, 5.5, 16, 2);
  ember.position.set(0, 3.4, -4);
  ember.castShadow = false;
  root.add(ember);
  const cool = new PointLight(PALETTE.coolFlame, 5, 16, 2);
  cool.position.set(0, 3.4, 4);
  cool.castShadow = false;
  root.add(cool);
  return { ember, cool };
}

// Wall thickness lives on ROOM but TS wants it declared with the rest.
interface Mats {
  concrete: MeshStandardMaterial;
  floor: MeshStandardMaterial;
  wall: MeshStandardMaterial;
  wainscot: MeshStandardMaterial;
  steel: MeshStandardMaterial;
  steelDark: MeshStandardMaterial;
  stand: MeshStandardMaterial;
  standRiser: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  rust: MeshStandardMaterial;
  ember: MeshStandardMaterial;
  amber: MeshStandardMaterial;
  cool: MeshStandardMaterial;
  coolDim: MeshStandardMaterial;
  emberDim: MeshStandardMaterial;
}
