/**
 * Match UI, styled after the Blaston arena boards: two angled neon banners
 * flanking the gap — YOUR board on the left (ember orange), THEIRS on the
 * right (blue) — each with a big health bar, round-win pips and the round
 * timer. A centre strip appears for headline messages (ROUND WON, etc.), and
 * a stats board hangs BEHIND you (curveball-style: always there, unclickable,
 * turn around to read it mid-bout).
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

/** Dark arena-board backdrop with a neon edge in the side's colour. */
function boardBg(ctx: CanvasRenderingContext2D, neon: string): void {
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(20,22,30,0.92)');
  bg.addColorStop(1, 'rgba(30,26,34,0.92)');
  roundRect(ctx, 8, 8, W - 16, H - 16, 30);
  ctx.fillStyle = bg;
  ctx.shadowColor = neon;
  ctx.shadowBlur = 26;
  ctx.fill();
  ctx.shadowBlur = 0;
  roundRect(ctx, 8, 8, W - 16, H - 16, 30);
  ctx.lineWidth = 5;
  ctx.strokeStyle = neon;
  ctx.stroke();
}

/** The big Blaston-style health bar: chunky, gradient, glowing. */
function healthBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  frac: number, c0: string, c1: string,
): void {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) {
    const fw = Math.max(h, w * f);
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
    ctx.save();
    roundRect(ctx, x, y, fw, h, h / 2);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.shadowColor = c1;
    ctx.shadowBlur = 30;
    ctx.fillRect(x, y, fw, h);
    ctx.restore();
  }
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
}

/** Round-win pips: filled per round taken, hollow up to the win target. */
function scorePips(ctx: CanvasRenderingContext2D, x: number, y: number, won: number, color: string): void {
  for (let i = 0; i < MATCH.winTarget; i++) {
    ctx.beginPath();
    ctx.arc(x + i * 56, y, 18, 0, Math.PI * 2);
    if (i < won) {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.stroke();
    }
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

  // Stats board behind you — unclickable, curveball-style.
  const back = makeBoard(1.5, 0.72);
  back.mesh.position.set(0, 1.7, 1.6);
  back.mesh.rotation.y = Math.PI;

  group.add(left.mesh, right.mesh, centre.mesh, back.mesh);
  scene.add(group);

  const drawBack = (lines: string[]): void => {
    const { ctx, tex } = back;
    boardBg(ctx, 'rgba(255,160,60,0.7)');
    ctx.textAlign = 'center';
    ctx.font = '900 54px system-ui, sans-serif';
    ctx.fillStyle = '#ffc04d';
    ctx.fillText(GAME_TITLE, W / 2, 80);
    ctx.font = '600 40px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(244,246,251,0.9)';
    lines.forEach((line, i) => ctx.fillText(line, W / 2, 170 + i * 64));
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
    c0: string,
    c1: string,
  ): void => {
    const { ctx, tex } = board;
    boardBg(ctx, neon);
    ctx.textAlign = 'left';
    ctx.font = '900 56px system-ui, sans-serif';
    ctx.fillStyle = neon;
    ctx.fillText(name, 56, 86);
    ctx.textAlign = 'right';
    ctx.font = '900 64px system-ui, sans-serif';
    ctx.fillStyle = '#f4f6fb';
    ctx.fillText(timer, W - 56, 86);
    healthBar(ctx, 56, 150, W - 112, 64, hpFrac, c0, c1);
    ctx.textAlign = 'right';
    ctx.font = '800 42px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(hpText, W - 56, 296);
    scorePips(ctx, 80, 296, pips, neon);
    tex.needsUpdate = true;
  };

  const drawCentre = (message: string, sub: string): void => {
    const { ctx, tex } = centre;
    ctx.clearRect(0, 0, W, H);
    if (message) {
      roundRect(ctx, 40, 110, W - 80, 200, 44);
      ctx.fillStyle = 'rgba(18,20,28,0.88)';
      ctx.shadowColor = 'rgba(255,150,60,0.8)';
      ctx.shadowBlur = 34;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.font = '900 92px system-ui, sans-serif';
      const grad = ctx.createLinearGradient(0, 130, 0, 280);
      grad.addColorStop(0, '#fff3cf');
      grad.addColorStop(1, '#ff7a18');
      ctx.fillStyle = grad;
      ctx.fillText(message, W / 2, 196);
      if (sub) {
        ctx.font = '700 44px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(244,246,251,0.9)';
        ctx.fillText(sub, W / 2, 272);
      }
    }
    tex.needsUpdate = true;
  };

  return {
    updateMatch(state, pHp, pMax, oHp, oMax) {
      const timer = fmtTime(state.roundTimer);
      drawSide(left, 'YOU', '#ff9a3c', pHp / pMax, String(Math.ceil(pHp)), state.myScore, timer, '#ff7a18', '#ffc04d');
      drawSide(right, app.mode === 'net' ? 'RIVAL' : 'BOT', '#4fb7ff', oHp / oMax, String(Math.ceil(oHp)), state.oppScore, timer, '#2f7fd6', '#9fe2ff');
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
      boardBg(ctx, '#ff9a3c');
      ctx.textAlign = 'left';
      ctx.font = '900 56px system-ui, sans-serif';
      ctx.fillStyle = '#ff9a3c';
      ctx.fillText('AIM TRAINING', 56, 86);
      ctx.font = '900 110px system-ui, sans-serif';
      ctx.fillStyle = '#f4f6fb';
      ctx.fillText(String(training.score), 56, 210);
      ctx.font = '700 44px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,220,170,0.95)';
      ctx.fillText(`streak x${training.streak}`, 56, 320);
      ctx.textAlign = 'right';
      ctx.fillText(`best ${Math.max(app.stats.trainingBest, training.score)}`, W - 56, 320);
      tex.needsUpdate = true;
      // Right board: time + accuracy (+ health when shoot-back is on).
      drawSide(
        right, 'DODGE', '#4fb7ff',
        app.shootBack ? hp / hpMax : 1,
        app.shootBack ? String(Math.ceil(hp)) : 'safe',
        0, timer, '#2f7fd6', '#9fe2ff',
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
