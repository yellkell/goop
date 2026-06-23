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
  AdditiveBlending,
  CanvasTexture,
  Color,
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
import { UI, fitStencilText, hazardStrip, metalText, plate, segmentBar, stencilFont } from './industrial.js';
import { countdownArt } from './countdownArt.js';
import { verdictArt } from './verdictArt.js';

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

/** One fighter's HUD readout — a stacked health bar with a name + round pips. */
export interface FighterHud {
  name: string;
  /** CSS colour for the bar/name (team tint). */
  neon: string;
  /** current / max health, 0..1. */
  hpFrac: number;
  /** round wins to light as pips. */
  pips: number;
  /** Team id (0 = your team) — your team stacks left, the rest stack right. */
  team: number;
}

export interface Scoreboard {
  /**
   * Redraw the match boards. `fighters[0]` is always you; your team stacks up
   * the left column, every other fighter stacks up the right — so 1v1 reads as
   * the classic two boards and 2v2 / FFA add bars on top.
   */
  updateMatch(state: MatchState, fighters: FighterHud[]): void;
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
  // Match the countdown art: 3 & 2 glow blue, 1 glows red (like FIGHT).
  if (message === '3' || message === '2') return UI.cool;
  if (message === '1') return UI.danger;
  if (message === 'DRAW') return UI.amber;
  if (message === 'FIGHT' || message === 'TIME') return UI.danger;
  if (message === 'WIN') return UI.amber;
  return UI.emberBright;
}

/** Soft additive aura that sits behind the verdict and pulses with it. A
 *  radial-gradient sprite — animated purely by transform/opacity/colour, so it
 *  never costs a canvas redraw. */
