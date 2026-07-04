/**
 * The fight HUD, third draft — everything on the WALL.
 *
 *  - WallBoard: one big fixed panel mounted at wall distance behind the
 *    creature's corner, like the gym's fight board: both health bars, the
 *    round pips, the clock, and the centre stage for countdown plates,
 *    round-rest cards and verdict art. Nothing floats over the creature;
 *    the board doesn't chase your head — it's furniture.
 *  - WristHud: YOUR health duplicated on the back of your left wrist,
 *    glanceable in guard, flashing when you've just been tagged.
 *
 * Canvases redraw on state changes plus a 1 Hz clock tick, and every draw
 * marks its texture dirty (its predecessor forgot — the "health bar that
 * never worked" was one missing needsUpdate).
 */

import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { COMBAT, GAME_TITLE } from '../config.js';
import { match, MAX_ROUNDS } from '../state.js';
import { countdownArt } from './countdownArt.js';
import { verdictArt } from './verdictArt.js';

function makeCanvasPlane(
  w: number,
  h: number,
  meshW: number,
): { mesh: Mesh; canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry(meshW, meshW * (h / w)),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 5;
  return { mesh, canvas, g, tex };
}

// ------------------------------------------------------------------- wall

const W = 1024;
const H = 700;

export class WallBoard {
  readonly group = new Group();
  private board = makeCanvasPlane(W, H, 1.6);
  private clockShown = -1;

  constructor() {
    this.group.add(this.board.mesh);
    this.draw();
  }

  /** Redraw when the match says so, or when the clock ticks. */
  update(): void {
    const clock = Math.ceil(match.timeLeft);
    if (match.boardDirty || (match.phase === 'fighting' && clock !== this.clockShown)) {
      this.clockShown = clock;
      match.boardDirty = false;
      this.draw();
    }
  }

  private bar(
    x: number,
    y: number,
    w: number,
    h: number,
    frac: number,
    color: string,
    label: string,
    value: number,
  ): void {
    const g = this.board.g;
    g.fillStyle = 'rgba(10, 18, 12, 0.9)';
    g.beginPath();
    g.roundRect(x, y, w, h, h / 2);
    g.fill();
    g.strokeStyle = 'rgba(140, 255, 150, 0.25)';
    g.lineWidth = 3;
    g.stroke();
    const fw = Math.max(0, frac) * (w - 10);
    if (fw > 2) {
      const grad = g.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(x + 5, y + 5, fw, h - 10, (h - 10) / 2);
      g.fill();
    }
    g.fillStyle = 'rgba(238, 250, 238, 0.92)';
    g.font = '700 32px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(label, x + 20, y + h / 2 + 1);
    g.textAlign = 'right';
    g.fillText(String(Math.max(0, Math.ceil(value))), x + w - 20, y + h / 2 + 1);
  }

