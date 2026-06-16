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
import { app } from './appState.js';
import { customization } from './customization.js';
import { AVATAR_SKINS, PLATFORM_SKINS } from '../avatar/skins.js';
import { GAME_TITLE } from '../config.js';
import { LEADERBOARD_VISIBLE_ROWS, leaderboard, leaderboardRows, myStats } from '../net/leaderboard.js';
import { PUB_MAX_PLAYERS } from '../pub/protocol.js';
import { UI, buttonPlate, hazardStrip, plate, stencilFont } from '../ui/industrial.js';

export type PanelId = 'train' | 'duel' | 'info' | 'board' | 'custom';

export type MenuAction =
  | 'start-training'
  | 'toggle-shootback'
  | 'quick-match'
  | 'cancel-queue'
  | 'vs-bot'
  | 'toggle-environment'
  | 'lb-duel'
  | 'lb-training'
  | 'rename'
  | 'open-pub'
  | 'open-custom'
  | 'custom-close'
  | 'av-0' | 'av-1' | 'av-2'
  | 'pf-0' | 'pf-1' | 'pf-2';

const PW = 512;
const PH = 400;
// The leaderboard plate is taller than the lobby panels so the whole top 10
// fits at once — its own canvas (same width, more height) and a physical size
// scaled to match, so the text keeps the lobby's pixel density (no stretch).
const BW = 512;
const BH = 548;

export interface MenuPanel {
  id: PanelId;
  mesh: Mesh;
  redraw: (hoverAction: MenuAction | null) => void;
  /** Map a hit UV (u right, v up) to an action, or null. */
  hitTest: (u: number, v: number) => MenuAction | null;
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

function makePanel(
  id: PanelId,
  wMeters: number,
  hMeters: number,
  draw: (ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null) => void,
  hitTest: MenuPanel['hitTest'],
  cw = PW,
  ch = PH,
): MenuPanel {
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
  return { id, mesh, redraw, hitTest };
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

/** Left — 1V1: quick match (or cancel) + vs bot. */
function drawDuel(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.cool, '1 V 1');

  const queueing = app.state === 'queueing';
  const queueAction = queueing ? 'cancel-queue' : 'quick-match';
  buttonPlate(
    ctx, 70, 108, PW - 140, 84,
    queueing ? 'CANCEL' : 'QUICK MATCH',
    queueing ? UI.amber : UI.cool,
    hoverAction === queueAction,
  );

  // Live "N searching" badge riding the top-right of the QUICK MATCH plate, so
  // you can see the queue filling before you commit. Hidden while you're the
  // one queueing (the status line speaks for you) and when the count's unknown.
  if (!queueing && app.searching > 0) {
    const label = `${app.searching} SEARCHING`;
    ctx.font = '800 18px system-ui, sans-serif';
    const pillW = ctx.measureText(label).width + 38;
    const pillH = 28;
    const px = PW - 70 - pillW;
    const py = 96;
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

  buttonPlate(ctx, 70, 200, PW - 140, 84, 'VS BOT', UI.ember, hoverAction === 'vs-bot');

  // Desert-arena breaker switch, right under VS BOT: flips the whole arena
  // between the papercraft desert and bare AR passthrough, held across modes.
  const on = app.environment === 'desert';
  const environmentHot = hoverAction === 'toggle-environment';
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = environmentHot ? UI.amber : UI.textDim;
  ctx.fillText('desert arena', 64, 322);
  const sw = 120, sh = 48, sx = PW - 64 - sw, sy = 298;
  plate(ctx, sx, sy, sw, sh, {
    cut: 10,
    fill: on ? 'rgba(255,176,0,0.22)' : environmentHot ? 'rgba(255,176,0,0.16)' : 'rgba(150,150,170,0.12)',
    stroke: environmentHot || on ? UI.amber : UI.steelDim,
    rivets: false,
  });
  ctx.fillStyle = on ? UI.amber : UI.steelDim;
  const kw = sw / 2 - 12;
  ctx.fillRect(on ? sx + sw - kw - 8 : sx + 8, sy + 8, kw, sh - 16);

  ctx.textAlign = 'center';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(159,226,255,0.85)';
  const status = queueing
    ? 'searching for an opponent…'
    : app.searching > 0
      ? `${app.searching} ${app.searching === 1 ? 'boxer' : 'boxers'} in the queue now`
      : app.searching === 0
        ? 'no one queued yet — be the first'
        : app.netStatus;
  ctx.fillText(status, PW / 2, 378);
}

function hitDuel(_u: number, v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 100 && y <= 194) return app.state === 'queueing' ? 'cancel-queue' : 'quick-match';
  if (y >= 196 && y <= 288) return 'vs-bot';
  if (y >= 292 && y <= 354) return 'toggle-environment';
  return null;
}

/** Right — doors out of the lobby: the PUB social area + customisation. */
function drawInfo(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.text, GAME_TITLE);

  buttonPlate(ctx, 70, 104, PW - 140, 96, 'IRON BALLS PUB', UI.cool, hoverAction === 'open-pub');

  // Live headcount riding the top-right of the PUB plate — the mirror of the
  // 1V1 panel's searcher badge, but the room's `X/12` occupancy.
  if (app.pubCount > 0) {
    const label = `${app.pubCount}/${PUB_MAX_PLAYERS}`;
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
  ctx.fillText(`aim best ${app.stats.trainingBest}  ·  scores behind you`, PW / 2, 366);
}

function hitInfo(_u: number, v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 96 && y <= 208) return 'open-pub';
  if (y >= 218 && y <= 330) return 'open-custom';
  return null;
}