function makeVerdictGlow(): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.32)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(3.0, 1.7),
    new MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0,
    }),
  );
  mesh.visible = false;
  return mesh;
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export function createScoreboard(scene: Scene): Scoreboard {
  const group = new Group();
  group.name = 'scoreboards';

  // Both boards side by side behind/above the opponent's pad, barely angled
  // inward — read your bar and theirs without turning your head.
  const left = makeBoard(1.5, 0.72); // YOU — ember
  left.mesh.position.set(-1.0, 2.0, -ARENA_GAP - 1.1);
  left.mesh.rotation.y = 0.18;
  const right = makeBoard(1.5, 0.72); // primary opponent — blue
  right.mesh.position.set(1.0, 2.0, -ARENA_GAP - 1.1);
  right.mesh.rotation.y = -0.18;

  // Arcade stacks: a teammate above your bar, extra opponents above theirs.
  // Hidden in 1v1 / training, so the classic two-board layout is unchanged.
  // Each board's readout sits in the top ~two-thirds of its plate, so a tight
  // 0.54 m step stacks the bars close together (the overlap is empty margin)
  // instead of leaving a big gap and floating the top bar near the ceiling.
  const STACK_STEP = 0.54;
  const extraLeft = makeBoard(1.5, 0.72);
  extraLeft.mesh.position.set(-1.0, 2.0 + STACK_STEP, -ARENA_GAP - 1.1);
  extraLeft.mesh.rotation.y = 0.18;
  const extraRightA = makeBoard(1.5, 0.72);
  extraRightA.mesh.position.set(1.0, 2.0 + STACK_STEP, -ARENA_GAP - 1.1);
  extraRightA.mesh.rotation.y = -0.18;
  const extraRightB = makeBoard(1.5, 0.72);
  extraRightB.mesh.position.set(1.0, 2.0 + 2 * STACK_STEP, -ARENA_GAP - 1.1);
  extraRightB.mesh.rotation.y = -0.18;
  const extras = [extraLeft, extraRightA, extraRightB];
  for (const e of extras) e.mesh.visible = false;

  // ONE shared round clock, big, in the slot between the two boards.
  const timer = makeBoard(0.46, 0.29, 256, 160);
  timer.mesh.position.set(0, 2.0, -ARENA_GAP - 1.1);

  // Headline strip (KO, YOU WIN...) floating just above the boards.
  // Sized to the canvas aspect so the stencil type renders undistorted.
  const centre = makeBoard(2.2, 1.05);
  const CENTRE_Y = 2.9;
  const CENTRE_Z = -ARENA_GAP - 1.15;
  centre.mesh.position.set(0, CENTRE_Y, CENTRE_Z);
  centre.mesh.renderOrder = 12;

  // The accent aura behind the verdict.
  const glow = makeVerdictGlow();
  glow.position.set(0, CENTRE_Y, CENTRE_Z - 0.04);
  glow.renderOrder = 11;
  const glowColor = new Color();

  group.add(left.mesh, right.mesh, extraLeft.mesh, extraRightA.mesh, extraRightB.mesh, timer.mesh, glow, centre.mesh);
  scene.add(group);

  // --- verdict animation (transform/opacity only — no canvas redraws) -------
  let verdictMsg = '';
  let verdictStart = 0;
  const glowMat = glow.material as MeshBasicMaterial;

  const animateVerdict = (message: string): void => {
    const now = performance.now();
    if (message !== verdictMsg) {
      verdictMsg = message;
      verdictStart = now;
    }
    if (!message) {
      centre.mesh.scale.setScalar(1);
      centre.mesh.position.y = CENTRE_Y;
      glow.visible = false;
      return;
    }
    const t = (now - verdictStart) / 1000;
    // Slam in: a quick overshoot that springs to rest, then a slow breathe.
    const spring = 1 + 0.6 * Math.exp(-t * 8) * Math.cos(t * 17);
    const breathe = 1 + 0.02 * Math.sin(now * 0.0042);
    centre.mesh.scale.setScalar(Math.max(0.25, spring * breathe));
    centre.mesh.position.y = CENTRE_Y + 0.012 * Math.sin(now * 0.0032);

    // Aura: a bright impact flash on arrival decaying into a steady pulse.
    glow.visible = true;
    glowColor.set(verdictAccent(message));
    glowMat.color.copy(glowColor);
    const intro = easeOutCubic(Math.min(1, t / 0.25));
    const flash = 0.55 * Math.exp(-t * 5);
    const pulse = 0.26 + 0.12 * Math.sin(now * 0.005);
    glowMat.opacity = Math.min(0.95, intro * pulse + flash);
    glow.scale.setScalar(spring * (1 + 0.18 * Math.exp(-t * 6) + 0.05 * Math.sin(now * 0.005)));
  };

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
    // Two flavours of art: the countdown plates (3/2/1/FIGHT) and the verdict
    // plates (KO/KO'D/WIN). Everything else is stencilled. "Is the art decoded
    // yet" folds into the key so the first frame after a cold load swaps the
    // text fallback out for the image.
    const cd = countdownArt(message);
    const vd = cd ? null : verdictArt(message);
    const key = `c|${message}|${sub}|${cd ? 'cd' : vd ? 'vd' : 'txt'}`;
    if (centre.key === key) return;
    centre.key = key;
    const { ctx, tex } = centre;
    ctx.clearRect(0, 0, W, H);
    if (cd) {
      // Countdown plate, centred and undistorted. Numbers are sized to a tall
      // glyph; the wide FIGHT bar is sized to fill the board's WIDTH so it
      // reads big (its transparent top/bottom padding overruns the canvas
      // harmlessly). The mesh's slam-in spring still animates the whole board.
      let w: number, h: number;
      if (message === 'FIGHT') {
        w = W - 90;
        h = cd.naturalHeight * (w / cd.naturalWidth);
      } else {
        h = 360;
        w = cd.naturalWidth * (h / cd.naturalHeight);
      }
      ctx.drawImage(cd, (W - w) / 2, (H - h) / 2, w, h);
    } else if (vd) {
      // Verdict plate (KO/KO'D/WIN): a smaller neon-metal word, centred. Capped
      // on width too so a wide verdict never overruns the board.
      const targetH = 150;
      let h = targetH;
      let w = vd.naturalWidth * (h / vd.naturalHeight);
      const maxW = W - 140;
      if (w > maxW) {
        h *= maxW / w;
        w = maxW;
      }
      ctx.drawImage(vd, (W - w) / 2, (H - h) / 2, w, h);
    } else if (message) {
      // No backing plate: just the short chromed verdict floating over the gap.
      ctx.textAlign = 'center';
      const accent = verdictAccent(message);
      const isCountdown = /^[123]$/.test(message);
      const px = fitStencilText(ctx, message, W - 120, isCountdown ? 210 : message.includes('YOU') ? 124 : 152, 44);
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

  /** Draw a fighter onto a board (or hide it when there's no fighter). */
  const setBoard = (board: Board, hud: FighterHud | undefined): void => {
    if (!hud) {
      board.mesh.visible = false;
      return;
    }
    board.mesh.visible = true;
    drawSide(board, hud.name, hud.neon, hud.hpFrac, hud.pips);
  };

  return {
    updateMatch(state, fighters) {
      drawTimer(fmtTime(state.roundTimer));
      const you = fighters[0];
      setBoard(left, you);
      // Your team (the ally in 2v2) stacks above your bar; everyone else
      // (the opponents) stacks up the right column.
      const allies = fighters.filter((f, i) => i > 0 && f.team === 0);
      const enemies = fighters.filter((f) => f.team !== 0);
      setBoard(extraLeft, allies[0]);
      setBoard(right, enemies[0]);
      setBoard(extraRightA, enemies[1]);
      setBoard(extraRightB, enemies[2]);
      // The loser gets no verdict popup — a plain LOSS / YOU LOSE shows nothing
      // (the winner still sees WIN). A knockout still flashes KO'D, since that's
      // the dramatic beat and it has its own plate.
      const verdict = state.message === 'LOSS' || state.message === 'YOU LOSE' ? '' : state.message;
      drawCentre(verdict, '');
      animateVerdict(verdict);
    },

    updateTraining(hp, hpMax) {
      // Aim Training uses just the two classic boards.
      left.mesh.visible = true;
      right.mesh.visible = true;
      for (const e of extras) e.mesh.visible = false;
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
      animateVerdict('');
    },

    setVisible(v) {
      group.visible = v;
    },
  };
}
