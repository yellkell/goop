/**
 * The "FIRE FIGHT" title plate — a riveted, hazard-striped steel sign
 * floating high behind the opponent's pad, robot-wars pit-lane style.
 * Visible in the lobby; hidden during a bout.
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Scene,
} from 'three';
import { ARENA_GAP } from '../config.js';
import { UI, hazardStrip, plate, stencilFont } from '../ui/industrial.js';

const W = 1024;
const H = 512;

export function createTitleBanner(scene: Scene): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Smoked-steel plate with hazard rails top and bottom.
  plate(ctx, 12, 12, W - 24, H - 24, { cut: 40, fill: 'rgba(12,13,17,0.62)', stroke: UI.amberSoft });
  hazardStrip(ctx, 52, 40, W - 104, 26, UI.amber);
  hazardStrip(ctx, 52, H - 66, W - 104, 26, UI.amber);

  // Title: stencilled steel — FIRE in molten amber, FIGHT in arc-light blue.
  const fire = ctx.createLinearGradient(0, 110, 0, 230);
  fire.addColorStop(0, '#fff3cf');
  fire.addColorStop(0.5, UI.emberBright);
  fire.addColorStop(1, UI.ember);
  ctx.font = stencilFont(128);
  ctx.fillStyle = fire;
  ctx.shadowColor = 'rgba(255,122,24,0.9)';
  ctx.shadowBlur = 30;
  ctx.fillText('FIRE', W / 2 - 190, 178);
  ctx.shadowBlur = 0;

  ctx.fillStyle = UI.text;
  ctx.shadowColor = 'rgba(79,183,255,0.8)';
  ctx.shadowBlur = 22;
  ctx.fillText('FIGHT', W / 2 + 185, 178);
  ctx.shadowBlur = 0;

  ctx.font = '700 34px system-ui, sans-serif';
  ctx.fillStyle = UI.amberSoft;
  ctx.fillText('hold trigger or grip · ball orbits your fist', W / 2, 332);
  ctx.fillText('punch to throw · hold or trigger to recall', W / 2, 392);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const material = new MeshBasicMaterial({ map: texture, transparent: true });
  const banner = new Mesh(new PlaneGeometry(2.4, 1.2), material);
  banner.name = 'title-banner';
  banner.position.set(0, 3.2, -ARENA_GAP - 1.2);
  scene.add(banner);

  // Prefer the hand-made sign art if it's been committed to public/signs/;
  // the stencil canvas above is the fallback until then.
  new TextureLoader().load(
    'signs/fire-fight.png',
    (tex) => {
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      material.map?.dispose();
      material.map = tex;
      material.needsUpdate = true;
    },
    undefined,
    () => {
      /* no PNG yet — keep the stencil banner */
    },
  );
  return banner;
}
