/**
 * The lobby: three dark fight-poster panels on a shallow arc in front of the
 * player. Centre = AIM TRAINING (the headline mode), left = 1V1 (quick match
 * + vs bot), right = stats & connection info. Each panel is a canvas texture
 * on a plane; MenuSystem raycasts the controllers for hover + click and maps
 * the hit UV to an action zone.
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

export type PanelId = 'train' | 'duel' | 'info';

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
}

export interface Menu {
  group: Group;
  panels: MenuPanel[];
  setVisible: (v: boolean) => void;
  redrawAll: (hoverId: PanelId | null) => void;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function panelBg(ctx: CanvasRenderingContext2D, hover: boolean, neon: string): void {
  ctx.clearRect(0, 0, PW, PH);
  const g = ctx.createLinearGradient(0, 0, 0, PH);
  g.addColorStop(0, hover ? 'rgba(30,32,44,0.96)' : 'rgba(22,24,32,0.92)');
  g.addColorStop(1, hover ? 'rgba(44,30,24,0.96)' : 'rgba(34,24,20,0.92)');
  roundRect(ctx, 10, 10, PW - 20, PH - 20, 32);
  ctx.fillStyle = g;
  ctx.shadowColor = neon;
  ctx.shadowBlur = hover ? 34 : 20;
  ctx.fill();
  ctx.shadowBlur = 0;
  roundRect(ctx, 10, 10, PW - 20, PH - 20, 32);
  ctx.lineWidth = 4;
  ctx.strokeStyle = hover ? neon : 'rgba(255,160,60,0.45)';
  ctx.stroke();
}

/** A chunky pill button. */
function button(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, c0: string, c1: string): void {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, c0);
  grad.addColorStop(1, c1);
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = grad;
  ctx.shadowColor = c1;
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#16181f';
  ctx.font = `900 ${Math.round(h * 0.42)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2 + 2);
}

function makePanel(
  id: PanelId,
  wMeters: number,
  hMeters: number,
  neon: string,
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
    panelBg(ctx, hover, neon);
    draw(ctx, hover);
    texture.needsUpdate = true;
  };
  return { id, mesh, redraw, hitTest };
}

/** Centre — AIM TRAINING: the big start button + the shoot-back toggle. */
function drawTrain(ctx: CanvasRenderingContext2D, hover: boolean): void {
  ctx.fillStyle = '#ffc04d';
  ctx.font = '900 52px system-ui, sans-serif';
  ctx.fillText('AIM TRAINING', PW / 2, 70);

  button(ctx, 70, 120, PW - 140, 110, 'START', hover ? '#ffd27a' : '#ffc04d', '#ff7a18');

  // Shoot-back toggle row.
  const on = app.shootBack;
  ctx.font = '700 30px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(244,246,251,0.9)';
  ctx.fillText('targets shoot back', 64, 300);
  const pw = 120, ph = 56, px = PW - 64 - pw, py = 272;
  roundRect(ctx, px, py, pw, ph, ph / 2);
  ctx.fillStyle = on ? '#4fb7ff' : 'rgba(150,150,170,0.3)';
  ctx.fill();
  const kr = ph / 2 - 7;
  ctx.beginPath();
  ctx.arc(on ? px + pw - kr - 8 : px + kr + 8, py + ph / 2, kr, 0, Math.PI * 2);
  ctx.fillStyle = '#f4f6fb';
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,200,140,0.8)';
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
  ctx.fillStyle = '#4fb7ff';
  ctx.font = '900 52px system-ui, sans-serif';
  ctx.fillText('1 V 1', PW / 2, 70);

  const queueing = app.state === 'queueing';
  button(
    ctx, 70, 116, PW - 140, 96,
    queueing ? 'CANCEL' : 'QUICK MATCH',
    queueing ? '#ffd27a' : hover ? '#9fe2ff' : '#7fd0ff',
    queueing ? '#ff9a3c' : '#2f7fd6',
  );
  button(ctx, 70, 240, PW - 140, 96, 'VS BOT', hover ? '#ffd27a' : '#ffc04d', '#ff7a18');

  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(159,226,255,0.85)';
  ctx.fillText(queueing ? 'searching for an opponent…' : app.netStatus, PW / 2, 368);
}

function hitDuel(_u: number, v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 108 && y <= 220) return app.state === 'queueing' ? 'cancel-queue' : 'quick-match';
  if (y >= 232 && y <= 344) return 'vs-bot';
  return null;
}

/** Right — stats & how-to. Not clickable. */
function drawInfo(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#f4f6fb';
  ctx.font = '900 44px system-ui, sans-serif';
  ctx.fillText(GAME_TITLE, PW / 2, 64);

  ctx.font = '600 27px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,220,170,0.95)';
  const lines = [
    'hold trigger — ball orbits your fist',
    'punch + release — throw',
    'trigger — recall the ball',
    'your orbit parries their fire',
    'stay on your platform!',
  ];
  lines.forEach((l, i) => ctx.fillText(l, PW / 2, 122 + i * 42));

  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillStyle = '#ffc04d';
  ctx.fillText(
    `${app.stats.wins}W / ${app.stats.losses}L  ·  best ${app.stats.trainingBest}${training.lastScore ? `  ·  last ${training.lastScore}` : ''}`,
    PW / 2,
    352,
  );
}

export function createMenu(scene: Scene): Menu {
  const group = new Group();
  group.name = 'lobby-menu';

  const train = makePanel('train', 0.86, 0.68, 'rgba(255,160,60,0.95)', drawTrain, hitTrain);
  const duel = makePanel('duel', 0.78, 0.62, 'rgba(79,183,255,0.95)', drawDuel, hitDuel);
  const info = makePanel('info', 0.78, 0.62, 'rgba(255,243,207,0.7)', (ctx) => drawInfo(ctx), () => null);

  // Shallow arc in front of the player, tilted inward toward the centre.
  const y = 1.45;
  train.mesh.position.set(0, y, -1.25);
  duel.mesh.position.set(-0.84, y - 0.02, -1.02);
  duel.mesh.rotation.y = 0.48;
  info.mesh.position.set(0.84, y - 0.02, -1.02);
  info.mesh.rotation.y = -0.48;

  const panels = [train, duel, info];
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
