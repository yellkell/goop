/**
 * THE IRON TANKARD — the pub itself.
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
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  TorusGeometry,
} from 'three';
import { IBLGradient, type World } from '@iwsdk/core';
import { PALETTE } from '../config.js';
import { diamondPlateTextures } from '../materials/diamondPlate.js';
import { PUB } from './config.js';
import { Panel } from './panel.js';
import type { PubRefs } from './state.js';
import { corkTexture, dartboardTexture, steelWallTexture } from './textures.js';

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

export function buildPub(world: World): PubRefs {
  const root = new Group();
  root.name = 'the-iron-tankard';

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
  mkWall(W * 2, 0, -D, 0); // north (behind the bar)
  mkWall(W * 2, 0, D, Math.PI); // south (booths)
  const eastWall = mkWall(D * 2, W, 0, -Math.PI / 2); // dartboard wall
  mkWall(D * 2, -W, 0, Math.PI / 2); // west

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
    [D * 2, -W + 0.01, 0, Math.PI / 2],
  ] as const) {
    const skirt = new Mesh(new PlaneGeometry(w, 0.05), skirtMat);
    skirt.position.set(x, 0.09, z);
    skirt.rotation.y = ry;
    root.add(skirt);
  }

  // I-beams under the low ceiling — the head-grazing pub feel.
  const beamMat = darkSteel();
  for (const z of [-1.8, -0.3, 1.2]) {
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
  for (const x of [-1.2, -0.4, 0.4, 1.2]) {
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

  const sign = new Panel(2.4, 0.45);
  sign.setLines([{ text: 'THE IRON TANKARD', size: 76, colour: '#ffb000', bold: true }]);
  sign.mesh.position.set(0, 2.0, -D + 0.02);
  root.add(sign.mesh);

  // Stools at the bar.
  for (const x of [-1.6, -0.8, 0.8, 1.6]) {
    const stool = new Group();
    stool.position.set(x, 0, bar.z + 0.45);
    const leg = new Mesh(new CylinderGeometry(0.03, 0.05, 0.62, 8), gunmetal(0.3));
    leg.position.y = 0.31;
    stool.add(leg);
    const seat = new Mesh(
      new CylinderGeometry(0.17, 0.17, 0.06, 12),
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

  // --- booths along the south wall ---------------------------------------------
  for (const bx of [-3, 0, 3]) {
    root.add(buildBooth(bx));
  }

  // --- darts corner -------------------------------------------------------------
  const darts = PUB.darts;
  // Cork blast circle behind/around the board.
  const corkSurround = new Mesh(
    new CircleGeometry(darts.surroundRadius, 24),
    new MeshStandardMaterial({ map: corkTexture(), roughness: 0.95 }),
  );
  corkSurround.name = 'cork-surround';
  corkSurround.position.set(darts.boardX - 0.005, darts.boardY, darts.boardZ);
  corkSurround.rotation.y = -Math.PI / 2;
  root.add(corkSurround);
  // Steel cabinet ring around the cork.
  const cabinetRing = new Mesh(new TorusGeometry(darts.surroundRadius, 0.025, 8, 28), gunmetal(0.3));
  cabinetRing.position.copy(corkSurround.position);
  cabinetRing.rotation.y = -Math.PI / 2;
  root.add(cabinetRing);
  // The board itself.
  const dartboard = new Mesh(
    new CircleGeometry(darts.boardRadius, 40),
    new MeshStandardMaterial({ map: dartboardTexture(), roughness: 0.9, side: DoubleSide }),
  );
  dartboard.name = 'dartboard';
  dartboard.position.set(darts.boardX, darts.boardY, darts.boardZ);
  dartboard.rotation.y = -Math.PI / 2;
  root.add(dartboard);
  // Spot lamp over the board.
  const boardLight = new PointLight(0xfff0d8, 4, 3.5, 1.5);
  boardLight.position.set(darts.boardX - 0.6, darts.boardY + 0.7, darts.boardZ);
  root.add(boardLight);

  // Oche (throw line): hazard tape on the diamond plate.
  const oche = new Mesh(
    new PlaneGeometry(0.08, 1.2),
    new MeshStandardMaterial({ color: PALETTE.amber, emissive: PALETTE.amber, emissiveIntensity: 0.35 }),
  );
  oche.rotation.x = -Math.PI / 2;
  oche.position.set(darts.ocheX, 0.012, darts.boardZ);
  root.add(oche);

  // Dart rack: a steel ledge holding the house darts.
  const rackSlots: [number, number, number][] = [];
  const rack = new Mesh(new BoxGeometry(0.04, 0.03, 0.7), gunmetal(0.3));
  rack.position.set(darts.wallX - 0.07, 1.15, darts.boardZ + 1.05);
  root.add(rack);
  for (let i = 0; i < darts.rackSlots; i++) {
    rackSlots.push([darts.wallX - 0.09, 1.19, darts.boardZ + 0.78 + i * 0.105]);
  }

  // Leaderboard panel left of the board.
  const dartsBoardPanel = new Panel(0.85, 0.7);
  dartsBoardPanel.mesh.position.set(darts.wallX - 0.02, 1.7, darts.boardZ - 1.15);
  dartsBoardPanel.mesh.rotation.y = -Math.PI / 2;
  root.add(dartsBoardPanel.mesh);

  // --- IRON SNAKE arcade cabinet (north-west corner) -----------------------------
  const arcadePos: [number, number, number] = [-3.75, 0, -2.25];
  const { cabinet, screen } = buildArcadeCabinet();
  cabinet.position.set(arcadePos[0], 0, arcadePos[2]);
  cabinet.rotation.y = Math.PI / 4 + Math.PI / 2; // face south-east into the room
  root.add(cabinet);

  const hiScorePanel = new Panel(0.9, 0.3);
  hiScorePanel.mesh.position.set(-3.55, 2.05, -2.45);
  hiScorePanel.mesh.rotation.y = Math.PI / 4 + Math.PI / 2;
  root.add(hiScorePanel.mesh);

  // --- pint glass home slots on the bar -------------------------------------------
  const glassSlots: [number, number, number][] = [];
  for (let i = 0; i < PUB.glassCount; i++) {
    glassSlots.push([-2.1 + i * 0.6, bar.top + 0.002, bar.z - 0.28]);
  }

  world.scene.add(root);

  return {
    root,
    dartboard,
    corkSurround,
    dartCatchers: [eastWall],
    dartRackSlots: rackSlots,
    glassSlots,
    dartsBoardPanel,
    arcadeScreen: screen,
    arcadePos,
    hiScorePanel,
  };
}

/** A booth: padded bench against the south wall + a steel pedestal table. */
function buildBooth(x: number): Group {
  const booth = new Group();
  const pad = new MeshStandardMaterial({ color: 0x5a2a20, roughness: 0.85 });

  const seatBase = new Mesh(new BoxGeometry(1.5, 0.42, 0.5), darkSteel());
  seatBase.position.set(x, 0.21, 2.72);
  booth.add(seatBase);
  const cushion = new Mesh(new BoxGeometry(1.46, 0.08, 0.46), pad);
  cushion.position.set(x, 0.46, 2.72);
  booth.add(cushion);
  const backrest = new Mesh(new BoxGeometry(1.5, 0.6, 0.1), pad);
  backrest.position.set(x, 0.8, 2.94);
  booth.add(backrest);
  const trim = new Mesh(new BoxGeometry(1.5, 0.04, 0.11), amberGlow(0.3));
  trim.position.set(x, 1.12, 2.94);
  booth.add(trim);

  // Table matching SURFACES in config.ts: 0.9 m square top at y 0.78.
  const pedestal = new Mesh(new CylinderGeometry(0.05, 0.16, 0.76, 8), gunmetal(0.3));
  pedestal.position.set(x, 0.38, 2.3);
  booth.add(pedestal);
  const tabletop = new Mesh(new BoxGeometry(0.9, 0.04, 0.9), gunmetal(0.25));
  tabletop.position.set(x, 0.76, 2.3);
  booth.add(tabletop);
  const edge = new Mesh(new BoxGeometry(0.92, 0.015, 0.92), darkSteel());
  edge.position.set(x, 0.783, 2.3);
  booth.add(edge);

  return booth;
}

