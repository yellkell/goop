/**
 * Drives the lobby: draws controller laser pointers, raycasts the menu
 * panels for hover/click, runs the actions (Aim Training, quick match,
 * vs bot, shoot-back toggle), and shows/hides the right scene pieces per
 * app state. During a bout or training the menu hides and the pointers
 * disappear — your hands are for punching.
 *
 * The A button summons a small waist-height action panel (A again dismisses
 * it): FORFEIT mid-training; at the end of a bout, RETURN — plus REMATCH in
 * online bouts, where the panel pops up by itself for the decision.
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
import { app, saveShootBack, type AppState } from '../menu/appState.js';
import {
  createActionPanel,
  createMenu,
  type ActionButton,
  type ActionPanel,
  type Menu,
  type MenuAction,
  type PanelId,
} from '../menu/menu.js';
import { match } from '../combat/matchState.js';
import { UI } from '../ui/industrial.js';
import { net } from '../net/client.js';
import * as sfx from '../audio/sfx.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();
const _head = new Vector3();
const _fwd = new Vector3();

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
  private panel!: ActionPanel;
  private panelKey = '';
  private wasMatchOver = false;

  init(): void {
    this.menu = createMenu(this.scene);
    this.panel = createActionPanel(this.scene);
    this.pointers.left = this.makePointer();
    this.pointers.right = this.makePointer();
    this.applyState();
  }

  update(delta: number): void {
    if (app.state !== this.lastState) this.applyState();

    if (app.state === 'training' || app.state === 'playing') {
      this.updateActionPanel();
      return;
    }

    // Lobby / queueing: hover + click the panels.
    let hover: PanelId | null = null;
    const meshes = this.menu.panels.map((p) => p.mesh);
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, meshes);
      if (!hit) continue;
      const panel = this.menu.panels.find((p) => p.mesh === hit.object);
      if (!panel) continue;
      hover = panel.id;
      if (hit.uv && this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        const action = panel.hitTest(hit.uv.x, hit.uv.y);
        if (action) this.run(action);
      }
    }
    if (hover !== this.hovered) {
      this.hovered = hover;
      this.menu.redrawAll(hover);
    }

    // Periodic redraw so live text (queue status) stays fresh.
    this.redrawTimer -= delta;
    if (this.redrawTimer <= 0) {
      this.redrawTimer = 0.5;
      this.menu.redrawAll(this.hovered);
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

  // --- the A-button action panel ---------------------------------------------

  /**
   * What the panel offers right now, or null when it has no business being
   * up (mid-bout — your hands are for punching, not menus).
   */
  private panelContent(): { title: string; buttons: ActionButton[]; status: string } | null {
    if (app.state === 'training') {
      return {
        title: 'AIM TRAINING',
        buttons: [{ id: 'forfeit', label: 'FORFEIT', accent: UI.danger }],
        status: '',
      };
    }
    if (app.state === 'playing' && match.phase === 'matchOver') {
      const buttons: ActionButton[] = [];
      if (app.mode === 'net') {
        buttons.push({
          id: 'rematch',
          label: match.rematchMine ? 'WAITING…' : 'REMATCH',
          accent: UI.cool,
        });
      }
      buttons.push({ id: 'return', label: 'RETURN', accent: UI.danger });
      return {
        title: 'FIGHT OVER',
        buttons,
        status: match.rematchTheirs ? 'rival wants a rematch' : '',
      };
    }
    return null;
  }

  /** A toggles the panel; point + trigger clicks its buttons. */
  private updateActionPanel(): void {
    // The rematch decision pops the panel up by itself in online bouts.
    const over = app.state === 'playing' && match.phase === 'matchOver';
    if (over && !this.wasMatchOver && app.mode === 'net' && !this.panel.mesh.visible) {
      this.panel.mesh.visible = true;
      this.placePanel();
    }
    this.wasMatchOver = over;

    const content = this.panelContent();
    if (!content) {
      this.panel.mesh.visible = false;
      this.hidePointers();
      return;
    }

    if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
      this.panel.mesh.visible = !this.panel.mesh.visible;
      if (this.panel.mesh.visible) this.placePanel();
      sfx.ensureAudio();
      sfx.uiClick();
    }
    if (!this.panel.mesh.visible) {
      this.hidePointers();
      return;
    }

    let hover: string | null = null;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, [this.panel.mesh]);
      const id = hit?.uv ? this.panel.hitTest(hit.uv.x, hit.uv.y) : null;
      if (!id) continue;
      hover = id;
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        this.runPanelAction(id);
        return;
      }
    }

    // Redraw only when the content or hover actually changed.
    const key = `${content.title}|${content.buttons.map((b) => b.id + b.label).join(',')}|${content.status}|${hover}`;
    if (key !== this.panelKey) {
      this.panelKey = key;
      this.panel.redraw(content.title, content.buttons, 'press A to dismiss', hover, content.status);
    }
  }

  private runPanelAction(id: string): void {
    sfx.uiClick();
    switch (id) {
      case 'forfeit':
      case 'return':
        this.panel.mesh.visible = false;
        if (app.state === 'playing' && app.mode === 'net') net.cancel();
        app.state = 'menu'; // training tears down unsaved; bouts end here
        this.applyState();
        break;
      case 'rematch':
        if (!match.rematchMine) {
          match.rematchMine = true;
          net.send({ k: 'rematch' });
        }
        break;
    }
  }

  /** In front of you, off to the side, waist height — out of punching room. */
  private placePanel(): void {
    this.world.camera.getWorldPosition(_head);
    this.world.camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    // right = forward × up
    const rx = -_fwd.z;
    const rz = _fwd.x;
    this.panel.mesh.position.set(
      _head.x + _fwd.x * 0.55 + rx * 0.38,
      0.95,
      _head.z + _fwd.z * 0.55 + rz * 0.38,
    );
    this.panel.mesh.lookAt(_head);
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

    // The action panel only lives inside training runs and bouts.
    if (inLobby && this.panel) {
      this.panel.mesh.visible = false;
      this.panelKey = '';
      this.wasMatchOver = false;
    }

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
