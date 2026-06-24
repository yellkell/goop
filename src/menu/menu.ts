/**
 * The lobby: three smoked-steel plates on a shallow arc in front of the
 * player — industrial robot-wars styling, translucent so your room stays
 * visible through them. Centre = AIM TRAINING (the headline mode), left =
 * 1V1 (quick match + vs bot), right = stats & connection info. A fourth
 * plate hangs BEHIND the player: the Firebase leaderboard (1V1 score / aim
 * training tabs) — lobby only, gone the moment a bout or run starts. Each
 * panel is a canvas texture on a plane; MenuSystem raycasts the controllers
 * for hover + click and maps the hit UV to an action zone.
 */

import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import { app, DEFAULT_ACCENT_HUE, saveBallAttach } from './appState.js';
import { customization, platformOwned } from './customization.js';
import { rankBadge } from './rankBadges.js';
import { coinImage } from './coinIcon.js';
import { canAfford, coins } from './wallet.js';
import { tierForXp } from './progression.js';
import { AVATAR_SKINS, PLATFORM_SKINS, type AvatarSkin, type PlatformSkin } from '../avatar/skins.js';
import { drawAvatarIcon, drawPlatformIcon } from './skinIcons.js';
import { ATTACH, GAME_TITLE, hueToColor } from '../config.js';
import {
  LEADERBOARD_VISIBLE_ROWS,
  boardScroll,
  leaderboard,
  leaderboardRows,
  myProfileRow,
  type LeaderboardTab,
} from '../net/leaderboard.js';
import { gazette, type GazetteArticle } from '../net/gazette.js';
import { isMusicMuted } from '../audio/menuMusic.js';
import { voiceEnabled } from '../audio/voicePref.js';
import { PUB_MAX_PLAYERS } from '../pub/protocol.js';
import { PUB_REGIONS } from '../pub/config.js';
import { UI, buttonPlate, hazardStrip, plate, segmentBar, stencilFont } from '../ui/industrial.js';

export type PanelId =
  | 'train'
  | 'duel'
  | 'info'
  | 'board'
  | 'custom'
  | 'loadout'
  | 'balls'
  /** The platform shop (a sub-modal of customisation). */
  | 'shop'
  /** The coin-wallet readout that sits beside the paper button. */
  | 'coins'
  /** The little circular paper button hanging above the right panel. */
  | 'gazette'
  /** The music mute disc, left of the paper button. */
  | 'mute'
  /** The Gasket Gazette front page itself (opens modal over the lobby). */
  | 'news';

export type MenuAction =
  | 'start-tutorial'
  | 'start-training'
  | 'arcade-2v2'
  | 'arcade-ffa'
  | 'toggle-shootback'
  | 'toggle-onlybots'
  | 'toggle-voice'
  | 'ranked-match'
  | 'quick-match'
  | 'cancel-queue'
  | 'private-open'
  | 'private-create'
  | 'private-enter'
  | 'private-back'
  | 'kp-del'
  | 'kp-join'
  | `kp-${number}`
  | 'toggle-environment'
  | 'toggle-factory'
  | 'lb-ranked'
  | 'lb-xp'
  | 'lb-arcade'
  | 'lb-training'
  | 'lb-duo'
  | 'lb-ffa'
  | 'lb-profile'
  | `lb-row-${number}`
  | 'edit-note'
  | 'profile-back'
  | 'rename'
  | 'open-pub'
  | 'pub-back'
  | `pub-go-${string}`
  | 'open-custom'
  | 'custom-close'
  /** Dragging the armour-colour hue bar (continuous — MenuSystem reads the UV). */
  | 'av-color'
  /** Dragging the armour lightness/darkness bar. */
  | 'av-light'
  /** Reset the armour colour to the skin's default palette. */
  | 'av-uncolor'
  /** Dragging the avatar-accent (neon) hue bar in the locker's COLOUR tab. */
  | 'accent-color'
  /** Dragging the avatar-accent (neon) lightness bar. */
  | 'accent-light'
  /** Reset the avatar-accent (neon) hue to the house ember default. */
  | 'accent-default'
  /** Swap between SHOP (all items) and LOCKER (your inventory + colours). */
  | 'open-shop'
  | 'open-locker'
  /** Switch the shop / locker tab. */
  | 'tab-avatars'
  | 'tab-platforms'
  | 'tab-colour'
  /** Tap an avatar tile (equip) or a platform tile (buy if unowned, else equip). */
  | `shop-av-${number}`
  | `shop-pf-${number}`
  /** Open / close the Gasket Gazette. */
  | 'open-gazette'
  | 'gazette-close'
  /** Toggle the lobby music mute (the speaker button left of the paper). */
  | 'toggle-mute';

const PW = 512;
const PH = 400;
// The ARCADE panel is taller than the others to fit its three breaker toggles
// (shoot-back, only-play-bots, voice-chat) with breathing room at the bottom.
const TRAIN_H = PH + 92;
// The leaderboard plate is taller than the lobby panels so the whole top 10
// fits at once — its own canvas (same width, more height) and a physical size
// scaled to match, so the text keeps the lobby's pixel density (no stretch).
const BW = 512;
const BH = 548;
const PROFILE_KEYBOARD_HINT_MS = 4500;

let profileKeyboardHintUntil = 0;

export function flashProfileKeyboardHint(): void {
  profileKeyboardHintUntil = performance.now() + PROFILE_KEYBOARD_HINT_MS;
}

export function clearProfileKeyboardHint(): void {
  profileKeyboardHintUntil = 0;
}

export interface MenuPanel {
  id: PanelId;
  mesh: Mesh;
  redraw: (hoverAction: MenuAction | null) => void;
  /** Map a hit UV (u right, v up) to an action, or null. */
  hitTest: (u: number, v: number) => MenuAction | null;
  /**
   * Continuous control (e.g. a slider): called every frame the trigger is
   * held over the panel. Returns true if the hit landed on the control (the
   * caller then redraws and suppresses the click action).
   */
  drag?: (u: number, v: number) => boolean;
  /**
   * Self-contained click on trigger-down (mutates + persists its own state).
   * Returns true if it handled the hit, so the caller redraws + clicks the
   * relay sound instead of running a global MenuAction.
   */
  click?: (u: number, v: number) => boolean;
}

export interface Menu {
  group: Group;
  panels: MenuPanel[];
  setVisible: (v: boolean) => void;
  redrawAll: (hoverId: PanelId | null, hoverAction: MenuAction | null) => void;
}

/** The shared panel skeleton: smoked plate, hazard chip, stencil title. The
 *  taller leaderboard plate passes its own width/height. */
function panelBg(
  ctx: CanvasRenderingContext2D,
  hover: boolean,
  accent: string,
  title: string,
  w = PW,
  h = PH,
): void {
  ctx.clearRect(0, 0, w, h);
  plate(ctx, 8, 8, w - 16, h - 16, {
    cut: 26,
    fill: hover ? 'rgba(14,15,20,0.6)' : UI.ink,
    stroke: hover ? accent : UI.steel,
  });
  hazardStrip(ctx, 36, 34, 52, 16, UI.amber);
  ctx.textAlign = 'left';
  ctx.font = stencilFont(40);
  ctx.fillStyle = accent;
  ctx.fillText(title, 104, 44);
  ctx.strokeStyle = hover ? accent : UI.steelDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 72);
  ctx.lineTo(w - 36, 72);
  ctx.stroke();
  ctx.textAlign = 'center';
}

interface PanelOpts {
  cw?: number;
  ch?: number;
  drag?: MenuPanel['drag'];
  click?: MenuPanel['click'];
}

function makePanel(
  id: PanelId,
  wMeters: number,
  hMeters: number,
  draw: (ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null) => void,
  hitTest: MenuPanel['hitTest'],
  opts: PanelOpts = {},
): MenuPanel {
  const { cw = PW, ch = PH, drag, click } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(wMeters, hMeters),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  mesh.name = `menu-panel:${id}`;
  const redraw = (hoverAction: MenuAction | null): void => {
    draw(ctx, hoverAction);
    texture.needsUpdate = true;
  };
  return { id, mesh, redraw, hitTest, drag, click };
}

/** Centre — ARCADE: aim training plus the 2v2 and FFA brawls, and the
 *  shoot-back toggle (which only flavours aim training). */
function drawTrain(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.emberBright, 'ARCADE', PW, TRAIN_H);

  // TUTORIAL sits at the top — the very first thing a new boxer should tap.
  buttonPlate(ctx, 70, 80, PW - 140, 54, 'TUTORIAL', UI.emberBright, hoverAction === 'start-tutorial');
  buttonPlate(ctx, 70, 140, PW - 140, 54, '2V2', UI.cool, hoverAction === 'arcade-2v2');
  buttonPlate(ctx, 70, 200, PW - 140, 54, 'FFA', UI.amber, hoverAction === 'arcade-ffa');
  buttonPlate(ctx, 70, 260, PW - 140, 54, 'AIM TRAINING', UI.ember, hoverAction === 'start-training');

  // Two industrial breaker switches: targets-shoot-back, then only-play-bots.
  const breaker = (text: string, on: boolean, hot: boolean, py: number, onFill: string, onStroke: string): void => {
    ctx.font = '700 21px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = hot ? UI.emberBright : UI.textDim;
    ctx.fillText(text, 64, py + 23);
    const pw = 96, ph = 34, px = PW - 64 - pw;
    plate(ctx, px, py, pw, ph, {
      cut: 10,
      fill: on ? onFill : hot ? 'rgba(255,176,0,0.16)' : 'rgba(150,150,170,0.12)',
      stroke: hot ? UI.emberBright : on ? onStroke : UI.steelDim,
      rivets: false,
    });
    ctx.fillStyle = on ? onStroke : UI.steelDim;
    const kw = pw / 2 - 10;
    ctx.fillRect(on ? px + pw - kw - 6 : px + 6, py + 6, kw, ph - 12);
  };
  breaker('targets shoot back', app.shootBack, hoverAction === 'toggle-shootback', 320, 'rgba(79,183,255,0.25)', UI.cool);
  breaker('only play bots', app.onlyBots, hoverAction === 'toggle-onlybots', 362, 'rgba(255,176,0,0.25)', UI.amber);
  breaker('voice chat', voiceEnabled(), hoverAction === 'toggle-voice', 404, 'rgba(57,217,138,0.28)', '#39d98a');
}

