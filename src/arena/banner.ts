/**
 * The "IRON BALLS BOXING" title banner — a canvas-drawn fight poster floating
 * high behind the opponent's pad. Visible in the lobby; hidden during a bout.
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import { ARENA_GAP } from '../config.js';

const W = 1024;
const H = 512;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createTitleBanner(scene: Scene): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Charcoal fight-poster backdrop with an ember glow at the bottom.
  roundRect(ctx, 12, 12, W - 24, H - 24, 42);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(22,24,32,0.94)');
  bg.addColorStop(1, 'rgba(38,22,12,0.94)');
  ctx.fillStyle = bg;
  ctx.fill();
  const emberGlow = ctx.createRadialGradient(W / 2, H * 1.1, 40, W / 2, H * 1.1, W * 0.7);
  emberGlow.addColorStop(0, 'rgba(255,122,24,0.5)');
  emberGlow.addColorStop(1, 'rgba(255,122,24,0)');
  ctx.save();
  roundRect(ctx, 12, 12, W - 24, H - 24, 42);
  ctx.clip();
  ctx.fillStyle = emberGlow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  roundRect(ctx, 12, 12, W - 24, H - 24, 42);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,160,60,0.85)';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Two crossed fireballs: orange (you) vs blue (them).
  for (const [cx, hue] of [[W * 0.16, 'rgba(255,140,30,'], [W * 0.84, 'rgba(80,180,255,']] as const) {
    const ball = ctx.createRadialGradient(cx, 140, 4, cx, 140, 60);
    ball.addColorStop(0, `${hue}1)`);
    ball.addColorStop(0.5, `${hue}0.55)`);
    ball.addColorStop(1, `${hue}0)`);
    ctx.fillStyle = ball;
    ctx.beginPath();
    ctx.arc(cx, 140, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2c36';
    ctx.beginPath();
    ctx.arc(cx, 140, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  // Title with a molten gradient.
  const fire = ctx.createLinearGradient(0, 90, 0, 220);
  fire.addColorStop(0, '#fff3cf');
  fire.addColorStop(0.5, '#ffc04d');
  fire.addColorStop(1, '#ff7a18');
  ctx.font = '900 132px system-ui, sans-serif';
  ctx.fillStyle = fire;
  ctx.shadowColor = 'rgba(255,122,24,0.9)';
  ctx.shadowBlur = 34;
  ctx.fillText('FIRE', W / 2 - 190, 170);
  ctx.shadowBlur = 0;

  ctx.font = '900 132px system-ui, sans-serif';
  ctx.fillStyle = '#f4f6fb';
  ctx.shadowColor = 'rgba(79,183,255,0.8)';
  ctx.shadowBlur = 24;
  ctx.fillText('FIGHT', W / 2 + 180, 170);
  ctx.shadowBlur = 0;

  ctx.font = '700 40px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,220,170,0.85)';
  ctx.fillText('flaming-fist duels at a distance', W / 2, 268);

  ctx.font = '700 36px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,200,140,0.9)';
  ctx.fillText('hold trigger · ball orbits your fist', W / 2, 380);
  ctx.fillText('punch to throw · trigger to recall', W / 2, 432);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const banner = new Mesh(
    new PlaneGeometry(2.4, 1.2),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  banner.name = 'title-banner';
  banner.position.set(0, 2.5, -ARENA_GAP - 1.2);
  scene.add(banner);
  return banner;
}
