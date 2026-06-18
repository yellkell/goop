/**
 * Drives the lobby: draws controller laser pointers, raycasts the menu
 * panels for hover/click, runs the actions (Aim Training, quick match,
 * vs bot, shoot-back toggle), and shows/hides the right scene pieces per
 * app state. During a bout or training the menu hides and the pointers
 * disappear — your hands are for punching.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  SphereGeometry,
  Vector3,
  type Intersection,
} from 'three';
import { app, saveAccentHue, saveShootBack, type AppState } from '../menu/appState.js';
import { createMenu, type Menu, type MenuAction, type PanelId } from '../menu/menu.js';
import { buildBoxerPreview, setAvatarAccent } from '../avatar/boxer.js';
import { hueToColor } from '../config.js';
import { net } from '../net/client.js';
import * as sfx from '../audio/sfx.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();

interface Pointer {
  line: Line;
  dot: Mesh;
}

export class MenuSystem extends createSystem({}) {
  private menu!: Menu;
  private ray = new Raycaster();
  private hovered: PanelId | null = null;
  private lastState: AppState | null = null;
  private pointers: Record<'left' | 'right', Pointer> = {} as Record<'left' | 'right', Pointer>;
  private redrawTimer = 0;
  private draggingHue = false;
  private preview?: Object3D;
  private previewHue = Number.NaN;

  init(): void {
    this.menu = createMenu(this.scene);
    this.pointers.left = this.makePointer();
    this.pointers.right = this.makePointer();

    // A rotating bust of your own boxer so the accent slider visibly recolours
    // the whole avatar's neon, not just the gloves you wear in the arena.
    this.preview = buildBoxerPreview(hueToColor(app.accentHue));
    this.preview.scale.setScalar(0.5);
    this.preview.position.set(0, 0.85, -0.9);
    this.preview.visible = false;
    this.scene.add(this.preview);
    this.previewHue = app.accentHue;

    this.applyState();
  }

  update(delta: number): void {
    if (app.state !== this.lastState) this.applyState();

    this.updatePreview(delta);

    if (app.state === 'playing' || app.state === 'training') {
      this.hidePointers();
      return;
    }

    // Lobby / queueing: hover + click the panels (and drag the accent slider).
    let hover: PanelId | null = null;
    let dragged = false;
    let clicked = false;
    const meshes = this.menu.panels.map((p) => p.mesh);
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, meshes);
      if (!hit) continue;
      const panel = this.menu.panels.find((p) => p.mesh === hit.object);
      if (!panel) continue;
      hover = panel.id;
      const gp = this.input.xr.gamepads[hand];
      if (hit.uv && panel.drag && gp?.getButtonPressed(InputComponent.Trigger)) {
        if (panel.drag(hit.uv.x, hit.uv.y)) dragged = true;
      } else if (hit.uv && gp?.getButtonDown(InputComponent.Trigger)) {
        if (panel.click) {
          if (panel.click(hit.uv.x, hit.uv.y)) clicked = true;
        } else {
          const action = panel.hitTest(hit.uv.x, hit.uv.y);
          if (action) this.run(action);
        }
      }
    }
    if (hover !== this.hovered) {
      this.hovered = hover;
      this.menu.redrawAll(hover);
      if (hover) sfx.uiHover(); // soft laser zap as the pointer lands
    }

    // Self-contained panel click (e.g. the ball loadout tiles).
    if (clicked) {
      sfx.ensureAudio();
      sfx.uiClick();
      this.menu.redrawAll(this.hovered);
    }

    // Live-update the accent slider; persist once the trigger is released.
    if (dragged) {
      this.draggingHue = true;
      this.menu.redrawAll(this.hovered);
    } else if (this.draggingHue) {
      this.draggingHue = false;
      saveAccentHue();
    }

    // Periodic redraw so live text (queue status) stays fresh.
    this.redrawTimer -= delta;
    if (this.redrawTimer <= 0) {
      this.redrawTimer = 0.5;
      this.menu.redrawAll(this.hovered);
    }
  }

  /** Spin the avatar preview in the lobby and recolour it as the slider moves. */
  private updatePreview(delta: number): void {
    const p = this.preview;
    if (!p) return;
    const inLobby = app.state === 'menu' || app.state === 'queueing';
    p.visible = inLobby;
    if (!inLobby) return;
    p.rotation.y += delta * 0.6;
    if (this.previewHue !== app.accentHue) {
      setAvatarAccent(p, hueToColor(app.accentHue));
      this.previewHue = app.accentHue;
    }
  }

  private run(action: MenuAction): void {
    sfx.ensureAudio();
    sfx.uiClick();
    switch (action) {
      case 'start-training':
        app.state = 'training';
        break;
      case 'toggle-shootback':
        app.shootBack = !app.shootBack;
        saveShootBack();
        break;
      case 'quick-match':
        app.state = 'queueing';
        net.queue();
        break;
      case 'cancel-queue':
        net.cancel();
        app.state = 'menu';
        break;
      case 'vs-bot':
        app.mode = 'bot';
        app.state = 'playing';
        break;
    }
    this.applyState();
  }

  // --- controller pointers -------------------------------------------------

  private makePointer(): Pointer {
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    const line = new Line(geo, new LineBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0.85 }));
    line.name = 'menu-pointer';
    line.frustumCulled = false;
    const dot = new Mesh(new SphereGeometry(0.012, 12, 10), new MeshBasicMaterial({ color: 0xffc04d }));
    dot.visible = false;
    this.scene.add(line);
    this.scene.add(dot);
    return { line, dot };
  }

  /** Point the laser down the hand's ray, snap its end + dot to any hit. */
  private updatePointer(hand: 'left' | 'right', targets: Object3D[]): Intersection | undefined {
    const p = this.pointers[hand];
    const rayObj = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
    if (!rayObj) {
      p.line.visible = false;
      p.dot.visible = false;
      return undefined;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate(); // ray space points down −Z
    this.ray.set(_origin, _dir);
    const hit = this.ray.intersectObjects(targets, false)[0];
    _end.copy(hit ? hit.point : _origin.clone().addScaledVector(_dir, 1.6));
    const pos = p.line.geometry.getAttribute('position');
    pos.setXYZ(0, _origin.x, _origin.y, _origin.z);
    pos.setXYZ(1, _end.x, _end.y, _end.z);
    pos.needsUpdate = true;
    p.line.visible = true;
    if (hit) {
      p.dot.position.copy(hit.point);
      p.dot.visible = true;
    } else {
      p.dot.visible = false;
    }
    return hit;
  }

  private hidePointers(): void {
    for (const hand of ['left', 'right'] as const) {
      this.pointers[hand].line.visible = false;
      this.pointers[hand].dot.visible = false;
    }
  }

  // --- visibility per state --------------------------------------------------

  private applyState(): void {
    const inLobby = app.state === 'menu' || app.state === 'queueing';
    this.menu.setVisible(inLobby);

    // The title banner shows only in the lobby.
    const banner = this.scene.getObjectByName('title-banner');
    if (banner) banner.visible = inLobby;
    // The opponent's platform reads as "occupied" only when fighting.
    const oppPlatform = this.scene.getObjectByName('opponent-platform');
    if (oppPlatform) oppPlatform.visible = app.state !== 'training';

    if (inLobby) this.menu.redrawAll(this.hovered);
    this.lastState = app.state;
  }
}
