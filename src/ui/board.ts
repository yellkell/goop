/**
 * The floating scoreboard — a slime-styled canvas plate hanging in the air
 * beside the creature: two health bars, the round clock, and a centre stage
 * for the harvested FIRE FIGHT countdown plates (3/2/1/FIGHT) and verdict
 * art. Redrawn only when the match state says so (plus a slow tick for the
 * clock); it yaws to face you.
 */

import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { COMBAT, GAME_TITLE } from '../config.js';
import { match, POKES_TO_START } from '../state.js';
import { countdownArt } from './countdownArt.js';
import { verdictArt } from './verdictArt.js';

const W = 1024;
const H = 640;

export class ScoreBoard {
  readonly group = new Group();
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private clockShown = -1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(
      new PlaneGeometry(1.0, 0.625),
      new MeshBasicMaterial({ map: this.tex, transparent: true }),
    );
    this.group.add(mesh);
    this.draw();
  }

  /** Yaw the board toward the player each frame; redraw when needed. */
  update(playerHead: Vector3): void {
    const p = this.group.position;
    this.group.rotation.set(0, Math.atan2(playerHead.x - p.x, playerHead.z - p.z), 0);

    const clock = Math.ceil(match.timeLeft);
    if (match.boardDirty || (match.phase === 'fighting' && clock !== this.clockShown)) {
      this.clockShown = clock;
      match.boardDirty = false;
      this.draw();
    }
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, color: string, label: string, value: number): void {
    const g = this.g;
    g.save();
    // Trough.
    g.fillStyle = 'rgba(10, 18, 12, 0.85)';
    g.beginPath();
    g.roundRect(x, y, w, h, h / 2);
    g.fill();
    g.strokeStyle = 'rgba(140, 255, 150, 0.25)';
    g.lineWidth = 3;
    g.stroke();
    // Fill, with a goo-drip nose on the leading edge.
    const fw = Math.max(0, frac) * (w - 10);
    if (fw > 2) {
      const grad = g.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(x + 5, y + 5, fw, h - 10, (h - 10) / 2);
      g.fill();
      g.globalAlpha = 0.75;
      g.beginPath();
      g.arc(x + 5 + fw, y + h * 0.72, h * 0.16, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    g.fillStyle = 'rgba(238, 250, 238, 0.92)';
    g.font = '700 34px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(label, x + 22, y + h / 2 + 1);
    g.textAlign = 'right';
    g.fillText(String(Math.max(0, Math.ceil(value))), x + w - 22, y + h / 2 + 1);
    g.restore();
  }

  private draw(): void {
    const g = this.g;
    g.clearRect(0, 0, W, H);

    // Plate.
    g.fillStyle = 'rgba(8, 14, 10, 0.78)';
    g.beginPath();
    g.roundRect(8, 8, W - 16, H - 16, 46);
    g.fill();
    g.strokeStyle = 'rgba(109, 255, 126, 0.5)';
    g.lineWidth = 5;
    g.stroke();

    // Title.
    g.font = '900 92px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillStyle = '#6dff7e';
    g.shadowColor = 'rgba(109, 255, 126, 0.55)';
    g.shadowBlur = 26;
    g.fillText(GAME_TITLE, W / 2, 30);
    g.shadowBlur = 0;

    // Health bars.
    this.bar(60, 160, W - 120, 68, match.creatureHp / COMBAT.creatureHealth, 'rgba(74, 222, 96, 0.95)', 'THE GOOP', match.creatureHp);
    this.bar(60, 250, W - 120, 68, match.playerHp / COMBAT.playerHealth, 'rgba(255, 176, 58, 0.95)', 'YOU', match.playerHp);

    // Centre stage.
    const cx = W / 2;
    const cy = 470;
    if (match.phase === 'countdown') {
      const beat = Math.min(3, Math.floor(match.countdownT / COMBAT.countdownBeat));
      const msg = ['3', '2', '1', 'FIGHT'][beat];
      const art = countdownArt(msg);
      if (art) {
        const s = Math.min(280 / art.height, 620 / art.width);
        g.drawImage(art, cx - (art.width * s) / 2, cy - (art.height * s) / 2, art.width * s, art.height * s);
      } else {
        g.font = '900 150px system-ui, sans-serif';
        g.textBaseline = 'middle';
        g.fillStyle = '#f2fff0';
        g.fillText(msg, cx, cy);
      }
    } else if (match.phase === 'verdict' && match.verdict) {
      const key = match.verdict === 'time' ? 'time' : match.verdict === 'draw' ? 'draw' : match.verdict === 'win' ? 'win' : 'ko';
      const art = verdictArt(key);
      if (art) {
        const s = Math.min(260 / art.height, 620 / art.width);
        g.drawImage(art, cx - (art.width * s) / 2, cy - (art.height * s) / 2, art.width * s, art.height * s);
      } else {
        g.font = '900 120px system-ui, sans-serif';
        g.textBaseline = 'middle';
        g.fillStyle = match.verdict === 'ko' ? '#ff7a5c' : '#f2fff0';
        g.fillText(key.toUpperCase(), cx, cy);
      }
      // Whose verdict it was.
      g.font = '700 40px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.8)';
      g.fillText(
        match.verdict === 'win' ? 'THE GOOP IS DOWN' : match.verdict === 'ko' ? 'THE GOOP GOT YOU' : match.verdict === 'draw' ? 'NOBODY BUDGED' : match.playerHp >= match.creatureHp ? 'YOU TAKE IT ON POINTS' : 'IT TAKES IT ON POINTS',
        cx,
        cy + 170,
      );
    } else if (match.phase === 'fighting') {
      g.font = '900 130px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillStyle = match.timeLeft < 10 ? '#ff7a5c' : 'rgba(238, 250, 238, 0.9)';
      g.fillText(String(Math.max(0, Math.ceil(match.timeLeft))), cx, cy);
    } else {
      // Lobby prompt.
      const left = Math.max(0, POKES_TO_START - match.lobbyPokes);
      g.font = '800 56px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(238, 250, 238, 0.92)';
      g.fillText(left > 0 ? `PUNCH THE GOOP ${'●'.repeat(left)}` : 'HERE IT COMES…', cx, cy - 30);
      g.font = '600 36px system-ui, sans-serif';
      g.fillStyle = 'rgba(238, 250, 238, 0.55)';
      g.fillText(left > 0 ? `${left} more to start the bout` : '', cx, cy + 45);
    }
  }
}
