/**
 * Procedural emblems for the shop / locker tiles — so a skin reads as a picture,
 * not just a word. Avatars get an animal silhouette (the metallic-animal head
 * each skin's name comes from) and the KNIGHT a heraldic shield; platforms get
 * a little octagon pad swatch painted in their colours. All drawn into a canvas
 * 2D context, sized around a centre (cx, cy) and radius r.
 */

import type { PlatformSkin } from '../avatar/skins.js';

function hex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** The avatar emblem for a skin id, filled in `color`. */
export function drawAvatarIcon(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  switch (id) {
    case 'cobalt':
      drawBear(ctx, cx, cy, r);
      break;
    case 'valkyrie':
      drawEagle(ctx, cx, cy, r);
      break;
    case 'knight':
      drawShield(ctx, cx, cy, r);
      break;
    case 'crimson':
    default:
      drawPanther(ctx, cx, cy, r);
      break;
  }
  ctx.restore();
}

/** Bear head: round skull, two round ears, a paler muzzle bump. */
function drawBear(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx - r * 0.62, cy - r * 0.58, r * 0.34, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.62, cy - r * 0.58, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.04, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  // Muzzle, knocked out a touch darker so the snout reads.
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#06070b';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.42, r * 0.3, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.32, r * 0.1, 0, Math.PI * 2); // nose
  ctx.fill();
}

/** Panther head: sleek skull with two pointed ears + a notched chin. */
function drawPanther(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  // Left ear.
  ctx.moveTo(cx - r * 0.72, cy - r * 0.1);
  ctx.lineTo(cx - r * 0.5, cy - r * 0.98);
  ctx.lineTo(cx - r * 0.08, cy - r * 0.5);
  // Right ear.
  ctx.lineTo(cx + r * 0.08, cy - r * 0.5);
  ctx.lineTo(cx + r * 0.5, cy - r * 0.98);
  ctx.lineTo(cx + r * 0.72, cy - r * 0.1);
  ctx.closePath();
  ctx.fill();
  // Jaw.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.72, cy - r * 0.2);
  ctx.quadraticCurveTo(cx - r * 0.7, cy + r * 0.55, cx, cy + r * 0.95);
  ctx.quadraticCurveTo(cx + r * 0.7, cy + r * 0.55, cx + r * 0.72, cy - r * 0.2);
  ctx.closePath();
  ctx.fill();
  // Eyes carved out.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#06070b';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * r * 0.18, cy - r * 0.02);
    ctx.lineTo(cx + s * r * 0.46, cy - r * 0.12);
    ctx.lineTo(cx + s * r * 0.22, cy + r * 0.12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Eagle: a head between two swept, spread wings. */
function drawEagle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.1);
    ctx.quadraticCurveTo(cx + s * r * 1.05, cy - r * 0.7, cx + s * r * 1.08, cy + r * 0.18);
    ctx.quadraticCurveTo(cx + s * r * 0.7, cy - r * 0.02, cx + s * r * 0.22, cy + r * 0.34);
    ctx.closePath();
    ctx.fill();
  }
  // Body.
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.1, r * 0.18, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Head + hooked beak.
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.52, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.04, cy - r * 0.58);
  ctx.lineTo(cx - r * 0.3, cy - r * 0.46);
  ctx.lineTo(cx - r * 0.04, cy - r * 0.4);
  ctx.closePath();
  ctx.fill();
}

/** Knight: a heraldic shield with a struck cross. */
function drawShield(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const w = r * 0.82;
  const top = cy - r * 0.92;
  const h = r * 1.82;
  ctx.beginPath();
  ctx.moveTo(cx - w, top);
  ctx.lineTo(cx + w, top);
  ctx.lineTo(cx + w, top + h * 0.42);
  ctx.quadraticCurveTo(cx + w, top + h * 0.82, cx, top + h);
  ctx.quadraticCurveTo(cx - w, top + h * 0.82, cx - w, top + h * 0.42);
  ctx.closePath();
  ctx.fill();
  // Cross knocked through it.
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#06070b';
  const bar = r * 0.2;
  ctx.fillRect(cx - bar / 2, top + r * 0.18, bar, h * 0.62);
  ctx.fillRect(cx - w * 0.62, cy - bar / 2, w * 1.24, bar);
  ctx.restore();
}

/** A platform's emblem: a little octagon pad in its colours (slab fill if it has
 *  a premium tint, else the neon), rimmed in the neon. */
export function drawPlatformIcon(ctx: CanvasRenderingContext2D, skin: PlatformSkin, cx: number, cy: number, r: number): void {
  const fill = skin.slab !== undefined ? skin.slab : skin.neon;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = hex(fill);
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.strokeStyle = hex(skin.neon);
  ctx.shadowColor = hex(skin.neon);
  ctx.shadowBlur = r * 0.5;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // The XD pad wears its grin even at thumbnail size.
  if (skin.id === 'xdface') {
    ctx.fillStyle = '#f4f6fb';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(r * 0.7)}px system-ui, sans-serif`;
    ctx.fillText('XD', cx, cy + r * 0.04);
  }
  ctx.restore();
}
