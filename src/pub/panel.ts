/**
 * Canvas-texture wall panels in the FIRE FIGHT industrial language —
 * chamfered plate steel, rivets, hazard amber, stencil type — opaque (this
 * is a real pub interior, not passthrough smoked glass).
 */

import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { chamferPath, futuristicFont, stencilFont } from '../ui/industrial.js';

export interface PanelLine {
  text: string;
  size?: number;
  colour?: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
}

export class Panel {
  readonly mesh: Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: CanvasTexture;

  constructor(width: number, height: number, pxPerMeter = 512) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * pxPerMeter);
    this.canvas.height = Math.round(height * pxPerMeter);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: this.texture, transparent: true });
    this.mesh = new Mesh(new PlaneGeometry(width, height), material);
  }

  /** Steel backplate: chamfered corners, edge stroke, corner rivets. */
  clear(): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    const cut = Math.min(w, h) * 0.07;
    chamferPath(ctx, 3, 3, w - 6, h - 6, cut);
    ctx.fillStyle = 'rgba(16,18,23,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(172,182,198,0.55)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = 'rgba(172,182,198,0.4)';
    for (const [rx, ry] of [
      [cut, cut],
      [w - cut, cut],
      [cut, h - cut],
      [w - cut, h - cut],
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  setLines(lines: PanelLine[]): void {
    this.clear();
    const { width: w } = this.canvas;
    const ctx = this.ctx;
    let y = 22;
    for (const line of lines) {
      // Shrink-to-fit: a title must never run off its plate.
      let size = line.size ?? 34;
      const font = (px: number): string =>
        line.bold ? stencilFont(px) : `${px}px 'Arial Narrow', system-ui, sans-serif`;
      ctx.font = font(size);
      while (size > 12 && ctx.measureText(line.text).width > w - 52) {
        size -= 2;
        ctx.font = font(size);
      }
      y += size;
      ctx.fillStyle = line.colour ?? '#e8ecf2';
      ctx.textAlign = line.align ?? 'center';
      const x = line.align === 'left' ? 26 : line.align === 'right' ? w - 26 : w / 2;
      ctx.fillText(line.text, x, y);
      y += Math.round(size * 0.42);
    }
    this.texture.needsUpdate = true;
  }

  /**
   * Plate-free floating text — for name labels over players' heads. Transparent
   * background (no steel backplate), bright text with a soft glow and wide
   * letter-spacing for a futuristic HUD read. Shrinks to fit the canvas width.
   */
  setLabel(text: string, colour = '#ffffff', size = 60): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h); // no plate — just the glyphs
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${Math.round(size * 0.1)}px`;
    let px = size;
    ctx.font = futuristicFont(px);
    while (px > 16 && ctx.measureText(text).width > w - 24) {
      px -= 2;
      ctx.font = futuristicFont(px);
    }
    const cx = w / 2;
    const cy = h / 2;
    // Glow pass, then a crisp core pass on top.
    ctx.shadowColor = 'rgba(170,225,255,0.95)';
    ctx.shadowBlur = Math.round(px * 0.55);
    ctx.fillStyle = colour;
    ctx.fillText(text, cx, cy);
    ctx.shadowBlur = 0;
    ctx.fillText(text, cx, cy);
    ctx.letterSpacing = '0px';
    this.texture.needsUpdate = true;
  }

  /** Direct canvas access for custom drawing (leaderboards, scoreboards). */
  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.clear();
    fn(this.ctx, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  /**
   * Like {@link draw} but starts from a fully TRANSPARENT canvas — no steel
   * backplate — so the caller can paint its own (e.g. the sleek smoked-glass
   * match card that wants the arena's translucent look, not an opaque slab).
   */
  drawBare(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fn(this.ctx, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.geometry.dispose();
  }
}