function hitTrain(_u: number, v: number): MenuAction | null {
  // v: 0 bottom → 1 top (canvas y = (1-v)*TRAIN_H — this panel is taller).
  const y = (1 - v) * TRAIN_H;
  if (y >= 80 && y <= 134) return 'start-tutorial';
  if (y >= 140 && y <= 194) return 'arcade-2v2';
  if (y >= 200 && y <= 254) return 'arcade-ffa';
  if (y >= 260 && y <= 314) return 'start-training';
  if (y >= 318 && y <= 358) return 'toggle-shootback';
  if (y >= 360 && y <= 400) return 'toggle-onlybots';
  if (y >= 402 && y <= 442) return 'toggle-voice';
  return null;
}

/** Left — 1V1. Mode list (Ranked / Quick / Private) or the private-match flow. */
function drawDuel(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.cool, '1 V 1');
  switch (app.duelView) {
    case 'private':
      return drawPrivateMenu(ctx, hoverAction);
    case 'hosting':
      return drawHosting(ctx, hoverAction);
    case 'keypad':
      return drawKeypad(ctx, hoverAction);
    default:
      return drawDuelRoot(ctx, hoverAction);
  }
}

function hitDuel(u: number, v: number): MenuAction | null {
  switch (app.duelView) {
    case 'private':
      return hitPrivateMenu(v);
    case 'hosting':
      return hitHosting(v);
    case 'keypad':
      return hitKeypad(u, v);
    default:
      return hitDuelRoot(v);
  }
}

function drawDuelRoot(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  const queueing = app.state === 'queueing';
  const rankedAction = queueing ? 'cancel-queue' : 'ranked-match';
  // RANKED is disabled while ONLY PLAY BOTS is on (no online queue allowed).
  const rankedOff = app.onlyBots && !queueing;

  // RANKED — waits in the lobby for a real human (no bot). Greyed + dead while
  // ONLY PLAY BOTS is on.
  buttonPlate(
    ctx, 70, 84, PW - 140, 66,
    queueing ? 'CANCEL' : 'RANKED',
    queueing ? UI.amber : UI.cool,
    !rankedOff && hoverAction === rankedAction,
    rankedOff,
  );

  // Live "N searching" badge on the RANKED plate — the queue you'd join.
  if (!queueing && !rankedOff && app.searching > 0) {
    const label = `${app.searching} SEARCHING`;
    ctx.font = '800 16px system-ui, sans-serif';
    const pillW = ctx.measureText(label).width + 34, pillH = 24;
    const px = PW - 70 - pillW, py = 90;
    plate(ctx, px, py, pillW, pillH, { cut: 8, fill: 'rgba(79,183,255,0.22)', stroke: UI.cool, rivets: false });
    ctx.fillStyle = UI.coolBright;
    ctx.beginPath();
    ctx.arc(px + 14, py + pillH / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = UI.coolBright;
    ctx.fillText(label, px + 24, py + pillH / 2 + 1);
    ctx.textAlign = 'center';
  }

  // QUICK MATCH — drops you straight onto a bot, but keeps hunting; a human who
  // turns up pulls you into the live bout.
  buttonPlate(ctx, 70, 156, PW - 140, 66, 'QUICK MATCH', UI.ember, hoverAction === 'quick-match');
  // PRIVATE — share a 5-digit code with a friend.
  buttonPlate(ctx, 70, 228, PW - 140, 58, 'PRIVATE', UI.coolBright, hoverAction === 'private-open');

  // Arena-backdrop breaker switches: desert, then factory beneath it (each a
  // toggle; turning one on turns the other off — the third state is bare AR).
  envToggle(ctx, 'desert arena', app.environment === 'desert', hoverAction === 'toggle-environment', 290);
  envToggle(ctx, 'old factory arena', app.environment === 'factory', hoverAction === 'toggle-factory', 334);

  if (queueing) {
    ctx.textAlign = 'center';
    ctx.font = '600 19px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(159,226,255,0.85)';
    ctx.fillText('searching for an opponent…', PW / 2, 392);
  }
}

/** One labelled breaker switch row at canvas y `sy`. */
function envToggle(ctx: CanvasRenderingContext2D, label: string, on: boolean, hot: boolean, sy: number): void {
  ctx.font = '700 23px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = hot ? UI.amber : UI.textDim;
  ctx.fillText(label, 64, sy + 24);
  const sw = 110, sh = 36, sx = PW - 64 - sw;
  plate(ctx, sx, sy, sw, sh, {
    cut: 10,
    fill: on ? 'rgba(255,176,0,0.22)' : hot ? 'rgba(255,176,0,0.16)' : 'rgba(150,150,170,0.12)',
    stroke: hot || on ? UI.amber : UI.steelDim,
    rivets: false,
  });
  ctx.fillStyle = on ? UI.amber : UI.steelDim;
  const kw = sw / 2 - 12;
  ctx.fillRect(on ? sx + sw - kw - 8 : sx + 8, sy + 7, kw, sh - 14);
}

function hitDuelRoot(v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 80 && y <= 152) {
    if (app.state === 'queueing') return 'cancel-queue';
    return app.onlyBots ? null : 'ranked-match'; // ranked disabled in only-bots mode
  }
  if (y >= 154 && y <= 224) return 'quick-match';
  if (y >= 226 && y <= 288) return 'private-open';
  if (y >= 288 && y <= 328) return 'toggle-environment';
  if (y >= 332 && y <= 372) return 'toggle-factory';
  return null;
}

function drawPrivateMenu(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  ctx.font = '600 19px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('create a 5-digit code, or type a friend’s', PW / 2, 92);
  buttonPlate(ctx, 64, 110, PW - 128, 86, 'CREATE MATCH', UI.cool, hoverAction === 'private-create');
  buttonPlate(ctx, 64, 212, PW - 128, 86, 'ENTER CODE', UI.amber, hoverAction === 'private-enter');
  buttonPlate(ctx, 150, 320, PW - 300, 50, 'BACK', UI.steel, hoverAction === 'private-back');
}

function hitPrivateMenu(v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 104 && y <= 202) return 'private-create';
  if (y >= 206 && y <= 304) return 'private-enter';
  if (y >= 312 && y <= 378) return 'private-back';
  return null;
}

function drawHosting(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('YOUR MATCH CODE', PW / 2, 116);
  const code = app.privateCode || '·····';
  ctx.font = stencilFont(72);
  ctx.fillStyle = UI.coolBright;
  ctx.fillText(code.split('').join(' '), PW / 2, 188);
  ctx.font = '600 21px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(159,226,255,0.85)';
  ctx.fillText(app.privateCode ? 'share it · waiting for them…' : 'allocating…', PW / 2, 250);
  buttonPlate(ctx, 110, 296, PW - 220, 70, 'CANCEL', UI.amber, hoverAction === 'cancel-queue');
}

function hitHosting(v: number): MenuAction | null {
  const y = (1 - v) * PH;
  return y >= 290 && y <= 372 ? 'cancel-queue' : null;
}

// Keypad geometry, shared by draw + hit-test.
const KP = { x: 56, y: 150, gap: 9, cols: 3, rows: 4, w: PW - 112, h: 218 };
const KP_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['DEL', '0', 'JOIN'],
];

function kpCell(r: number, c: number): { x: number; y: number; w: number; h: number } {
  const cw = (KP.w - KP.gap * (KP.cols - 1)) / KP.cols;
  const ch = (KP.h - KP.gap * (KP.rows - 1)) / KP.rows;
  return { x: KP.x + c * (cw + KP.gap), y: KP.y + r * (ch + KP.gap), w: cw, h: ch };
}

function drawKeypad(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  if (app.state === 'queueing') {
    buttonPlate(ctx, 70, 150, PW - 140, 92, 'CANCEL', UI.amber, hoverAction === 'cancel-queue');
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(159,226,255,0.85)';
    ctx.fillText(`joining ${app.codeEntry}…`, PW / 2, 300);
    return;
  }

  buttonPlate(ctx, 36, 84, 96, 34, 'BACK', UI.steel, hoverAction === 'private-back');

  const bad = app.netStatus.includes('not found') || app.netStatus.includes('expired') || app.netStatus.includes('already');
  const slots = Array.from({ length: 5 }, (_, i) => app.codeEntry[i] ?? '·').join(' ');
  ctx.font = stencilFont(40);
  ctx.fillStyle = bad ? UI.danger : UI.coolBright;
  ctx.fillText(slots, PW / 2 + 28, 104);

  const ready = app.codeEntry.length === 5;
  for (let r = 0; r < KP.rows; r++) {
    for (let c = 0; c < KP.cols; c++) {
      const key = KP_KEYS[r][c];
      const cell = kpCell(r, c);
      const accent = key === 'JOIN' ? (ready ? UI.cool : UI.steelDim) : key === 'DEL' ? UI.amber : UI.text;
      buttonPlate(ctx, cell.x, cell.y, cell.w, cell.h, key, accent, false);
    }
  }
}

function hitKeypad(u: number, v: number): MenuAction | null {
  const x = u * PW;
  const y = (1 - v) * PH;
  if (app.state === 'queueing') return y >= 140 && y <= 250 ? 'cancel-queue' : null;
  if (y >= 80 && y <= 122 && x <= 140) return 'private-back';
  for (let r = 0; r < KP.rows; r++) {
    for (let c = 0; c < KP.cols; c++) {
      const cell = kpCell(r, c);
      if (x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h) {
        const key = KP_KEYS[r][c];
        if (key === 'DEL') return 'kp-del';
        if (key === 'JOIN') return 'kp-join';
        return `kp-${Number(key)}` as MenuAction;
      }
    }
  }
  return null;
}

/** Right — doors out of the lobby: the PUB social area + customisation. */
function drawInfo(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  if (app.infoView === 'pubpick') return drawPubPicker(ctx, hoverAction);
  return drawInfoRoot(ctx, hoverAction);
}

function hitInfo(_u: number, v: number): MenuAction | null {
  if (app.infoView === 'pubpick') return hitPubPicker(v);
  return hitInfoRoot(v);
}

