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
import { currentDifficulty, settings } from '../state.js';

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
    { action: 'fight', x: 132, y: 250, w: 760, h: 170 },
    { action: 'round', x: 132, y: 470, w: 365, h: 96 },
    { action: 'music', x: 527, y: 470, w: 365, h: 96 },
    { action: 'difficulty', x: 132, y: 596, w: 760, h: 96 },
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

  private label(action: MenuAction): { big: string; small: string } {
    switch (action) {
      case 'fight':
        return { big: 'FIGHT', small: '' };
      case 'round':
        return { big: `${settings.roundSeconds}s`, small: 'ROUND' };
      case 'music':
        return { big: isMusicMuted() ? 'OFF' : 'ON', small: 'MUSIC' };
      case 'difficulty':
        return { big: currentDifficulty().name, small: 'THE GOOP COMES AT YOU' };
    }
  }

  private draw(): void {
    const g = this.g;
    g.clearRect(0, 0, W, H);

    // Plate.
    g.fillStyle = 'rgba(8, 14, 10, 0.82)';
    g.beginPath();
    g.roundRect(8, 8, W - 16, H - 16, 46);
    g.fill();
    g.strokeStyle = 'rgba(109, 255, 126, 0.5)';
    g.lineWidth = 5;
    g.stroke();

    // Title.
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.font = '900 96px system-ui, sans-serif';
    g.fillStyle = '#6dff7e';
    g.shadowColor = 'rgba(109, 255, 126, 0.55)';
    g.shadowBlur = 26;
    g.fillText('GOOP', W / 2, 44);
    g.shadowBlur = 0;
    g.font = '700 34px system-ui, sans-serif';
    g.fillStyle = 'rgba(238, 250, 238, 0.6)';
    g.fillText('IT REFORMS. YOU RE-PUNCH.', W / 2, 156);

    for (const b of this.buttons) {
      const hot = this.hovered === b.action;
      const primary = b.action === 'fight';

      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, primary ? 40 : 28);
      if (primary) {
        const grad = g.createLinearGradient(0, b.y, 0, b.y + b.h);
        grad.addColorStop(0, hot ? 'rgba(74, 230, 100, 0.95)' : 'rgba(46, 160, 62, 0.9)');
        grad.addColorStop(1, hot ? 'rgba(30, 130, 48, 0.95)' : 'rgba(22, 92, 34, 0.9)');
        g.fillStyle = grad;
      } else {
        g.fillStyle = hot ? 'rgba(52, 96, 60, 0.9)' : 'rgba(16, 30, 20, 0.9)';
      }
      g.fill();
      g.strokeStyle = hot ? 'rgba(180, 255, 190, 0.95)' : 'rgba(109, 255, 126, 0.45)';
      g.lineWidth = hot ? 6 : 3;
      g.stroke();

      const { big, small } = this.label(b.action);
      g.fillStyle = '#f2fff0';
      if (primary) {
        g.font = '900 92px system-ui, sans-serif';
        g.textBaseline = 'middle';
        g.fillText(big, b.x + b.w / 2, b.y + b.h / 2 + 4);
      } else if (b.action === 'difficulty') {
        g.textBaseline = 'middle';
        g.font = '600 26px system-ui, sans-serif';
        g.fillStyle = 'rgba(238, 250, 238, 0.55)';
        g.fillText(small, b.x + b.w / 2, b.y + 26);
        g.font = '900 46px system-ui, sans-serif';
        g.fillStyle = '#f2fff0';
        g.fillText(big, b.x + b.w / 2, b.y + b.h - 32);
      } else {
        g.textBaseline = 'middle';
        g.font = '600 26px system-ui, sans-serif';
        g.fillStyle = 'rgba(238, 250, 238, 0.55)';
        g.fillText(small, b.x + b.w / 2, b.y + 26);
        g.font = '900 48px system-ui, sans-serif';
        g.fillStyle = '#f2fff0';
        g.fillText(big, b.x + b.w / 2, b.y + b.h - 30);
      }
    }

    // Footer hint.
    g.font = '600 26px system-ui, sans-serif';
    g.fillStyle = 'rgba(238, 250, 238, 0.4)';
    g.textBaseline = 'alphabetic';
    g.fillText('point + trigger · warm up on the goop meanwhile · A also starts', W / 2, H - 40);

    this.tex.needsUpdate = true;
  }
}