/** Classic upright cabinet: marquee, angled screen, control deck, side art. */
function buildArcadeCabinet(): { cabinet: Group; screen: Mesh } {
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
  marquee.position.set(0, 1.84, 0.21);
  cabinet.add(marquee);
  const marqueeText = new Panel(0.6, 0.2);
  marqueeText.setLines([{ text: 'IRON SNAKE', size: 60, colour: '#39ff14', bold: true }]);
  marqueeText.mesh.position.set(0, 1.84, 0.301);
  cabinet.add(marqueeText.mesh);

  // Screen: angled back CRT face. The SnakeSystem owns its canvas texture.
  const bezel = new Mesh(new BoxGeometry(0.56, 0.46, 0.06), darkSteel());
  bezel.position.set(0, 1.42, 0.27);
  bezel.rotation.x = -0.18;
  cabinet.add(bezel);
  const screen = new Mesh(
    new PlaneGeometry(0.46, 0.36),
    new MeshBasicMaterial({ color: 0x041204 }),
  );
  screen.name = 'snake-screen';
  screen.position.set(0, 1.42, 0.302);
  screen.rotation.x = -0.18;
  cabinet.add(screen);

  // Control deck: joystick + two buttons.
  const deck = new Mesh(new BoxGeometry(0.6, 0.07, 0.3), gunmetal(0.3));
  deck.position.set(0, 1.05, 0.38);
  deck.rotation.x = 0.12;
  cabinet.add(deck);
  const stick = new Mesh(new CylinderGeometry(0.012, 0.012, 0.1, 6), darkSteel());
  stick.position.set(-0.12, 1.13, 0.38);
  cabinet.add(stick);
  const ball = new Mesh(
    new CylinderGeometry(0.028, 0.028, 0.03, 10),
    new MeshStandardMaterial({ color: 0xe8352a, roughness: 0.4 }),
  );
  ball.position.set(-0.12, 1.18, 0.38);
  cabinet.add(ball);
  for (const [bx, c] of [
    [0.08, 0x39ff14],
    [0.18, 0xe8352a],
  ] as const) {
    const button = new Mesh(
      new CylinderGeometry(0.022, 0.026, 0.018, 10),
      new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.4, roughness: 0.4 }),
    );
    button.position.set(bx, 1.095, 0.39);
    button.rotation.x = 0.12;
    cabinet.add(button);
  }

  // Glow under the marquee so the corner reads from across the room.
  const glow = new PointLight(0x39ff14, 1.6, 2.2, 1.8);
  glow.position.set(0, 1.6, 0.45);
  cabinet.add(glow);

  return { cabinet, screen };
}
