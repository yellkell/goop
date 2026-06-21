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
import { customization } from './customization.js';
import { rankBadge } from './rankBadges.js';
import { tierForXp } from './progression.js';
import { AVATAR_SKINS, PLATFORM_SKINS } from '../avatar/skins.js';
import { ATTACH, GAME_TITLE, hueToColor } from '../config.js';
import {
  LEADERBOARD_VISIBLE_ROWS,
  boardScroll,
  leaderboard,
  leaderboardRows,
  myProfileRow,
  type LeaderboardTab,
} from '../net/leaderboard.js';
import { PUB_MAX_PLAYERS } from '../pub/protocol.js';
import { PUB_REGIONS } from '../pub/config.js';
import { UI, buttonPlate, hazardStrip, plate, segmentBar, stencilFont } from '../ui/industrial.js';

export type PanelId = 'train' | 'duel' | 'info' | 'board' | 'custom' | 'loadout' | 'balls';

export type MenuAction =
  | 'start-training'
  | 'toggle-shootback'
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
  | 'lb-ranked'
  | 'lb-xp'
  | 'lb-training'
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
  | 'av-0' | 'av-1' | 'av-2' | 'av-3'
  /** Dragging the armour-colour hue bar (continuous — MenuSystem reads the UV). */
  | 'av-color'
  /** Reset the armour colour to the skin's default palette. */
  | 'av-uncolor'
  /** Reset the avatar-accent (neon) hue to the house ember default. */
  | 'accent-default'
  | 'pf-0' | 'pf-1' | 'pf-2';

const PW = 512;
const PH = 400;
// The leaderboard plate is taller than the lobby panels so the whole top 10
// fits at once — its own canvas (same width, more height) and a physical size
// scaled to match, so the text keeps the lobby's pixel density (no stretch).
const BW = 512;
const BH = 548;
const PROFILE_KEYBOARD_HINT_MS = 4500;
// The customisation plate: room for the avatar/platform chips AND the armour-
// colour picker beneath them. (The CLOSE button now lives on the AVATAR ACCENT
// panel, so this plate ends just under the colour picker.)
const CW = 512;
const CH = 430;
/** The hue-picker bar on the customisation panel (canvas coords). */
const COLOR_BAR = { x: 40, y: 322, w: CW - 80, h: 44 };

/** Map a customisation-panel hit u (0..1) to a hue (0..1), clamped to the bar. */
export function colorBarHue(u: number): number {
  return Math.max(0, Math.min(1, (u * CW - COLOR_BAR.x) / COLOR_BAR.w));
}

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

/** Centre — AIM TRAINING: the big start plate + the shoot-back toggle. */
function drawTrain(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.emberBright, 'AIM TRAINING');

  buttonPlate(ctx, 70, 120, PW - 140, 110, 'START', UI.ember, hoverAction === 'start-training');

  // Shoot-back toggle row: an industrial breaker switch.
  const on = app.shootBack;
  const toggleHot = hoverAction === 'toggle-shootback';
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = toggleHot ? UI.emberBright : UI.textDim;
  ctx.fillText('targets shoot back', 64, 300);
  const pw = 120, ph = 56, px = PW - 64 - pw, py = 272;
  plate(ctx, px, py, pw, ph, {
    cut: 10,
    fill: on ? 'rgba(79,183,255,0.25)' : toggleHot ? 'rgba(255,176,0,0.16)' : 'rgba(150,150,170,0.12)',
    stroke: toggleHot ? UI.emberBright : on ? UI.cool : UI.steelDim,
    rivets: false,
  });
  ctx.fillStyle = on ? UI.cool : UI.steelDim;
  const kw = pw / 2 - 12;
  ctx.fillRect(on ? px + pw - kw - 8 : px + 8, py + 8, kw, ph - 16);

  ctx.textAlign = 'center';
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  ctx.fillText(`best score  ${app.stats.trainingBest}`, PW / 2, 360);
}

