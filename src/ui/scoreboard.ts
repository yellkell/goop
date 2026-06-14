/**
 * Match UI in the industrial robot-wars language: both boards hang together
 * behind and above the opponent's pad — YOURS on the left (ember), THEIRS on
 * the right (blue) — so one glance over your rival's shoulder takes in the
 * whole game state. Smoked glass, not opaque hoardings: a stencilled name
 * strip, a chunky segmented health readout, chamfered round pips and the
 * timer, with your real room visible through everything. The short metallic
 * verdict (KO, YOU WIN, etc.) floats above them.
 *
 * In Aim Training the left board becomes your score/streak readout and the
 * right board shows the dodge bar + time.
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
import { ARENA_GAP, MATCH } from '../config.js';
import type { MatchState } from '../combat/matchState.js';
import { app, training } from '../menu/appState.js';
import { myName, rival } from '../net/leaderboard.js';
import { UI, fitStencilText, hazardStrip, metalText, plate, segmentBar, stencilFont } from './industrial.js';

const W = 880;
const H = 420;

interface Board {
  mesh: Mesh;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
  /**
   * Content fingerprint of the last draw. Boards are asked to refresh every
   * frame but a canvas redraw + GPU texture upload is the single most
   * expensive UI op we have — so each draw skips when nothing changed
   * (the timer ticks once a second; health moves only on hits).
   */
  key?: string;
}

export interface Scoreboard {
  /** Redraw match boards. pHp/oHp are current health, *Max the pools. */
  updateMatch(state: MatchState, pHp: number, pMax: number, oHp: number, oMax: number): void;
  /** Redraw boards in Aim Training mode. */
  updateTraining(hp: number, hpMax: number): void;
  setVisible(v: boolean): void;
}

function makeBoard(wMeters: number, hMeters: number, cw = W, ch = H): Board {
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'middle';
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(wMeters, hMeters),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  return { mesh, ctx, tex };
}

/**
 * The shared board skeleton: clear canvas, a hazard keying chip + stencilled
 * title + neon underline up top. Everything below floats over passthrough.
 */
