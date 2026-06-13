/**
 * Procedural canvas textures for the pub — riveted steel walls, cork, the
 * regulation dartboard — plus `scoreFromUV`, the board's UV → score lookup.
 * The dartboard drawing/scoring pair is lifted from our old vrstreet project
 * (the one part of its darts game worth keeping); both functions share the
 * same segment layout so what you see is what you score.
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

export function makeCanvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeat: [number, number] = [1, 1],
): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, alpha: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const v = Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

/** Riveted gunmetal wall plates with grime streaks — the pub's wallpaper. */
export function steelWallTexture(repeat: [number, number] = [3, 1.5]): CanvasTexture {
  return makeCanvasTexture(
    512,
    (ctx, s) => {
      ctx.fillStyle = '#262931';
      ctx.fillRect(0, 0, s, s);
      // Plate seams: 2×2 big panels per tile, slightly varied tone.
      const half = s / 2;
      for (let px = 0; px < 2; px++) {
        for (let py = 0; py < 2; py++) {
          const tone = 36 + Math.floor(Math.random() * 8);
          ctx.fillStyle = `rgb(${tone},${tone + 2},${tone + 7})`;
          ctx.fillRect(px * half + 3, py * half + 3, half - 6, half - 6);
          // Rivets around each plate edge.
          ctx.fillStyle = '#15161b';
          const step = half / 5;
          for (let i = 0.5; i < 5; i++) {
            for (const [rx, ry] of [
              [px * half + i * step, py * half + 9],
              [px * half + i * step, py * half + half - 9],
              [px * half + 9, py * half + i * step],
              [px * half + half - 9, py * half + i * step],
            ]) {
              ctx.beginPath();
              ctx.arc(rx, ry, 4, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#4a4f5a';
              ctx.beginPath();
              ctx.arc(rx - 1, ry - 1, 2, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#15161b';
            }
          }
        }
      }
      // Grime runs from the ceiling line.
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = 'rgba(8,8,10,0.16)';
        ctx.fillRect(Math.random() * s, 0, 2 + Math.random() * 7, s * (0.3 + Math.random() * 0.7));
      }
      speckle(ctx, s, 0.22, 800);
    },
    repeat,
  );
}

/** Dark cork — the blast zone around the dartboard, pre-pocked. */
export function corkTexture(): CanvasTexture {
  return makeCanvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#352a1d';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 0.3, 2200);
    for (let i = 0; i < 130; i++) {
      ctx.fillStyle = 'rgba(8,5,3,0.8)';
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// --- Dartboard ---------------------------------------------------------------

/**
 * The house board: a big, readable bullseye TARGET — concentric rings worth
 * 50 / 25 / 20 / 10 / 5 from the centre out. No regulation segments, no
 * triple-twenty arithmetic: what you see is what you score. Shared ring
 * fractions keep `scoreFromUV` exact.
 */
const RINGS: Array<{ r: number; score: number; fill: string }> = [
  { r: 0.06, score: 50, fill: '#cf2030' }, // bullseye
  { r: 0.18, score: 25, fill: '#e8e0d0' },
  { r: 0.42, score: 20, fill: '#cf2030' },
  { r: 0.7, score: 10, fill: '#e8e0d0' },
  { r: 1.0, score: 5, fill: '#cf2030' },
];
const RIM_PX = 6; // dead rim pixels on the 512 canvas

export function dartboardTexture(): CanvasTexture {
  return makeCanvasTexture(512, (ctx, s) => {
    const c = s / 2;
    const R = s / 2 - RIM_PX;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, s, s);
    // Paint outside-in so each smaller ring sits on top.
    for (let i = RINGS.length - 1; i >= 0; i--) {
      ctx.beginPath();
      ctx.arc(c, c, R * RINGS[i].r, 0, Math.PI * 2);
      ctx.fillStyle = RINGS[i].fill;
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(20,20,20,0.7)';
    ctx.lineWidth = 3;
    for (const ring of RINGS) {
      ctx.beginPath();
      ctx.arc(c, c, R * ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Ring values printed straight onto the bands (skip the tiny bullseye).
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 1; i < RINGS.length; i++) {
      const mid = (RINGS[i - 1].r + RINGS[i].r) / 2;
      const dark = RINGS[i].fill !== '#e8e0d0';
      ctx.fillStyle = dark ? '#e8e0d0' : '#1a1a1a';
      ctx.font = `bold ${i === 1 ? 22 : 30}px sans-serif`;
      for (const ang of [-Math.PI / 2, Math.PI / 2, 0, Math.PI]) {
        ctx.fillText(String(RINGS[i].score), c + Math.cos(ang) * R * mid, c + Math.sin(ang) * R * mid);
      }
    }
  });
}

/** Score from board-local UV (0..1). Radius-only — matches the rings above. */
export function scoreFromUV(u: number, v: number): { score: number; segment: string } {
  const dx = u - 0.5;
  const dy = v - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy) / (0.5 * (1 - RIM_PX / 256));
  if (r > 1.0) return { score: 0, segment: 'MISS' };
  for (const ring of RINGS) {
    if (r <= ring.r) {
      return { score: ring.score, segment: ring.score === 50 ? 'BULLSEYE' : String(ring.score) };
    }
  }
  return { score: 0, segment: 'MISS' };
}
