/**
 * Match UI in the industrial robot-wars language: two angled boards flank the
 * gap — YOUR board on the left (ember), THEIRS on the right (blue) — but
 * they're smoked glass, not opaque hoardings: a stencilled name strip, a
 * chunky segmented health readout, chamfered round pips and the timer, with
 * your real room visible through everything. A centre strip appears for
 * headline messages (ROUND WON, etc.).
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
import { ARENA_GAP, MATCH } from '../config.js';
import type { MatchState } from '../combat/matchState.js';
import { app, training } from '../menu/appState.js';
import { UI, hazardStrip, plate, segmentBar, stencilFont } from './industrial.js';

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

  // Centre headline strip (ROUND WON, KNOCKOUT…), above the gap. Sized to
  // the canvas aspect so the stencil type renders undistorted.
  const centre = makeBoard(2.2, 1.05);
  centre.mesh.position.set(0, 2.45, -ARENA_GAP * 0.55);

  group.add(left.mesh, right.mesh, centre.mesh);
  scene.add(group);

  const drawSide = (
    board: Board,
    name: string,
    neon: string,
    hpFrac: number,
    hpText: string,
    pips: number,
    timer: string,
  ): void => {
    const key = `s|${name}|${hpFrac}|${hpText}|${pips}|${timer}`;
    if (board.key === key) return;
    board.key = key;
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
    const key = `c|${message}|${sub}`;
    if (centre.key === key) return;
    centre.key = key;
    const { ctx, tex } = centre;
    ctx.clearRect(0, 0, W, H);
    if (message) {
      // No backing plate — just the verdict, molten stencil type floating
      // over the gap, shrunk until it fits whatever the message is.
      ctx.textAlign = 'center';
      let px = 120;
      ctx.font = stencilFont(px);
      while (px > 44 && ctx.measureText(message).width > W - 64) {
        px -= 4;
        ctx.font = stencilFont(px);
      }
      const midY = sub ? 188 : 216;
      const grad = ctx.createLinearGradient(0, midY - px * 0.55, 0, midY + px * 0.55);
      grad.addColorStop(0, '#fff3cf');
      grad.addColorStop(1, UI.ember);
      // A dark outline then an ember halo keep it readable over passthrough.
      ctx.lineWidth = Math.max(6, px * 0.09);
      ctx.strokeStyle = 'rgba(10,11,14,0.85)';
      ctx.strokeText(message, W / 2, midY);
      ctx.fillStyle = grad;
      ctx.shadowColor = 'rgba(255,122,24,0.9)';
      ctx.shadowBlur = 26;
      ctx.fillText(message, W / 2, midY);
      ctx.shadowBlur = 0;
      if (sub) {
        ctx.font = '700 44px system-ui, sans-serif';
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(10,11,14,0.8)';
        ctx.strokeText(sub, W / 2, 296);
        ctx.fillStyle = UI.textDim;
        ctx.fillText(sub, W / 2, 296);
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
    },

    updateTraining(hp, hpMax) {
      const timer = fmtTime(training.timeLeft);
      // Left board: score + streak.
      const best = Math.max(app.stats.trainingBest, training.score);
      const key = `t|${training.score}|${training.streak}|${best}|${timer}`;
      if (left.key !== key) {
        left.key = key;
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
        ctx.fillText(`best ${best}`, W - 52, 320);
        tex.needsUpdate = true;
      }
      // Right board: dodge readout (health only matters with shoot-back on).
      drawSide(
        right, 'DODGE', UI.cool,
        app.shootBack ? hp / hpMax : 1,
        app.shootBack ? String(Math.ceil(hp)) : 'SAFE',
        0, timer,
      );
      drawCentre('', '');
    },

    setVisible(v) {
      group.visible = v;
    },
  };
}
