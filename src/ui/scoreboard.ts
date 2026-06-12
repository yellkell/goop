/**
 * Match UI in the industrial robot-wars language: two angled boards flank the
 * gap — YOUR board on the left (ember), THEIRS on the right (blue) — but
 * they're smoked glass, not opaque hoardings: a stencilled name strip, a
 * chunky segmented health readout, chamfered round pips and the timer, with
 * your real room visible through everything. A centre strip appears for
 * headline messages (ROUND WON, etc.), and a stats plate hangs BEHIND you
 * (curveball-style: always there, unclickable, turn around to read it
 * mid-bout).
 *
 * In Aim Training the left board becomes your score/streak readout and the
 * right board shows accuracy + time.
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
import { ARENA_GAP, GAME_TITLE, MATCH } from '../config.js';
import type { MatchState } from '../combat/matchState.js';
import { app, training } from '../menu/appState.js';
import { UI, hazardStrip, plate, segmentBar, stencilFont } from './industrial.js';

const W = 880;
const H = 420;

interface Board {
  mesh: Mesh;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
}

export interface Scoreboard {
  /** Redraw match boards. pHp/oHp are current health, *Max the pools. */
  updateMatch(state: MatchState, pHp: number, pMax: number, oHp: number, oMax: number): void;
  /** Redraw boards in Aim Training mode. */
  updateTraining(hp: number, hpMax: number): void;
  setVisible(v: boolean): void;
}

