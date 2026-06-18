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
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector3,
  type Intersection,
} from 'three';
import { app, DEFAULT_ACCENT_HUE, saveAccentHue, saveEnvironment, saveShootBack, type AppState } from '../menu/appState.js';
import {
  colorBarHue,
  createActionPanel,
  createMenu,
  type ActionButton,
  type ActionPanel,
  type Menu,
  type MenuAction,
  type PanelId,
} from '../menu/menu.js';
import { createNameKeyboard, type NameKeyboard } from '../menu/keyboard.js';
import { customization, myAvatarSkin, setAvatarColor, setAvatarSkin, setPlatformSkin } from '../menu/customization.js';
import { buildBoxer, setAvatarAccent, solveTorso, type BoxerRig } from '../avatar/boxer.js';
import {
  AVATAR_SKINS,
  PLATFORM_SKINS,
  applyAvatarSkin,
  applyPlatformSkin,
  platformSkin,
} from '../avatar/skins.js';
import { match } from '../combat/matchState.js';
import { UI } from '../ui/industrial.js';
import { net } from '../net/client.js';
import { startQueueWatch, stopQueueWatch } from '../net/queueWatch.js';
import { startPubWatch, stopPubWatch } from '../net/pubWatch.js';
import {
  hasCustomName,
  myStats,
  refreshLeaderboard,
  rival,
  scrollLeaderboard,
  setLeaderboardTab,
  setPlayerName,
} from '../net/leaderboard.js';
import { hueToColor, pubUrl } from '../config.js';
import * as sfx from '../audio/sfx.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();
const _head = new Vector3();
const _fwd = new Vector3();
const BOARD_SCROLL_DEADZONE = 0.55;
const BOARD_SCROLL_INITIAL_REPEAT = 0.28;
const BOARD_SCROLL_REPEAT = 0.12;

interface Pointer {
  line: Line;
  dot: Mesh;
}

export class MenuSystem extends createSystem({}) {
  private menu!: Menu;
  private ray = new Raycaster();
  private hovered: PanelId | null = null;
  private hoveredAction: MenuAction | null = null;
  private lastState: AppState | null = null;
  private pointers: Record<'left' | 'right', Pointer> = {} as Record<'left' | 'right', Pointer>;
  private redrawTimer = 0;
  /** Last customisation version the panels were drawn at — a chip pick or a
   *  colour-bar drag repaints them at once rather than on the 0.5 s tick. */
  private lastSkinDraw = 0;
  private panel!: ActionPanel;
  private panelKey = '';
  private wasMatchOver = false;
  private keyboard!: NameKeyboard;
  /** The action waiting behind the name keyboard. */
  private kbPending: MenuAction | null = null;
  private mirror?: { group: Group; rig: BoxerRig };
  private skinVersion = 0;
  private boardScrollCooldown = 0;
  private boardScrollDir = 0;
  private draggingHue = false;
  private accentHue = Number.NaN;

  init(): void {
    this.menu = createMenu(this.scene);
    this.panel = createActionPanel(this.scene);
    this.keyboard = createNameKeyboard(this.scene);
    this.pointers.left = this.makePointer();
    this.pointers.right = this.makePointer();

    this.applyState();
  }