function drawInfoRoot(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.text, GAME_TITLE);

  buttonPlate(ctx, 70, 104, PW - 140, 96, 'IRON BALLS PUB', UI.cool, hoverAction === 'open-pub');

  // Live headcount riding the top-right of the PUB plate — the mirror of the
  // 1V1 panel's searcher badge, but the total occupancy across pub regions.
  if (app.pubCount > 0) {
    const label = `${app.pubCount}/${PUB_MAX_PLAYERS * PUB_REGIONS.length}`;
    ctx.font = '800 18px system-ui, sans-serif';
    const pillW = ctx.measureText(label).width + 38;
    const pillH = 28;
    const px = PW - 70 - pillW;
    const py = 92;
    plate(ctx, px, py, pillW, pillH, {
      cut: 8,
      fill: 'rgba(79,183,255,0.22)',
      stroke: UI.cool,
      rivets: false,
    });
    ctx.fillStyle = UI.coolBright; // a "live" dot
    ctx.beginPath();
    ctx.arc(px + 16, py + pillH / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = UI.coolBright;
    ctx.fillText(label, px + 28, py + pillH / 2 + 1);
    ctx.textAlign = 'center';
  }

  buttonPlate(ctx, 70, 226, PW - 140, 96, 'CUSTOMISE', UI.ember, hoverAction === 'open-custom');

  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('Check out the leaderboard behind you', PW / 2, 366);
}

function hitInfoRoot(v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 96 && y <= 208) return 'open-pub';
  if (y >= 218 && y <= 330) return 'open-custom';
  return null;
}

/** The pub-region picker — pick EU or USA, each with its live `X/12` headcount,
 *  shown when you tap IRON BALLS PUB. One plate per region, then BACK. */
function drawPubPicker(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.text, 'PICK A PUB');

  const accents = [UI.cool, UI.ember, UI.amber, UI.coolBright];
  const top = 96;
  const gap = 12;
  const h = Math.min(96, (260 - gap * (PUB_REGIONS.length - 1)) / PUB_REGIONS.length);
  PUB_REGIONS.forEach((region, i) => {
    const y = top + i * (h + gap);
    const action = `pub-go-${region.id}` as MenuAction;
    buttonPlate(ctx, 70, y, PW - 140, h, region.label, accents[i % accents.length], hoverAction === action);

    // Live `X/12` headcount pill on the right of each region plate.
    const count = app.pubRegionCounts[region.id];
    if (typeof count === 'number' && count >= 0) {
      const label = `${count}/${PUB_MAX_PLAYERS}`;
      ctx.font = '800 18px system-ui, sans-serif';
      const pillW = ctx.measureText(label).width + 38;
      const pillH = 28;
      const px = PW - 86 - pillW;
      const py = y + h / 2 - pillH / 2 - 14;
      plate(ctx, px, py, pillW, pillH, {
        cut: 8,
        fill: 'rgba(79,183,255,0.22)',
        stroke: UI.cool,
        rivets: false,
      });
      ctx.fillStyle = UI.coolBright;
      ctx.beginPath();
      ctx.arc(px + 16, py + pillH / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = UI.coolBright;
      ctx.fillText(label, px + 28, py + pillH / 2 + 1);
      ctx.textAlign = 'center';
    }
  });

  buttonPlate(ctx, 150, 320, PW - 300, 50, 'BACK', UI.steel, hoverAction === 'pub-back');
}

function hitPubPicker(v: number): MenuAction | null {
  const y = (1 - v) * PH;
  const top = 96;
  const gap = 12;
  const h = Math.min(96, (260 - gap * (PUB_REGIONS.length - 1)) / PUB_REGIONS.length);
  for (let i = 0; i < PUB_REGIONS.length; i++) {
    const ry = top + i * (h + gap);
    if (y >= ry - 8 && y <= ry + h + 4) return `pub-go-${PUB_REGIONS[i].id}` as MenuAction;
  }
  if (y >= 312 && y <= 378) return 'pub-back';
  return null;
}


// Leaderboard row band: the full top 10 laid out at once, then the footer.
const BOARD_ROW_Y0 = 164;
const BOARD_ROW_STEP = 30;

/** Top row: RANKED / XP / ARCADE / PROFILE. ARCADE fronts the three brawl
 *  boards, so it lights for any of training/duo/ffa. */
const BOARD_TABS: Array<[string, MenuAction, (t: LeaderboardTab) => boolean]> = [
  ['RANKED', 'lb-ranked', (t) => t === 'ranked'],
  ['XP', 'lb-xp', (t) => t === 'xp'],
  ['ARCADE', 'lb-arcade', (t) => t === 'training' || t === 'duo' || t === 'ffa'],
  ['PROFILE', 'lb-profile', (t) => t === 'profile'],
];
const BOARD_TAB_W = (BW - 96 - 48) / 4;

/** ARCADE sub-tabs: the three brawl boards. */
const ARCADE_SUBS: Array<[LeaderboardTab, string, MenuAction]> = [
  ['training', 'AIM', 'lb-training'],
  ['duo', '2V2', 'lb-duo'],
  ['ffa', 'FFA', 'lb-ffa'],
];
const ARCADE_SUB_Y = 140;
const ARCADE_SUB_H = 38;
const ARCADE_SUB_W = (BW - 96 - 32) / 3;

function arcadeActive(): boolean {
  return leaderboard.tab === 'training' || leaderboard.tab === 'duo' || leaderboard.tab === 'ffa';
}

/** Behind — the Firebase leaderboard: RANKED / XP / ARCADE boards + PROFILE. */
function drawBoard(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.amber, 'LEADERBOARD', BW, BH);
  let x = 48;
  for (const [label, action, isActive] of BOARD_TABS) {
    const active = isActive(leaderboard.tab);
    const hot = hoverAction === action;
    plate(ctx, x, 88, BOARD_TAB_W, 44, {
      cut: 10,
      fill: active ? 'rgba(255,176,0,0.18)' : hot ? 'rgba(255,176,0,0.14)' : 'rgba(150,150,170,0.10)',
      stroke: active || hot ? UI.amber : UI.steelDim,
      rivets: false,
    });
    ctx.font = '700 19px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = active || hot ? UI.amber : UI.textDim;
    ctx.fillText(label, x + BOARD_TAB_W / 2, 110);
    x += BOARD_TAB_W + 16;
  }

  // ARCADE sub-tabs (AIM / 2V2 / FFA) appear only under the ARCADE tab.
  if (arcadeActive()) {
    let sx = 48;
    for (const [id, label, action] of ARCADE_SUBS) {
      const active = leaderboard.tab === id;
      const hot = hoverAction === action;
      plate(ctx, sx, ARCADE_SUB_Y, ARCADE_SUB_W, ARCADE_SUB_H, {
        cut: 8,
        fill: active ? 'rgba(79,183,255,0.18)' : hot ? 'rgba(255,176,0,0.12)' : 'rgba(150,150,170,0.08)',
        stroke: active ? UI.cool : hot ? UI.amber : UI.steelDim,
        rivets: false,
      });
      ctx.font = '700 17px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = active ? UI.cool : hot ? UI.amber : UI.textDim;
      ctx.fillText(label, sx + ARCADE_SUB_W / 2, ARCADE_SUB_Y + ARCADE_SUB_H / 2 + 6);
      sx += ARCADE_SUB_W + 16;
    }
  }

  if (leaderboard.tab === 'profile') drawProfile(ctx, hoverAction);
  else drawBoardRows(ctx, hoverAction);
}

/** Row column origin — pushed down when the ARCADE sub-tab row is showing. */
function boardRowY0(): number {
  return arcadeActive() ? BOARD_ROW_Y0 + ARCADE_SUB_H + 8 : BOARD_ROW_Y0;
}

function drawBoardRows(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  const rows = leaderboardRows();
  const offset = boardScroll();
  const rowY0 = boardRowY0();
  rows.slice(offset, offset + LEADERBOARD_VISIBLE_ROWS).forEach((r, i) => {
    const y = rowY0 + i * BOARD_ROW_STEP;
    const hot = hoverAction === `lb-row-${i}`;
    if (hot) {
      ctx.fillStyle = 'rgba(255,176,0,0.12)';
      ctx.fillRect(38, y - 16, BW - 76, BOARD_ROW_STEP - 3);
    }
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillStyle = r.me ? UI.emberBright : hot ? UI.text : UI.textDim;
    ctx.textAlign = 'left';
    // Rank number, then a small rank emblem (nudged down so its bottom lines
    // up with the row text — text is middle-baselined at y), then the name.
    ctx.fillText(`${offset + i + 1}.`, 48, y);
    const badge = rankBadge(tierForXp(r.xp).index);
    if (badge) ctx.drawImage(badge, 84, y + 12 - 30, 30, 30);
    ctx.fillText(r.name, 126, y);
    ctx.textAlign = 'right';
    ctx.fillText(String(r.value), BW - 56, y);
  });
  ctx.textAlign = 'center';
  if (!rows.length) {
    ctx.fillStyle = UI.textDim;
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillText(leaderboard.status || 'no entries yet', BW / 2, rowY0 + 4 * BOARD_ROW_STEP);
  } else {
    ctx.fillStyle = UI.steelDim;
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText('tap a name to open their profile', BW / 2, 514);
  }
}

