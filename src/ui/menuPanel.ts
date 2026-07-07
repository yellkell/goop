/**
 * The lobby menu — a slime-styled canvas panel you laser-point at before a
 * bout: one fat FIGHT button and three option pills (round length, music,
 * difficulty). Pure drawing + hit-testing; MenuSystem owns the pointers,
 * clicks and consequences.
 *
 * Hit-testing works in canvas pixels: the raycaster hands us the mesh UV,
 * we flip V and scale. Buttons redraw on hover so the laser feels alive.
 */

import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { isMusicMuted } from '../audio/music.js';
import { currentDifficulty, DIFFICULTIES, settings } from '../state.js';
import { drawTitle, onTitleReady } from './titleArt.js';

const W = 1024;
const H = 820;

export type MenuAction = 'fight' | 'round' | 'music' | 'difficulty';

interface Button {
  action: MenuAction;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class MenuPanel {
  readonly group = new Group();
  /** The raycast target. */
  readonly mesh: Mesh;

  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private buttons: Button[] = [
    { action: 'fight', x: 112, y: 248, w: 800, h: 158 },
    { action: 'round', x: 112, y: 456, w: 386, h: 112 },
    { action: 'music', x: 526, y: 456, w: 386, h: 112 },
    { action: 'difficulty', x: 112, y: 612, w: 800, h: 108 },
  ];
  private hovered: MenuAction | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(0.78, 0.78 * (H / W)),
      new MeshBasicMaterial({ map: this.tex, transparent: true }),
    );
    this.group.add(this.mesh);
    this.draw();
    // Redraw once the wordmark banner decodes (it replaces the title text).
    onTitleReady(() => this.draw());
  }

  /** Which button sits under a mesh UV, or null. */
  hitTest(u: number, v: number): MenuAction | null {
    const px = u * W;
    const py = (1 - v) * H;
    for (const b of this.buttons) {
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.action;
    }
    return null;
  }

  /** Update hover highlight; returns true when it changed (for the blip). */
  setHovered(action: MenuAction | null): boolean {
    if (action === this.hovered) return false;
    this.hovered = action;
    this.draw();
    return true;
  }

  /** Redraw (option labels changed). */
  refresh(): void {
    this.draw();
  }

  /** Rounded-rect path helper. */
  private rr(x: number, y: number, w: number, h: number, r: number): void {
    this.g.beginPath();
    this.g.roundRect(x, y, w, h, r);
  }

  private draw(): void {
    const g = this.g;
    g.clearRect(0, 0, W, H);

    // ---- The plate: dark glass with a hairline slime edge. ----
    const plate = g.createLinearGradient(0, 0, 0, H);
    plate.addColorStop(0, 'rgba(9, 17, 11, 0.94)');
    plate.addColorStop(1, 'rgba(4, 9, 6, 0.9)');
    g.fillStyle = plate;
    this.rr(6, 6, W - 12, H - 12, 44);
    g.fill();
    g.strokeStyle = 'rgba(109, 255, 126, 0.3)';
    g.lineWidth = 2;
    g.stroke();
    // Whisper of a top-edge sheen so the glass reads as glass.
    const sheen = g.createLinearGradient(0, 6, 0, 150);
    sheen.addColorStop(0, 'rgba(190, 255, 200, 0.07)');
    sheen.addColorStop(1, 'rgba(190, 255, 200, 0)');
    g.fillStyle = sheen;
    this.rr(6, 6, W - 12, 144, 44);
    g.fill();

    // ---- Wordmark, centred. ----
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.shadowColor = 'rgba(109, 255, 126, 0.35)';
    g.shadowBlur = 30;
    if (!drawTitle(g, W / 2, 34, 520, 168)) {
      g.font = '900 96px system-ui, sans-serif';
      g.fillStyle = '#6dff7e';
      g.fillText('GOOP', W / 2, 60);
    }
    g.shadowBlur = 0;

    const spaced = g as CanvasRenderingContext2D & { letterSpacing: string };

    // ---- FIGHT — the one big call to action. ----
    const f = this.buttons[0];
    const fHot = this.hovered === 'fight';
    if (fHot) {
      g.shadowColor = 'rgba(94, 240, 122, 0.75)';
      g.shadowBlur = 34;
    }
    const fg = g.createLinearGradient(0, f.y, 0, f.y + f.h);
    fg.addColorStop(0, fHot ? '#5ef07a' : '#3ecb62');
    fg.addColorStop(1, fHot ? '#1f9c3f' : '#177a31');
    g.fillStyle = fg;
    this.rr(f.x, f.y, f.w, f.h, 34);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = fHot ? 'rgba(220, 255, 226, 0.9)' : 'rgba(180, 255, 190, 0.35)';
    g.lineWidth = fHot ? 4 : 2;
    g.stroke();
    g.textBaseline = 'middle';
    g.font = '900 88px system-ui, sans-serif';
    spaced.letterSpacing = '12px';
    g.fillStyle = '#f4fff2';
    g.shadowColor = 'rgba(0, 40, 10, 0.55)';
    g.shadowBlur = 10;
    g.fillText('FIGHT', f.x + f.w / 2 + 6, f.y + f.h / 2 + 5);
    g.shadowBlur = 0;
    spaced.letterSpacing = '0px';

    // ---- ROUND + MUSIC pills, side by side. ----
    const pill = (b: Button, label: string, value: string): void => {
      const hot = this.hovered === b.action;
      g.fillStyle = hot ? 'rgba(32, 60, 40, 0.95)' : 'rgba(14, 26, 17, 0.92)';
      this.rr(b.x, b.y, b.w, b.h, 26);
      g.fill();
      g.strokeStyle = hot ? 'rgba(190, 255, 200, 0.85)' : 'rgba(109, 255, 126, 0.3)';
      g.lineWidth = hot ? 3 : 2;
      g.stroke();
      g.textBaseline = 'middle';
      g.font = '700 24px system-ui, sans-serif';
      spaced.letterSpacing = '5px';
      g.fillStyle = 'rgba(160, 210, 170, 0.75)';
      g.fillText(label, b.x + b.w / 2 + 2, b.y + 32);
      spaced.letterSpacing = '0px';
      g.font = '900 52px system-ui, sans-serif';
      g.fillStyle = '#f2fff0';
      g.fillText(value, b.x + b.w / 2, b.y + b.h - 38);
    };
    pill(this.buttons[1], 'ROUND', `${settings.roundSeconds}s`);
    pill(this.buttons[2], 'MUSIC', isMusicMuted() ? 'OFF' : 'ON');

    // ---- DIFFICULTY — a segmented control showing all three notches, the
    // active one lit. One tap cycles (the whole row is the hit target). ----
    const d = this.buttons[3];
    const dHot = this.hovered === 'difficulty';
    const gap = 14;
    const segW = (d.w - gap * 2) / 3;
    for (let s = 0; s < DIFFICULTIES.length; s++) {
      const sx = d.x + s * (segW + gap);
      const active = DIFFICULTIES[s] === currentDifficulty();
      if (active) {
        const ag = g.createLinearGradient(0, d.y, 0, d.y + d.h);
        ag.addColorStop(0, dHot ? 'rgba(110, 240, 135, 0.98)' : 'rgba(84, 216, 110, 0.95)');
        ag.addColorStop(1, dHot ? 'rgba(46, 160, 66, 0.98)' : 'rgba(36, 130, 54, 0.95)');
        g.fillStyle = ag;
      } else {
        g.fillStyle = dHot ? 'rgba(24, 44, 30, 0.95)' : 'rgba(14, 26, 17, 0.9)';
      }
      this.rr(sx, d.y, segW, d.h, 22);
      g.fill();
      g.strokeStyle = active
        ? 'rgba(210, 255, 216, 0.7)'
        : dHot
          ? 'rgba(150, 220, 160, 0.5)'
          : 'rgba(109, 255, 126, 0.22)';
      g.lineWidth = 2;
      g.stroke();
      g.textBaseline = 'middle';
      g.font = `${active ? 900 : 700} 34px system-ui, sans-serif`;
      spaced.letterSpacing = '3px';
      g.fillStyle = active ? '#08170c' : 'rgba(238, 250, 238, 0.42)';
      g.fillText(DIFFICULTIES[s].name, sx + segW / 2 + 1, d.y + d.h / 2 + 2);
      spaced.letterSpacing = '0px';
    }

    this.tex.needsUpdate = true;
  }
}
