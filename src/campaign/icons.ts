/**
 * Bespoke 2D icons for the five ARCADE titans — hand-drawn canvas glyphs in
 * each machine's signature accent, used on the campaign sub-menu cards (and
 * anywhere else a titan needs a face at postage-stamp size):
 *
 *   0 RUSTHOOK      — a scrapyard crane hook
 *   1 PISTONKAISER  — a drop-forge piston hammer
 *   2 VULTURE    — an executioner's crosshair
 *   3 JUGGERNAUT    — a riveted fortress shield
 *   4 GOLIATH       — the king's crown
 *
 * Every glyph is drawn inside a circle of radius `r` centred on (cx, cy),
 * stroked in `color` — pass a dimmed colour for locked stages.
 */

export function drawBossIcon(
  ctx: CanvasRenderingContext2D,
  stage: number,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r / 50, r / 50); // glyphs are authored on a ±50 grid
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (stage) {
    case 0: {
      // RUSTHOOK: hanging eye, shank, and the big open J-hook with a point.
      ctx.beginPath();
      ctx.arc(0, -36, 10, 0, Math.PI * 2); // the eye
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(0, -4); // shank
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-2, 16, 22, -Math.PI / 2, Math.PI * 0.82); // the hook belly
      ctx.stroke();
      // The tip barb.
      ctx.beginPath();
      ctx.moveTo(-21, 27);
      ctx.lineTo(-13, 10);
      ctx.stroke();
      break;
    }
    case 1: {
      // PISTONKAISER: a piston hammer — wide head block, rod, flared base.
      ctx.fillRect(-32, -42, 64, 22); // hammer head
      ctx.fillRect(-7, -20, 14, 34); // rod
      ctx.fillRect(-22, 14, 44, 10); // guide collar
      ctx.fillRect(-30, 32, 60, 10); // base plate
      // Steam ticks off the head.
      ctx.lineWidth = 6;
      for (const sx of [-40, 40]) {
        ctx.beginPath();
        ctx.moveTo(sx, -36);
        ctx.lineTo(sx * 1.2, -46);
        ctx.stroke();
      }
      break;
    }
    case 2: {
      // VULTURE: crosshair — ring, four ticks, kill dot.
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.stroke();
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        ctx.beginPath();
        ctx.moveTo(dx * 22, dy * 22);
        ctx.lineTo(dx * 44, dy * 44);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 3: {
      // JUGGERNAUT: fortress shield — chamfered plate, keel, three rivets.
      ctx.beginPath();
      ctx.moveTo(-34, -34);
      ctx.lineTo(34, -34);
      ctx.lineTo(34, 6);
      ctx.lineTo(0, 42);
      ctx.lineTo(-34, 6);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(0, 42); // centre keel
      ctx.stroke();
      ctx.lineWidth = 0;
      for (const [bx, by] of [[-19, -18], [19, -18], [0, 14]] as const) {
        ctx.beginPath();
        ctx.arc(bx, by, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default: {
      // GOLIATH: the crown — band, three spikes, jewel studs.
      ctx.beginPath();
      ctx.moveTo(-36, 26);
      ctx.lineTo(-36, -10);
      ctx.lineTo(-18, 8);
      ctx.lineTo(0, -34);
      ctx.lineTo(18, 8);
      ctx.lineTo(36, -10);
      ctx.lineTo(36, 26);
      ctx.closePath();
      ctx.stroke();
      ctx.fillRect(-36, 30, 72, 10); // the band
      for (const bx of [-22, 0, 22]) {
        ctx.beginPath();
        ctx.arc(bx, 18, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}