/** The PROFILE face: a player's big emblem, tier, ELO/XP and their note. */
function drawProfile(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  const row = leaderboard.viewRow ?? myProfileRow();
  const own = row.me;
  const tier = tierForXp(row.xp);
  const badge = rankBadge(tier.index);
  if (badge) ctx.drawImage(badge, BW / 2 - 58, 134, 116, 116);

  ctx.textAlign = 'center';
  ctx.font = stencilFont(38);
  ctx.fillStyle = UI.emberBright;
  ctx.fillText(row.name, BW / 2, 286);
  ctx.font = stencilFont(24);
  ctx.fillStyle = UI.amber;
  ctx.fillText(tier.name, BW / 2, 320);
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  ctx.fillText(`${row.elo} ELO       ${row.xp} XP`, BW / 2, 352);

  // Progress toward the next rank emblem.
  segmentBar(ctx, 80, 366, BW - 160, 16, tier.progress, UI.ember);
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  ctx.fillText(
    tier.next === null ? 'MAX RANK' : `${tier.next - row.xp} XP TO ${tierForXp(tier.next).name}`,
    BW / 2,
    396,
  );

  // Note plate — clipped so a long note can never spill past the box.
  plate(ctx, 56, 408, BW - 112, 72, { cut: 10, fill: 'rgba(18,19,24,0.5)', stroke: UI.steelDim, rivets: false });
  ctx.save();
  ctx.beginPath();
  ctx.rect(64, 412, BW - 128, 64);
  ctx.clip();
  ctx.font = '600 21px system-ui, sans-serif';
  ctx.fillStyle = row.note ? UI.text : UI.steelDim;
  drawNote(ctx, row.note || (own ? 'no note yet' : 'no note'), BW / 2, 434, BW - 152, 26);
  ctx.restore();

  if (own) {
    buttonPlate(ctx, 56, 488, 180, 40, 'RENAME', UI.amber, hoverAction === 'rename');
    buttonPlate(ctx, BW - 236, 488, 180, 40, 'WRITE NOTE', UI.cool, hoverAction === 'edit-note');
    if (performance.now() < profileKeyboardHintUntil) {
      plate(ctx, 70, 529, BW - 140, 18, {
        cut: 5,
        fill: 'rgba(22,30,38,0.88)',
        stroke: UI.cool,
        rivets: false,
      });
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillStyle = UI.coolBright;
      ctx.fillText('turn around to the keyboard to write your note', BW / 2, 539);
    }
  } else {
    buttonPlate(ctx, BW / 2 - 90, 494, 180, 42, 'BACK', UI.steel, hoverAction === 'profile-back');
  }
}

/** A profile note in at most two centred lines, ellipsised if it overflows. */
function drawNote(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, lineH: number): void {
  const words = text.split(' ');
  const lines = [''];
  for (const w of words) {
    const i = lines.length - 1;
    const test = lines[i] ? `${lines[i]} ${w}` : w;
    if (ctx.measureText(test).width > maxW && lines[i]) {
      if (lines.length === 2) {
        let s = `${lines[1]}…`;
        while (s.length > 1 && ctx.measureText(s).width > maxW) s = `${s.slice(0, -2)}…`;
        lines[1] = s;
        break;
      }
      lines.push(w);
    } else {
      lines[i] = test;
    }
  }
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, cx, y + i * lineH));
}

function hitBoard(u: number, v: number): MenuAction | null {
  const x = u * BW;
  const y = (1 - v) * BH;
  if (y >= 82 && y <= 138) {
    const i = Math.max(0, Math.min(3, Math.floor((x - 48) / (BOARD_TAB_W + 16))));
    return BOARD_TABS[i][1];
  }
  // ARCADE sub-tabs.
  if (arcadeActive() && y >= ARCADE_SUB_Y - 4 && y <= ARCADE_SUB_Y + ARCADE_SUB_H + 4) {
    const i = Math.max(0, Math.min(2, Math.floor((x - 48) / (ARCADE_SUB_W + 16))));
    return ARCADE_SUBS[i][2];
  }
  if (leaderboard.tab === 'profile') {
    if (y >= 482 && y <= 536) {
      const own = !leaderboard.viewRow || leaderboard.viewRow.me;
      return own ? (x < BW / 2 ? 'rename' : 'edit-note') : 'profile-back';
    }
    return null;
  }
  const rowY0 = boardRowY0();
  if (y >= rowY0 - 15 && y <= rowY0 + LEADERBOARD_VISIBLE_ROWS * BOARD_ROW_STEP) {
    const n = Math.floor((y - (rowY0 - 15)) / BOARD_ROW_STEP);
    if (n >= 0 && n < LEADERBOARD_VISIBLE_ROWS) return `lb-row-${n}` as MenuAction;
  }
  return null;
}

// --- the A-button action panel -----------------------------------------------

export interface ActionButton {
  id: string;
  label: string;
  accent: string;
}

export interface ActionPanel {
  mesh: Mesh;
  /** Redraw with the given content; the layout is remembered for hitTest. */
  redraw: (
    title: string,
    buttons: ActionButton[],
    hint: string,
    hoverId: string | null,
    status?: string,
  ) => void;
  /** Map a hit UV to the id of the button under it, or null. */
  hitTest: (u: number, v: number) => string | null;
}

const FW = 512;
const FH = 384;

/**
 * The small waist-height panel summoned with the A button: FORFEIT mid-
 * training, REMATCH / RETURN at the end of a bout. Starts hidden; MenuSystem
 * owns placement, toggling and what the buttons do.
 */
export function createActionPanel(scene: Scene): ActionPanel {
  const canvas = document.createElement('canvas');
  canvas.width = FW;
  canvas.height = FH;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(0.46, 0.345),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  mesh.name = 'action-panel';
  mesh.visible = false;
  scene.add(mesh);

  let zones: Array<{ id: string; y0: number; y1: number }> = [];

  return {
    mesh,
    redraw: (title, buttons, hint, hoverId, status = '') => {
      ctx.clearRect(0, 0, FW, FH);
      plate(ctx, 8, 8, FW - 16, FH - 16, {
        cut: 22,
        fill: UI.ink,
        stroke: hoverId ? UI.amberSoft : UI.steel,
      });
      hazardStrip(ctx, 36, 30, 48, 14, UI.amber);
      ctx.textAlign = 'left';
      ctx.font = stencilFont(30);
      ctx.fillStyle = UI.amberSoft;
      ctx.fillText(title, 98, 38);
      ctx.strokeStyle = UI.steelDim;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(36, 64);
      ctx.lineTo(FW - 36, 64);
      ctx.stroke();

      zones = [];
      let y = 84;
      for (const b of buttons) {
        buttonPlate(ctx, 64, y, FW - 128, 84, b.label, b.accent, hoverId === b.id);
        zones.push({ id: b.id, y0: y - 6, y1: y + 90 });
        y += 102;
      }

      ctx.textAlign = 'center';
      ctx.font = '600 24px system-ui, sans-serif';
      if (status) {
        ctx.fillStyle = UI.coolBright;
        ctx.fillText(status, FW / 2, y + 12);
      }
      ctx.fillStyle = UI.textDim;
      ctx.fillText(hint, FW / 2, FH - 34);
      texture.needsUpdate = true;
    },
    hitTest: (_u, v) => {
      const y = (1 - v) * FH;
      for (const z of zones) {
        if (y >= z.y0 && y <= z.y1) return z.id;
      }
      return null;
    },
  };
}


// --- BALL LOADOUT: pick an attachment for each fist's ball -----------------

interface AttachInfo {
  name: string;
  color: string;
  desc: string;
}
const ATTACHMENTS: AttachInfo[] = [
  { name: 'SPLIT', color: UI.cool, desc: 'Splits on return.' },
  { name: 'GROW', color: UI.emberBright, desc: 'Gets bigger on return with less damage.' },
  { name: 'SHRINK', color: UI.amber, desc: 'Gets smaller on return for more damage.' },
];
const TYPES = [ATTACH.split, ATTACH.grow, ATTACH.shrink];

const BALL_W = 560;
const BALL_H = 480;
const BMX = 36; // side margin
const BGAP = 18; // gap between tiles
const TILE_W = (BALL_W - 2 * BMX - 2 * BGAP) / 3;
const TILE_H = 92;
const ROW_L_Y = 120; // left-fist tile row top
const ROW_R_Y = 244; // right-fist tile row top
const DESC_Y = 360;
const tileX = (i: number): number => BMX + i * (TILE_W + BGAP);

/** Last attachment whose description is shown in the box (−1 = none yet). */
let ballDescIdx = -1;

