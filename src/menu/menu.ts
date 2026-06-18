/**
 * The lobby: three smoked-steel plates on a shallow arc in front of the
 * player — industrial robot-wars styling, translucent so your room stays
 * visible through them. Centre = AIM TRAINING (the headline mode), left =
 * 1V1 (quick match + vs bot), right = stats & connection info. Each panel is
 * a canvas texture on a plane; MenuSystem raycasts the controllers for
 * hover + click and maps the hit UV to an action zone.
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
import { GAME_TITLE, hueToColor } from '../config.js';
import { UI, buttonPlate, hazardStrip, plate, stencilFont } from '../ui/industrial.js';

export type PanelId = 'train' | 'duel' | 'info' | 'loadout';

export type MenuAction =
  | 'start-training'
  | 'toggle-shootback'
  | 'quick-match'
  | 'cancel-queue'
  | 'vs-bot';

const PW = 512;
const PH = 400;

export interface MenuPanel {
  id: PanelId;
  mesh: Mesh;
  redraw: (hover: boolean) => void;
  /** Map a hit UV (u right, v up) to an action, or null. */
  hitTest: (u: number, v: number) => MenuAction | null;
  /**
   * Continuous control (e.g. a slider): called every frame the trigger is
   * held over the panel. Returns true if the hit landed on the control (the
   * caller then redraws and suppresses the click action).
   */
  drag?: (u: number, v: number) => boolean;
}

export interface Menu {
  group: Group;
  panels: MenuPanel[];
  setVisible: (v: boolean) => void;
  redrawAll: (hoverId: PanelId | null) => void;
}

/** The shared panel skeleton: smoked plate, hazard chip, stencil title. */
function panelBg(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hover: boolean,
  accent: string,
  title: string,
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
}

function makePanel(
  id: PanelId,
  wMeters: number,
  hMeters: number,
  draw: (ctx: CanvasRenderingContext2D, hover: boolean) => void,
  hitTest: MenuPanel['hitTest'],
  opts: PanelOpts = {},
): MenuPanel {
  const { cw = PW, ch = PH, drag } = opts;
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
  const redraw = (hover: boolean): void => {
    draw(ctx, hover);
    texture.needsUpdate = true;
  };
  return { id, mesh, redraw, hitTest, drag };
}

/** Centre — AIM TRAINING: the big start plate + the shoot-back toggle. */
function drawTrain(ctx: CanvasRenderingContext2D, hover: boolean): void {
  panelBg(ctx, PW, PH, hover, UI.emberBright, 'AIM TRAINING');

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
  panelBg(ctx, PW, PH, hover, UI.cool, '1 V 1');

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

/** Right — stats & how-to. Not clickable. */
function drawInfo(ctx: CanvasRenderingContext2D): void {
  panelBg(ctx, PW, PH, false, UI.text, GAME_TITLE);

  ctx.font = '600 26px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  const lines = [
    'hold trigger — ball orbits your fist',
    'punch + release — throw',
    'trigger — recall the ball',
    'a recall through them still hits',
    'your orbit parries their fire',
    'stay on your platform!',
  ];
  lines.forEach((l, i) => ctx.fillText(l, PW / 2, 112 + i * 40));

  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillStyle = UI.emberBright;
  ctx.fillText(
    `${app.stats.wins}W / ${app.stats.losses}L  ·  best ${app.stats.trainingBest}${training.lastScore ? `  ·  last ${training.lastScore}` : ''}`,
    PW / 2,
    364,
  );
}

// --- Bottom — GLOVE ACCENT: a hue slider for your glove glow ---------------
// The loadout panel uses its own wider/shorter canvas so the slider isn't
// squashed when mapped onto the plane.
const LW = 512;
const LH = 240;
const SL_X = 56; // slider track left
const SL_W = 356; // slider track width
const SL_Y = 120; // slider track top (canvas y, down)
const SL_H = 34; // slider track height
const SW_X = SL_X + SL_W + 18; // colour swatch left
const SW_Y = SL_Y - 7;
const SW = 48; // swatch size

function hexCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Bottom — GLOVE ACCENT: drag a hue bar to tint your glove glow. */
function drawLoadout(ctx: CanvasRenderingContext2D, hover: boolean): void {
  const col = hueToColor(app.accentHue);
  const css = hexCss(col);
  panelBg(ctx, LW, LH, hover, css, 'GLOVE ACCENT');

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

  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.textAlign = 'center';
  ctx.fillText('drag to tint your glove accents', LW / 2, LH - 30);
}

/** While the trigger is held over the track, set the hue from the hit X. */
function dragLoadout(u: number, v: number): boolean {
  const y = (1 - v) * LH;
  if (y < SL_Y - 34 || y > SL_Y + SL_H + 34) return false;
  const x = u * LW;
  app.accentHue = Math.min(1, Math.max(0, (x - SL_X) / SL_W));
  return true;
}

export function createMenu(scene: Scene): Menu {
  const group = new Group();
  group.name = 'lobby-menu';

  const train = makePanel('train', 0.86, 0.68, drawTrain, hitTrain);
  const duel = makePanel('duel', 0.78, 0.62, drawDuel, hitDuel);
  const info = makePanel('info', 0.78, 0.62, (ctx) => drawInfo(ctx), () => null);
  const loadout = makePanel('loadout', 0.86, 0.4, drawLoadout, () => null, {
    cw: LW,
    ch: LH,
    drag: dragLoadout,
  });

  // Shallow arc in front of the player, tilted inward toward the centre.
  const y = 1.45;
  train.mesh.position.set(0, y, -1.25);
  duel.mesh.position.set(-0.84, y - 0.02, -1.02);
  duel.mesh.rotation.y = 0.48;
  info.mesh.position.set(0.84, y - 0.02, -1.02);
  info.mesh.rotation.y = -0.48;
  // The accent slider sits just below the centre training plate.
  loadout.mesh.position.set(0, y - 0.59, -1.18);

  const panels = [train, duel, info, loadout];
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
