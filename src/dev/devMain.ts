/**
 * The creature workbench — a flat-screen Three.js scene (no IWSDK, no XR)
 * that drives the exact same GelCreature you box in passthrough. For shader
 * and sim iteration: orbit it, click it to punch it, key through its moods.
 *
 * Also the automated screenshot rig: `dev.html?shot=<scene>` runs a
 * deterministic little performance and sets `window.__SHOT_READY` when the
 * frame is worth photographing — a headless browser waits on that flag.
 *   shot=glob      resting glob, three-quarter view
 *   shot=boxer     formed up, guard raised
 *   shot=punched   0.35 s after a heavy hit: dent + lumps in flight
 *   shot=reform    1.8 s after the hit: lumps crawling home
 *   shot=ko        the puddle
 */

import {
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GelCreature } from '../creature/GelCreature.js';
import { GooFx } from '../fx/splats.js';
import { buildFist } from '../systems/FistSystem.js';
import { match } from '../state.js';
import { CountdownPlate, WallBoard } from '../ui/hud.js';
import { MenuPanel } from '../ui/menuPanel.js';

declare global {
  interface Window {
    __SHOT_READY?: boolean;
  }
}

const scene = new Scene();
scene.background = new Color(0x14161a);
scene.fog = new Fog(0x14161a, 8, 18);

const camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 60);
camera.position.set(1.4, 1.5, 2.6);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;

scene.add(new HemisphereLight(0xdfe8dc, 0x24301f, 1.0));
const key = new DirectionalLight(0xffffff, 0.6);
key.position.set(0.6, 1.8, 0.6);
scene.add(key);