  update(delta: number): void {
    if (app.state !== this.lastState) this.applyState();
    this.applyOwnSkins();

    if (app.state === 'training' || app.state === 'playing') {
      this.updateActionPanel();
      return;
    }

    // The name keyboard owns the pointers while it's up.
    if (this.keyboard.isOpen()) {
      this.updateKeyboard();
      return;
    }

    // Customisation is modal: the arc swaps out for the panel + mirror.
    for (const p of this.menu.panels) {
      if (p.id === 'custom' || p.id === 'loadout' || p.id === 'balls') p.mesh.visible = customization.open;
      else if (p.id !== 'board') p.mesh.visible = !customization.open;
    }
    if (this.mirror) this.mirror.group.visible = customization.open;

    // Lobby / queueing: hover + click the panels.
    let hover: PanelId | null = null;
    let hoverAction: MenuAction | null = null;
    let boardPointed = false;
    let boardScrollAxis = 0;
    let dragged = false;
    let clicked = false;
    const meshes = this.menu.panels.filter((p) => p.mesh.visible).map((p) => p.mesh);
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, meshes);
      if (!hit) continue;
      const panel = this.menu.panels.find((p) => p.mesh === hit.object);
      if (!panel) continue;
      if (panel.id === 'board') {
        boardPointed = true;
        const axis = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick)?.y ?? 0;
        if (Math.abs(axis) > Math.abs(boardScrollAxis)) boardScrollAxis = axis;
      }
      const action = hit.uv ? panel.hitTest(hit.uv.x, hit.uv.y) : null;
      if (action || !hoverAction) {
        hover = panel.id;
        hoverAction = action;
      }
      const gp = this.input.xr.gamepads[hand];
      // Gate the drag branch on an ACTUAL track hit — a held trigger off the
      // track (e.g. on the accent panel's DEFAULT button) then falls through to
      // the click/action branch below instead of being swallowed.
      if (
        hit.uv && panel.drag && gp?.getButtonPressed(InputComponent.Trigger) &&
        panel.drag(hit.uv.x, hit.uv.y)
      ) {
        dragged = true;
      } else if (hit.uv && action === 'av-color' && gp?.getButtonPressed(InputComponent.Trigger)) {
        // The hue bar is continuous: scrub the armour colour live while held.
        setAvatarColor(colorBarHue(hit.uv.x));
      } else if (hit.uv && gp?.getButtonDown(InputComponent.Trigger)) {
        if (panel.click) {
          if (panel.click(hit.uv.x, hit.uv.y)) clicked = true;
        } else if (action) {
          this.run(action);
        }
      }
    }
    const boardScrolled = this.updateBoardScroll(boardPointed, boardScrollAxis, delta);
    const skinChanged = customization.version !== this.lastSkinDraw;
    if (skinChanged) this.lastSkinDraw = customization.version;
    const hoverChanged = hover !== this.hovered || hoverAction !== this.hoveredAction;
    if (hoverChanged || boardScrolled || skinChanged) {
      this.hovered = hover;
      this.hoveredAction = hoverAction;
      this.menu.redrawAll(hover, hoverAction);
      if (hoverChanged && hover) sfx.uiHover(); // soft laser zap as the pointer lands
    }

    // Self-contained panel click (e.g. the ball loadout tiles).
    if (clicked) {
      sfx.ensureAudio();
      sfx.uiClick();
      this.menu.redrawAll(this.hovered, this.hoveredAction);
    }

    // Live-update the accent slider; persist once the trigger is released.
    if (dragged) {
      this.draggingHue = true;
      this.menu.redrawAll(this.hovered, this.hoveredAction);
    } else if (this.draggingHue) {
      this.draggingHue = false;
      saveAccentHue();
    }

    // Periodic redraw so live text (queue status) stays fresh.
    this.redrawTimer -= delta;
    if (this.redrawTimer <= 0) {
      this.redrawTimer = 0.5;
      this.menu.redrawAll(this.hovered, this.hoveredAction);
    }
  }

  private updateBoardScroll(pointing: boolean, axisY: number, delta: number): boolean {
    this.boardScrollCooldown = Math.max(0, this.boardScrollCooldown - delta);
    if (!pointing || Math.abs(axisY) < BOARD_SCROLL_DEADZONE) {
      this.boardScrollCooldown = 0;
      this.boardScrollDir = 0;
      return false;
    }

    const dir = axisY > 0 ? 1 : -1;
    const changedDir = dir !== this.boardScrollDir;
    if (!changedDir && this.boardScrollCooldown > 0) return false;

    this.boardScrollDir = dir;
    this.boardScrollCooldown = changedDir ? BOARD_SCROLL_INITIAL_REPEAT : BOARD_SCROLL_REPEAT;
    return scrollLeaderboard(dir);
  }

  private run(action: MenuAction): void {
    sfx.ensureAudio();
    sfx.uiClick();
    // The first leaderboard-relevant act (a training run, a 1v1 queue, or a
    // bot bout — bot wins score now too) claims a callsign: the keyboard pops
    // once, prefilled with the auto name, and the pending action resumes after
    // OK. Saved forever after, shared by both boards.
    if (
      (action === 'start-training' || action === 'quick-match' || action === 'vs-bot') &&
      !hasCustomName()
    ) {
      this.kbPending = action;
      this.keyboard.open(myStats().name);
      return;
    }
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
        // Keep hunting for a real opponent in the background. If one turns up
        // mid-bout the bot is dropped and we swap straight into the live bout.
        net.queue();
        break;
      case 'toggle-environment':
        app.environment = app.environment === 'desert' ? 'ar' : 'desert';
        saveEnvironment();
        break;
      case 'lb-duel':
        setLeaderboardTab('duel');
        break;
      case 'lb-training':
        setLeaderboardTab('training');
        break;
      case 'rename':
        this.kbPending = null;
        this.keyboard.open(myStats().name);
        return;
      case 'open-pub': {
        // Navigating WHILE an immersive session is live hangs the browser —
        // end the XR session first, then hop pages.
        const go = (): void => window.location.assign(pubUrl());
        const session = this.world.session as XRSession | undefined;
        if (session) {
          void Promise.resolve(session.end()).then(go, go);
        } else {
          go();
        }
        break;
      }
      case 'open-custom':
        customization.open = true;
        this.ensureMirror();
        break;
      case 'custom-close':
        customization.open = false;
        break;
      case 'av-0':
      case 'av-1':
      case 'av-2':
      case 'av-3':
        setAvatarSkin(AVATAR_SKINS[Number(action.slice(3))].id);
        break;
      case 'av-uncolor':
        setAvatarColor(-1); // back to the skin's own palette
        break;
      case 'accent-default':
        app.accentHue = DEFAULT_ACCENT_HUE; // neon back to the house ember
        saveAccentHue();
        break;
      case 'pf-0':
      case 'pf-1':
      case 'pf-2':
        setPlatformSkin(PLATFORM_SKINS[Number(action.slice(3))].id);
        break;
    }
    this.applyState();
  }

  // --- customisation: the avatar mirror + live skin application ---------------

  /**
   * The "mirror": your full boxer rig standing beside the customisation
   * panel in a relaxed guard, re-skinned live as you click chips — so you
   * see exactly how you'll look across the gap.
   */
  private ensureMirror(): void {
    if (this.mirror) return;
    const rig = buildBoxer(0);
    const group = new Group();
    group.name = 'mirror-avatar';
    for (const piece of rig.all) {
      piece.visible = true;
      group.add(piece);
    }
    // Static display pose: solve the torso once under a standing head, fists
    // up in a loose guard. Group-local coords, so place/turn the group only.
    solveTorso(rig, new Vector3(0, 1.5, 0), new Quaternion(), 0, 0, _dir, _end);
    rig.gloves[0].position.set(-0.22, 1.12, -0.28);
    rig.gloves[1].position.set(0.22, 1.12, -0.28);
    group.position.set(-0.75, 0, -2.0);
    // Face the player standing at the rig origin (default forward is -Z).
    group.rotation.y = Math.PI + Math.atan2(0 - group.position.x, 0 - group.position.z);
    this.scene.add(group);
    this.mirror = { group, rig };
    this.skinVersion = -1; // force a re-apply so the mirror dresses correctly
    this.accentHue = Number.NaN;
  }

  /**
   * Re-skin everything that's YOURS whenever the picks change: the mirror,
   * your torso, both gloves and your platform. Visual only — PlayerBodyPart
   * hitboxes never move.
   */
  private applyOwnSkins(): void {
    const skinChanged = customization.version !== this.skinVersion;
    const accentChanged = app.accentHue !== this.accentHue;
    if (!skinChanged && !accentChanged) return;

    const names = ['player-torso', 'player-glove-left', 'player-glove-right', 'mirror-avatar'];
    // The body steel follows your ARMOUR colour, or your ACCENT hue when no
    // armour colour is set (see myAvatarSkin). In that case an accent change
    // must RE-SKIN the body too, not just re-glow the neon.
    const reskin = skinChanged || (accentChanged && customization.colorHue < 0);
    if (reskin) {
      this.skinVersion = customization.version;
      const av = myAvatarSkin(); // chosen shape + colour
      const pf = platformSkin(customization.platform);
      for (const name of names) {
        const obj = this.scene.getObjectByName(name);
        if (obj) applyAvatarSkin(obj, av);
      }
      const pad = this.scene.getObjectByName('player-platform');
      if (pad) applyPlatformSkin(pad, pf);
    }

    const accent = hueToColor(app.accentHue);
    for (const name of names) {
      const obj = this.scene.getObjectByName(name);
      if (obj) setAvatarAccent(obj, accent);
    }
    this.accentHue = app.accentHue;
  }

  /** Point + trigger types on the keyboard; OK saves and resumes the action. */
  private updateKeyboard(): void {
    let hover: string | null = null;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, [this.keyboard.mesh]);
      const id = hit?.uv ? this.keyboard.hitTest(hit.uv.x, hit.uv.y) : null;
      if (!id) continue;
      hover = id;
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        sfx.uiClick();
        const done = this.keyboard.press(id);
        if (done !== null) {
          setPlayerName(done);
          this.keyboard.close();
          const pending = this.kbPending;
          this.kbPending = null;
          if (pending) this.run(pending);
          else this.menu.redrawAll(this.hovered, this.hoveredAction);
          return;
        }
      }
    }
    this.keyboard.setHover(hover);
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
        status: match.rematchTheirs ? `${rival.name} wants a rematch` : '',
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
        // Ends a live net bout OR stops the bot-bout background search.
        if (app.state === 'playing') net.cancel();
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
    // Fresh board standings whenever you land back in the lobby (throttled).
    if (inLobby) void refreshLeaderboard();

    // Live "N searching" (1V1 panel) and "X/12 in the pub" (pub door) counts —
    // only watched in the lobby.
    if (inLobby) {
      startQueueWatch((n) => {
        app.searching = n;
      });
      startPubWatch((n) => {
        app.pubCount = n;
      });
    } else {
      stopQueueWatch();
      app.searching = -1;
      stopPubWatch();
      app.pubCount = -1;
    }

    // The action panel only lives inside training runs and bouts; the
    // keyboard only in the lobby.
    if (inLobby && this.panel) {
      this.panel.mesh.visible = false;
      this.panelKey = '';
      this.wasMatchOver = false;
    }
    if (!inLobby && this.keyboard) {
      this.keyboard.close();
      this.kbPending = null;
    }
    // Customisation (panel + mirror) is a lobby-only affair.
    if (!inLobby) {
      customization.open = false;
      if (this.mirror) this.mirror.group.visible = false;
    }

    // The title banner shows only in the lobby.
    const banner = this.scene.getObjectByName('title-banner');
    if (banner) banner.visible = inLobby;
    // The opponent's platform reads as "occupied" only when fighting.
    const oppPlatform = this.scene.getObjectByName('opponent-platform');
    if (oppPlatform) oppPlatform.visible = app.state !== 'training';

    if (inLobby) this.menu.redrawAll(this.hovered, this.hoveredAction);
    this.lastState = app.state;
  }
}