function hitTrain(_u: number, v: number): MenuAction | null {
  // v: 0 bottom → 1 top (canvas y = (1-v)*PH).
  const y = (1 - v) * PH;
  if (y >= 110 && y <= 245) return 'start-training';
  if (y >= 262 && y <= 340) return 'toggle-shootback';
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

  // RANKED — waits in the lobby for a real human (no bot).
  buttonPlate(
    ctx, 70, 84, PW - 140, 66,
    queueing ? 'CANCEL' : 'RANKED',
    queueing ? UI.amber : UI.cool,
    hoverAction === rankedAction,
  );

  // Live "N searching" badge on the RANKED plate — the queue you'd join.
  if (!queueing && app.searching > 0) {
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

  // Desert-arena breaker switch.
  const on = app.environment === 'desert';
  const environmentHot = hoverAction === 'toggle-environment';
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = environmentHot ? UI.amber : UI.textDim;
  ctx.fillText('desert arena', 64, 320);
  const sw = 110, sh = 44, sx = PW - 64 - sw, sy = 298;
  plate(ctx, sx, sy, sw, sh, {
    cut: 10,
    fill: on ? 'rgba(255,176,0,0.22)' : environmentHot ? 'rgba(255,176,0,0.16)' : 'rgba(150,150,170,0.12)',
    stroke: environmentHot || on ? UI.amber : UI.steelDim,
    rivets: false,
  });
  ctx.fillStyle = on ? UI.amber : UI.steelDim;
  const kw = sw / 2 - 12;
  ctx.fillRect(on ? sx + sw - kw - 8 : sx + 8, sy + 8, kw, sh - 16);

  if (queueing) {
    ctx.textAlign = 'center';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(159,226,255,0.85)';
    ctx.fillText('searching for an opponent…', PW / 2, 372);
  }
}

function hitDuelRoot(v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 80 && y <= 152) return app.state === 'queueing' ? 'cancel-queue' : 'ranked-match';
  if (y >= 154 && y <= 224) return 'quick-match';
  if (y >= 226 && y <= 288) return 'private-open';
  if (y >= 292 && y <= 344) return 'toggle-environment';
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

/**
 * The customisation panel — replaces the lobby arc while open, with the
 * avatar mirror standing beside it. One chip row per slot: three live
 * skins + a greyed-out COMING SOON.
 */
function drawCustom(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.emberBright, 'CUSTOMISE', CW, CH);

  const chipRow = (
    label: string,
    skins: Array<{ name: string; locked?: boolean; accent?: number; neon?: number }>,
    selectedIdx: number,
    y: number,
    actionPrefix: 'av' | 'pf',
  ): void => {
    ctx.textAlign = 'left';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillStyle = UI.textDim;
    ctx.fillText(label, 40, y);
    const w = (CW - 80 - 3 * 10) / 4;
    skins.forEach((s, i) => {
      const x = 40 + i * (w + 10);
      const cy = y + 16;
      const hex = s.locked ? undefined : ((s.accent ?? s.neon ?? 0xffffff) as number);
      const css = hex !== undefined ? `#${hex.toString(16).padStart(6, '0')}` : UI.steelDim;
      const selected = i === selectedIdx;
      const action = `${actionPrefix}-${i}` as MenuAction;
      const hot = !s.locked && hoverAction === action;
      plate(ctx, x, cy, w, 54, {
        cut: 8,
        fill: s.locked
          ? 'rgba(60,62,70,0.25)'
          : selected
            ? 'rgba(20,22,30,0.92)'
            : hot
              ? 'rgba(20,22,30,0.9)'
              : 'rgba(10,11,15,0.7)',
        stroke: s.locked ? UI.steelDim : selected || hot ? css : UI.steel,
        rivets: false,
      });
      ctx.textAlign = 'center';
      ctx.font = `700 ${s.name.length > 7 ? 18 : 21}px system-ui, sans-serif`;
      ctx.fillStyle = s.locked ? UI.steelDim : selected || hot ? css : UI.text;
      ctx.fillText(s.name, x + w / 2, cy + 23);
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = s.locked ? UI.steelDim : 'rgba(232,236,242,0.45)';
      ctx.fillText(s.locked ? 'COMING SOON' : selected ? 'EQUIPPED' : 'select', x + w / 2, cy + 43);
    });
    ctx.textAlign = 'center';
  };

  chipRow('AVATAR', AVATAR_SKINS, AVATAR_SKINS.findIndex((s) => s.id === customization.avatar), 102, 'av');
  chipRow('PLATFORM', PLATFORM_SKINS, PLATFORM_SKINS.findIndex((s) => s.id === customization.platform), 204, 'pf');

  // --- ARMOUR COLOUR picker: a hue bar repainting the whole suit -------------
  const hue = customization.colorHue;
  ctx.textAlign = 'left';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('ARMOUR COLOUR', 40, 304);
  // Live swatch of the current colour beside the label.
  ctx.fillStyle = hue >= 0 ? `hsl(${hue * 360}, 85%, 56%)` : UI.steelDim;
  ctx.fillRect(228, 289, 26, 18);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = UI.steel;
  ctx.strokeRect(228, 289, 26, 18);
  // DEFAULT — revert to the skin's own palette.
  const resetHot = hoverAction === 'av-uncolor';
  plate(ctx, CW - 132, 286, 92, 30, {
    cut: 8,
    fill: resetHot ? 'rgba(255,176,0,0.16)' : 'rgba(10,11,15,0.7)',
    stroke: hue < 0 || resetHot ? UI.amber : UI.steelDim,
    rivets: false,
  });
  ctx.textAlign = 'center';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillStyle = hue < 0 ? UI.amber : UI.textDim;
  ctx.fillText('DEFAULT', CW - 86, 305);
  // The hue spectrum bar + a cursor at the picked hue.
  const grad = ctx.createLinearGradient(COLOR_BAR.x, 0, COLOR_BAR.x + COLOR_BAR.w, 0);
  for (let s = 0; s <= 12; s++) grad.addColorStop(s / 12, `hsl(${(s / 12) * 360}, 85%, 55%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(COLOR_BAR.x, COLOR_BAR.y, COLOR_BAR.w, COLOR_BAR.h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = UI.steel;
  ctx.strokeRect(COLOR_BAR.x, COLOR_BAR.y, COLOR_BAR.w, COLOR_BAR.h);
  if (hue >= 0) {
    const cx = COLOR_BAR.x + hue * COLOR_BAR.w;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 2.5, COLOR_BAR.y - 5, 5, COLOR_BAR.h + 10);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeRect(cx - 2.5, COLOR_BAR.y - 5, 5, COLOR_BAR.h + 10);
  }

  // CLOSE now lives on the AVATAR ACCENT panel, beneath the accent slider.
  ctx.textAlign = 'center';
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('looks only — your hitbox never changes', CW / 2, 400);
}

function hitCustom(u: number, v: number): MenuAction | null {
  const x = u * CW;
  const y = (1 - v) * CH;
  const w = (CW - 80 - 3 * 10) / 4;
  const chipIdx = (px: number): number => Math.floor((px - 40) / (w + 10));
  if (y >= 112 && y <= 178 && x >= 40 && x <= CW - 40) {
    const i = chipIdx(x);
    if (i >= 0 && i <= 3 && !AVATAR_SKINS[i].locked) return `av-${i}` as MenuAction;
    return null;
  }
  if (y >= 214 && y <= 280 && x >= 40 && x <= CW - 40) {
    const i = chipIdx(x);
    if (i >= 0 && i <= 3 && !PLATFORM_SKINS[i].locked) return `pf-${i}` as MenuAction;
    return null;
  }
  if (y >= 282 && y <= 320 && x >= CW - 136 && x <= CW - 36) return 'av-uncolor';
  if (
    y >= COLOR_BAR.y - 6 && y <= COLOR_BAR.y + COLOR_BAR.h + 6 &&
    x >= COLOR_BAR.x - 6 && x <= COLOR_BAR.x + COLOR_BAR.w + 6
  ) {
    return 'av-color';
  }
  return null;
}

// Leaderboard row band: the full top 10 laid out at once, then the footer.
const BOARD_ROW_Y0 = 164;
const BOARD_ROW_STEP = 30;

const BOARD_TABS: Array<[LeaderboardTab, string, MenuAction]> = [
  ['ranked', 'RANKED', 'lb-ranked'],
  ['xp', 'XP', 'lb-xp'],
  ['training', 'AIM', 'lb-training'],
  ['profile', 'PROFILE', 'lb-profile'],
];
const BOARD_TAB_W = (BW - 96 - 48) / 4;

/** Behind — the Firebase leaderboard: RANKED / XP / AIM boards + PROFILE face. */
function drawBoard(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.amber, 'LEADERBOARD', BW, BH);
  let x = 48;
  for (const [id, label, action] of BOARD_TABS) {
    const active = leaderboard.tab === id;
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
  if (leaderboard.tab === 'profile') drawProfile(ctx, hoverAction);
  else drawBoardRows(ctx, hoverAction);
}

function drawBoardRows(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  const rows = leaderboardRows();
  const offset = boardScroll();
  rows.slice(offset, offset + LEADERBOARD_VISIBLE_ROWS).forEach((r, i) => {
    const y = BOARD_ROW_Y0 + i * BOARD_ROW_STEP;
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
    ctx.fillText(leaderboard.status || 'no entries yet', BW / 2, BOARD_ROW_Y0 + 4 * BOARD_ROW_STEP);
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
    return BOARD_TABS[i][2];
  }
  if (leaderboard.tab === 'profile') {
    if (y >= 482 && y <= 536) {
      const own = !leaderboard.viewRow || leaderboard.viewRow.me;
      return own ? (x < BW / 2 ? 'rename' : 'edit-note') : 'profile-back';
    }
    return null;
  }
  if (y >= BOARD_ROW_Y0 - 15 && y <= BOARD_ROW_Y0 + LEADERBOARD_VISIBLE_ROWS * BOARD_ROW_STEP) {
    const n = Math.floor((y - (BOARD_ROW_Y0 - 15)) / BOARD_ROW_STEP);
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

// --- AVATAR ACCENT: a hue slider for all your neon highlights ---------------
// Its own canvas; tall enough to carry the slider up top and the customisation
// CLOSE button beneath it (moved here off the CUSTOMISE plate).
const LW = 512;
const LH = 312;
const SL_X = 44; // slider track left
const SL_W = 296; // slider track width
const SL_Y = 120; // slider track top (canvas y, down)
const SL_H = 34; // slider track height
const SW_X = SL_X + SL_W + 12; // colour swatch left
const SW_Y = SL_Y - 6;
const SW = 46; // swatch size
// DEFAULT button — to the right of the swatch, mirroring the ARMOUR COLOUR
// picker's reset. Sits clear of the slider track's x-range so a tap on it
// falls through the drag handler (see dragLoadout) to a clean click.
const ACC_DEF = { x: SW_X + SW + 12, y: SL_Y - 6, w: LW - (SW_X + SW + 12) - 16, h: 46 };
// CLOSE the whole customisation modal — sits beneath the accent slider (moved
// off the CUSTOMISE plate). Well below the slider's drag band, so a tap on it
// falls through dragLoadout to a clean click.
const ACC_CLOSE = { x: (LW - 220) / 2, y: 232, w: 220, h: 60 };

function hexCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** AVATAR ACCENT: drag a hue bar to tint every neon highlight you wear. */
function drawLoadout(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  const hover = hoverAction !== null;
  const col = hueToColor(app.accentHue);
  const css = hexCss(col);
  panelBg(ctx, hover, css, 'AVATAR ACCENT', LW, LH);

  // Slider housing.
  plate(ctx, SL_X - 10, SL_Y - 12, SL_W + 20, SL_H + 24, {
    cut: 8,
    fill: 'rgba(10,11,14,0.55)',
    stroke: hover ? css : UI.steel,
    rivets: false,
  });

  // Hue gradient track.
  const grad = ctx.createLinearGradient(SL_X, 0, SL_X + SL_W, 0);
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    grad.addColorStop(f, hexCss(hueToColor(f)));
  }
  ctx.fillStyle = grad;
  ctx.fillRect(SL_X, SL_Y, SL_W, SL_H);

  // Knob.
  const kx = SL_X + Math.min(1, Math.max(0, app.accentHue)) * SL_W;
  ctx.fillStyle = '#f4f6fb';
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 3;
  ctx.fillRect(kx - 5, SL_Y - 9, 10, SL_H + 18);
  ctx.strokeRect(kx - 5, SL_Y - 9, 10, SL_H + 18);

  // Live colour swatch.
  plate(ctx, SW_X, SW_Y, SW, SW, { cut: 8, fill: css, stroke: UI.steel, rivets: false });

  // DEFAULT — revert the accent to the house ember (DEFAULT_ACCENT_HUE).
  const atDefault = Math.abs(app.accentHue - DEFAULT_ACCENT_HUE) < 0.005;
  const resetHot = hoverAction === 'accent-default';
  plate(ctx, ACC_DEF.x, ACC_DEF.y, ACC_DEF.w, ACC_DEF.h, {
    cut: 8,
    fill: resetHot ? 'rgba(255,176,0,0.16)' : 'rgba(10,11,15,0.7)',
    stroke: atDefault || resetHot ? UI.amber : UI.steelDim,
    rivets: false,
  });
  ctx.textAlign = 'center';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillStyle = atDefault ? UI.amber : UI.textDim;
  ctx.fillText('DEFAULT', ACC_DEF.x + ACC_DEF.w / 2, ACC_DEF.y + ACC_DEF.h / 2 + 1);

  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.textAlign = 'center';
  ctx.fillText("drag to tint your avatar's neon", LW / 2, 196);

  // CLOSE the customisation modal — moved here, directly beneath the slider.
  buttonPlate(ctx, ACC_CLOSE.x, ACC_CLOSE.y, ACC_CLOSE.w, ACC_CLOSE.h, 'CLOSE', UI.amber, hoverAction === 'custom-close');
}

/** While the trigger is held over the TRACK (not the swatch/DEFAULT button to
 *  its right), set the hue from the hit X. Returning false off the track lets
 *  a tap fall through to the DEFAULT button's click. */
function dragLoadout(u: number, v: number): boolean {
  const y = (1 - v) * LH;
  const x = u * LW;
  if (y < SL_Y - 30 || y > SL_Y + SL_H + 30) return false;
  if (x < SL_X - 14 || x > SL_X + SL_W + 12) return false;
  app.accentHue = Math.min(1, Math.max(0, (x - SL_X) / SL_W));
  return true;
}

/** Hover/hit test for the AVATAR ACCENT panel: only the DEFAULT button. */
function hitLoadout(u: number, v: number): MenuAction | null {
  const x = u * LW;
  const y = (1 - v) * LH;
  if (x >= ACC_DEF.x && x <= ACC_DEF.x + ACC_DEF.w && y >= ACC_DEF.y && y <= ACC_DEF.y + ACC_DEF.h) {
    return 'accent-default';
  }
  if (x >= ACC_CLOSE.x && x <= ACC_CLOSE.x + ACC_CLOSE.w && y >= ACC_CLOSE.y && y <= ACC_CLOSE.y + ACC_CLOSE.h) {
    return 'custom-close';
  }
  return null;
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

export function createMenu(scene: Scene): Menu {
  const group = new Group();
  group.name = 'lobby-menu';

  const train = makePanel('train', 0.86, 0.68, drawTrain, hitTrain);
  const duel = makePanel('duel', 0.78, 0.62, drawDuel, hitDuel);
  const info = makePanel('info', 0.78, 0.62, drawInfo, hitInfo);
  // Taller than the lobby panels (1.36 × 1.456 ≈ BW:BH) so the full top 10
  // reads at a glance; its own BW×BH canvas keeps the text at lobby density.
  const board = makePanel('board', 1.36, 1.456, drawBoard, hitBoard, { cw: BW, ch: BH });
  // Taller than the lobby panels (own CW×CH canvas) for the colour picker row.
  const custom = makePanel('custom', 0.9, 0.756, drawCustom, hitCustom, { cw: CW, ch: CH });
  const loadout = makePanel('loadout', 0.78, 0.475, drawLoadout, hitLoadout, {
    cw: LW,
    ch: LH,
    drag: dragLoadout,
  });
  const balls = makePanel('balls', 0.84, 0.72, drawBalls, () => null, {
    cw: BALL_W,
    ch: BALL_H,
    click: clickBalls,
  });

  // Shallow arc in front of the player, tilted inward toward the centre.
  const y = 1.45;
  train.mesh.position.set(0, y, -1.25);
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
  // Raised a touch (was 0.78) so the slider and the CLOSE button beneath it sit
  // higher — there's room under the trimmed CUSTOMISE plate above.
  loadout.mesh.position.set(0.54, 0.86, -1.08);
  loadout.mesh.rotation.y = -0.3;
  loadout.mesh.visible = false;

  const panels = [train, duel, info, board, custom, balls, loadout];
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
      for (const p of panels) p.redraw(p.id === hoverId ? hoverAction : null);
    },
  };
}
