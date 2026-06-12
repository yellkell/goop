/**
 * Hazard-stripe canvas texture for 3D set dressing (platform kick-bands,
 * barrier trims) — the same amber-on-charcoal diagonals the 2D UI wears.
 */

import { CanvasTexture, LinearFilter, RepeatWrapping } from 'three';

export function hazardTexture(color = '#ffb000'): CanvasTexture {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#15161a';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = color;
  // Two diagonal stripes per tile so the pattern wraps seamlessly.
  for (const off of [-S, 0, S]) {
    ctx.beginPath();
    ctx.moveTo(off, S);
    ctx.lineTo(off + S / 2, 0);
    ctx.lineTo(off + S * 0.78, 0);
    ctx.lineTo(off + S * 0.28, S);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearFilter;
  return tex;
}