// A dark studio floor (stands in for your real one in passthrough).
const floor = new Mesh(
  new PlaneGeometry(20, 20),
  new MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new GridHelper(20, 40, 0x2f5a38, 0x23262b);
(grid.position as Vector3).y = 0.001;
scene.add(grid);

const fx = new GooFx();
scene.add(fx.group);
const creature = new GelCreature(fx);
scene.add(creature.group);

// A pretend player for the creature to look at / swing at.
const playerHead = new Vector3(1.4, 1.55, 2.4);

// ---------------------------------------------------------------- controls

const raycaster = new Raycaster();
const mouse = new Vector2();
const _dir = new Vector3();
const _p = new Vector3();

/** March the camera ray against the creature's field; punch what it hits. */
function punchAlongRay(speed: number): void {
  raycaster.setFromCamera(mouse, camera);
  _dir.copy(raycaster.ray.direction);
  for (let t = 0.2; t < 10; t += 0.03) {
    _p.copy(raycaster.ray.origin).addScaledVector(_dir, t);
    if (creature.fieldAtWorld(_p) < 0.01) {
      creature.receivePunchWorld(_p, _dir, speed);
      return;
    }
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (e.button === 0 && !e.shiftKey) punchAlongRay(3.4);
  if (e.button === 0 && e.shiftKey) punchAlongRay(1.0); // gentle poke
});

let autoSpar = false;
let autoT = 0;

const MOVES = ['jab', 'cross', 'hook', 'uppercut', 'overhand', 'backfist', 'roundhouse', 'spinkick', 'clap'] as const;

addEventListener('keydown', (e) => {
  if (e.key === '1') creature.setFormTarget(0);
  if (e.key === '2') creature.setFormTarget(1);
  if (e.key === '3') {
    const move = MOVES[Math.floor(Math.random() * MOVES.length)];
    creature.throwAttack(move, Math.random() > 0.5 ? 'left' : 'right', playerHead);
  }
  if (e.key === '4') autoSpar = !autoSpar;
  if (e.key === '5') creature.setKo(!creature.isKo);
  // The moveset on its own keys: q/w/e/r/t/y/u =
  // jab/cross/hook/upper/overhand/spin/kick.
  const idx = ['q', 'w', 'e', 'r', 't', 'y', 'u'].indexOf(e.key);
  if (idx >= 0) creature.throwAttack(MOVES[idx], idx % 2 === 0 ? 'left' : 'right', playerHead);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------ screenshots

const shot = new URLSearchParams(location.search).get('shot');
let shotClock = 0;
let shotPunched = false;
let menuPanel: MenuPanel | null = null;
let hud: WallBoard | null = null;
let cdPlate: CountdownPlate | null = null;
let gloves = false;

function shotDirector(dt: number): boolean {
  shotClock += dt;
  switch (shot) {
    case 'glob':
      camera.position.set(1.5, 1.25, 2.2);
      controls.target.set(0, 0.55, 0);
      return shotClock > 2.5;
    case 'boxer':
      creature.setFormTarget(1);
      camera.position.set(0.9, 1.5, 2.3);
      controls.target.set(0, 1.1, 0);
      return shotClock > 3.4;
    case 'punched':
    case 'reform': {
      camera.position.set(1.35, 1.3, 2.1);
      controls.target.set(0, 0.8, 0);
      const hitAt = 2.0;
      if (!shotPunched && shotClock >= hitAt) {
        shotPunched = true;
        // March each punch ray until it actually meets the surface.
        const swing = (from: Vector3, dir: Vector3, speed: number) => {
          for (let t = 0; t < 3; t += 0.02) {
            _p.copy(from).addScaledVector(dir, t);
            if (creature.fieldAtWorld(_p) < 0.01) {
              creature.receivePunchWorld(_p, dir, speed);
              return;
            }
          }
        };
        swing(new Vector3(0.25, 0.8, 1.4), _dir.set(-0.15, 0.2, -1).normalize().clone(), 4.4);
        swing(new Vector3(-0.3, 0.55, 1.4), new Vector3(0.2, 0.15, -1).normalize(), 3.6);
      }
      return shotClock > hitAt + (shot === 'punched' ? 0.35 : 1.8);
    }
    case 'ko':
      creature.setKo(true);
      camera.position.set(1.2, 1.05, 1.9);
      controls.target.set(0, 0.25, 0);
      return shotClock > 2.5;
    case 'puddle': {
      // Knock a few lumps off, then frame the FLOOR to see them as flat
      // puddles crawling back to the creature.
      creature.setFormTarget(0);
      camera.position.set(1.4, 0.75, 1.7);
      controls.target.set(0, 0.1, -0.1);
      if (!shotPunched && shotClock >= 0.8) {
        shotPunched = true;
        const swing = (from: Vector3, dir: Vector3, speed: number) => {
          for (let t = 0; t < 3; t += 0.02) {
            _p.copy(from).addScaledVector(dir, t);
            if (creature.fieldAtWorld(_p) < 0.01) {
              creature.receivePunchWorld(_p, dir, speed);
              return;
            }
          }
        };
        swing(new Vector3(0.5, 0.6, 1.4), _dir.set(-0.5, 0.05, -1).normalize().clone(), 5.0);
        swing(new Vector3(-0.45, 0.5, 1.4), new Vector3(0.5, 0.05, -1).normalize(), 4.8);
        swing(new Vector3(0.15, 0.7, 1.4), new Vector3(0.1, 0.1, -1).normalize(), 4.6);
      }
      return shotClock > 2.0; // just after they land and spread flat
    }
    case 'spin':
    case 'kick': {
      // Catch the showpiece attacks mid-strike.
      creature.setFormTarget(1);
      camera.position.set(1.5, 1.45, 1.9);
      controls.target.set(0, 1.1, 0);
      const launchAt = 2.0;
      if (!shotPunched && shotClock >= launchAt) {
        shotPunched = true;
        creature.throwAttack(shot === 'spin' ? 'backfist' : 'roundhouse', 'right', playerHead);
      }
      // Freeze the frame mid-strike: telegraph + just over half the strike.
      const midStrike = shot === 'spin' ? 0.75 + 0.2 : 0.7 + 0.15;
      return shotClock > launchAt + midStrike;
    }
    case 'clap': {
      // The two-handed Bear-Hugger clap — framed head-on so both arms read.
      creature.setFormTarget(1);
      camera.position.set(0, 1.35, 2.4);
      controls.target.set(0, 1.3, 0);
      const launchAt = 1.6;
      if (!shotPunched && shotClock >= launchAt) {
        shotPunched = true;
        creature.throwAttack('clap', 'right', playerHead);
      }
      // Freeze at the top of the wind-up: both arms reared up and out wide.
      return shotClock > launchAt + 0.92;
    }
    case 'glove': {
      // Both gloves floating, framed close, to check the thumb-on-top.
      if (!gloves) {
        gloves = true;
        const gl = buildFist('left');
        gl.position.set(-0.16, 1.3, 0);
        gl.rotation.set(0, 0, 0);
        scene.add(gl);
        const gr = buildFist('right');
        gr.position.set(0.16, 1.3, 0);
        scene.add(gr);
      }
      creature.group.visible = false;
      // Front-top 3/4 view (knuckles point -Z) so the thumb-on-top shows.
      camera.position.set(0.35, 1.72, -0.75);
      controls.target.set(0, 1.28, -0.05);
      return shotClock > 1.5;
    }
    case 'countdown': {
      // Wall board (big art) + the bare floating glyph between us and it.
      if (!hud) {
        hud = new WallBoard();
        hud.group.position.set(0, 1.8, -2.2);
        scene.add(hud.group);
      }
      if (!cdPlate) {
        cdPlate = new CountdownPlate();
        scene.add(cdPlate.mesh);
      }
      match.phase = 'countdown';
      match.countdownT = 0.35; // shows "3"
      match.boardDirty = true;
      creature.setFormTarget(1);
      camera.position.set(0.5, 1.55, 2.7);
      controls.target.set(0, 1.35, -0.4);
      cdPlate.update(camera.position, creature.group.position);
      return shotClock > 2.5;
    }
    case 'hud': {
      // Mid-fight framing: boxer on its new legs, wall board behind it.
      if (!hud) {
        hud = new WallBoard();
        hud.group.position.set(0, 1.8, -1.4);
        scene.add(hud.group);
        match.phase = 'fighting';
        match.creatureHp = 190;
        match.playerHp = 81;
        match.round = 2;
        match.playerRounds = 1;
        match.timeLeft = 47;
        match.boardDirty = true;
      }
      creature.setFormTarget(1);
      camera.position.set(0.9, 1.5, 2.7);
      controls.target.set(0, 1.2, -0.4);
      return shotClock > 3.2;
    }
    case 'menu': {
      // The lobby menu panel floating next to the resting glob.
      if (!menuPanel) {
        menuPanel = new MenuPanel();
        menuPanel.group.position.set(0.85, 1.45, 0.9);
        menuPanel.group.rotation.y = Math.atan2(camera.position.x - 0.85, camera.position.z - 0.9);
        scene.add(menuPanel.group);
        menuPanel.setHovered('fight');
      }
      camera.position.set(1.1, 1.5, 2.6);
      controls.target.set(0.35, 1.0, 0);
      return shotClock > 2.2;
    }
    default:
      return false;
  }
}

// ----------------------------------------------------------------- render

let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (autoSpar) {
    autoT += dt;
    if (autoT > 2.4) {
      autoT = 0;
      if (creature.formValue > 0.9 && !creature.isPunching) {
        creature.throwPunch(Math.random() > 0.5 ? 'left' : 'right', playerHead);
      } else if (creature.formValue < 0.1) {
        creature.setFormTarget(1);
      }
      // And slug it back.
      _p.set(0.05, 0.9 + Math.random() * 0.5, 0.45);
      _dir.set(Math.random() * 0.4 - 0.2, 0.1, -1).normalize();
      creature.receivePunchWorld(_p, _dir, 2.2 + Math.random() * 2.4);
    }
  }

  if (shot && !window.__SHOT_READY && shotDirector(dt)) {
    window.__SHOT_READY = true;
  }

  playerHead.copy(camera.position);
  creature.update(dt, playerHead);
  hud?.update();
  cdPlate?.update(playerHead, creature.group.position);
  fx.update(dt);
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
