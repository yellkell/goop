/**
 * ARCADE HUD — floating text and bare bars, no plates. The campaign speaks
 * in as few words as possible:
 *
 *  - the titan's NAME (and the run clock) floating over the gap, with a
 *    slim segmented health bar under it — dark-souls style;
 *  - YOUR health as one small ember bar low in front of you;
 *  - a big centre TITLE for the beats (WARNING · the name reveal · FIGHT ·
 *    TITAN FELLED · SCRAPPED), one optional sub-line, nothing else.
 *
 * Everything is a transparent canvas texture — glowing stencil type floating
 * over your passthrough room, not a billboard.
 */

import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import { ARENA_GAP } from '../config.js';
import { UI, segmentBar, stencilFont } from './industrial.js';

interface TextPlane {
  mesh: Mesh;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
  w: number;
  h: number;
  /** What's currently drawn, so identical redraw calls cost nothing. */
  key: string;
}

export interface CampaignHud {
  setVisible(v: boolean): void;
  /** The floating nameplate: titan name + optional run clock. */
  setBoss(name: string, accent: string, clock: string): void;
  /** The two bare bars (fractions 0..1). Boss bar wears the accent. */
  setBars(bossFrac: number, playerFrac: number, accent: string): void;
  /** Big centre beat: title + one optional sub-line. Empty title clears. */
  title(text: string, sub: string, accent?: string): void;
}

/** Set the stencil font at `px`, shrinking until `text` fits `maxW`. */
function fitStencil(ctx: CanvasRenderingContext2D, text: string, px: number, maxW: number): void {
  let size = px;
  ctx.font = stencilFont(size);
  while (size > 24 && ctx.measureText(text).width > maxW) {
    size -= 4;
    ctx.font = stencilFont(size);
  }
}

function makeText(scene: Scene, w: number, h: number, meters: number): TextPlane {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(meters, meters * (h / w)),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 50;
  scene.add(mesh);
  return { mesh, ctx, tex, w, h, key: '' };
}

export function createCampaignHud(scene: Scene): CampaignHud {
  const group = new Group();
  group.name = 'campaign-hud';

  // Nameplate + boss bar float over the gap, under the titan's chin height.
  const name = makeText(scene, 1024, 128, 1.7);
  name.mesh.position.set(0, 2.42, -ARENA_GAP * 0.72);
  const bossBar = makeText(scene, 768, 44, 1.35);
  bossBar.mesh.position.set(0, 2.26, -ARENA_GAP * 0.72);

  // Your bar: small, low, tilted up at you — a glance down, not a board.
  const playerBar = makeText(scene, 512, 40, 0.62);
  playerBar.mesh.position.set(0, 0.98, -1.1);
  playerBar.mesh.rotation.x = -0.55;

  // The centre beat text, big and unmissable, mid-gap at eye height.
  const centre = makeText(scene, 1024, 300, 2.1);
  centre.mesh.position.set(0, 1.9, -ARENA_GAP * 0.6);

  // makeText parents to the scene; re-parent under the group so one
  // visibility flag rules them all.
  for (const t of [name, bossBar, playerBar, centre]) group.add(t.mesh);
  group.visible = false;
  scene.add(group);

  return {
    setVisible(v) {
      group.visible = v;
    },

    setBoss(bossName, accent, clock) {
      const key = `${bossName}|${accent}|${clock}`;
      if (key === name.key) return;
      name.key = key;
      const { ctx, w, h } = name;
      ctx.clearRect(0, 0, w, h);
      fitStencil(ctx, bossName, 64, w - 60);
      ctx.fillStyle = accent;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 26;
      ctx.fillText(bossName, w / 2, h / 2 - (clock ? 14 : 0));
      ctx.shadowBlur = 0;
      if (clock) {
        ctx.font = '700 34px system-ui, sans-serif';
        ctx.fillStyle = UI.text;
        ctx.fillText(clock, w / 2, h - 24);
      }
      name.tex.needsUpdate = true;
    },

    setBars(bossFrac, playerFrac, accent) {
      // Quantise so tiny per-frame drips don't force canvas uploads.
      const key = `${Math.round(bossFrac * 200)}|${accent}`;
      if (key !== bossBar.key) {
        bossBar.key = key;
        const { ctx, w, h } = bossBar;
        ctx.clearRect(0, 0, w, h);
        segmentBar(ctx, 2, 6, w - 4, h - 12, bossFrac, accent);
        bossBar.tex.needsUpdate = true;
      }
      const pkey = String(Math.round(playerFrac * 200));
      if (pkey !== playerBar.key) {
        playerBar.key = pkey;
        const { ctx, w, h } = playerBar;
        ctx.clearRect(0, 0, w, h);
        segmentBar(ctx, 2, 6, w - 4, h - 12, playerFrac, UI.emberBright);
        playerBar.tex.needsUpdate = true;
      }
    },

    title(text, sub, accent = UI.emberBright) {
      const key = `${text}|${sub}|${accent}`;
      if (key === centre.key) return;
      centre.key = key;
      const { ctx, w, h } = centre;
      ctx.clearRect(0, 0, w, h);
      if (text) {
        fitStencil(ctx, text, 120, w - 80);
        const grad = ctx.createLinearGradient(0, h / 2 - 70, 0, h / 2 + 70);
        grad.addColorStop(0, '#fff3cf');
        grad.addColorStop(1, accent);
        ctx.fillStyle = grad;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 34;
        ctx.fillText(text, w / 2, h / 2 - (sub ? 30 : 0));
        ctx.shadowBlur = 0;
        if (sub) {
          ctx.font = '700 44px system-ui, sans-serif';
          ctx.fillStyle = UI.text;
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 10;
          ctx.fillText(sub, w / 2, h / 2 + 78);
          ctx.shadowBlur = 0;
        }
      }
      centre.tex.needsUpdate = true;
    },
  };
}