  private draw(): void {
    const g = this.board.g;
    g.clearRect(0, 0, W, H);

    // Plate.
    g.fillStyle = 'rgba(8, 14, 10, 0.8)';
    g.beginPath();
    g.roundRect(8, 8, W - 16, H - 16, 44);
    g.fill();
    g.strokeStyle = 'rgba(109, 255, 126, 0.5)';
    g.lineWidth = 5;
    g.stroke();

    // Title strip + round state.
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.font = '900 64px system-ui, sans-serif';
    g.fillStyle = '#6dff7e';
    g.shadowColor = 'rgba(109, 255, 126, 0.5)';
    g.shadowBlur = 20;
    g.fillText(GAME_TITLE, W / 2, 26);
    g.shadowBlur = 0;

    const inMatch = match.phase !== 'lobby';
    if (inMatch) {
      g.font = '800 34px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(238, 250, 238, 0.85)';
      const clock = match.phase === 'fighting' ? ` · ${Math.max(0, Math.ceil(match.timeLeft))}` : '';
      g.fillText(`ROUND ${Math.min(match.round, MAX_ROUNDS)} OF ${MAX_ROUNDS}${clock}`, W / 2, 128);
      const pip = (x: number, won: boolean, color: string) => {
        g.beginPath();
        g.arc(x, 128, 13, 0, Math.PI * 2);
        g.fillStyle = won ? color : 'rgba(238, 250, 238, 0.16)';
        g.fill();
        g.strokeStyle = 'rgba(238, 250, 238, 0.4)';
        g.lineWidth = 2;
        g.stroke();
      };
      // Your pips build from the left, its pips from the right.
      for (let i = 0; i < MAX_ROUNDS - 1; i++) {
        pip(120 + i * 44, i < match.playerRounds, 'rgba(255, 176, 58, 0.95)');
        pip(W - 120 - i * 44, i < match.creatureRounds, 'rgba(74, 222, 96, 0.95)');
      }
    }

    // Health bars.
    this.bar(60, 170, W - 120, 62, match.creatureHp / COMBAT.creatureHealth, 'rgba(74, 222, 96, 0.95)', 'THE GOOP', match.creatureHp);
    this.bar(60, 252, W - 120, 62, match.playerHp / COMBAT.playerHealth, 'rgba(255, 176, 58, 0.95)', 'YOU', match.playerHp);

    // Centre stage.
    const cx = W / 2;
    const cy = 490;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (match.phase === 'countdown') {
      const beat = Math.min(3, Math.floor(match.countdownT / COMBAT.countdownBeat));
      const msg = ['3', '2', '1', 'FIGHT'][beat];
      const art = countdownArt(msg);
      if (art) {
        const s = Math.min(280 / art.height, 640 / art.width);
        g.drawImage(art, cx - (art.width * s) / 2, cy - (art.height * s) / 2, art.width * s, art.height * s);
      } else {
        g.font = '900 170px system-ui, sans-serif';
        g.fillStyle = '#f2fff0';
        g.fillText(msg, cx, cy);
      }
    } else if (match.phase === 'roundEnd') {
      g.font = '900 62px system-ui, sans-serif';
      g.fillStyle =
        match.lastRound === 'player' ? '#ffb03a' : match.lastRound === 'creature' ? '#6dff7e' : '#f2fff0';
      g.fillText(
        match.lastRound === 'player'
          ? `YOU TAKE ROUND ${match.round}`
          : match.lastRound === 'creature'
            ? `THE GOOP TAKES ROUND ${match.round}`
            : `ROUND ${match.round} IS EVEN`,
        cx,
        cy - 25,
      );
      g.font = '700 34px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.7)';
      g.fillText('breathe — it certainly isn’t', cx, cy + 50);
    } else if (match.phase === 'verdict' && match.verdict) {
      const key = match.verdict === 'win' ? 'win' : match.verdict === 'draw' ? 'draw' : 'ko';
      const art = verdictArt(key);
      if (art) {
        const s = Math.min(200 / art.height, 640 / art.width);
        g.drawImage(art, cx - (art.width * s) / 2, cy - 55 - (art.height * s) / 2, art.width * s, art.height * s);
      } else {
        g.font = '900 130px system-ui, sans-serif';
        g.fillStyle = key === 'ko' ? '#ff7a5c' : '#f2fff0';
        g.fillText(key.toUpperCase(), cx, cy - 55);
      }
      g.font = '700 34px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.85)';
      g.fillText(
        match.verdict === 'win' ? 'THE GOOP IS DOWN' : match.verdict === 'ko' ? 'THE GOOP TAKES IT' : 'NOBODY TAKES IT',
        cx,
        cy + 62,
      );
      g.font = '900 44px system-ui, sans-serif';
      g.fillStyle = '#f2fff0';
      g.fillText(`ROUNDS ${match.playerRounds} – ${match.creatureRounds}`, cx, cy + 118);
    } else if (match.phase === 'fighting') {
      // Fighting: the strip above already carries round + clock; keep the
      // stage clear so the wall reads calm mid-brawl.
    } else {
      g.font = '800 46px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.85)';
      g.fillText('WARM UP ON THE GOOP', cx, cy - 20);
      g.font = '600 30px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.5)';
      g.fillText('start from the menu · A also works', cx, cy + 40);
    }

    this.board.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ wrist

const WRIST_W = 256;
const WRIST_H = 88;

export class WristHud {
  readonly mesh: Mesh;
  private hud = makeCanvasPlane(WRIST_W, WRIST_H, 0.11);
  private hpShown = -1;
  private flashShown = 0;

  constructor() {
    this.mesh = this.hud.mesh;
    // Back of the left wrist, tilted up toward your face in guard.
    this.mesh.position.set(0, 0.045, 0.1);
    this.mesh.rotation.set(-Math.PI / 2.4, 0, 0);
    this.draw();
  }

  update(): void {
    this.mesh.visible = match.phase !== 'lobby';
    const flash = match.playerFlash > 0.03 ? 1 : 0;
    if (Math.ceil(match.playerHp) !== this.hpShown || flash !== this.flashShown) {
      this.hpShown = Math.ceil(match.playerHp);
      this.flashShown = flash;
      this.draw();
    }
  }

  private draw(): void {
    const g = this.hud.g;
    g.clearRect(0, 0, WRIST_W, WRIST_H);
    g.fillStyle = 'rgba(8, 14, 10, 0.78)';
    g.beginPath();
    g.roundRect(2, 2, WRIST_W - 4, WRIST_H - 4, 20);
    g.fill();
    g.strokeStyle = this.flashShown ? 'rgba(255, 84, 60, 0.95)' : 'rgba(255, 176, 58, 0.5)';
    g.lineWidth = this.flashShown ? 6 : 3;
    g.stroke();

    const bx = 14;
    const by = 30;
    const bw = WRIST_W - 28;
    const bh = 34;
    g.fillStyle = 'rgba(10, 18, 12, 0.9)';
    g.beginPath();
    g.roundRect(bx, by, bw, bh, bh / 2);
    g.fill();
    const frac = Math.max(0, match.playerHp / COMBAT.playerHealth);
    if (frac > 0.01) {
      g.fillStyle = frac > 0.35 ? 'rgba(255, 176, 58, 0.95)' : 'rgba(255, 84, 60, 0.95)';
      g.beginPath();
      g.roundRect(bx + 3, by + 3, (bw - 6) * frac, bh - 6, (bh - 6) / 2);
      g.fill();
    }
    g.font = '800 18px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(238, 250, 238, 0.9)';
    g.fillText('YOU', bx + 2, 16);
    g.textAlign = 'right';
    g.fillText(String(Math.max(0, Math.ceil(match.playerHp))), WRIST_W - 16, 16);
    this.hud.tex.needsUpdate = true;
  }
}
