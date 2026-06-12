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

/** Standard segment order clockwise from the top (20 at 12 o'clock). */
export const DART_SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// Ring radii as fractions of board radius — shared by drawing and scoring.
const BULLSEYE_R = 0.035;
const BULL_R = 0.08;
const TRIPLE_IN = 0.45;
const TRIPLE_OUT = 0.5;
const DOUBLE_IN = 0.92;
const RIM_PX = 6; // dead rim pixels on the 512 canvas

export function dartboardTexture(): CanvasTexture {
  return makeCanvasTexture(512, (ctx, s) => {
    const c = s / 2;
    const R = s / 2 - RIM_PX;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, s, s);
    const seg = (Math.PI * 2) / 20;
    for (let i = 0; i < 20; i++) {
      const start = -Math.PI / 2 + i * seg - seg / 2;
      const end = start + seg;
      const dark = i % 2 === 0;
      const rings: Array<[number, number, string]> = [
        [BULL_R, TRIPLE_IN, dark ? '#111111' : '#e8e0d0'],
        [TRIPLE_IN, TRIPLE_OUT, dark ? '#cf2030' : '#1f8a3f'],
        [TRIPLE_OUT, DOUBLE_IN, dark ? '#111111' : '#e8e0d0'],
        [DOUBLE_IN, 1.0, dark ? '#cf2030' : '#1f8a3f'],
      ];
      for (const [r0, r1, fill] of rings) {
        ctx.beginPath();
        ctx.arc(c, c, R * r1, start, end);
        ctx.arc(c, c, R * r0, end, start, true);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
      const mid = start + seg / 2;
      ctx.fillStyle = '#e8e0d0';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(DART_SEGMENTS[i]), c + Math.cos(mid) * R * 0.97, c + Math.sin(mid) * R * 0.97);
    }
    ctx.beginPath();
    ctx.arc(c, c, R * BULL_R, 0, Math.PI * 2);
    ctx.fillStyle = '#1f8a3f';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c, c, R * BULLSEYE_R, 0, Math.PI * 2);
    ctx.fillStyle = '#cf2030';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,200,200,0.5)';
    ctx.lineWidth = 1.5;
    for (const r of [BULL_R, TRIPLE_IN, TRIPLE_OUT, DOUBLE_IN, 1.0]) {
      ctx.beginPath();
      ctx.arc(c, c, R * r, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/**
 * Score from board-local UV (0..1, v up). Matches `dartboardTexture` exactly:
 * same segment order, same ring fractions.
 */
export function scoreFromUV(u: number, v: number): { score: number; segment: string } {
  const dx = u - 0.5;
  const dy = v - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy) / (0.5 * (1 - RIM_PX / 256));
  if (r > 1.0) return { score: 0, segment: 'MISS' };
  if (r <= BULLSEYE_R) return { score: 50, segment: 'BULLSEYE' };
  if (r <= BULL_R) return { score: 25, segment: 'BULL' };
  // Canvas y grows downward, UV v grows upward — flip dy to get canvas angle.
  const angle = Math.atan2(-dy, dx);
  const seg = (Math.PI * 2) / 20;
  let rel = angle + Math.PI / 2 + seg / 2;
  while (rel < 0) rel += Math.PI * 2;
  while (rel >= Math.PI * 2) rel -= Math.PI * 2;
  const idx = Math.floor(rel / seg) % 20;
  const base = DART_SEGMENTS[idx];
  if (r > TRIPLE_IN && r <= TRIPLE_OUT) return { score: base * 3, segment: `TRIPLE ${base}` };
  if (r > DOUBLE_IN) return { score: base * 2, segment: `DOUBLE ${base}` };
  return { score: base, segment: `${base}` };
}
