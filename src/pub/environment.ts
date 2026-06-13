/**
 * IRON BALLS PUB — the pub itself.
 *
 * A low-ceilinged steel boozer in the FIRE FIGHT language: diamond-plate
 * floor, riveted gunmetal walls, hazard-amber trim, I-beams you can almost
 * graze your head on. Around the room: the bar with taps and a shelf of
 * bottles, three booths, stools, the dartboard corner (board, cork surround,
 * oche line, rack, leaderboard) and the IRON SNAKE arcade cabinet.
 *
 * Pure VR scene (not passthrough): we paint every surface ourselves.
 */

import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  TorusGeometry,
  Vector2,
} from 'three';
import { IBLGradient, type World } from '@iwsdk/core';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { OCTAGON_VERTICES, PALETTE, teamColor } from '../config.js';
import { diamondPlateTextures } from '../materials/diamondPlate.js';
import { octagonSlab } from '../arena/octagon.js';
import { FIGHT, PUB } from './config.js';
import { Panel } from './panel.js';
import { buildSign } from './signs.js';
import type { PubRefs } from './state.js';
import { corkTexture, dartboardTexture, fabricTexture, steelWallTexture, woodTexture } from './textures.js';

function rgba(hex: number, a = 1): [number, number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b, a];
}

const gunmetal = (rough = 0.35): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: PALETTE.gunmetal, metalness: 0.85, roughness: rough });
const darkSteel = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: PALETTE.gunmetalDark, metalness: 0.8, roughness: 0.5 });
const amberGlow = (intensity = 1.2): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color: PALETTE.amber,
    emissive: PALETTE.amber,
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.4,
  });

/** A box with softened edges — for upholstered/wood furniture corners. */
function roundedBox(w: number, h: number, d: number, r = 0.04): RoundedBoxGeometry {
  const rr = Math.min(r, Math.min(w, h, d) * 0.49);
  return new RoundedBoxGeometry(w, h, d, 4, rr);
}

/**
 * A round upholstered puck (stool cushion) with filleted top and bottom
 * rims — a lathe of a rounded-corner profile, origin at the puck centre.
 */
function roundedPuck(radius: number, height: number, fillet = 0.025): LatheGeometry {
  const r = Math.min(fillet, radius * 0.49, height * 0.49);
  const hh = height / 2;
  const pts: Vector2[] = [new Vector2(0, -hh)];
  // Bottom rim fillet: from the flat underside out to the side wall.
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    pts.push(new Vector2(radius - r + Math.cos(a) * r, -hh + r + Math.sin(a) * r));
  }
  // Top rim fillet: up the side wall, then in across the top.
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new Vector2(radius - r + Math.cos(a) * r, hh - r + Math.sin(a) * r));
  }
  pts.push(new Vector2(0, hh));
  return new LatheGeometry(pts, 24);
}

