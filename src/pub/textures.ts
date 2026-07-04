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

/** Stained wood with plank seams + grain streaks — booth/table timber. */
export function woodTexture(base = '#6b4526', repeat: [number, number] = [2, 1]): CanvasTexture {
  return makeCanvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      // Long grain streaks.
      for (let i = 0; i < 140; i++) {
        const y = Math.random() * s;
        const dark = Math.random() < 0.5;
        ctx.strokeStyle = dark ? 'rgba(0,0,0,0.10)' : 'rgba(255,210,160,0.06)';
        ctx.lineWidth = 0.5 + Math.random() * 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.33, y + (Math.random() - 0.5) * 6, s * 0.66, y + (Math.random() - 0.5) * 6, s, y + (Math.random() - 0.5) * 4);
        ctx.stroke();
      }
      // Plank seams every quarter.
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 2;
      for (let p = 1; p < 4; p++) {
        ctx.beginPath();
        ctx.moveTo(0, (p * s) / 4);
        ctx.lineTo(s, (p * s) / 4);
        ctx.stroke();
      }
    },
    repeat,
  );
}

/** Tufted upholstery — a fine woven speckle over a flat colour. */
export function fabricTexture(base = '#4e1f2d', repeat: [number, number] = [3, 1]): CanvasTexture {
  return makeCanvasTexture(
    128,
    (ctx, s) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      // Cross-hatch weave.
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      for (let i = 0; i < s; i += 3) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      for (let i = 0; i < 600; i++) ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1);
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
 * The house board: a big, readable bullseye target with traditional pub-board
 * colours, but still simple radius scoring: 50 / 20 / 10 / 5 / 1 from the
 * centre out. No 25 circle, no regulation segment arithmetic.
 */
const RINGS: Array<{ r: number; score: number; fills: [string, string] }> = [
  { r: 0.07, score: 50, fills: ['#b91526', '#b91526'] }, // bullseye
  { r: 0.33, score: 20, fills: ['#181713', '#eadfc8'] },
  { r: 0.58, score: 10, fills: ['#eadfc8', '#181713'] },
  { r: 0.78, score: 5, fills: ['#b91526', '#147a3d'] },
  { r: 1.0, score: 1, fills: ['#147a3d', '#b91526'] },
];
const SEGMENTS = 20;
const RIM_PX = 6; // dead rim pixels on the 512 canvas

export function dartboardTexture(): CanvasTexture {
  return makeCanvasTexture(512, (ctx, s) => {
    const c = s / 2;
    const R = s / 2 - RIM_PX;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, s, s);
    // Paint outside-in bands. Wedges are visual only; scoring stays radius-
    // based so the board remains readable in VR.
    for (let i = RINGS.length - 1; i >= 0; i--) {
      const inner = i === 0 ? 0 : RINGS[i - 1].r;
      const outer = RINGS[i].r;
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const a0 = -Math.PI / 2 + (seg / SEGMENTS) * Math.PI * 2;
        const a1 = -Math.PI / 2 + ((seg + 1) / SEGMENTS) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(c, c, R * outer, a0, a1);
        if (inner > 0) ctx.arc(c, c, R * inner, a1, a0, true);
        else ctx.lineTo(c, c);
        ctx.closePath();
        ctx.fillStyle = RINGS[i].fills[seg % 2];
        ctx.fill();
      }
    }

    ctx.strokeStyle = 'rgba(235,226,205,0.32)';
    ctx.lineWidth = 1.2;
    for (let seg = 0; seg < SEGMENTS; seg++) {
      const a = -Math.PI / 2 + (seg / SEGMENTS) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(16,16,16,0.85)';
    ctx.lineWidth = 3;
    for (const ring of RINGS) {
      ctx.beginPath();
      ctx.arc(c, c, R * ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#24201a';
    ctx.lineWidth = 8;
    ctx.stroke();
    // Ring values printed straight onto the bands (skip the tiny bullseye).
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 1; i < RINGS.length; i++) {
      const mid = (RINGS[i - 1].r + RINGS[i].r) / 2;
      ctx.font = `bold ${i === 1 ? 22 : 30}px sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#0b0b0b';
      ctx.fillStyle = '#f4ead3';
      for (const ang of [-Math.PI / 2, Math.PI / 2, 0, Math.PI]) {
        const x = c + Math.cos(ang) * R * mid;
        const y = c + Math.sin(ang) * R * mid;
        ctx.strokeText(String(RINGS[i].score), x, y);
        ctx.fillText(String(RINGS[i].score), x, y);
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