function makeBoard(wMeters: number, hMeters: number): Board {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
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
function header(ctx: CanvasRenderingContext2D, title: string, neon: string, right = ''): void {
  ctx.clearRect(0, 0, W, H);
  hazardStrip(ctx, 32, 38, 64, 22, UI.amber);
  ctx.textAlign = 'left';
  ctx.font = stencilFont(54);
  ctx.fillStyle = neon;
  ctx.fillText(title, 116, 54);
  if (right) {
    ctx.textAlign = 'right';
    ctx.font = stencilFont(60);
    ctx.fillStyle = UI.text;
    ctx.fillText(right, W - 36, 54);
  }
  ctx.strokeStyle = neon;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(32, 96);
  ctx.lineTo(W - 32, 96);
  ctx.stroke();
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

export function createScoreboard(scene: Scene): Scoreboard {
  const group = new Group();
  group.name = 'scoreboards';

  // Flanking boards at mid-gap, angled inward like arena hoardings.
  const left = makeBoard(1.5, 0.72); // YOU — ember
  left.mesh.position.set(-1.85, 1.95, -ARENA_GAP * 0.52);
  left.mesh.rotation.y = 0.62;
  const right = makeBoard(1.5, 0.72); // THEM — blue
  right.mesh.position.set(1.85, 1.95, -ARENA_GAP * 0.52);
  right.mesh.rotation.y = -0.62;

  // Centre headline strip (ROUND WON, KNOCKOUT…), above the gap.
  const centre = makeBoard(1.9, 0.5);
  centre.mesh.position.set(0, 2.45, -ARENA_GAP * 0.55);

  // Stats plate behind you — unclickable, curveball-style.
  const back = makeBoard(1.5, 0.72);
  back.mesh.position.set(0, 1.7, 1.6);
  back.mesh.rotation.y = Math.PI;

  group.add(left.mesh, right.mesh, centre.mesh, back.mesh);
  scene.add(group);

  const drawBack = (lines: string[]): void => {
    const { ctx, tex } = back;
    ctx.clearRect(0, 0, W, H);
    plate(ctx, 16, 16, W - 32, H - 32, { cut: 28 });
    hazardStrip(ctx, 56, 44, W - 112, 16, UI.amber);
    ctx.textAlign = 'center';
    ctx.font = stencilFont(52);
    ctx.fillStyle = UI.emberBright;
    ctx.fillText(GAME_TITLE, W / 2, 110);
    ctx.font = '600 38px system-ui, sans-serif';
    ctx.fillStyle = UI.textDim;
    lines.forEach((line, i) => ctx.fillText(line, W / 2, 184 + i * 62));
    tex.needsUpdate = true;
  };

  const drawSide = (
    board: Board,
    name: string,
    neon: string,
    hpFrac: number,
    hpText: string,
    pips: number,
    timer: string,
  ): void => {
    const { ctx, tex } = board;
    header(ctx, name, neon, timer);
    // The health readout gets the only solid-ish backing on the board.
    plate(ctx, 28, 124, W - 56, 110, { cut: 16, fill: UI.ink, rivets: false });
    segmentBar(ctx, 52, 148, W - 104, 60, hpFrac, neon);
    scorePips(ctx, 70, 308, pips, neon);
    ctx.textAlign = 'right';
    ctx.font = stencilFont(48);
    ctx.fillStyle = UI.textDim;
    ctx.fillText(hpText, W - 40, 310);
    tex.needsUpdate = true;
  };

  const drawCentre = (message: string, sub: string): void => {
    const { ctx, tex } = centre;
    ctx.clearRect(0, 0, W, H);
    if (message) {
      plate(ctx, 60, 104, W - 120, 212, { cut: 30, fill: UI.inkDeep, stroke: UI.amberSoft });
      hazardStrip(ctx, 78, 118, 70, 18, UI.amber);
      hazardStrip(ctx, W - 148, 118, 70, 18, UI.amber);
      ctx.textAlign = 'center';
      ctx.font = stencilFont(86);
      const grad = ctx.createLinearGradient(0, 130, 0, 280);
      grad.addColorStop(0, '#fff3cf');
      grad.addColorStop(1, UI.ember);
      ctx.fillStyle = grad;
      ctx.fillText(message, W / 2, 200);
      if (sub) {
        ctx.font = '700 42px system-ui, sans-serif';
        ctx.fillStyle = UI.textDim;
        ctx.fillText(sub, W / 2, 274);
      }
    }
    tex.needsUpdate = true;
  };

  return {
    updateMatch(state, pHp, pMax, oHp, oMax) {
      const timer = fmtTime(state.roundTimer);
      drawSide(left, 'YOU', UI.emberBright, pHp / pMax, String(Math.ceil(pHp)), state.myScore, timer);
      drawSide(right, app.mode === 'net' ? 'RIVAL' : 'BOT', UI.cool, oHp / oMax, String(Math.ceil(oHp)), state.oppScore, timer);
      drawCentre(state.message, state.phase === 'matchOver' ? '' : state.message ? `round ${state.round}` : '');
      drawBack([
        `round ${state.round}  ·  ${state.myScore} - ${state.oppScore}`,
        `lifetime  ${app.stats.wins}W / ${app.stats.losses}L`,
        app.mode === 'net' ? app.netStatus : 'sparring the bot',
      ]);
    },

    updateTraining(hp, hpMax) {
      const timer = fmtTime(training.timeLeft);
      const acc = training.thrown > 0 ? Math.round((training.hits / training.thrown) * 100) : 0;
      // Left board: score + streak.
      const { ctx, tex } = left;
      header(ctx, 'AIM TRAINING', UI.emberBright, timer);
      ctx.textAlign = 'left';
      ctx.font = stencilFont(104);
      ctx.fillStyle = UI.text;
      ctx.fillText(String(training.score), 52, 200);
      ctx.font = '700 42px system-ui, sans-serif';
      ctx.fillStyle = UI.amberSoft;
      ctx.fillText(`streak x${training.streak}`, 52, 320);
      ctx.textAlign = 'right';
      ctx.fillStyle = UI.textDim;
      ctx.fillText(`best ${Math.max(app.stats.trainingBest, training.score)}`, W - 52, 320);
      tex.needsUpdate = true;
      // Right board: dodge readout (health only matters with shoot-back on).
      drawSide(
        right, 'DODGE', UI.cool,
        app.shootBack ? hp / hpMax : 1,
        app.shootBack ? String(Math.ceil(hp)) : 'SAFE',
        0, timer,
      );
      drawCentre('', '');
      drawBack([
        `accuracy ${acc}%  ·  hits ${training.hits}/${training.thrown}`,
        `best streak x${training.bestStreak}`,
        app.shootBack ? 'targets are shooting back' : 'targets are passive',
      ]);
    },

    setVisible(v) {
      group.visible = v;
    },
  };
}