function header(ctx: CanvasRenderingContext2D, title: string, neon: string): void {
  ctx.clearRect(0, 0, W, H);
  hazardStrip(ctx, 32, 38, 64, 22, UI.amber);
  ctx.textAlign = 'left';
  const px = fitStencilText(ctx, title, W - 148, 54, 26);
  ctx.font = stencilFont(px);
  ctx.fillStyle = neon;
  ctx.fillText(title, 116, 54);
  ctx.strokeStyle = neon;
  ctx.lineWidth = 3;
  ctx.shadowColor = neon;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(32, 96);
  ctx.lineTo(W - 32, 96);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/** Round-win pips: chamfered studs, lit per round taken. */
function scorePips(ctx: CanvasRenderingContext2D, x: number, y: number, won: number, color: string): void {
  for (let i = 0; i < MATCH.winTarget; i++) {
    const px = x + i * 58;
    ctx.save();
    ctx.translate(px, y);
    ctx.rotate(Math.PI / 4);
    if (i < won) {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fillRect(-14, -14, 28, 28);
      ctx.shadowBlur = 0;
    } else {
      ctx.lineWidth = 3;
      ctx.strokeStyle = UI.steelDim;
      ctx.strokeRect(-14, -14, 28, 28);
    }
    ctx.restore();
  }
}

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function verdictAccent(message: string): string {
  if (message.includes('LOSE') || message === 'LOSS' || message === "KO'D") return UI.coolBright;
  if (message === 'DRAW') return UI.amber;
  if (message === 'FIGHT' || message === 'TIME') return UI.danger;
  if (message === 'WIN') return UI.amber;
  return UI.emberBright;
}

function displayName(name: string, fallback: string): string {
  const clean = name.trim();
  return clean ? clean.toUpperCase() : fallback;
}

export function createScoreboard(scene: Scene): Scoreboard {
  const group = new Group();
  group.name = 'scoreboards';

  // Both boards side by side behind/above the opponent's pad, barely angled
  // inward — read your bar and theirs without turning your head.
  const left = makeBoard(1.5, 0.72); // YOU — ember
  left.mesh.position.set(-1.0, 2.0, -ARENA_GAP - 1.1);
  left.mesh.rotation.y = 0.18;
  const right = makeBoard(1.5, 0.72); // THEM — blue
  right.mesh.position.set(1.0, 2.0, -ARENA_GAP - 1.1);
  right.mesh.rotation.y = -0.18;

  // ONE shared round clock, big, in the slot between the two boards.
  const timer = makeBoard(0.46, 0.29, 256, 160);
  timer.mesh.position.set(0, 2.0, -ARENA_GAP - 1.1);

  // Headline strip (KO, YOU WIN...) floating just above the boards.
  // Sized to the canvas aspect so the stencil type renders undistorted.
  const centre = makeBoard(2.2, 1.05);
  centre.mesh.position.set(0, 2.9, -ARENA_GAP - 1.15);

  group.add(left.mesh, right.mesh, timer.mesh, centre.mesh);
  scene.add(group);

  const drawTimer = (text: string): void => {
    const key = `clk|${text}`;
    if (timer.key === key) return;
    timer.key = key;
    const { ctx, tex } = timer;
    ctx.clearRect(0, 0, 256, 160);
    plate(ctx, 6, 6, 244, 148, { cut: 18, fill: UI.ink, rivets: false });
    ctx.textAlign = 'center';
    ctx.font = stencilFont(84);
    ctx.fillStyle = UI.text;
    ctx.shadowColor = 'rgba(255,176,0,0.55)';
    ctx.shadowBlur = 14;
    ctx.fillText(text, 128, 84);
    ctx.shadowBlur = 0;
    tex.needsUpdate = true;
  };

  const drawSide = (
    board: Board,
    name: string,
    neon: string,
    hpFrac: number,
    pips: number,
  ): void => {
    const key = `s|${name}|${hpFrac}|${pips}`;
    if (board.key === key) return;
    board.key = key;
    const { ctx, tex } = board;
    header(ctx, name, neon);
    // The health readout gets the only solid-ish backing on the board —
    // the segmented bar IS the number, no digits needed.
    plate(ctx, 28, 124, W - 56, 110, { cut: 16, fill: UI.ink, rivets: false });
    segmentBar(ctx, 52, 148, W - 104, 60, hpFrac, neon);
    scorePips(ctx, 70, 308, pips, neon);
    tex.needsUpdate = true;
  };

  const drawCentre = (message: string, sub: string): void => {
    const key = `c|${message}|${sub}`;
    if (centre.key === key) return;
    centre.key = key;
    const { ctx, tex } = centre;
    ctx.clearRect(0, 0, W, H);
    if (message) {
      // No backing plate: just the short chromed verdict floating over the gap.
      ctx.textAlign = 'center';
      const accent = verdictAccent(message);
      const px = fitStencilText(ctx, message, W - 120, message.includes('YOU') ? 124 : 152, 44);
      const midY = sub ? 188 : 216;
      metalText(ctx, message, W / 2, midY, px, accent);
      if (sub) {
        ctx.font = stencilFont(40);
        ctx.lineWidth = 7;
        ctx.strokeStyle = 'rgba(2,3,7,0.9)';
        ctx.strokeText(sub, W / 2, 304);
        ctx.fillStyle = accent;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 10;
        ctx.fillText(sub, W / 2, 304);
        ctx.shadowBlur = 0;
      }
    }
    tex.needsUpdate = true;
  };

  return {
    updateMatch(state, pHp, pMax, oHp, oMax) {
      drawTimer(fmtTime(state.roundTimer));
      drawSide(left, app.mode === 'net' ? displayName(myName(), 'YOU') : 'YOU', UI.emberBright, pHp / pMax, state.myScore);
      drawSide(right, app.mode === 'net' ? displayName(rival.name, 'RIVAL') : 'BOT', UI.cool, oHp / oMax, state.oppScore);
      drawCentre(state.message, state.phase === 'matchOver' ? '' : state.message ? `R${state.round}` : '');
    },

    updateTraining(hp, hpMax) {
      drawTimer(fmtTime(training.timeLeft));
      // Left board: score + streak.
      const best = Math.max(app.stats.trainingBest, training.score);
      const key = `t|${training.score}|${training.streak}|${best}`;
      if (left.key !== key) {
        left.key = key;
        const { ctx, tex } = left;
        header(ctx, 'AIM TRAINING', UI.emberBright);
        ctx.textAlign = 'left';
        ctx.font = stencilFont(104);
        ctx.fillStyle = UI.text;
        ctx.fillText(String(training.score), 52, 200);
        ctx.font = '700 42px system-ui, sans-serif';
        ctx.fillStyle = UI.amberSoft;
        ctx.fillText(`streak x${training.streak}`, 52, 320);
        ctx.textAlign = 'right';
        ctx.fillStyle = UI.textDim;
        ctx.fillText(`best ${best}`, W - 52, 320);
        tex.needsUpdate = true;
      }
      // Right board: dodge readout (health only matters with shoot-back on).
      drawSide(right, 'DODGE', UI.cool, app.shootBack ? hp / hpMax : 1, 0);
      drawCentre('', '');
    },

    setVisible(v) {
      group.visible = v;
    },
  };
}
