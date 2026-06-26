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
import { app, DEFAULT_ACCENT_HUE, DEFAULT_ACCENT_LIGHT, saveAccentHue, saveAccentLight, saveEnvironment, saveOnlyBots, saveShootBack, type AppState } from '../menu/appState.js';
import {
  accentBarHue,
  accentBarLight,
  clearProfileKeyboardHint,
  colorBarHue,
  colorBarLight,
  createActionPanel,
  createMenu,
  flashProfileKeyboardHint,
  resetNewsScroll,
  scrollNews,
  tickCoinRollup,
  type ActionButton,
  type ActionPanel,
  type Menu,
  type MenuAction,
  type PanelId,
} from '../menu/menu.js';
import { createNameKeyboard, type NameKeyboard } from '../menu/keyboard.js';
import {
  customization,
  myAvatarSkin,
  ownPlatform,
  platformOwned,
  setAvatarColor,
  setAvatarLight,
  setAvatarSkin,
  setPlatformSkin,
} from '../menu/customization.js';
import { canAfford, spendCoins } from '../menu/wallet.js';
import { playCash, preloadCash } from '../audio/cash.js';
import { setMenuMusicActive, toggleMusicMuted } from '../audio/menuMusic.js';
import { setVoiceEnabled, voiceEnabled } from '../audio/voicePref.js';
import { buildBoxer, setAvatarAccent, solveTorso, type BoxerRig } from '../avatar/boxer.js';
import {
  AVATAR_SKINS,
  PLATFORM_SKINS,
  applyAvatarSkin,
  applyPlatformSkin,
  platformSkin,
} from '../avatar/skins.js';
import { match } from '../combat/matchState.js';
import { applyArenaLayout } from '../arena/arena.js';
import { mesh } from '../net/mesh.js';
import { UI } from '../ui/industrial.js';
import { net } from '../net/client.js';
import { startQueueWatch, stopQueueWatch } from '../net/queueWatch.js';
import { startPubWatch, stopPubWatch } from '../net/pubWatch.js';
import { PUB_REGIONS } from '../pub/config.js';
import {
  boardScroll,
  hasCustomName,
  leaderboard,
  leaderboardRows,
  myNote,
  myStats,
  refreshLeaderboard,
  rival,
  scrollLeaderboard,
  setLeaderboardTab,
  setPlayerName,
  setPlayerNote,
  setProfileView,
} from '../net/leaderboard.js';
import { markGazetteRead, refreshGazette } from '../net/gazette.js';
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
/** Pixels of newspaper body scrolled per thumbstick step (~2.5 lines). */
const NEWS_SCROLL_STEP = 76;

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
  /** Whether the keyboard is editing your callsign or your profile note. */
  private kbMode: 'name' | 'note' = 'name';
  private mirror?: { group: Group; rig: BoxerRig };
  private skinVersion = 0;
  private boardScrollCooldown = 0;
  private boardScrollDir = 0;
  private newsScrollCooldown = 0;
  private newsScrollDir = 0;
  private draggingHue = false;
  private accentHue = Number.NaN;
  private accentLight = Number.NaN;
  /** Which hand+panel currently owns a slider scrub. A scrub may only START on
   *  a fresh trigger press over the track, so a trigger held from opening the
   *  panel (or clicking elsewhere) can't hijack a slider as the ray crosses it. */
  private sliderGrab: { hand: 'left' | 'right'; panel: PanelId } | null = null;

  init(): void {
    this.menu = createMenu(this.scene);
    this.panel = createActionPanel(this.scene);
    this.keyboard = createNameKeyboard(this.scene);
    this.pointers.left = this.makePointer();
    this.pointers.right = this.makePointer();
    preloadCash(); // the shop money sting, ready before the first buy

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

    // Customisation and the gazette are both modal: the lobby arc swaps out for
    // the open panel. The leaderboard ('board') hangs behind you — always up.
    // The shop is a sub-modal of customisation: while it's up the customise
    // plate (and its mirror/loadout) step aside for the shop face.
    const shopOpen = customization.open && customization.shopOpen;
    const modalCustom = customization.open && !shopOpen;
    const modalNews = app.gazetteOpen;
    for (const p of this.menu.panels) {
      switch (p.id) {
        case 'board':
          break;
        case 'custom': // the LOCKER
        case 'balls':
          p.mesh.visible = modalCustom;
          break;
        case 'shop':
          p.mesh.visible = shopOpen;
          break;
        case 'news':
          p.mesh.visible = modalNews;
          break;
        default:
          // The arc (train/duel/info), the paper button AND the coin readout:
          // the lobby's face, gone while any modal is open.
          p.mesh.visible = !customization.open && !modalNews;
          break;
      }
    }
    // The mirror stands beside both the customise plate AND the shop, so avatar
    // changes preview live wherever you pick them.
    if (this.mirror) this.mirror.group.visible = customization.open;

    // Lobby / queueing: hover + click the panels.
    let hover: PanelId | null = null;
    let hoverAction: MenuAction | null = null;
    let boardPointed = false;
    let boardScrollAxis = 0;
    let newsPointed = false;
    let newsScrollAxis = 0;
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
      if (panel.id === 'news') {
        newsPointed = true;
        const axis = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick)?.y ?? 0;
        if (Math.abs(axis) > Math.abs(newsScrollAxis)) newsScrollAxis = axis;
      }
      const action = hit.uv ? panel.hitTest(hit.uv.x, hit.uv.y) : null;
      if (action || !hoverAction) {
        hover = panel.id;
        hoverAction = action;
      }
      const gp = this.input.xr.gamepads[hand];
      const held = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      const down = gp?.getButtonDown(InputComponent.Trigger) ?? false;
      // A scrub may only BEGIN on a fresh press over the track (`down`); once
      // grabbed it continues while held (`owns`), even as the ray wanders. This
      // stops a trigger still held from opening the panel — or from a click
      // elsewhere — from hijacking a slider the instant the ray sweeps over it.
      if (!held && this.sliderGrab?.hand === hand) this.sliderGrab = null;
      const owns = this.sliderGrab?.hand === hand && this.sliderGrab?.panel === panel.id;
      // Gate the drag branch on an ACTUAL track hit — a press off the track
      // (e.g. on the accent panel's DEFAULT button) then falls through to the
      // click/action branch below instead of being swallowed.
      if (hit.uv && panel.drag && (down || owns) && panel.drag(hit.uv.x, hit.uv.y)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        dragged = true;
      } else if (hit.uv && action === 'av-color' && (down || owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        // The hue bar is continuous: scrub the armour colour live while held.
        setAvatarColor(colorBarHue(hit.uv.x));
      } else if (hit.uv && action === 'av-light' && (down || owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        setAvatarLight(colorBarLight(hit.uv.x)); // scrub the armour lightness live
      } else if (hit.uv && action === 'accent-color' && (down || owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        app.accentHue = accentBarHue(hit.uv.x); // scrub the neon accent live
        saveAccentHue();
      } else if (hit.uv && action === 'accent-light' && (down || owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        app.accentLight = accentBarLight(hit.uv.x);
        saveAccentLight();
      } else if (hit.uv && down) {
        if (panel.click) {
          if (panel.click(hit.uv.x, hit.uv.y)) clicked = true;
        } else if (action) {
          this.run(action);
        }
      }
    }
    const boardScrolled = this.updateBoardScroll(boardPointed, boardScrollAxis, delta);
    const newsScrolled = this.updateNewsScroll(newsPointed, newsScrollAxis, delta);
    const skinChanged = customization.version !== this.lastSkinDraw;
    if (skinChanged) this.lastSkinDraw = customization.version;
    const hoverChanged = hover !== this.hovered || hoverAction !== this.hoveredAction;
    if (hoverChanged || boardScrolled || newsScrolled || skinChanged) {
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

    // Coins banked during a bout roll up the moment you're back at the menu —
    // redraw just the readout each frame while the digits are still climbing.
    if (tickCoinRollup(delta)) {
      this.menu.panels.find((p) => p.id === 'coins')?.redraw(null);
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

  /** The newspaper body scrolls the same way as the leaderboard — stepped
   *  thumbstick with a repeat cooldown — but in pixels rather than rows. */
  private updateNewsScroll(pointing: boolean, axisY: number, delta: number): boolean {
    this.newsScrollCooldown = Math.max(0, this.newsScrollCooldown - delta);
    if (!pointing || Math.abs(axisY) < BOARD_SCROLL_DEADZONE) {
      this.newsScrollCooldown = 0;
      this.newsScrollDir = 0;
      return false;
    }

    const dir = axisY > 0 ? 1 : -1;
    const changedDir = dir !== this.newsScrollDir;
    if (!changedDir && this.newsScrollCooldown > 0) return false;

    this.newsScrollDir = dir;
    this.newsScrollCooldown = changedDir ? BOARD_SCROLL_INITIAL_REPEAT : BOARD_SCROLL_REPEAT;
    return scrollNews(dir * NEWS_SCROLL_STEP);
  }

  private run(action: MenuAction): void {
    sfx.ensureAudio();
    sfx.uiClick();
    // The first leaderboard-relevant act (a training run, a 1v1 queue, or a
    // bot bout — bot wins score now too) claims a callsign: the keyboard pops
    // once, prefilled with the auto name, and the pending action resumes after
    // OK. Saved forever after, shared by both boards.
    if (
      (action === 'start-training' ||
        action === 'quick-match' ||
        action === 'ranked-match' ||
        action === 'arcade-2v2' ||
        action === 'arcade-ffa') &&
      !hasCustomName()
    ) {
      this.kbPending = action;
      this.kbMode = 'name';
      this.keyboard.open(myStats().name);
      return;
    }
    switch (action) {
      case 'start-tutorial':
        // The guided basics: a normal vs-bot duel that TutorialSystem paces
        // with pop-ups and a half-health bot. No callsign needed first.
        app.tutorial = true;
        app.arcade = '1v1';
        app.mode = 'bot';
        app.state = 'playing';
        break;
      case 'start-training':
        app.arcade = '1v1';
        app.state = 'training';
        break;
      case 'arcade-2v2':
        // Arcade brawl: drop onto bots now, hunt humans on the mesh in the
        // background, and flip to the live bout once the room fills. ONLY PLAY
        // BOTS skips the matchmaking entirely — bots and bots alone.
        app.arcade = '2v2';
        app.mode = 'bot';
        app.state = 'playing';
        if (!app.onlyBots) void mesh.queue('2v2', (s) => (app.netStatus = s));
        break;
      case 'arcade-ffa':
        app.arcade = 'ffa';
        app.mode = 'bot';
        app.state = 'playing';
        if (!app.onlyBots) void mesh.queue('ffa', (s) => (app.netStatus = s));
        break;
      case 'toggle-shootback':
        app.shootBack = !app.shootBack;
        saveShootBack();
        break;
      case 'toggle-onlybots':
        app.onlyBots = !app.onlyBots;
        saveOnlyBots();
        break;
      case 'toggle-voice':
        setVoiceEnabled(!voiceEnabled());
        break;
      case 'ranked-match':
        if (app.onlyBots) break; // disabled — no online queue in only-bots mode
        // Wait in the lobby for a real human — no bot fallback.
        app.arcade = '1v1';
        app.state = 'queueing';
        net.queue();
        break;
      case 'quick-match':
        // Drop straight onto a bot. Normally we keep hunting for a human in the
        // background (swap to the live bout if one turns up) — but ONLY PLAY BOTS
        // skips that, so it stays a pure bot bout.
        app.arcade = '1v1';
        app.mode = 'bot';
        app.state = 'playing';
        if (!app.onlyBots) net.queue();
        break;
      case 'cancel-queue':
        net.cancel();
        app.state = 'menu';
        app.duelView = 'root';
        app.codeEntry = '';
        break;
      case 'private-open':
        app.duelView = 'private';
        break;
      case 'private-create':
        app.duelView = 'hosting';
        app.privateCode = '';
        app.state = 'queueing';
        net.createPrivate();
        break;
      case 'private-enter':
        app.duelView = 'keypad';
        app.codeEntry = '';
        break;
      case 'private-back':
        net.cancel();
        app.duelView = 'root';
        app.codeEntry = '';
        break;
      case 'kp-del':
        app.codeEntry = app.codeEntry.slice(0, -1);
        break;
      case 'kp-join':
        if (app.codeEntry.length === 5) {
          app.state = 'queueing';
          net.joinPrivate(app.codeEntry);
        }
        break;
      case 'toggle-environment':
        app.environment = app.environment === 'desert' ? 'ar' : 'desert';
        saveEnvironment();
        break;
      case 'toggle-factory':
        app.environment = app.environment === 'factory' ? 'ar' : 'factory';
        saveEnvironment();
        break;
      case 'lb-ranked':
        setLeaderboardTab('ranked');
        break;
      case 'lb-xp':
        setLeaderboardTab('xp');
        break;
      case 'lb-arcade':
        // The ARCADE tab opens onto its first board (AIM) unless one of the
        // brawl boards is already showing.
        setLeaderboardTab(
          leaderboard.tab === 'duo' || leaderboard.tab === 'ffa' ? leaderboard.tab : 'training',
        );
        break;
      case 'lb-training':
        setLeaderboardTab('training');
        break;
      case 'lb-duo':
        setLeaderboardTab('duo');
        break;
      case 'lb-ffa':
        setLeaderboardTab('ffa');
        break;
      case 'lb-profile':
        setProfileView(null); // your own profile
        break;
      case 'profile-back':
        setLeaderboardTab('ranked');
        break;
      case 'edit-note':
        this.kbPending = null;
        this.kbMode = 'note';
        flashProfileKeyboardHint();
        this.menu.redrawAll(this.hovered, this.hoveredAction);
        this.keyboard.open(myNote(), 'ENTER NOTE', 48); // matches setPlayerNote's cap
        return;
      case 'rename':
        this.kbPending = null;
        this.kbMode = 'name';
        this.keyboard.open(myStats().name);
        return;
      case 'open-gazette':
        // Open the paper, and the moment you do the edition counts as read —
        // the red dot clears.
        app.gazetteOpen = true;
        resetNewsScroll();
        markGazetteRead();
        void refreshGazette(true);
        break;
      case 'gazette-close':
        app.gazetteOpen = false;
        break;
      case 'toggle-mute':
        // Flip the lobby music (persisted) and repaint the disc's glyph.
        toggleMusicMuted();
        this.menu.panels.find((p) => p.id === 'mute')?.redraw(null);
        break;
      case 'open-pub':
        // Don't navigate yet — open the EU/USA region picker first.
        app.infoView = 'pubpick';
        break;
      case 'pub-back':
        app.infoView = 'root';
        break;
      case 'open-custom':
        // Opens onto the LOCKER (your inventory + colours).
        customization.open = true;
        customization.shopOpen = false;
        this.ensureMirror();
        break;
      case 'custom-close':
        customization.open = false;
        customization.shopOpen = false;
        break;
      case 'open-shop':
        customization.shopOpen = true;
        break;
      case 'open-locker':
        customization.shopOpen = false;
        break;
      case 'tab-avatars':
        customization.tab = 'avatars';
        break;
      case 'tab-platforms':
        customization.tab = 'platforms';
        break;
      case 'tab-colour':
        customization.tab = 'colour';
        break;
      case 'av-uncolor':
        setAvatarColor(-1); // back to the skin's own palette
        break;
      case 'accent-default':
        app.accentHue = DEFAULT_ACCENT_HUE; // neon back to the house ember
        app.accentLight = DEFAULT_ACCENT_LIGHT;
        saveAccentHue();
        saveAccentLight();
        break;
      default:
        // shop-av-N: equip an avatar. shop-pf-N: equip a platform if owned,
        // else try to buy it.
        if (action.startsWith('shop-av-')) {
          const skin = AVATAR_SKINS[Number(action.slice(8))];
          if (skin && !skin.locked) setAvatarSkin(skin.id);
          break;
        }
        if (action.startsWith('shop-pf-')) {
          const skin = PLATFORM_SKINS[Number(action.slice(8))];
          if (skin) this.buyOrEquipPlatform(skin.id, skin.price ?? 0);
          break;
        }
        // kp-0 … kp-9: append a digit (max five) on the join keypad.
        if (action.startsWith('kp-') && app.codeEntry.length < 5) {
          const d = action.slice(3);
          if (d >= '0' && d <= '9') app.codeEntry += d;
        } else if (action.startsWith('lb-row-')) {
          // Open the clicked player's profile.
          const row = leaderboardRows()[boardScroll() + Number(action.slice(7))];
          if (row) setProfileView(row);
        } else if (action.startsWith('pub-go-')) {
          // Pick a pub region, remember it, then hop to the pub page.
          const id = action.slice(7);
          const region = PUB_REGIONS.find((r) => r.id === id);
          if (region) {
            localStorage.setItem('ibb-pub-server', region.url);
            app.infoView = 'root';
            this.gotoPub();
          }
        }
        break;
    }
    this.applyState();
  }

  /**
   * Shop tap on a platform tile: if it's already owned, equip it; otherwise
   * buy it (debit the wallet, mark it owned) and equip it. Can't afford it →
   * nothing changes (the wallet refuses the spend).
   */
  private buyOrEquipPlatform(id: string, price: number): void {
    if (!platformOwned(id)) {
      if (!canAfford(price) || !spendCoins(price)) return; // can't afford — no-op
      ownPlatform(id);
      playCash(); // the money sting on a fresh purchase
    }
    setPlatformSkin(id); // applyOwnSkins repaints the pad next frame
  }

  /** Leave for the pub page. Navigating WHILE an immersive session is live
   *  hangs the browser, so end the XR session first, then hop pages. */
  private gotoPub(): void {
    const go = (): void => window.location.assign(pubUrl());
    const session = this.world.session as XRSession | undefined;
    if (session) {
      void Promise.resolve(session.end()).then(go, go);
    } else {
      go();
    }
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
    this.accentLight = Number.NaN;
  }

  /**
   * Re-skin everything that's YOURS whenever the picks change: the mirror,
   * your torso, both gloves and your platform. Visual only — PlayerBodyPart
   * hitboxes never move.
   */
  private applyOwnSkins(): void {
    const skinChanged = customization.version !== this.skinVersion;
    const accentChanged = app.accentHue !== this.accentHue || app.accentLight !== this.accentLight;
    if (!skinChanged && !accentChanged) return;

    const names = ['player-torso', 'player-glove-left', 'player-glove-right', 'mirror-avatar'];
    if (skinChanged) {
      this.skinVersion = customization.version;
      const av = myAvatarSkin(); // chosen shape + custom colour
      const pf = platformSkin(customization.platform);
      for (const name of names) {
        const obj = this.scene.getObjectByName(name);
        if (obj) applyAvatarSkin(obj, av);
      }
      const pad = this.scene.getObjectByName('player-platform');
      if (pad) applyPlatformSkin(pad, pf);
      this.accentHue = Number.NaN;
    }

    const accent = hueToColor(app.accentHue, app.accentLight);
    for (const name of names) {
      const obj = this.scene.getObjectByName(name);
      if (obj) setAvatarAccent(obj, accent);
    }
    this.accentHue = app.accentHue;
    this.accentLight = app.accentLight;
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
          if (this.kbMode === 'note') {
            setPlayerNote(done); // empty clears the note
            clearProfileKeyboardHint();
          } else if (done.length > 0) {
            setPlayerName(done);
          } else {
            return; // a name is required — ignore empty OK, leave the keyboard up
          }
          this.kbMode = 'name';
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
    setMenuMusicActive(inLobby); // pause the lobby music during a bout / training
    // Fresh board standings + the day's Gasket Gazette whenever you land back
    // in the lobby (both throttled).
    if (inLobby) {
      void refreshLeaderboard();
      void refreshGazette();
    }

    // Live "N searching" (1V1 panel) and "X/12 in the pub" (pub door) counts —
    // only watched in the lobby.
    if (inLobby) {
      startQueueWatch((n) => {
        app.searching = n;
      });
      startPubWatch((counts) => {
        app.pubRegionCounts = counts;
        // Door badge shows the total across all reachable regions.
        const known = Object.values(counts).filter((c) => c >= 0);
        app.pubCount = known.length ? known.reduce((a, b) => a + b, 0) : -1;
      });
    } else {
      stopQueueWatch();
      app.searching = -1;
      stopPubWatch();
      app.pubCount = -1;
      app.pubRegionCounts = {};
      app.infoView = 'root';
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
    // Customisation (panel + mirror) and the gazette are lobby-only affairs.
    if (!inLobby) {
      customization.open = false;
      app.gazetteOpen = false;
      if (this.mirror) this.mirror.group.visible = false;
    }

    // The title banner shows only in the lobby.
    const banner = this.scene.getObjectByName('title-banner');
    if (banner) banner.visible = inLobby;
    // Outside a live bout, fall back to the classic duel layout so the lobby
    // and Aim Training show one opponent pad, not a leftover arcade cross,
    // and leave any arcade mesh room we were in.
    if (app.state !== 'playing') {
      mesh.cancel();
      app.arcade = '1v1';
      app.mySlot = 0;
      applyArenaLayout(this.scene);
    }
    // The opponent's platform reads as "occupied" only when fighting.
    const oppPlatform = this.scene.getObjectByName('opponent-platform');
    if (oppPlatform) oppPlatform.visible = app.state !== 'training';

    if (inLobby) this.menu.redrawAll(this.hovered, this.hoveredAction);
    this.lastState = app.state;
  }
}