/** A small arrowhead triangle at (x,y) pointing along `ang`. */
function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.6, size * 0.6);
  ctx.lineTo(-size * 0.6, -size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Draw the icon for an attachment type (ATTACH.*) centred at (cx,cy). */
function drawAttachIcon(ctx: CanvasRenderingContext2D, type: number, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  if (type === ATTACH.split) {
    for (let k = 0; k < 3; k++) {
      const ang = -Math.PI / 2 + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * r * 0.55, cy + Math.sin(ang) * r * 0.55, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  const grow = type === ATTACH.grow;
  // Outer ring.
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Solid core — small for grow (about to grow), large for shrink.
  ctx.beginPath();
  ctx.arc(cx, cy, grow ? r * 0.26 : r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  // Four arrows: outward for grow, inward for shrink.
  for (let k = 0; k < 4; k++) {
    const ang = Math.PI / 4 + (k * Math.PI) / 2;
    const rad = grow ? r * 0.5 : r * 0.78;
    arrowHead(ctx, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, grow ? ang : ang + Math.PI, r * 0.22);
  }
}

/** Word-wrap `text` into `maxW`, returning the count of lines drawn. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  const words = text.split(' ');
  let line = '';
  let cy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, cy);
      line = w;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

function drawBallRow(ctx: CanvasRenderingContext2D, side: 0 | 1, label: string, rowY: number): void {
  const equipped = app.ballAttach[side] ?? 0;
  ctx.textAlign = 'left';
  ctx.font = '700 23px system-ui, sans-serif';
  ctx.fillStyle = UI.text;
  const eqName = equipped ? ATTACHMENTS[equipped - 1].name.toLowerCase() : 'none';
  ctx.fillText(`${label}  ·  ${eqName}`, BMX, rowY - 16);

  for (let i = 0; i < 3; i++) {
    const type = TYPES[i];
    const info = ATTACHMENTS[i];
    const selected = equipped === type;
    const x = tileX(i);
    plate(ctx, x, rowY, TILE_W, TILE_H, {
      cut: 10,
      fill: selected ? 'rgba(255,255,255,0.10)' : 'rgba(18,19,24,0.6)',
      stroke: selected ? info.color : UI.steelDim,
      rivets: false,
    });
    drawAttachIcon(ctx, type, x + TILE_W / 2, rowY + 34, 24, selected ? info.color : UI.steel);
    ctx.textAlign = 'center';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillStyle = selected ? info.color : UI.textDim;
    ctx.fillText(info.name, x + TILE_W / 2, rowY + TILE_H - 16);
  }
}

/** BALL LOADOUT: per-fist attachment picker with click-to-read descriptions. */
function drawBalls(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  const hover = hoverAction !== null;
  panelBg(ctx, hover, UI.emberBright, 'BALL LOADOUT', BALL_W, BALL_H);

  drawBallRow(ctx, 0, 'LEFT FIST', ROW_L_Y);
  drawBallRow(ctx, 1, 'RIGHT FIST', ROW_R_Y);

  // Description box for the last-tapped attachment.
  plate(ctx, BMX, DESC_Y, BALL_W - 2 * BMX, 104, {
    cut: 10,
    fill: 'rgba(10,11,14,0.55)',
    stroke: UI.steelDim,
    rivets: false,
  });
  ctx.textAlign = 'left';
  if (ballDescIdx < 0) {
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillStyle = UI.textDim;
    ctx.fillText('tap an attachment to read what it does', BMX + 20, DESC_Y + 52);
  } else {
    const info = ATTACHMENTS[ballDescIdx];
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillStyle = info.color;
    ctx.fillText(info.name, BMX + 20, DESC_Y + 28);
    ctx.font = '500 20px system-ui, sans-serif';
    ctx.fillStyle = UI.text;
    wrapText(ctx, info.desc, BMX + 20, DESC_Y + 58, BALL_W - 2 * BMX - 40, 26);
  }
}

/** Tap a tile → equip/clear that attachment and show its description. */
function clickBalls(u: number, v: number): boolean {
  const x = u * BALL_W;
  const y = (1 - v) * BALL_H;
  for (const [side, rowY] of [[0, ROW_L_Y], [1, ROW_R_Y]] as const) {
    if (y < rowY || y > rowY + TILE_H) continue;
    const i = Math.floor((x - BMX) / (TILE_W + BGAP));
    if (i < 0 || i > 2) return false;
    const tx = tileX(i);
    if (x < tx || x > tx + TILE_W) return false;
    const type = TYPES[i];
    ballDescIdx = i;
    app.ballAttach[side] = app.ballAttach[side] === type ? 0 : type;
    saveBallAttach();
    return true;
  }
  return false;
}

// --- THE GASKET GAZETTE -----------------------------------------------------
// A plain circular button hangs above the right panel; it wears a red dot when
// Sheriff Cole Ironside has filed a new edition you haven't read. Tapping it
// opens the paper itself — an aged-newsprint front page (serif type on cream,
// a deliberate break from the smoked-steel lobby) over the lobby arc.

const GZ = 128; // the round button's square canvas
const NW = 720; // newspaper page canvas — portrait, like a real front page
const NH = 900;

/** The round paper button: a steel disc with a folded-newspaper glyph, plus a
 *  red notification dot while the latest edition is unread. NOT glowing. */
function drawGazetteButton(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  ctx.clearRect(0, 0, GZ, GZ);
  const hot = hoverAction === 'open-gazette';
  const cx = GZ / 2;
  const cy = GZ / 2;
  const r = 52;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = hot ? 'rgba(16,18,24,0.92)' : 'rgba(9,10,14,0.82)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = hot ? UI.amber : UI.steel;
  ctx.stroke();

  // Folded-newspaper glyph: a page with a masthead bar + body lines.
  const iw = 50;
  const ih = 44;
  const ix = cx - iw / 2;
  const iy = cy - ih / 2;
  const ink = hot ? UI.amber : UI.text;
  ctx.fillStyle = ink;
  ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = 'rgba(9,10,14,0.92)';
  ctx.fillRect(ix + 6, iy + 6, iw - 12, 9); // masthead block
  for (let i = 0; i < 4; i++) ctx.fillRect(ix + 6, iy + 21 + i * 6, iw - 12, 3); // text lines

  // Unread dot — the whole point of the button.
  if (gazette.unread) {
    ctx.beginPath();
    ctx.arc(cx + r * 0.66, cy - r * 0.66, 12, 0, Math.PI * 2);
    ctx.fillStyle = UI.danger;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
  }
}

/** Inside the disc → open the gazette. */
function hitGazetteButton(u: number, v: number): MenuAction | null {
  const dx = u - 0.5;
  const dy = v - 0.5;
  return dx * dx + dy * dy <= 0.41 * 0.41 ? 'open-gazette' : null;
}

/** The lobby-music mute button: a steel disc with a speaker glyph, struck
 *  through in red when muted. Matches the paper button's look (NOT glowing). */
function drawMuteButton(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  ctx.clearRect(0, 0, GZ, GZ);
  const hot = hoverAction === 'toggle-mute';
  const muted = isMusicMuted();
  const cx = GZ / 2;
  const cy = GZ / 2;
  const r = 52;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = hot ? 'rgba(16,18,24,0.92)' : 'rgba(9,10,14,0.82)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = hot ? UI.amber : UI.steel;
  ctx.stroke();

  const ink = muted ? UI.steel : hot ? UI.amber : UI.text;
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  // Speaker body: a little square + a trapezoidal cone.
  ctx.beginPath();
  ctx.moveTo(cx - 22, cy - 9);
  ctx.lineTo(cx - 9, cy - 9);
  ctx.lineTo(cx + 4, cy - 20);
  ctx.lineTo(cx + 4, cy + 20);
  ctx.lineTo(cx - 9, cy + 9);
  ctx.lineTo(cx - 22, cy + 9);
  ctx.closePath();
  ctx.fill();
  if (!muted) {
    // Two sound-wave arcs.
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (const rad of [12, 21]) {
      ctx.beginPath();
      ctx.arc(cx + 6, cy, rad, -Math.PI / 4, Math.PI / 4);
      ctx.stroke();
    }
  } else {
    // Red strike-through — sound off.
    ctx.strokeStyle = UI.danger;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 26, cy - 22);
    ctx.lineTo(cx - 14, cy + 22);
    ctx.stroke();
  }
}

/** Inside the disc → toggle mute. */
function hitMuteButton(u: number, v: number): MenuAction | null {
  const dx = u - 0.5;
  const dy = v - 0.5;
  return dx * dx + dy * dy <= 0.41 * 0.41 ? 'toggle-mute' : null;
}

const NEWS_INK = '#241c12'; // sepia newsprint ink
const NEWS_SERIF = 'Georgia, "Times New Roman", serif';
/** CLOSE button band on the page (canvas coords). */
const NEWS_CLOSE = { x: NW / 2 - 120, y: NH - 92, w: 240, h: 56 };

function newsRule(ctx: CanvasRenderingContext2D, y: number, h = 3): void {
  ctx.fillStyle = NEWS_INK;
  ctx.fillRect(48, y, NW - 96, h);
}

/** Flow one paragraph, wrapped to `maxW`; returns the y past the last line.
 *  Pass `draw = false` to measure height only (for scroll clamping). */
function flowParagraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  draw = true,
): number {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  let line = '';
  let cy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      if (draw) ctx.fillText(line, x, cy);
      line = w;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) {
    if (draw) ctx.fillText(line, x, cy);
    cy += lineH;
  }
  return cy;
}

// Body scroll (pixels): the news body scrolls under the fixed masthead/headline
// when an edition runs long, driven by the thumbstick like the leaderboard.
// drawNews sets the max each redraw; scrollNews clamps against it.
let newsScroll = 0;
let newsMaxScroll = 0;

/** Scroll the news body by `deltaPx`, clamped. Returns true if it moved. */
export function scrollNews(deltaPx: number): boolean {
  const before = newsScroll;
  newsScroll = Math.max(0, Math.min(newsMaxScroll, newsScroll + deltaPx));
  return newsScroll !== before;
}

/** Back to the top — called when the paper is opened. */
export function resetNewsScroll(): void {
  newsScroll = 0;
}

/** A tin sheriff's star, drawn as a bold newsprint engraving (sepia ink): a
 *  double ring and a solid five-point ball-tipped star. */
function drawSheriffBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.strokeStyle = NEWS_INK;
  ctx.fillStyle = NEWS_INK;
  ctx.lineJoin = 'round';

  // Double ring — a struck-tin rim.
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
  ctx.stroke();

  // Solid five-point star.
  const tips = 5;
  const outer = r * 0.72;
  const inner = r * 0.3;
  ctx.beginPath();
  for (let i = 0; i < tips * 2; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / tips;
    const rad = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // A small ball at each of the five points.
  const ballR = r * 0.1;
  for (let i = 0; i < tips; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / tips;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * outer, cy + Math.sin(ang) * outer, ballR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Where the scrolling article column begins (just below the dateline rule). */
const NEWS_CONTENT_TOP = 272;

/** Lay out the whole article — headline, subhead, rule, body, byline — from
 *  `top` downward, returning the y past the last line. `draw = false` measures
 *  only (for scroll clamping); the y arithmetic is identical either way so the
 *  measured height matches what's drawn. */
function layoutArticle(ctx: CanvasRenderingContext2D, art: GazetteArticle, top: number, draw: boolean): number {
  ctx.textAlign = 'center';
  ctx.fillStyle = NEWS_INK;
  ctx.font = `900 46px ${NEWS_SERIF}`;
  let y = flowParagraph(ctx, art.headline.toUpperCase(), NW / 2, top, NW - 110, 50, draw);
  if (art.subhead) {
    ctx.font = `italic 24px ${NEWS_SERIF}`;
    y = flowParagraph(ctx, art.subhead, NW / 2, y + 18, NW - 150, 30, draw) + 6;
  }
  if (draw) newsRule(ctx, y + 6, 2);
  y += 34;

  ctx.textAlign = 'left';
  ctx.fillStyle = NEWS_INK;
  ctx.font = `22px ${NEWS_SERIF}`;
  for (const para of art.body.split(/\n\s*\n/)) y = flowParagraph(ctx, para, 50, y, NW - 100, 30, draw) + 12;

  ctx.textAlign = 'right';
  ctx.font = `italic bold 22px ${NEWS_SERIF}`;
  if (draw) ctx.fillText(`— ${art.byline}, Gasket Township`, NW - 50, y + 8);
  y += 40;
  return y;
}

/** The Gasket Gazette front page. */
function drawNews(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  // Aged paper, lightly vignetted at the edges.
  ctx.clearRect(0, 0, NW, NH);
  ctx.fillStyle = '#e9e2cf';
  ctx.fillRect(0, 0, NW, NH);
  const vg = ctx.createRadialGradient(NW / 2, NH / 2, NH * 0.18, NW / 2, NH / 2, NH * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(74,52,18,0.22)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, NW, NH);
  ctx.strokeStyle = NEWS_INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, NW - 28, NH - 28);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(22, 22, NW - 44, NH - 44);

  const art = gazette.article;

  // Masthead — a tin sheriff's star crests the page.
  ctx.fillStyle = NEWS_INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  drawSheriffBadge(ctx, NW / 2, 64, 30);
  newsRule(ctx, 102);
  ctx.fillStyle = NEWS_INK;
  ctx.font = `900 58px ${NEWS_SERIF}`;
  ctx.fillText('The Gasket Gazette', NW / 2, 152);
  ctx.font = `italic 17px ${NEWS_SERIF}`;
  ctx.fillText('GASKET TERRITORY · EST. 2226 · PRICE ONE CENT', NW / 2, 178);
  newsRule(ctx, 192, 2);

  // Dateline strip — edition number left, the date centred. Strip any
  // "GASKET TERRITORY —" prefix (older editions stored it) so the date stays
  // short and never collides.
  ctx.font = `bold 16px ${NEWS_SERIF}`;
  ctx.textAlign = 'left';
  ctx.fillText(art ? `No. ${art.edition}` : 'No. —', 50, 216);
  let dateText = (art?.dateline || '').replace(/^\s*GASKET TERRITORY\s*[—–-]\s*/i, '').trim();
  if (!dateText) dateText = 'GASKET TERRITORY';
  ctx.textAlign = 'center';
  ctx.fillText(dateText, NW / 2, 216);
  newsRule(ctx, 228, 2);

  ctx.textAlign = 'center';
  if (!art) {
    ctx.font = `italic 26px ${NEWS_SERIF}`;
    ctx.fillStyle = NEWS_INK;
    ctx.fillText(gazette.status || 'the presses are quiet', NW / 2, NH / 2 - 40);
    ctx.font = `18px ${NEWS_SERIF}`;
    ctx.fillText('Check back after the next edition is filed.', NW / 2, NH / 2);
  } else {
    // The WHOLE article — headline, subhead, body, byline — scrolls together
    // as one column under the fixed masthead (thumbstick, like the leaderboard).
    const viewBottom = NEWS_CLOSE.y - 16;
    const clipTop = 238; // just under the dateline rule, above the headline tops

    // Measure the full article height (no draw) to clamp the scroll.
    const contentBottom = layoutArticle(ctx, art, NEWS_CONTENT_TOP, false);
    newsMaxScroll = Math.max(0, contentBottom - viewBottom);
    if (newsScroll > newsMaxScroll) newsScroll = newsMaxScroll;

    // Draw the article in a scrolling viewport.
    ctx.save();
    ctx.beginPath();
    ctx.rect(28, clipTop, NW - 56, viewBottom - clipTop);
    ctx.clip();
    ctx.translate(0, -newsScroll);
    layoutArticle(ctx, art, NEWS_CONTENT_TOP, true);
    ctx.restore();

    // More-to-read chevrons in the right margin.
    const chevron = (yc: number, down: boolean): void => {
      ctx.fillStyle = 'rgba(36,28,18,0.6)';
      const xc = NW - 40;
      const s = 7;
      ctx.beginPath();
      if (down) {
        ctx.moveTo(xc - s, yc - s);
        ctx.lineTo(xc + s, yc - s);
        ctx.lineTo(xc, yc + s);
      } else {
        ctx.moveTo(xc - s, yc + s);
        ctx.lineTo(xc + s, yc + s);
        ctx.lineTo(xc, yc - s);
      }
      ctx.closePath();
      ctx.fill();
    };
    if (newsScroll > 0.5) chevron(clipTop + 8, false);
    if (newsScroll < newsMaxScroll - 0.5) chevron(viewBottom - 6, true);
  }

  // CLOSE — the one control on the page. Restore the 'middle' baseline FIRST
  // (the masthead left it 'alphabetic'); buttonPlate centres its label assuming
  // middle, so without this the CLOSE text rides high in the button.
  ctx.textBaseline = 'middle';
  buttonPlate(ctx, NEWS_CLOSE.x, NEWS_CLOSE.y, NEWS_CLOSE.w, NEWS_CLOSE.h, 'CLOSE', UI.amber, hoverAction === 'gazette-close');
}

function hitNews(u: number, v: number): MenuAction | null {
  const x = u * NW;
  const y = (1 - v) * NH;
  if (x >= NEWS_CLOSE.x && x <= NEWS_CLOSE.x + NEWS_CLOSE.w && y >= NEWS_CLOSE.y && y <= NEWS_CLOSE.y + NEWS_CLOSE.h) {
    return 'gazette-close';
  }
  return null;
}

// --- THE COIN WALLET + PLATFORM SHOP ----------------------------------------
// A small readout sits beside the paper button: the bolt-dollar symbol and your
// balance. Spend it in the shop (reached from CUSTOMISE) on new platforms — the
// three launch pads are free, a couple of recolours cost 100, the gold pad 1000.

/** Draw the riveted "$" symbol at (x,y) sized w×h — the decoded PNG once it's
 *  loaded, with a stencilled "$" as the fallback before then. */
function drawCoinSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const img = coinImage();
  if (img) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(h * 0.9)}px Georgia, serif`;
    ctx.fillStyle = UI.amber;
    ctx.fillText('$', x + w / 2, y + h / 2);
    ctx.restore();
  }
}

const COIN_HUD_W = 256;
const COIN_HUD_H = 128;

// The number shown on the lobby readout ROLLS UP to the real balance rather
// than snapping — so coins banked during a bout count up satisfyingly the
// moment you're back at the menu. `coinShown` is the live (fractional) display
// value; MenuSystem ticks it each lobby frame via tickCoinRollup.
let coinShown = coins.balance;

/**
 * Ease the displayed coin count toward the real balance. Returns true while
 * it's still rolling (so the caller keeps redrawing the readout), false once
 * it's landed. A min step makes small gains still visibly tick over.
 */
export function tickCoinRollup(dt: number): boolean {
  const target = coins.balance;
  const diff = target - coinShown;
  if (Math.abs(diff) < 0.5) {
    const landed = coinShown !== target;
    coinShown = target;
    return landed; // one last redraw to show the final integer
  }
  const step = diff * (1 - Math.exp(-7 * dt));
  // Guarantee forward progress so the digits keep moving on big jumps.
  coinShown += Math.abs(step) < 0.4 ? Math.sign(diff) * 0.4 : step;
  return true;
}

/** The current readout value (rounded) — also lets the shop/header agree. */
function coinDisplayValue(): number {
  return Math.round(coinShown);
}

/** The lobby coin readout: symbol on the left, balance on the right, on a
 *  smoked-steel chip — sized and styled to sit beside the gazette button. */
function drawCoinHud(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, COIN_HUD_W, COIN_HUD_H);
  const rolling = coinShown !== coins.balance;
  plate(ctx, 6, 30, COIN_HUD_W - 12, COIN_HUD_H - 60, {
    cut: 14,
    fill: 'rgba(9,10,14,0.82)',
    stroke: rolling ? UI.amber : UI.steel, // glints amber while counting up
    rivets: false,
  });
  drawCoinSymbol(ctx, 22, 40, 48, 48);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '800 46px system-ui, sans-serif';
  ctx.fillStyle = rolling ? UI.amber : UI.text;
  ctx.fillText(String(coinDisplayValue()), 84, 65);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
}

// The shop sells both cosmetics: AVATARS (everything we've got, plus a COMING
// SOON tile) on top, PLATFORMS (free recolours + paid ones) below. Two tidy
// grids of chips with the CLOSE button clear beneath them.
// ─────────────────────────── SHOP & LOCKER ──────────────────────────────────
// Two faces of one tabbed cosmetics plate. SHOP lists every item with prices
// (buying auto-equips AND stocks your locker); LOCKER lists only what you own,
// to equip — plus a COLOUR tab carrying the armour + accent hue sliders. Each
// tile shows a PICTURE of the skin: an animal silhouette (a shield for the
// knight) for avatars, a little coloured pad for platforms.

const PAN_W = 560;
const PAN_H = 600;
const TAB_Y = 84;
const TAB_H = 46;
const GRID_TOP = 152;
const GRID_COLS = 3;
const GRID_GAP = 14;
const ITEM_W = (PAN_W - 80 - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS;
const ITEM_H = 112;
const ROW_STEP = ITEM_H + 12;
const FOOT_SWAP = { x: 40, y: PAN_H - 66, w: 210, h: 50 };
const FOOT_CLOSE = { x: PAN_W - 40 - 160, y: PAN_H - 66, w: 160, h: 50 };
// COLOUR-tab tracks (locker only): armour repaints the suit, accent the neon,
// each with a hue track and a lightness track beneath it.
const ARMOUR_BAR = { x: 40, y: 168, w: PAN_W - 210, h: 38 };
const ARMOUR_DEF = { x: PAN_W - 156, y: 168, w: 116, h: 38 };
const ARMOUR_LIGHT_BAR = { x: 40, y: 250, w: PAN_W - 80, h: 38 };
const ACCENT_BAR = { x: 40, y: 348, w: PAN_W - 210, h: 38 };
const ACCENT_DEF = { x: PAN_W - 156, y: 348, w: 116, h: 38 };
const ACCENT_LIGHT_BAR = { x: 40, y: 430, w: PAN_W - 80, h: 38 };

interface PanRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function hexCss(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

function inPanRect(x: number, y: number, r: PanRect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** u (0..1 across the panel) → hue (0..1) for the armour track. */
export function colorBarHue(u: number): number {
  return Math.max(0, Math.min(1, (u * PAN_W - ARMOUR_BAR.x) / ARMOUR_BAR.w));
}
/** u → hue for the accent track. */
export function accentBarHue(u: number): number {
  return Math.max(0, Math.min(1, (u * PAN_W - ACCENT_BAR.x) / ACCENT_BAR.w));
}
/** u → lightness (0..1) for the armour lightness track. */
export function colorBarLight(u: number): number {
  return Math.max(0, Math.min(1, (u * PAN_W - ARMOUR_LIGHT_BAR.x) / ARMOUR_LIGHT_BAR.w));
}
/** u → lightness (0..1) for the accent lightness track. */
export function accentBarLight(u: number): number {
  return Math.max(0, Math.min(1, (u * PAN_W - ACCENT_LIGHT_BAR.x) / ACCENT_LIGHT_BAR.w));
}

/** Which tab is showing. 'colour' is locker-only, so the shop falls back to avatars. */
function activeTab(locker: boolean): 'avatars' | 'platforms' | 'colour' {
  const t = customization.tab;
  return !locker && t === 'colour' ? 'avatars' : t;
}

interface DisplayItem {
  rect: PanRect;
  action: MenuAction;
  kind: 'avatar' | 'platform';
  skin: AvatarSkin | PlatformSkin;
  index: number;
}

/** The tiles shown for the current tab — laid out in a 3-wide grid. SHOP shows
 *  everything (+ a COMING SOON slot), the LOCKER only what's owned. */
function panelItems(locker: boolean): { items: DisplayItem[]; soon: PanRect | null } {
  const tab = activeTab(locker);
  const items: DisplayItem[] = [];
  let idx = 0;
  const next = (): PanRect => {
    const col = idx % GRID_COLS;
    const row = Math.floor(idx / GRID_COLS);
    idx++;
    return { x: 40 + col * (ITEM_W + GRID_GAP), y: GRID_TOP + row * ROW_STEP, w: ITEM_W, h: ITEM_H };
  };
  if (tab === 'avatars') {
    AVATAR_SKINS.forEach((s, i) => {
      if (s.locked) return;
      items.push({ rect: next(), action: `shop-av-${i}` as MenuAction, kind: 'avatar', skin: s, index: i });
    });
    return { items, soon: locker ? null : next() };
  }
  PLATFORM_SKINS.forEach((s, j) => {
    if (locker && !platformOwned(s.id)) return;
    items.push({ rect: next(), action: `shop-pf-${j}` as MenuAction, kind: 'platform', skin: s, index: j });
  });
  return { items, soon: null };
}

/** One cosmetic tile: a picture, its name, and a status footer. */
function drawTile(ctx: CanvasRenderingContext2D, it: DisplayItem, hoverAction: MenuAction | null): void {
  const r = it.rect;
  const avatar = it.kind === 'avatar';
  const accent = avatar ? (it.skin as AvatarSkin).accent : (it.skin as PlatformSkin).neon;
  const css = hexCss(accent);
  const equipped = avatar ? customization.avatar === it.skin.id : customization.platform === it.skin.id;
  const owned = avatar ? true : platformOwned(it.skin.id);
  const hot = hoverAction === it.action;
  plate(ctx, r.x, r.y, r.w, r.h, {
    cut: 10,
    fill: equipped ? 'rgba(20,22,30,0.94)' : hot ? 'rgba(20,22,30,0.9)' : 'rgba(10,11,15,0.72)',
    stroke: equipped || hot ? css : UI.steel,
    rivets: false,
  });
  const icx = r.x + r.w / 2;
  const iconR = r.h * 0.27;
  if (avatar) drawAvatarIcon(ctx, it.skin.id, icx, r.y + r.h * 0.34, iconR, css);
  else drawPlatformIcon(ctx, it.skin as PlatformSkin, icx, r.y + r.h * 0.34, iconR);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fs = 18;
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  while (fs > 11 && ctx.measureText(it.skin.name).width > r.w - 16) {
    fs -= 1;
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
  }
  ctx.fillStyle = equipped || hot ? css : UI.text;
  ctx.fillText(it.skin.name, icx, r.y + r.h * 0.72);

  const fy = r.y + r.h - 14;
  ctx.font = '800 12px system-ui, sans-serif';
  if (equipped) {
    ctx.fillStyle = UI.amber;
    ctx.fillText('EQUIPPED', icx, fy);
  } else if (owned) {
    ctx.fillStyle = 'rgba(232,236,242,0.5)';
    ctx.fillText('EQUIP', icx, fy);
  } else {
    const price = (it.skin as PlatformSkin).price ?? 0;
    const str = String(price);
    ctx.font = '800 15px system-ui, sans-serif';
    const tw = ctx.measureText(str).width;
    const sym = 16;
    const sx = icx - (sym + 4 + tw) / 2;
    drawCoinSymbol(ctx, sx, fy - sym / 2, sym, sym);
    ctx.textAlign = 'left';
    ctx.fillStyle = canAfford(price) ? UI.amber : UI.steelDim;
    ctx.fillText(str, sx + sym + 4, fy);
  }
}

function drawSoonTile(ctx: CanvasRenderingContext2D, r: PanRect): void {
  plate(ctx, r.x, r.y, r.w, r.h, { cut: 10, fill: 'rgba(60,62,70,0.22)', stroke: UI.steelDim, rivets: false });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = UI.steelDim;
  ctx.font = `900 ${Math.round(r.h * 0.36)}px system-ui, sans-serif`;
  ctx.fillText('?', r.x + r.w / 2, r.y + r.h * 0.36);
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.fillText('SOON', r.x + r.w / 2, r.y + r.h * 0.72);
  ctx.font = '800 12px system-ui, sans-serif';
  ctx.fillText('COMING SOON', r.x + r.w / 2, r.y + r.h - 14);
}

interface TabDef {
  label: string;
  action: MenuAction;
  active: boolean;
}

function drawTabs(ctx: CanvasRenderingContext2D, tabs: TabDef[], hoverAction: MenuAction | null): void {
  const gap = 10;
  const w = (PAN_W - 80 - (tabs.length - 1) * gap) / tabs.length;
  tabs.forEach((t, i) => {
    const x = 40 + i * (w + gap);
    const hot = hoverAction === t.action;
    plate(ctx, x, TAB_Y, w, TAB_H, {
      cut: 8,
      fill: t.active ? 'rgba(255,176,0,0.16)' : hot ? 'rgba(20,22,30,0.9)' : 'rgba(10,11,15,0.6)',
      stroke: t.active ? UI.amber : hot ? UI.steel : UI.steelDim,
      rivets: false,
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 19px system-ui, sans-serif';
    ctx.fillStyle = t.active ? UI.amber : UI.textDim;
    ctx.fillText(t.label, x + w / 2, TAB_Y + TAB_H / 2);
  });
}

function tabHit(x: number, y: number, count: number): number | null {
  if (y < TAB_Y || y > TAB_Y + TAB_H) return null;
  const gap = 10;
  const w = (PAN_W - 80 - (count - 1) * gap) / count;
  for (let i = 0; i < count; i++) {
    const tx = 40 + i * (w + gap);
    if (x >= tx && x <= tx + w) return i;
  }
  return null;
}

/** A hue track + knob; `accent` true uses the neon ramp, else a plain spectrum.
 *  `hue` < 0 (armour default) draws no knob. */
function drawHueBar(ctx: CanvasRenderingContext2D, bar: PanRect, hue: number, accent: boolean): void {
  const grad = ctx.createLinearGradient(bar.x, 0, bar.x + bar.w, 0);
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    grad.addColorStop(f, accent ? hexCss(hueToColor(f)) : `hsl(${f * 360}, 85%, 55%)`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = UI.steel;
  ctx.strokeRect(bar.x, bar.y, bar.w, bar.h);
  if (hue >= 0) {
    const kx = bar.x + Math.min(1, Math.max(0, hue)) * bar.w;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(kx - 3, bar.y - 6, 6, bar.h + 12);
    ctx.strokeRect(kx - 3, bar.y - 6, 6, bar.h + 12);
  }
}

/** A dark→light track for a fixed hue + a knob at the chosen lightness.
 *  `accent` uses the neon ramp; armour uses a suit-tone ramp (grey if no hue). */
function drawLightBar(ctx: CanvasRenderingContext2D, bar: PanRect, light: number, hue: number, accent: boolean): void {
  const grad = ctx.createLinearGradient(bar.x, 0, bar.x + bar.w, 0);
  const h360 = (((hue % 1) + 1) % 1) * 360;
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    let col: string;
    if (accent) {
      col = hexCss(hueToColor(hue, f));
    } else if (hue < 0) {
      col = `hsl(0, 0%, ${Math.round((0.06 + f * 0.84) * 100)}%)`; // no hue yet → greyscale
    } else {
      col = `hsl(${h360}, 55%, ${Math.round(Math.max(5, Math.min(92, (0.18 + f * 0.66) * 100)))}%)`;
    }
    grad.addColorStop(f, col);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = UI.steel;
  ctx.strokeRect(bar.x, bar.y, bar.w, bar.h);
  const kx = bar.x + Math.min(1, Math.max(0, light)) * bar.w;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(kx - 3, bar.y - 6, 6, bar.h + 12);
  ctx.strokeRect(kx - 3, bar.y - 6, 6, bar.h + 12);
}

function drawResetBtn(ctx: CanvasRenderingContext2D, r: PanRect, atDefault: boolean, hot: boolean): void {
  plate(ctx, r.x, r.y, r.w, r.h, {
    cut: 8,
    fill: hot ? 'rgba(255,176,0,0.16)' : 'rgba(10,11,15,0.7)',
    stroke: atDefault || hot ? UI.amber : UI.steelDim,
    rivets: false,
  });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.fillStyle = atDefault ? UI.amber : UI.textDim;
  ctx.fillText('DEFAULT', r.x + r.w / 2, r.y + r.h / 2 + 1);
}

/** The locker's COLOUR tab: armour-suit + neon-accent, each a hue track over a
 *  lightness/darkness track. */
function drawColourTab(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const label = (text: string, y: number): void => {
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillStyle = UI.textDim;
    ctx.textAlign = 'left'; // reset — drawResetBtn leaves textAlign 'center'
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, 40, y);
  };

  label('ARMOUR COLOUR', ARMOUR_BAR.y - 14);
  drawHueBar(ctx, ARMOUR_BAR, customization.colorHue, false);
  drawResetBtn(ctx, ARMOUR_DEF, customization.colorHue < 0, hoverAction === 'av-uncolor');
  label('LIGHTNESS', ARMOUR_LIGHT_BAR.y - 14);
  drawLightBar(ctx, ARMOUR_LIGHT_BAR, customization.colorLight, customization.colorHue, false);

  label('NEON ACCENT', ACCENT_BAR.y - 14);
  drawHueBar(ctx, ACCENT_BAR, app.accentHue, true);
  drawResetBtn(ctx, ACCENT_DEF, Math.abs(app.accentHue - DEFAULT_ACCENT_HUE) < 0.005, hoverAction === 'accent-default');
  label('LIGHTNESS', ACCENT_LIGHT_BAR.y - 14);
  drawLightBar(ctx, ACCENT_LIGHT_BAR, app.accentLight, app.accentHue, true);
}

function drawGrid(ctx: CanvasRenderingContext2D, locker: boolean, hoverAction: MenuAction | null): void {
  const { items, soon } = panelItems(locker);
  for (const it of items) drawTile(ctx, it, hoverAction);
  if (soon) drawSoonTile(ctx, soon);
}

function gridHit(x: number, y: number, locker: boolean): MenuAction | null {
  for (const it of panelItems(locker).items) {
    if (inPanRect(x, y, it.rect)) return it.action;
  }
  return null;
}

/** SHOP — everything, with prices. Tabs: AVATARS / PLATFORMS. */
function drawShop(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.amber, 'SHOP', PAN_W, PAN_H);
  drawCoinSymbol(ctx, PAN_W - 150, 22, 32, 32);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.fillStyle = UI.amber;
  ctx.fillText(String(coins.balance), PAN_W - 110, 39);

  const tab = activeTab(false);
  drawTabs(ctx, [
    { label: 'AVATARS', action: 'tab-avatars', active: tab === 'avatars' },
    { label: 'PLATFORMS', action: 'tab-platforms', active: tab === 'platforms' },
  ], hoverAction);
  drawGrid(ctx, false, hoverAction);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  buttonPlate(ctx, FOOT_SWAP.x, FOOT_SWAP.y, FOOT_SWAP.w, FOOT_SWAP.h, 'LOCKER', UI.cool, hoverAction === 'open-locker');
  buttonPlate(ctx, FOOT_CLOSE.x, FOOT_CLOSE.y, FOOT_CLOSE.w, FOOT_CLOSE.h, 'CLOSE', UI.amber, hoverAction === 'custom-close');
}

function hitShop(u: number, v: number): MenuAction | null {
  const x = u * PAN_W;
  const y = (1 - v) * PAN_H;
  if (inPanRect(x, y, FOOT_SWAP)) return 'open-locker';
  if (inPanRect(x, y, FOOT_CLOSE)) return 'custom-close';
  const t = tabHit(x, y, 2);
  if (t !== null) return t === 0 ? 'tab-avatars' : 'tab-platforms';
  return gridHit(x, y, false);
}

/** LOCKER — your inventory: equip owned skins, plus the COLOUR sliders. */
function drawLocker(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.emberBright, 'LOCKER', PAN_W, PAN_H);
  const tab = activeTab(true);
  drawTabs(ctx, [
    { label: 'AVATARS', action: 'tab-avatars', active: tab === 'avatars' },
    { label: 'PLATFORMS', action: 'tab-platforms', active: tab === 'platforms' },
    { label: 'COLOUR', action: 'tab-colour', active: tab === 'colour' },
  ], hoverAction);
  if (tab === 'colour') drawColourTab(ctx, hoverAction);
  else drawGrid(ctx, true, hoverAction);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  buttonPlate(ctx, FOOT_SWAP.x, FOOT_SWAP.y, FOOT_SWAP.w, FOOT_SWAP.h, 'SHOP', UI.amber, hoverAction === 'open-shop');
  buttonPlate(ctx, FOOT_CLOSE.x, FOOT_CLOSE.y, FOOT_CLOSE.w, FOOT_CLOSE.h, 'CLOSE', UI.amber, hoverAction === 'custom-close');
}

function hitLocker(u: number, v: number): MenuAction | null {
  const x = u * PAN_W;
  const y = (1 - v) * PAN_H;
  if (inPanRect(x, y, FOOT_SWAP)) return 'open-shop';
  if (inPanRect(x, y, FOOT_CLOSE)) return 'custom-close';
  const t = tabHit(x, y, 3);
  if (t !== null) return t === 0 ? 'tab-avatars' : t === 1 ? 'tab-platforms' : 'tab-colour';
  if (activeTab(true) === 'colour') {
    if (inPanRect(x, y, ARMOUR_DEF)) return 'av-uncolor';
    if (inPanRect(x, y, ACCENT_DEF)) return 'accent-default';
    if (inPanRect(x, y, ARMOUR_BAR)) return 'av-color';
    if (inPanRect(x, y, ARMOUR_LIGHT_BAR)) return 'av-light';
    if (inPanRect(x, y, ACCENT_BAR)) return 'accent-color';
    if (inPanRect(x, y, ACCENT_LIGHT_BAR)) return 'accent-light';
    return null;
  }
  return gridHit(x, y, true);
}

export function createMenu(scene: Scene): Menu {
  const group = new Group();
  group.name = 'lobby-menu';

  const train = makePanel('train', 0.86, 0.86 * (TRAIN_H / PW), drawTrain, hitTrain, { ch: TRAIN_H });
  const duel = makePanel('duel', 0.78, 0.62, drawDuel, hitDuel);
  const info = makePanel('info', 0.78, 0.62, drawInfo, hitInfo);
  // Taller than the lobby panels (1.36 × 1.456 ≈ BW:BH) so the full top 10
  // reads at a glance; its own BW×BH canvas keeps the text at lobby density.
  const board = makePanel('board', 1.36, 1.456, drawBoard, hitBoard, { cw: BW, ch: BH });
  // The LOCKER (your inventory + colour sliders) reuses the 'custom' id/slot.
  const custom = makePanel('custom', 0.9, 0.9 * (PAN_H / PAN_W), drawLocker, hitLocker, { cw: PAN_W, ch: PAN_H });
  const balls = makePanel('balls', 0.84, 0.72, drawBalls, () => null, {
    cw: BALL_W,
    ch: BALL_H,
    click: clickBalls,
  });
  // The little round paper button (above the right panel) + the front page it
  // opens. The page is portrait (NW:NH), sized to keep newsprint readable.
  const gazetteBtn = makePanel('gazette', 0.16, 0.16, drawGazetteButton, hitGazetteButton, {
    cw: GZ,
    ch: GZ,
  });
  // The music mute button, a twin disc just LEFT of the paper button.
  const muteBtn = makePanel('mute', 0.16, 0.16, drawMuteButton, hitMuteButton, {
    cw: GZ,
    ch: GZ,
  });
  const news = makePanel('news', 0.86, 0.86 * (NH / NW), drawNews, hitNews, { cw: NW, ch: NH });
  // The coin readout beside the paper button, and the platform shop it links to.
  const coinHud = makePanel('coins', 0.24, 0.24 * (COIN_HUD_H / COIN_HUD_W), (ctx) => drawCoinHud(ctx), () => null, {
    cw: COIN_HUD_W,
    ch: COIN_HUD_H,
  });
  const shop = makePanel('shop', 0.9, 0.9 * (PAN_H / PAN_W), drawShop, hitShop, { cw: PAN_W, ch: PAN_H });

  // Shallow arc in front of the player, tilted inward toward the centre.
  const y = 1.45;
  // Grow the taller ARCADE panel DOWNWARD: drop its centre by half the extra
  // height so its top stays level with the 1V1 panel.
  train.mesh.position.set(0, y - 0.86 * ((TRAIN_H - PH) / PW) / 2, -1.25);
  duel.mesh.position.set(-0.84, y - 0.02, -1.02);
  duel.mesh.rotation.y = 0.48;
  info.mesh.position.set(0.84, y - 0.02, -1.02);
  info.mesh.rotation.y = -0.48;
  // The leaderboard hangs behind you — turn around between fights.
  board.mesh.position.set(0, 1.6, 1.5);
  board.mesh.rotation.y = Math.PI;
  // Customisation: hidden until opened; sits right of centre so the avatar
  // mirror has room to stand beside it (MenuSystem owns the mirror).
  // Shorter plate now (CLOSE moved off it): nudge up so its TOP edge — where
  // the chips sit — stays put while the cropped bottom rises.
  custom.mesh.position.set(0.5, 1.53, -1.1);
  custom.mesh.rotation.y = -0.3;
  custom.mesh.visible = false;
  // BALL LOADOUT lives out on the RIGHT, wrapped toward you alongside the other
  // controls — the whole LEFT is left clear for the avatar mirror, so while
  // changing your skin you can still see it (it used to sit in front of it).
  // Nudged further right + forward so the CUSTOMISE plate's edge no longer
  // clips it.
  balls.mesh.position.set(1.32, 1.18, -0.66);
  balls.mesh.rotation.y = -0.6;
  balls.mesh.visible = false;
  // The paper button sits just above the right (info) panel, sharing its tilt.
  gazetteBtn.mesh.position.set(0.92, 1.86, -1.05);
  gazetteBtn.mesh.rotation.y = -0.48;
  // The mute button mirrors the coin readout to the LEFT of the paper button,
  // along the same inward-tilted arc (left → a touch further away).
  muteBtn.mesh.position.set(0.66, 1.86, -1.16);
  muteBtn.mesh.rotation.y = -0.48;
  // The coin readout sits just to the RIGHT of the paper button, same height +
  // tilt — symbol and balance together, as asked.
  coinHud.mesh.position.set(1.18, 1.86, -0.94);
  coinHud.mesh.rotation.y = -0.48;
  // The platform shop opens where the customise plate sits (it replaces it).
  shop.mesh.position.set(0.5, 1.5, -1.1);
  shop.mesh.rotation.y = -0.3;
  shop.mesh.visible = false;
  // The front page opens dead centre, facing you — modal over the lobby arc.
  news.mesh.position.set(0, 1.5, -1.16);
  news.mesh.visible = false;

  const panels = [train, duel, info, board, custom, balls, gazetteBtn, muteBtn, coinHud, shop, news];
  for (const p of panels) {
    p.redraw(null);
    group.add(p.mesh);
  }
  scene.add(group);

  return {
    group,
    panels,
    setVisible: (v) => {
      group.visible = v;
    },
    redrawAll: (hoverId, hoverAction) => {
      // Skip panels that aren't on screen — re-rendering a hidden canvas and
      // re-uploading its texture (the news page is 720×900) is pure waste. They
      // get a redraw the moment they're shown (applyState calls this again).
      for (const p of panels) {
        if (!p.mesh.visible) continue;
        p.redraw(p.id === hoverId ? hoverAction : null);
      }
    },
  };
}
