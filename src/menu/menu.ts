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
import { app, training } from './appState.js';
import { GAME_TITLE } from '../config.js';
import { leaderboard, myStats } from '../net/leaderboard.js';
import { UI, buttonPlate, hazardStrip, plate, stencilFont } from '../ui/industrial.js';

export type PanelId = 'train' | 'duel' | 'info' | 'board';

export type MenuAction =
  | 'start-training'
  | 'toggle-shootback'
  | 'quick-match'
  | 'cancel-queue'
  | 'vs-bot'
  | 'lb-duel'
  | 'lb-training';

const PW = 512;
const PH = 400;

export interface MenuPanel {
  id: PanelId;
  mesh: Mesh;
  redraw: (hover: boolean) => void;
  /** Map a hit UV (u right, v up) to an action, or null. */
  hitTest: (u: number, v: number) => MenuAction | null;
}

export interface Menu {
  group: Group;
  panels: MenuPanel[];
  setVisible: (v: boolean) => void;
  redrawAll: (hoverId: PanelId | null) => void;
}

/** The shared panel skeleton: smoked plate, hazard chip, stencil title. */
function panelBg(ctx: CanvasRenderingContext2D, hover: boolean, accent: string, title: string): void {
  ctx.clearRect(0, 0, PW, PH);
  plate(ctx, 8, 8, PW - 16, PH - 16, {
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
  ctx.lineTo(PW - 36, 72);
  ctx.stroke();
  ctx.textAlign = 'center';
}

function makePanel(
  id: PanelId,
  wMeters: number,
  hMeters: number,
  draw: (ctx: CanvasRenderingContext2D, hover: boolean) => void,
  hitTest: MenuPanel['hitTest'],
): MenuPanel {
  const canvas = document.createElement('canvas');
  canvas.width = PW;
  canvas.height = PH;
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
  const redraw = (hover: boolean): void => {
    draw(ctx, hover);
    texture.needsUpdate = true;
  };
  return { id, mesh, redraw, hitTest };
}

/** Centre — AIM TRAINING: the big start plate + the shoot-back toggle. */
function drawTrain(ctx: CanvasRenderingContext2D, hover: boolean): void {
  panelBg(ctx, hover, UI.emberBright, 'AIM TRAINING');

  buttonPlate(ctx, 70, 120, PW - 140, 110, 'START', UI.ember, hover);

  // Shoot-back toggle row: an industrial breaker switch.
  const on = app.shootBack;
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('targets shoot back', 64, 300);
  const pw = 120, ph = 56, px = PW - 64 - pw, py = 272;
  plate(ctx, px, py, pw, ph, {
    cut: 10,
    fill: on ? 'rgba(79,183,255,0.25)' : 'rgba(150,150,170,0.12)',
    stroke: on ? UI.cool : UI.steelDim,
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
function drawDuel(ctx: CanvasRenderingContext2D, hover: boolean): void {
  panelBg(ctx, hover, UI.cool, '1 V 1');

  const queueing = app.state === 'queueing';
  buttonPlate(
    ctx, 70, 116, PW - 140, 96,
    queueing ? 'CANCEL' : 'QUICK MATCH',
    queueing ? UI.amber : UI.cool,
    hover,
  );
  buttonPlate(ctx, 70, 240, PW - 140, 96, 'VS BOT', UI.ember, hover);

  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(159,226,255,0.85)';
  ctx.fillText(queueing ? 'searching for an opponent…' : app.netStatus, PW / 2, 352);
  ctx.fillStyle = UI.textDim;
  ctx.fillText('online duels carry positional voice chat', PW / 2, 380);
}

function hitDuel(_u: number, v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 108 && y <= 220) return app.state === 'queueing' ? 'cancel-queue' : 'quick-match';
  if (y >= 232 && y <= 344) return 'vs-bot';
  return null;
}

/** Right — how-to + training bests. Not clickable (W/L lives on the board). */
function drawInfo(ctx: CanvasRenderingContext2D): void {
  panelBg(ctx, false, UI.text, GAME_TITLE);

  ctx.font = '600 26px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  const lines = [
    'hold trigger or grip — ball orbits',
    'punch + release — throw',
    'squeeze — recall the ball',
    'a recall through them still hits',
    'your orbit parries their fire',
    'stay on your platform!',
  ];
  lines.forEach((l, i) => ctx.fillText(l, PW / 2, 112 + i * 40));

  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillStyle = UI.emberBright;
  ctx.fillText(
    `aim best ${app.stats.trainingBest}${training.lastScore ? `  ·  last ${training.lastScore}` : ''}  ·  scores behind you`,
    PW / 2,
    364,
  );
}

/** Behind — the Firebase leaderboard: 1V1 score / aim training tabs. */
function drawBoard(ctx: CanvasRenderingContext2D, hover: boolean): void {
  panelBg(ctx, hover, UI.amber, 'LEADERBOARD');

  // Tab plates: 1V1 (score) | AIM TRAINING (best runs).
  const tabs: Array<['duel' | 'training', string]> = [
    ['duel', '1V1'],
    ['training', 'AIM TRAINING'],
  ];
  const tw = (PW - 96 - 16) / 2;
  let x = 48;
  for (const [id, label] of tabs) {
    const active = leaderboard.tab === id;
    plate(ctx, x, 88, tw, 44, {
      cut: 10,
      fill: active ? 'rgba(255,176,0,0.18)' : 'rgba(150,150,170,0.10)',
      stroke: active ? UI.amber : UI.steelDim,
      rivets: false,
    });
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = active ? UI.amber : UI.textDim;
    ctx.fillText(label, x + tw / 2, 110);
    x += tw + 16;
  }

  // Ranked rows; your own entry burns ember.
  const rows = leaderboard.tab === 'duel' ? leaderboard.duel : leaderboard.training;
  ctx.font = '600 24px system-ui, sans-serif';
  rows.slice(0, 6).forEach((r, i) => {
    const y = 166 + i * 34;
    ctx.fillStyle = r.me ? UI.emberBright : UI.textDim;
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}.  ${r.name}`, 56, y);
    ctx.textAlign = 'right';
    ctx.fillText(String(r.value), PW - 56, y);
  });
  if (!rows.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = UI.textDim;
    ctx.fillText(leaderboard.status || 'no entries yet', PW / 2, 230);
  }

  const mine = myStats();
  ctx.textAlign = 'center';
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  ctx.fillText(`${mine.name}  ·  score ${mine.score}  ·  aim best ${mine.training}`, PW / 2, 376);
}

function hitBoard(u: number, v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 82 && y <= 138) return u < 0.5 ? 'lb-duel' : 'lb-training';
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
  const info = makePanel('info', 0.78, 0.62, (ctx) => drawInfo(ctx), () => null);
  const board = makePanel('board', 1.0, 0.78, drawBoard, hitBoard);

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

  const panels = [train, duel, info, board];
  for (const p of panels) {
    p.redraw(false);
    group.add(p.mesh);
  }
  scene.add(group);

  return {
    group,
    panels,
    setVisible: (v) => {
      group.visible = v;
    },
    redrawAll: (hoverId) => {
      for (const p of panels) p.redraw(p.id === hoverId);
    },
  };
}