/**
 * The customisation panel — replaces the lobby arc while open, with the
 * avatar mirror standing beside it. One chip row per slot: three live
 * skins + a greyed-out COMING SOON.
 */
function drawCustom(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.emberBright, 'CUSTOMISE');

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
    const w = (PW - 80 - 3 * 10) / 4;
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

  buttonPlate(ctx, 156, 296, 200, 56, 'CLOSE', UI.amber, hoverAction === 'custom-close');
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('looks only — your hitbox never changes', PW / 2, 376);
}

function hitCustom(u: number, v: number): MenuAction | null {
  const x = u * PW;
  const y = (1 - v) * PH;
  const w = (PW - 80 - 3 * 10) / 4;
  const chipIdx = (px: number): number => Math.floor((px - 40) / (w + 10));
  if (y >= 112 && y <= 178 && x >= 40 && x <= PW - 40) {
    const i = chipIdx(x);
    if (i >= 0 && i <= 2 && !AVATAR_SKINS[i].locked) return `av-${i}` as MenuAction;
    return null;
  }
  if (y >= 214 && y <= 280 && x >= 40 && x <= PW - 40) {
    const i = chipIdx(x);
    if (i >= 0 && i <= 2 && !PLATFORM_SKINS[i].locked) return `pf-${i}` as MenuAction;
    return null;
  }
  if (y >= 288 && y <= 360 && x >= 148 && x <= 364) return 'custom-close';
  return null;
}

// Leaderboard row band: the full top 10 laid out at once, then the footer.
const BOARD_ROW_Y0 = 152;
const BOARD_ROW_STEP = 30;

/** Behind — the Firebase leaderboard: 1V1 score / aim training tabs. */
function drawBoard(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.amber, 'LEADERBOARD', BW, BH);

  // Tab plates: 1V1 (score) | AIM TRAINING (best runs).
  const tabs: Array<['duel' | 'training', string]> = [
    ['duel', '1V1'],
    ['training', 'AIM TRAINING'],
  ];
  const tw = (BW - 96 - 16) / 2;
  let x = 48;
  for (const [id, label] of tabs) {
    const active = leaderboard.tab === id;
    const action: MenuAction = id === 'duel' ? 'lb-duel' : 'lb-training';
    const hot = hoverAction === action;
    plate(ctx, x, 88, tw, 44, {
      cut: 10,
      fill: active
        ? 'rgba(255,176,0,0.18)'
        : hot
          ? 'rgba(255,176,0,0.14)'
          : 'rgba(150,150,170,0.10)',
      stroke: active || hot ? UI.amber : UI.steelDim,
      rivets: false,
    });
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = active || hot ? UI.amber : UI.textDim;
    ctx.fillText(label, x + tw / 2, 110);
    x += tw + 16;
  }

  // Ranked rows — the whole top 10 at a glance; your own entry burns ember.
  const rows = leaderboardRows();
  const offset = leaderboard.scroll[leaderboard.tab];
  ctx.font = '600 22px system-ui, sans-serif';
  rows.slice(offset, offset + LEADERBOARD_VISIBLE_ROWS).forEach((r, i) => {
    const y = BOARD_ROW_Y0 + i * BOARD_ROW_STEP;
    ctx.fillStyle = r.me ? UI.emberBright : UI.textDim;
    ctx.textAlign = 'left';
    ctx.fillText(`${offset + i + 1}.  ${r.name}`, 56, y);
    ctx.textAlign = 'right';
    ctx.fillText(String(r.value), BW - 56, y);
  });
  if (!rows.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = UI.textDim;
    ctx.fillText(leaderboard.status || 'no entries yet', BW / 2, BOARD_ROW_Y0 + 4 * BOARD_ROW_STEP);
  }

  const mine = myStats();
  ctx.textAlign = 'center';
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  ctx.fillText(`${mine.name}  ·  score ${mine.score}  ·  aim best ${mine.training}`, BW / 2, 466);
  buttonPlate(ctx, 156, 486, 200, 44, 'RENAME', UI.amber, hoverAction === 'rename');
}

function hitBoard(u: number, v: number): MenuAction | null {
  const x = u * BW;
  const y = (1 - v) * BH;
  if (y >= 82 && y <= 138) return u < 0.5 ? 'lb-duel' : 'lb-training';
  if (y >= 478 && y <= 534 && x >= 148 && x <= 364) return 'rename';
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

export function createMenu(scene: Scene): Menu {
  const group = new Group();
  group.name = 'lobby-menu';

  const train = makePanel('train', 0.86, 0.68, drawTrain, hitTrain);
  const duel = makePanel('duel', 0.78, 0.62, drawDuel, hitDuel);
  const info = makePanel('info', 0.78, 0.62, drawInfo, hitInfo);
  // Taller than the lobby panels (1.36 × 1.456 ≈ BW:BH) so the full top 10
  // reads at a glance; its own BW×BH canvas keeps the text at lobby density.
  const board = makePanel('board', 1.36, 1.456, drawBoard, hitBoard, BW, BH);
  const custom = makePanel('custom', 0.9, 0.7, drawCustom, hitCustom);

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
  custom.mesh.position.set(0.5, 1.45, -1.1);
  custom.mesh.rotation.y = -0.3;
  custom.mesh.visible = false;

  const panels = [train, duel, info, board, custom];
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
