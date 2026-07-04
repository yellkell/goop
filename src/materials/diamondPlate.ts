/**
 * Procedural diamond-plate (chequer/tread plate) canvas textures for the
 * platform slabs: the classic raised steel treads in a 2x2 alternating ±45°
 * grid, drawn once into a seamless tile. Returns a shaded colour map plus a
 * matching grayscale bump map so the treads catch the arena lighting.
 */

import { CanvasTexture, LinearMipMapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';

const S = 256;

/** One tread lozenge centred at (cx, cy), rotated by `angle`. */
function tread(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  draw: (ctx: CanvasRenderingContext2D, halfL: number, halfW: number) => void,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  draw(ctx, S * 0.15, S * 0.052);
  ctx.restore();
}

/** The four tread slots of the tile — offsets chosen so the pattern wraps. */
function forEachTread(
  ctx: CanvasRenderingContext2D,
  draw: (ctx: CanvasRenderingContext2D, halfL: number, halfW: number) => void,
): void {
  tread(ctx, S * 0.25, S * 0.25, Math.PI / 4, draw);
  tread(ctx, S * 0.75, S * 0.25, -Math.PI / 4, draw);
  tread(ctx, S * 0.25, S * 0.75, -Math.PI / 4, draw);
  tread(ctx, S * 0.75, S * 0.75, Math.PI / 4, draw);
}

function makeCanvas(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  return canvas.getContext('2d')!;
}

function toTexture(ctx: CanvasRenderingContext2D, srgb: boolean): CanvasTexture {
  const tex = new CanvasTexture(ctx.canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipMapLinearFilter;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

export interface DiamondPlateMaps {
  map: CanvasTexture;
  bumpMap: CanvasTexture;
}

/** Build the tile once; set `repeat` on both maps to scale the treads. */
export function diamondPlateTextures(): DiamondPlateMaps {
  // --- colour map: dark worn mill steel with shaded treads ---
  const c = makeCanvas();
  c.fillStyle = '#26282d';
  c.fillRect(0, 0, S, S);
  // Subtle wear speckle so the flats aren't dead-flat.
  for (let i = 0; i < 220; i++) {
    c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
    c.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  forEachTread(c, (ctx, halfL, halfW) => {
    // Drop shadow under the lozenge.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(2, 3, halfL, halfW, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body: lit top edge rolling down to a near-black underside.
    const grad = ctx.createLinearGradient(0, -halfW, 0, halfW);
    grad.addColorStop(0, '#7e848f');
    grad.addColorStop(0.5, '#484c54');
    grad.addColorStop(1, '#16181c');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, halfL, halfW, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hard specular sliver along the crown — the wet-metal glint.
    ctx.fillStyle = 'rgba(235,241,250,0.65)';
    ctx.beginPath();
    ctx.ellipse(-halfL * 0.1, -halfW * 0.3, halfL * 0.62, halfW * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // --- bump map: white raised treads on mid-gray flats ---
  const b = makeCanvas();
  b.fillStyle = '#787878';
  b.fillRect(0, 0, S, S);
  forEachTread(b, (ctx, halfL, halfW) => {
    ctx.fillStyle = '#c8c8c8';
    ctx.beginPath();
    ctx.ellipse(0, 0, halfL, halfW, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(0, 0, halfL * 0.7, halfW * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  return { map: toTexture(c, true), bumpMap: toTexture(b, false) };
}
