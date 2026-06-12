/**
 * The shared 2D-canvas drawing kit for FIRE FIGHT's industrial fight-club
 * look: 90s UK robot-wars — gritty plate steel, chamfered corners, rivets,
 * hazard-amber striping, stencilled headline type. Everything translucent:
 * panels are smoked glass over your passthrough room, not opaque billboards.
 *
 * Used by the lobby menu, the match scoreboards and the title banner so the
 * whole game speaks one visual language.
 */

export const UI = {
  ink: 'rgba(5,6,9,0.68)', // smoked-glass backplate — near-black glass
  inkDeep: 'rgba(4,5,8,0.88)', // behind headline text
  steel: 'rgba(172,182,198,0.55)', // panel edge
  steelDim: 'rgba(172,182,198,0.22)',
  amber: '#ffb000',
  amberSoft: 'rgba(255,176,0,0.8)',
  ember: '#ff7a18',
  emberBright: '#ffc04d',
  cool: '#4fb7ff',
  coolBright: '#9fe2ff',
  text: '#e8ecf2',
  textDim: 'rgba(232,236,242,0.72)',
  danger: '#e8352a',
};

/** Heavy industrial type. Set per call — canvas state is shared. */
export function stencilFont(px: number): string {
  return `900 ${px}px 'Arial Black', 'Arial Narrow', system-ui, sans-serif`;
}

/** A rectangle with cut (chamfered) corners — the panel silhouette. */
export function chamferPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, cut: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

interface PlateOpts {
  cut?: number;
  fill?: string;
  stroke?: string;
  rivets?: boolean;
}

/**
 * A smoked-steel plate: chamfered, NEON-edged, corner rivets. The outline is
 * drawn twice — a soft glow pass under a crisp core — so every plate edge
 * reads as lit tubing against the dark glass.
 */
export function plate(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  opts: PlateOpts = {},
): void {
  const { cut = 22, fill = UI.ink, stroke = UI.steel, rivets = true } = opts;
  chamferPath(ctx, x, y, w, h, cut);
  ctx.fillStyle = fill;
  ctx.fill();
  chamferPath(ctx, x, y, w, h, cut);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = stroke;
  ctx.shadowColor = stroke;
  ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.stroke(); // crisp core over the glow
  if (rivets) {
    ctx.fillStyle = UI.steelDim;
    const inset = cut * 0.85;
    for (const [rx, ry] of [
      [x + inset, y + inset], [x + w - inset, y + inset],
      [x + inset, y + h - inset], [x + w - inset, y + h - inset],
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Diagonal hazard striping clipped to a bar — wear it sparingly. */
export function hazardStrip(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  color = UI.amber,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(16,17,21,0.8)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  const step = h * 1.6;
  for (let sx = x - h * 2; sx < x + w + h; sx += step * 2) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + h, y);
    ctx.lineTo(sx + h + step, y);
    ctx.lineTo(sx + step, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A chunky segmented readout bar (skewed LED blocks) — health, charge.
 * Far more robot-wars than a smooth gradient pill.
 */
export function segmentBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  frac: number,
  color: string,
): void {
  const f = Math.max(0, Math.min(1, frac));
  const skew = h * 0.35;
  const gap = 5;
  const count = 18;
  const segW = (w - skew - gap * (count - 1)) / count;
  const lit = Math.round(f * count);
  for (let i = 0; i < count; i++) {
    const sx = x + i * (segW + gap);
    ctx.beginPath();
    ctx.moveTo(sx + skew, y);
    ctx.lineTo(sx + segW + skew, y);
    ctx.lineTo(sx + segW, y + h);
    ctx.lineTo(sx, y + h);
    ctx.closePath();
    if (i < lit) {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 13;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = UI.steelDim;
      ctx.stroke();
    }
  }
}

/** A small chamfered industrial button plate with a stencilled label. */
export function buttonPlate(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
  accent: string,
  hot: boolean,
): void {
  plate(ctx, x, y, w, h, {
    cut: 14,
    fill: hot ? 'rgba(16,18,24,0.9)' : 'rgba(9,10,14,0.8)',
    stroke: hot ? accent : UI.steel,
    rivets: false,
  });
  // Accent keying notch on the left edge — always neon.
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  ctx.fillStyle = accent;
  ctx.fillRect(x + 6, y + h * 0.25, 5, h * 0.5);
  ctx.shadowBlur = 0;
  ctx.font = stencilFont(Math.round(h * 0.4));
  ctx.textAlign = 'center';
  ctx.fillStyle = hot ? accent : UI.text;
  if (hot) {
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
  }
  ctx.fillText(label.toUpperCase(), x + w / 2, y + h / 2 + 2);
  ctx.shadowBlur = 0;
}