export function buildPub(world: World): PubRefs {
  const root = new Group();
  root.name = 'iron-balls-pub';

  const W = PUB.halfWidth;
  const D = PUB.halfDepth;
  const H = PUB.ceiling;

  // Warm dim base light: amber from the lamps below, cold steel from above.
  world.scene.background = new Color(0x0c0d11);
  const env = world.createTransformEntity(undefined, { persistent: true });
  env.addComponent(IBLGradient, {
    sky: rgba(0x4a5160),
    equator: rgba(0x8a7a60),
    ground: rgba(0x6e4a26),
    intensity: 0.55,
  });

  // --- shell: floor, ceiling, walls -----------------------------------------
  const plate = diamondPlateTextures();
  plate.map.repeat.set(9, 6);
  plate.bumpMap.repeat.set(9, 6);
  const floor = new Mesh(
    new PlaneGeometry(W * 2, D * 2),
    new MeshStandardMaterial({
      map: plate.map,
      bumpMap: plate.bumpMap,
      bumpScale: 0.6,
      metalness: 0.75,
      roughness: 0.45,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  const ceiling = new Mesh(
    new PlaneGeometry(W * 2, D * 2),
    new MeshStandardMaterial({ color: 0x1b1d23, metalness: 0.6, roughness: 0.8 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  root.add(ceiling);

  const wallTex = steelWallTexture([4, 1.4]);
  const wallMat = new MeshStandardMaterial({
    map: wallTex,
    metalness: 0.7,
    roughness: 0.55,
  });
  const walls: Mesh[] = [];
  const mkWall = (w: number, x: number, z: number, ry: number): Mesh => {
    const wall = new Mesh(new PlaneGeometry(w, H), wallMat);
    wall.position.set(x, H / 2, z);
    wall.rotation.y = ry;
    root.add(wall);
    walls.push(wall);
    return wall;
  };
  const northWall = mkWall(W * 2, 0, -D, 0); // bar + dartboard wall
  mkWall(W * 2, 0, D, Math.PI); // south (banquette)
  mkWall(D * 2, W, 0, -Math.PI / 2); // east

  // West wall has the doorway through to the fight hall: a wall segment
  // either side of the opening plus a lintel above it.
  const door = FIGHT.door;
  {
    const south = new Mesh(new PlaneGeometry(D - door.z1, H), wallMat);
    south.position.set(-W, H / 2, (door.z1 + D) / 2);
    south.rotation.y = Math.PI / 2;
    root.add(south);
    const north = new Mesh(new PlaneGeometry(door.z0 + D, H), wallMat);
    north.position.set(-W, H / 2, (door.z0 - D) / 2);
    north.rotation.y = Math.PI / 2;
    root.add(north);
    const lintel = new Mesh(new PlaneGeometry(door.z1 - door.z0, H - door.height), wallMat);
    lintel.position.set(-W, (H + door.height) / 2, (door.z0 + door.z1) / 2);
    lintel.rotation.y = Math.PI / 2;
    root.add(lintel);
    // Hazard-striped door frame.
    for (const z of [door.z0, door.z1]) {
      const jamb = new Mesh(new BoxGeometry(0.12, door.height, 0.07), amberGlow(0.3));
      jamb.position.set(-W, door.height / 2, z);
      root.add(jamb);
    }
    const head = new Mesh(new BoxGeometry(0.12, 0.07, door.z1 - door.z0 + 0.07), amberGlow(0.3));
    head.position.set(-W, door.height, (door.z0 + door.z1) / 2);
    root.add(head);
  }

  // Hazard-amber skirting line around the floor edge.
  const skirtMat = new MeshStandardMaterial({
    color: PALETTE.amber,
    emissive: PALETTE.amber,
    emissiveIntensity: 0.25,
    metalness: 0.4,
    roughness: 0.5,
  });
  for (const [w, x, z, ry] of [
    [W * 2, 0, -D + 0.01, 0],
    [W * 2, 0, D - 0.01, Math.PI],
    [D * 2, W - 0.01, 0, -Math.PI / 2],
    // West skirting stops at the doorway.
    [D - door.z1, -W + 0.01, (door.z1 + D) / 2, Math.PI / 2],
    [door.z0 + D, -W + 0.01, (door.z0 - D) / 2, Math.PI / 2],
  ] as const) {
    const skirt = new Mesh(new PlaneGeometry(w, 0.05), skirtMat);
    skirt.position.set(x, 0.09, z);
    skirt.rotation.y = ry;
    root.add(skirt);
  }

  // I-beams under the low ceiling — the head-grazing pub feel.
  const beamMat = darkSteel();
  for (const z of [-1.8, -0.3, 1.2, 2.7]) {
    const beam = new Mesh(new BoxGeometry(W * 2, PUB.beamDrop, 0.14), beamMat);
    beam.position.set(0, H - PUB.beamDrop / 2, z);
    root.add(beam);
    for (const flange of [-1, 1]) {
      const lip = new Mesh(new BoxGeometry(W * 2, 0.025, 0.22), beamMat);
      lip.position.set(0, H - PUB.beamDrop / 2 + flange * (PUB.beamDrop / 2), z);
      root.add(lip);
    }
  }

  // Caged lamps hanging off the beams: warm pools of light.
  for (const [x, z] of [
    [-2.4, -1.8],
    [2.4, -1.8],
    [-2.4, 1.2],
    [2.4, 1.2],
    [0, -0.3],
    [0, 2.7],
    [4.2, 0.6], // over the darts corridor
  ] as const) {
    const lamp = new Group();
    lamp.position.set(x, H - PUB.beamDrop, z);
    const stem = new Mesh(new CylinderGeometry(0.012, 0.012, 0.16, 6), beamMat);
    stem.position.y = -0.08;
    lamp.add(stem);
    const bulb = new Mesh(
      new CylinderGeometry(0.045, 0.06, 0.09, 8),
      new MeshStandardMaterial({
        color: 0xffd9a0,
        emissive: 0xffb24d,
        emissiveIntensity: 2.2,
      }),
    );
    bulb.position.y = -0.2;
    lamp.add(bulb);
    const cage = new Mesh(
      new TorusGeometry(0.07, 0.006, 6, 10),
      darkSteel(),
    );
    cage.position.y = -0.2;
    cage.rotation.x = Math.PI / 2;
    lamp.add(cage);
    const light = new PointLight(0xffb46a, 6, 7, 1.6);
    light.position.y = -0.24;
    lamp.add(light);
    root.add(lamp);
  }

  // --- the bar ----------------------------------------------------------------
  const bar = PUB.bar;
  const counter = new Group();
  // Diamond-plate front panel — the theming statement piece.
  const frontPlate = diamondPlateTextures();
  frontPlate.map.repeat.set(8, 1.4);
  frontPlate.bumpMap.repeat.set(8, 1.4);
  const front = new Mesh(
    new BoxGeometry(bar.halfLength * 2, bar.top - 0.05, 0.04),
    new MeshStandardMaterial({
      map: frontPlate.map,
      bumpMap: frontPlate.bumpMap,
      bumpScale: 0.5,
      metalness: 0.8,
      roughness: 0.4,
    }),
  );
  front.position.set(0, (bar.top - 0.05) / 2, bar.z);
  counter.add(front);
  // Counter top: brushed steel slab with an amber-striped nose edge.
  const top = new Mesh(new BoxGeometry(bar.halfLength * 2 + 0.1, 0.05, bar.depth + 0.12), gunmetal(0.25));
  top.position.set(0, bar.top - 0.025, bar.z - bar.depth / 2 + 0.02);
  counter.add(top);
  const nose = new Mesh(new BoxGeometry(bar.halfLength * 2 + 0.1, 0.052, 0.03), amberGlow(0.4));
  nose.position.set(0, bar.top - 0.025, bar.z + 0.06);
  counter.add(nose);
  // Foot rail.
  const rail = new Mesh(new CylinderGeometry(0.022, 0.022, bar.halfLength * 2, 8), gunmetal(0.2));
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, 0.18, bar.z + 0.12);
  counter.add(rail);
  root.add(counter);

  // Beer taps along the counter.
  for (const x of PUB.tapXs) {
    const tap = new Group();
    tap.position.set(x, bar.top, bar.z - 0.18);
    const body = new Mesh(new CylinderGeometry(0.025, 0.035, 0.26, 8), gunmetal(0.2));
    body.position.y = 0.13;
    tap.add(body);
    const neck = new Mesh(new CylinderGeometry(0.014, 0.014, 0.1, 6), gunmetal(0.2));
    neck.rotation.x = Math.PI / 2.6;
    neck.position.set(0, 0.27, 0.045);
    tap.add(neck);
    const handle = new Mesh(new BoxGeometry(0.035, 0.1, 0.025), amberGlow(0.5));
    handle.position.set(0, 0.33, 0.02);
    handle.rotation.x = -0.25;
    tap.add(handle);
    root.add(tap);
  }

  // Back bar: shelf of glowing bottles + the pub sign.
  const shelf = new Mesh(new BoxGeometry(bar.halfLength * 2, 0.03, 0.22), darkSteel());
  shelf.position.set(0, 1.45, -D + 0.14);
  root.add(shelf);
  const bottleColors = [0xc97a1e, 0x7a3a10, 0x4fb7ff, 0x7dff5a, 0xe8352a, 0xc97a1e, 0xf2e9d4, 0x9f7bff];
  for (let i = 0; i < 14; i++) {
    const c = bottleColors[i % bottleColors.length];
    const bottle = new Mesh(
      new CylinderGeometry(0.03, 0.034, 0.2 + (i % 3) * 0.03, 8),
      new MeshStandardMaterial({
        color: c,
        emissive: c,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.85,
        roughness: 0.2,
      }),
    );
    bottle.position.set(-2.3 + i * 0.36, 1.465 + (0.2 + (i % 3) * 0.03) / 2, -D + 0.14);
    root.add(bottle);
  }

  // The hand-made neon sign mounted on the back-bar wall (PNG if present,
  // procedural neon fallback otherwise — see signs.ts).
  // The PNG is a 1:1 canvas with the sign letterboxed in transparent margins,
  // so the plane is SQUARE (a wide plane would squash the art).
  const sign = buildSign('signs/iron-balls-bar.png', 1.6, 1.6);
  sign.position.set(0, 1.95, -D + 0.03);
  root.add(sign);

  // Stools at the bar.
  for (const x of [-1.6, -0.8, 0.8, 1.6]) {
    const stool = new Group();
    stool.position.set(x, 0, bar.z + 0.45);
    const leg = new Mesh(new CylinderGeometry(0.03, 0.05, 0.62, 8), gunmetal(0.3));
    leg.position.y = 0.31;
    stool.add(leg);
    const seat = new Mesh(
      roundedPuck(0.17, 0.07, 0.03),
      new MeshStandardMaterial({ color: 0x5a2a20, roughness: 0.85 }),
    );
    seat.position.y = 0.65;
    stool.add(seat);
    const ring = new Mesh(new TorusGeometry(0.12, 0.012, 6, 12), darkSteel());
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.22;
    stool.add(ring);
    root.add(stool);
  }

  // --- banquette seating along the south wall ---------------------------------
  // A continuous raised plinth with a channel-backed bench, divided into
  // booths, each with a square table and a freestanding bench opposite —
  // the upmarket-bar look from the reference. Booth centres clear the exit.
  root.add(buildBanquette([-2.3, -0.3, 1.75, 3.8]));

  // --- the EXIT — the door you came in through (south wall, west end).
  // Teleport onto its hazard mat and you're back at the main menu.
  {
    const ex = PUB.exit;
    const cx = (ex.x0 + ex.x1) / 2;
    // Dark doorway inset.
    const void_ = new Mesh(
      new PlaneGeometry(ex.x1 - ex.x0, ex.height),
      new MeshBasicMaterial({ color: 0x05060a }),
    );
    void_.position.set(cx, ex.height / 2, D - 0.015);
    void_.rotation.y = Math.PI;
    root.add(void_);
    for (const x of [ex.x0, ex.x1]) {
      const jamb = new Mesh(new BoxGeometry(0.12, ex.height, 0.07), amberGlow(0.3));
      jamb.position.set(x, ex.height / 2, D - 0.04);
      root.add(jamb);
    }
    const head = new Mesh(new BoxGeometry(ex.x1 - ex.x0 + 0.12, 0.07, 0.07), amberGlow(0.3));
    head.position.set(cx, ex.height, D - 0.04);
    root.add(head);
    const exitSign = new Panel(0.7, 0.16, 384);
    // Centre the label on the plate (setLines baselined it low / clipped).
    exitSign.draw((ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = "900 34px 'Arial Black', system-ui, sans-serif";
      ctx.fillStyle = '#ffb000';
      ctx.fillText('EXIT → ARENA', w / 2, h / 2);
    });
    exitSign.mesh.position.set(cx, ex.height + 0.18, D - 0.05);
    exitSign.mesh.rotation.y = Math.PI;
    root.add(exitSign.mesh);
    // The hazard mat — land a teleport here to leave.
    const mat = new Mesh(
      new PlaneGeometry(ex.x1 - ex.x0, 0.45),
      new MeshStandardMaterial({
        color: PALETTE.amber,
        emissive: PALETTE.amber,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.5,
      }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(cx, 0.012, D - 0.3);
    root.add(mat);
  }

  // --- darts: on the NORTH wall, east end, beside the bar ---------------------
  const darts = PUB.darts;
  // Cork blast circle, set just BEHIND the board (toward the wall).
  const corkSurround = new Mesh(
    new CircleGeometry(darts.surroundRadius, 24),
    new MeshStandardMaterial({ map: corkTexture(), roughness: 0.95 }),
  );
  corkSurround.name = 'cork-surround';
  corkSurround.position.set(darts.boardX, darts.boardY, darts.boardZ - 0.02);
  root.add(corkSurround);
  // Steel cabinet ring around the cork.
  const cabinetRing = new Mesh(new TorusGeometry(darts.surroundRadius, 0.025, 8, 28), gunmetal(0.3));
  cabinetRing.position.copy(corkSurround.position);
  root.add(cabinetRing);
  // The board itself, facing out into the room (+z).
  const dartboard = new Mesh(
    new CircleGeometry(darts.boardRadius, 40),
    new MeshStandardMaterial({ map: dartboardTexture(), roughness: 0.9, side: DoubleSide }),
  );
  dartboard.name = 'dartboard';
  dartboard.position.set(darts.boardX, darts.boardY, darts.boardZ);
  root.add(dartboard);
  // Spot lamp out in front of the board.
  const boardLight = new PointLight(0xfff0d8, 4, 3.5, 1.5);
  boardLight.position.set(darts.boardX, darts.boardY + 0.7, darts.boardZ + 0.6);
  root.add(boardLight);

  // Oche (throw line): hazard tape across the lane, out in the room.
  const oche = new Mesh(
    new PlaneGeometry(1.2, 0.08),
    new MeshStandardMaterial({ color: PALETTE.amber, emissive: PALETTE.amber, emissiveIntensity: 0.35 }),
  );
  oche.rotation.x = -Math.PI / 2;
  oche.position.set(darts.boardX, 0.012, darts.ocheZ);
  root.add(oche);

  // The house dart BOX: an always-stocked open crate on a tall table beside
  // the oche (darts fly back here, so it never runs dry).
  const rackSlots: [number, number, number][] = [];
  const boxX = darts.boardX - 0.85; // toward the bar side, clear of the wall
  const boxZ = darts.ocheZ;
  const tallLeg = new Mesh(new CylinderGeometry(0.04, 0.11, 1.13, 8), gunmetal(0.3));
  tallLeg.position.set(boxX, 0.565, boxZ);
  root.add(tallLeg);
  const tallTop = new Mesh(new BoxGeometry(0.52, 0.04, 0.42), gunmetal(0.25));
  tallTop.position.set(boxX, 1.15, boxZ);
  root.add(tallTop);
  // Open crate walls with a hazard lip.
  const crateBase = new Mesh(new BoxGeometry(0.44, 0.025, 0.34), darkSteel());
  crateBase.position.set(boxX, 1.185, boxZ);
  root.add(crateBase);
  for (const [bw, bd, ox, oz] of [
    [0.44, 0.02, 0, -0.16],
    [0.44, 0.02, 0, 0.16],
    [0.02, 0.34, -0.21, 0],
    [0.02, 0.34, 0.21, 0],
  ] as const) {
    const wall = new Mesh(new BoxGeometry(bw, 0.1, bd), gunmetal(0.4));
    wall.position.set(boxX + ox, 1.23, boxZ + oz);
    root.add(wall);
  }
  const lip = new Mesh(new BoxGeometry(0.46, 0.015, 0.36), amberGlow(0.3));
  lip.position.set(boxX, 1.285, boxZ);
  root.add(lip);
  // Dart home slots: two rows of three STANDING in the crate, flights up,
  // poking above the lip so the box visibly holds darts.
  for (let i = 0; i < darts.rackSlots; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    rackSlots.push([boxX - 0.12 + col * 0.12, 1.3, boxZ - 0.08 + row * 0.16]);
  }

  // Leaderboard panel on the wall, between the board and the bar.
  const dartsBoardPanel = new Panel(0.85, 0.7);
  dartsBoardPanel.mesh.position.set(darts.boardX - 1.15, 1.7, darts.wallZ + 0.02);
  root.add(dartsBoardPanel.mesh);

  // --- IRON SNAKE arcade cabinet (north-west corner) -----------------------------
  const arcadePos: [number, number, number] = [-4.45, 0, -2.85];
  const { cabinet, screen, stick } = buildArcadeCabinet();
  cabinet.position.set(arcadePos[0], 0, arcadePos[2]);
  // Face SOUTH-EAST into the room (it used to face into the bar corner).
  cabinet.rotation.y = Math.PI / 4;
  root.add(cabinet);

  // --- pint glass home slots on the bar -------------------------------------------
  const glassSlots: [number, number, number][] = [];
  // One row along the counter front — all 8 start under the bar and the
  // barkeep sets them here one at a time.
  for (let i = 0; i < PUB.glassMax; i++) {
    glassSlots.push([-2.1 + i * 0.6, bar.top + 0.002, bar.z - 0.24]);
  }

  // --- the fight hall through the west door ---------------------------------
  const { consolePanels, fightDisplay, fightDisplay2, fightRims, fightSlabs } = buildFightHall(root);

  world.scene.add(root);

  return {
    root,
    dartboard,
    corkSurround,
    dartCatchers: [northWall],
    dartRackSlots: rackSlots,
    glassSlots,
    dartsBoardPanel,
    arcadeScreen: screen,
    arcadePos,
    arcadeCabinet: cabinet,
    snakeStick: stick,
    consolePanels,
    fightDisplay,
    fightDisplay2,
    fightRims,
    fightSlabs,
  };
}

/**
 * The FIGHT HALL: a tall annexe west of the pub with the full FIRE FIGHT
 * setup on display — the two octagonal platforms from the arena (ember vs
 * blue corners), claim consoles, a big match display, and a hazard line on
 * the floor marking the (5-yard) ball cage so the crowd knows where the
 * fire stops.
 */
function buildFightHall(root: Group): {
  consolePanels: [Panel, Panel];
  fightDisplay: Panel;
  fightDisplay2: Panel;
  fightRims: [Mesh, Mesh];
  fightSlabs: [Mesh, Mesh];
} {
  const hall = FIGHT.hall;
  const cx = (hall.minX + hall.maxX) / 2;
  const w = hall.maxX - hall.minX;
  const d = hall.maxZ - hall.minZ;
  const h = hall.height;

  // Floors: a stands ring at base level around the SUNKEN PIT (the cage
  // rect dug FIGHT.pitDepth into the ground), pit walls between the levels.
  const plate = diamondPlateTextures();
  plate.map.repeat.set(w, d);
  plate.bumpMap.repeat.set(w, d);
  const floorMat = new MeshStandardMaterial({
    map: plate.map,
    bumpMap: plate.bumpMap,
    bumpScale: 0.6,
    metalness: 0.75,
    roughness: 0.45,
  });
  const cage = FIGHT.cage;
  const pit = FIGHT.pitDepth;
  const strip = (sw: number, sd: number, x: number, z: number, y: number): void => {
    const f = new Mesh(new PlaneGeometry(sw, sd), floorMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, y, z);
    root.add(f);
  };
  // Stands ring (y = 0): west / east / north / south strips around the pit.
  strip(cage.minX - hall.minX, d, (hall.minX + cage.minX) / 2, 0, 0);
  strip(hall.maxX - cage.maxX, d, (cage.maxX + hall.maxX) / 2, 0, 0);
  strip(cage.maxX - cage.minX, cage.minZ - hall.minZ, (cage.minX + cage.maxX) / 2, (hall.minZ + cage.minZ) / 2, 0);
  strip(cage.maxX - cage.minX, hall.maxZ - cage.maxZ, (cage.minX + cage.maxX) / 2, (cage.maxZ + hall.maxZ) / 2, 0);
  // The pit floor.
  strip(cage.maxX - cage.minX, cage.maxZ - cage.minZ, (cage.minX + cage.maxX) / 2, 0, -pit);
  // Pit walls, facing inward, with a hazard lip along the rim.
  const pitWallMat = new MeshStandardMaterial({ map: steelWallTexture([6, 0.6]), metalness: 0.7, roughness: 0.55 });
  const pitWall = (pw: number, x: number, z: number, ry: number): void => {
    const wall = new Mesh(new PlaneGeometry(pw, pit), pitWallMat);
    wall.position.set(x, -pit / 2, z);
    wall.rotation.y = ry;
    root.add(wall);
  };
  pitWall(cage.maxX - cage.minX, (cage.minX + cage.maxX) / 2, cage.minZ, 0);
  pitWall(cage.maxX - cage.minX, (cage.minX + cage.maxX) / 2, cage.maxZ, Math.PI);
  pitWall(cage.maxZ - cage.minZ, cage.minX, 0, Math.PI / 2);
  pitWall(cage.maxZ - cage.minZ, cage.maxX, 0, -Math.PI / 2);

  // Bench stands: TWO TIERS around three sides (consoles own the east side).
  // The front row sits low at the pit rim; the back row is raised on a riser
  // so the crowd behind sees over the heads in front — a little stadium rake.
  const benchSteel = darkSteel();
  const riserMat = new MeshStandardMaterial({ map: steelWallTexture([6, 1]), metalness: 0.7, roughness: 0.6 });
  const benchPad = new MeshStandardMaterial({ map: fabricTexture('#5a2a20', [6, 1]), roughness: 0.85 });
  const bench = (len: number, x: number, z: number, ry: number, lift: number): void => {
    const seat = new Mesh(new BoxGeometry(len, 0.42, 0.38), benchSteel);
    seat.position.set(x, 0.21 + lift, z);
    seat.rotation.y = ry;
    root.add(seat);
    const cushion = new Mesh(new BoxGeometry(len, 0.06, 0.34), benchPad);
    cushion.position.set(x, 0.45 + lift, z);
    cushion.rotation.y = ry;
    root.add(cushion);
  };
  // A step deck from the floor up to the back-row seat foot.
  const riser = (len: number, x: number, z: number, ry: number, height: number, depth: number): void => {
    const step = new Mesh(new BoxGeometry(len, height, depth), riserMat);
    step.position.set(x, height / 2, z);
    step.rotation.y = ry;
    root.add(step);
  };
  const FRONT = 0.7; // offset of the low front row from the rim
  const BACK = 1.65; // offset of the raised back row
  const LIFT = 0.45; // how high the back tier rides
  const sideLen = cage.maxX - cage.minX - 1.2;
  const westLen = cage.maxZ - cage.minZ - 1.2;
  const midX = (cage.minX + cage.maxX) / 2;
  // Risers under the back tier (one long step per side).
  riser(sideLen + 0.4, midX, cage.minZ - BACK + 0.05, 0, LIFT, 0.95);
  riser(sideLen + 0.4, midX, cage.maxZ + BACK - 0.05, 0, LIFT, 0.95);
  riser(westLen + 0.4, cage.minX - BACK + 0.05, 0, Math.PI / 2, LIFT, 0.95);
  // Front (low) tier.
  bench(sideLen, midX, cage.minZ - FRONT, 0, 0);
  bench(sideLen, midX, cage.maxZ + FRONT, 0, 0);
  bench(westLen, cage.minX - FRONT, 0, Math.PI / 2, 0);
  // Back (raised) tier.
  bench(sideLen, midX, cage.minZ - BACK, 0, LIFT);
  bench(sideLen, midX, cage.maxZ + BACK, 0, LIFT);
  bench(westLen, cage.minX - BACK, 0, Math.PI / 2, LIFT);

  const ceiling = new Mesh(
    new PlaneGeometry(w, d),
    new MeshStandardMaterial({ color: 0x16181d, metalness: 0.6, roughness: 0.8 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(cx, h, 0);
  root.add(ceiling);

  const wallTex = steelWallTexture([5, 2]);
  const wallMat = new MeshStandardMaterial({ map: wallTex, metalness: 0.7, roughness: 0.55 });
  const mk = (pw: number, ph: number, x: number, y: number, z: number, ry: number): void => {
    const wall = new Mesh(new PlaneGeometry(pw, ph), wallMat);
    wall.position.set(x, y, z);
    wall.rotation.y = ry;
    root.add(wall);
  };
  mk(w, h, cx, h / 2, hall.minZ, 0); // north
  mk(w, h, cx, h / 2, hall.maxZ, Math.PI); // south
  mk(d, h, hall.minX, h / 2, 0, Math.PI / 2); // far west
  // East wall (shared with the pub) with the matching door opening.
  const door = FIGHT.door;
  mk(hall.maxZ - door.z1, h, hall.maxX, h / 2, (door.z1 + hall.maxZ) / 2, -Math.PI / 2);
  mk(door.z0 - hall.minZ, h, hall.maxX, h / 2, (door.z0 + hall.minZ) / 2, -Math.PI / 2);
  mk(door.z1 - door.z0, h - door.height, hall.maxX, (h + door.height) / 2, (door.z0 + door.z1) / 2, -Math.PI / 2);

  // High beams + lamps: cooler, brighter — a venue, not a snug.
  const beamMat = darkSteel();
  for (const z of [-4.5, 0, 4.5]) {
    const beam = new Mesh(new BoxGeometry(w, 0.22, 0.16), beamMat);
    beam.position.set(cx, h - 0.11, z);
    root.add(beam);
  }
  for (const [x, z, colour, intensity] of [
    [cx, FIGHT.platformZ, 0xfff0d8, 14],
    [cx, -FIGHT.platformZ, 0xfff0d8, 14],
    [hall.minX + 2, 5, 0xffb46a, 8],
    [hall.minX + 2, -5, 0xffb46a, 8],
    [hall.maxX - 2, 5, 0xffb46a, 8],
    [hall.maxX - 2, -5, 0xffb46a, 8],
  ] as const) {
    const light = new PointLight(colour, intensity, 12, 1.7);
    light.position.set(x, h - 0.6, z);
    root.add(light);
  }

  // The two octagonal platforms — the arena's own footprint and colours.
  const consolePanels: Panel[] = [];
  const fightRims: Mesh[] = [];
  const fightSlabs: Mesh[] = [];
  for (const side of [0, 1] as const) {
    const z = side === 0 ? FIGHT.platformZ : -FIGHT.platformZ;
    const accent = teamColor(side);
    // Platforms live INSIDE the pit, their tops flush with the pit floor —
    // fighters stand a level below the crowd, stadium-style. The slab carries
    // a low corner-coloured underglow that FightSystem re-tints to whichever
    // platform skin the claimant picked in customisation (dressRims).
    const slabMat = gunmetal(0.3);
    slabMat.emissive.setHex(accent);
    slabMat.emissiveIntensity = 0.22;
    const slab = new Mesh(
      octagonSlab(OCTAGON_VERTICES as [number, number][], FIGHT.platformThickness),
      slabMat,
    );
    slab.position.set(FIGHT.centerX, -FIGHT.pitDepth - FIGHT.platformThickness, z);
    // The octagon's straight front edge faces −z; side 0 (south) must face north.
    if (side === 0) slab.rotation.y = 0;
    else slab.rotation.y = Math.PI;
    root.add(slab);
    fightSlabs.push(slab);
    // Glowing rim outline at pit-floor level in the corner colour.
    const rim = new Mesh(
      octagonSlab(OCTAGON_VERTICES as [number, number][], 0.02),
      new MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 1.1,
        metalness: 0.2,
        roughness: 0.4,
      }),
    );
    rim.scale.set(1.06, 1, 1.06);
    rim.position.set(FIGHT.centerX, -FIGHT.pitDepth + 0.005, z);
    rim.rotation.y = slab.rotation.y;
    root.add(rim);
    fightRims.push(rim);

    // Claim console: steel pedestal + angled panel, between platform and door.
    const [px, , pz] = FIGHT.consoles[side];
    const pedestal = new Mesh(new CylinderGeometry(0.07, 0.13, 1.0, 8), gunmetal(0.3));
    pedestal.position.set(px, 0.5, pz);
    root.add(pedestal);
    const panel = new Panel(0.62, 0.4);
    panel.mesh.position.set(px, 1.18, pz);
    panel.mesh.rotation.y = Math.PI / 2; // face the doorway (east)
    panel.mesh.rotation.x = -0.35;
    root.add(panel.mesh);
    consolePanels.push(panel);
  }

  // Hazard line along the pit rim (the cage edge — where the fire stops).
  const lineMat = new MeshStandardMaterial({
    color: PALETTE.amber,
    emissive: PALETTE.amber,
    emissiveIntensity: 0.3,
  });
  for (const [lw, ld, x, z] of [
    [cage.maxX - cage.minX, 0.06, (cage.minX + cage.maxX) / 2, cage.minZ],
    [cage.maxX - cage.minX, 0.06, (cage.minX + cage.maxX) / 2, cage.maxZ],
    [0.06, cage.maxZ - cage.minZ, cage.minX, 0],
    [0.06, cage.maxZ - cage.minZ, cage.maxX, 0],
  ] as const) {
    const line = new Mesh(new PlaneGeometry(lw, ld), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.011, z);
    root.add(line);
  }

  // TWO match scoreboards facing opposite ways across the pit, so a
  // spectator on either side reads the health. Each is the IRON BALLS sign
  // (PNG, neon fallback) above a health/status panel — no "FIRE FIGHT" text.
  // West: high on the far wall, facing back toward the door (+x).
  // Signs are square (1:1 art with transparent margins) so they don't squash.
  const fightSign1 = buildSign('signs/iron-balls-bar.png', 2.4, 2.4);
  fightSign1.position.set(hall.minX + 0.04, 3.45, 0);
  fightSign1.rotation.y = Math.PI / 2;
  root.add(fightSign1);
  const fightDisplay = new Panel(3.2, 1.1);
  // Panel pushed 0.1 m PROUD of the sign (toward the viewer) so the two
  // coplanar planes stop z-fighting where they overlapped.
  fightDisplay.mesh.position.set(hall.minX + 0.14, 1.95, 0);
  fightDisplay.mesh.rotation.y = Math.PI / 2;
  root.add(fightDisplay.mesh);

  // East: above the door you came in by, facing into the hall (−x).
  const doorMidZ = (FIGHT.door.z0 + FIGHT.door.z1) / 2;
  const fightSign2 = buildSign('signs/iron-balls-bar.png', 2.0, 2.0);
  fightSign2.position.set(hall.maxX - 0.04, 3.8, doorMidZ);
  fightSign2.rotation.y = -Math.PI / 2;
  root.add(fightSign2);
  const fightDisplay2 = new Panel(3.0, 1.0);
  // Proud of the sign, and lifted clear of the door opening above it.
  fightDisplay2.mesh.position.set(hall.maxX - 0.14, 2.75, doorMidZ);
  fightDisplay2.mesh.rotation.y = -Math.PI / 2;
  root.add(fightDisplay2.mesh);

  return {
    consolePanels: [consolePanels[0], consolePanels[1]],
    fightDisplay,
    fightDisplay2,
    fightRims: [fightRims[0], fightRims[1]],
    fightSlabs: [fightSlabs[0], fightSlabs[1]],
  };
}

/**
 * The banquette run along the south wall: a raised wooden plinth, a
 * continuous channel-backed burgundy bench divided into booths by fins, and
 * for each booth a square table with a freestanding bench opposite — the
 * upmarket-bar layout from the reference. `centres` are the booth x's; the
 * tables match the SURFACES entries in config.ts.
 */
function buildBanquette(centres: number[]): Group {
  const D = PUB.halfDepth;
  const g = new Group();
  g.name = 'banquette';
  const wood = new MeshStandardMaterial({ map: woodTexture('#6b4526', [3, 1]), roughness: 0.7, metalness: 0.05 });
  const woodDark = new MeshStandardMaterial({ map: woodTexture('#4a2f1a', [2, 1]), roughness: 0.75 });
  const pad = new MeshStandardMaterial({ map: fabricTexture('#4e1f2d', [4, 1]), roughness: 0.9 });
  const tableMat = new MeshStandardMaterial({ map: woodTexture('#2a1d16', [1, 1]), roughness: 0.5, metalness: 0.25 });

  const x0 = centres[0] - 1.0;
  const x1 = centres[centres.length - 1] + 1.0;
  const span = x1 - x0;
  const midX = (x0 + x1) / 2;
  const PZ = D - 0.55; // bench/back centre line, against the wall
  const STEP = 0.12; // plinth height

  // Raised plinth the whole bench sits on (a step up off the floor).
  const plinth = new Mesh(new BoxGeometry(span + 0.1, STEP, 1.0), wood);
  plinth.position.set(midX, STEP / 2, D - 0.5);
  g.add(plinth);
  const plinthLip = new Mesh(new BoxGeometry(span + 0.1, 0.03, 0.05), woodDark);
  plinthLip.position.set(midX, STEP, D - 1.0);
  g.add(plinthLip);

  // Continuous bench: base box + burgundy cushion, sitting on the plinth.
  const base = new Mesh(roundedBox(span, 0.32, 0.55, 0.05), woodDark);
  base.position.set(midX, STEP + 0.16, PZ);
  g.add(base);
  const cushion = new Mesh(roundedBox(span - 0.04, 0.1, 0.5, 0.05), pad);
  cushion.position.set(midX, STEP + 0.37, PZ);
  g.add(cushion);

  // Tall channel-tufted back against the wall, built from vertical panels.
  const backZ = D - 0.16;
  const backTop = 1.35;
  const panelW = 0.26;
  const nPanels = Math.max(1, Math.round(span / panelW));
  for (let i = 0; i < nPanels; i++) {
    const px = x0 + (i + 0.5) * (span / nPanels);
    const panel = new Mesh(roundedBox((span / nPanels) - 0.03, backTop - (STEP + 0.42), 0.08, 0.04), pad);
    panel.position.set(px, (STEP + 0.42 + backTop) / 2, backZ);
    g.add(panel);
  }
  // Capping rail along the top of the back.
  const rail = new Mesh(roundedBox(span, 0.06, 0.12, 0.03), wood);
  rail.position.set(midX, backTop, backZ);
  g.add(rail);

  // Divider fins between booths + a table and opposite bench per booth.
  const bounds = [x0, ...centres.slice(0, -1).map((_, i) => (centres[i] + centres[i + 1]) / 2), x1];
  for (const bx of bounds) {
    const fin = new Mesh(new BoxGeometry(0.06, backTop - STEP, 0.95), wood);
    fin.position.set(bx, STEP + (backTop - STEP) / 2, D - 0.5);
    g.add(fin);
  }
  for (const cx of centres) {
    // Square table jutting toward the aisle.
    const tz = D - 1.45;
    const pedestal = new Mesh(new CylinderGeometry(0.05, 0.14, 0.72, 8), tableMat);
    pedestal.position.set(cx, 0.36, tz);
    g.add(pedestal);
    const top = new Mesh(roundedBox(0.7, 0.05, 0.7, 0.06), tableMat);
    top.position.set(cx, 0.74, tz);
    g.add(top);
    const edge = new Mesh(roundedBox(0.72, 0.02, 0.72, 0.06), woodDark);
    edge.position.set(cx, 0.765, tz);
    g.add(edge);
    // Freestanding bench across the table, facing the wall.
    const benchBase = new Mesh(roundedBox(0.9, 0.3, 0.4, 0.05), woodDark);
    benchBase.position.set(cx, 0.15, D - 1.95);
    g.add(benchBase);
    const benchPad = new Mesh(roundedBox(0.86, 0.09, 0.36, 0.045), pad);
    benchPad.position.set(cx, 0.35, D - 1.95);
    g.add(benchPad);
    const benchBack = new Mesh(roundedBox(0.9, 0.5, 0.08, 0.04), woodDark);
    benchBack.position.set(cx, 0.6, D - 2.13);
    g.add(benchBack);
  }
  return g;
}

/** Classic upright cabinet: marquee, angled screen, control deck, side art. */
function buildArcadeCabinet(): { cabinet: Group; screen: Mesh; stick: Group } {
  const cabinet = new Group();
  cabinet.name = 'iron-snake-cabinet';

  const body = new Mesh(new BoxGeometry(0.62, 1.75, 0.6), gunmetal(0.45));
  body.position.y = 0.875;
  cabinet.add(body);

  // Hazard-striped side art.
  const stripeMat = new MeshStandardMaterial({
    color: PALETTE.amber,
    emissive: PALETTE.amber,
    emissiveIntensity: 0.2,
    roughness: 0.5,
  });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const stripe = new Mesh(new PlaneGeometry(0.5, 0.06), stripeMat);
      stripe.position.set(side * 0.311, 0.5 + i * 0.18, -0.05 + i * 0.05);
      stripe.rotation.y = side * Math.PI / 2;
      stripe.rotation.z = side * -0.5;
      cabinet.add(stripe);
    }
  }

  // Marquee.
  const marquee = new Mesh(
    new BoxGeometry(0.62, 0.22, 0.18),
    new MeshStandardMaterial({
      color: 0x0d2a0d,
      emissive: 0x39ff14,
      emissiveIntensity: 0.35,
      roughness: 0.4,
    }),
  );
  marquee.position.set(0, 1.86, 0.26); // proud of the body face (0.30) so the
  cabinet.add(marquee);                //  marquee/body fronts don't z-fight
  const marqueeText = new Panel(0.6, 0.2);
  marqueeText.setLines([{ text: 'IRON SNAKE', size: 60, colour: '#39ff14', bold: true }]);
  // Sit the text clearly PROUD of the marquee face (front now at z 0.35).
  marqueeText.mesh.position.set(0, 1.86, 0.36);
  cabinet.add(marqueeText.mesh);

  // Screen: angled back CRT face, pushed PROUD of the body — the tilt used
  // to sink the top half of the screen inside the cabinet box.
  const bezel = new Mesh(new BoxGeometry(0.56, 0.46, 0.06), darkSteel());
  bezel.position.set(0, 1.42, 0.34);
  bezel.rotation.x = -0.18;
  cabinet.add(bezel);
  const screen = new Mesh(
    new PlaneGeometry(0.46, 0.36),
    new MeshBasicMaterial({ color: 0x041204 }),
  );
  screen.name = 'snake-screen';
  screen.position.set(0, 1.42, 0.372);
  screen.rotation.x = -0.18;
  cabinet.add(screen);

  // Control deck JUTS OUT below the screen so the joystick isn't tucked
  // under the screen's overhang (the screen's bottom edge sits near z 0.4).
  const deck = new Mesh(new BoxGeometry(0.6, 0.08, 0.34), gunmetal(0.3));
  deck.position.set(0, 1.0, 0.5);
  deck.rotation.x = 0.18;
  cabinet.add(deck);
  // Bracket linking the jutting deck back to the body.
  const bracket = new Mesh(new BoxGeometry(0.5, 0.1, 0.22), darkSteel());
  bracket.position.set(0, 0.92, 0.4);
  cabinet.add(bracket);
  // The joystick pivots at its base — SnakeSystem tilts this group when a
  // hand pushes the stick around.
  const stick = new Group();
  stick.name = 'snake-joystick';
  stick.position.set(-0.12, 1.04, 0.5);
  const shaft = new Mesh(new CylinderGeometry(0.012, 0.012, 0.1, 6), darkSteel());
  shaft.position.y = 0.05;
  stick.add(shaft);
  const ball = new Mesh(
    new CylinderGeometry(0.028, 0.028, 0.03, 10),
    new MeshStandardMaterial({ color: 0xe8352a, roughness: 0.4 }),
  );
  ball.position.y = 0.105;
  stick.add(ball);
  cabinet.add(stick);
  for (const [bx, c] of [
    [0.08, 0x39ff14],
    [0.18, 0xe8352a],
  ] as const) {
    const button = new Mesh(
      new CylinderGeometry(0.022, 0.026, 0.018, 10),
      new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.4, roughness: 0.4 }),
    );
    button.position.set(bx, 1.04, 0.52);
    button.rotation.x = 0.18;
    cabinet.add(button);
  }

  // Glow under the marquee so the corner reads from across the room.
  const glow = new PointLight(0x39ff14, 1.6, 2.2, 1.8);
  glow.position.set(0, 1.6, 0.45);
  cabinet.add(glow);

  return { cabinet, screen, stick };
}
