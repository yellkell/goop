/**
 * ARCADE HUD — the campaign bout's boards, in the same smoked-glass
 * industrial language as the duel scoreboards and hung in the same places
 * players already know: YOUR board left (ember), the TITAN's board right
 * (its signature accent), and a big centre card for the intro titles,
 * FIGHT flash, payout and defeat lines.
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
import { UI, hazardStrip, plate, segmentBar, stencilFont } from './industrial.js';

const W = 880;
const H = 420;

interface Board {
  mesh: Mesh;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
}

export interface CampaignHud {
  setVisible(v: boolean): void;
  /** Redraw the two side boards. `accent` is the titan's CSS colour. */
  updateBoards(opts: {
    stageLabel: string;
    bossName: string;
    accent: string;
    bossHp: number;
    bossMax: number;
    playerHp: number;
    playerMax: number;
    coreOpen: boolean;
    hint: string;
    /** The gauntlet-run clock (empty outside runs). */
    timer: string;
  }): void;
  /** Big centre card: headline + up to three sub lines. Empty title clears. */
  showCard(title: string, lines: string[], accent?: string): void;
}

function makeBoard(wMeters: number, hMeters: number): Board {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'middle';
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(wMeters, hMeters),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  return { mesh, ctx, tex };
}

function header(ctx: CanvasRenderingContext2D, title: string, neon: string, right = ''): void {
  ctx.clearRect(0, 0, W, H);
  hazardStrip(ctx, 32, 38, 64, 22, UI.amber);
  ctx.textAlign = 'left';
  ctx.font = stencilFont(54);
  ctx.fillStyle = neon;
  ctx.fillText(title, 116, 54);
  if (right) {
    ctx.textAlign = 'right';
    ctx.font = stencilFont(44);
    ctx.fillStyle = UI.textDim;
    ctx.fillText(right, W - 36, 54);
  }
  ctx.strokeStyle = neon;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(32, 96);
  ctx.lineTo(W - 32, 96);
  ctx.stroke();
}

export function createCampaignHud(scene: Scene): CampaignHud {
  const group = new Group();
  group.name = 'campaign-hud';

  const left = makeBoard(1.5, 0.72); // YOU
  left.mesh.position.set(-1.85, 1.95, -ARENA_GAP * 0.52);
  left.mesh.rotation.y = 0.62;
  const right = makeBoard(1.5, 0.72); // THE TITAN
  right.mesh.position.set(1.85, 1.95, -ARENA_GAP * 0.52);
  right.mesh.rotation.y = -0.62;
  const centre = makeBoard(2.3, 1.1);
  centre.mesh.position.set(0, 2.5, -ARENA_GAP * 0.55);

  group.add(left.mesh, right.mesh, centre.mesh);
  group.visible = false;
  scene.add(group);

  return {
    setVisible(v) {
      group.visible = v;
    },

    updateBoards({ stageLabel, bossName, accent, bossHp, bossMax, playerHp, playerMax, coreOpen, hint, timer }) {
      // The titan's board: name, its accent, big red-line health.
      {
        const { ctx, tex } = right;
        header(ctx, bossName, accent, stageLabel);
        plate(ctx, 28, 124, W - 56, 110, { cut: 16, fill: UI.ink, rivets: false });
        segmentBar(ctx, 52, 148, W - 104, 60, bossHp / bossMax, accent);
        ctx.textAlign = 'left';
        ctx.font = stencilFont(40);
        if (coreOpen) {
          ctx.fillStyle = UI.danger;
          ctx.fillText('CORE EXPOSED — HIT IT', 52, 308);
        } else {
          ctx.fillStyle = UI.steelDim;
          ctx.fillText('CORE SHUTTERED', 52, 308);
        }
        ctx.textAlign = 'right';
        ctx.font = stencilFont(48);
        ctx.fillStyle = UI.textDim;
        ctx.fillText(String(Math.ceil(bossHp)), W - 40, 308);
        tex.needsUpdate = true;
      }
      // Your board: health, the survival hint, and the run clock in runs.
      {
        const { ctx, tex } = left;
        header(ctx, 'YOU', UI.emberBright, timer);
        plate(ctx, 28, 124, W - 56, 110, { cut: 16, fill: UI.ink, rivets: false });
        segmentBar(ctx, 52, 148, W - 104, 60, playerHp / playerMax, UI.emberBright);
        ctx.textAlign = 'left';
        ctx.font = '700 34px system-ui, sans-serif';
        ctx.fillStyle = UI.amberSoft;
        ctx.fillText(hint, 52, 308);
        ctx.textAlign = 'right';
        ctx.font = stencilFont(48);
        ctx.fillStyle = UI.textDim;
        ctx.fillText(String(Math.ceil(playerHp)), W - 40, 308);
        tex.needsUpdate = true;
      }
    },

    showCard(title, lines, accent = UI.emberBright) {
      const { ctx, tex } = centre;
      ctx.clearRect(0, 0, W, H);
      if (title) {
        plate(ctx, 40, 60, W - 80, 300, { cut: 30, fill: UI.inkDeep, stroke: UI.amberSoft });
        hazardStrip(ctx, 58, 74, 70, 18, UI.amber);
        hazardStrip(ctx, W - 128, 74, 70, 18, UI.amber);
        ctx.textAlign = 'center';
        ctx.font = stencilFont(84);
        const grad = ctx.createLinearGradient(0, 90, 0, 220);
        grad.addColorStop(0, '#fff3cf');
        grad.addColorStop(1, accent);
        ctx.fillStyle = grad;
        ctx.fillText(title, W / 2, 158);
        ctx.font = '700 36px system-ui, sans-serif';
        lines.slice(0, 3).forEach((line, i) => {
          ctx.fillStyle = i === 0 ? UI.text : UI.textDim;
          ctx.fillText(line, W / 2, 232 + i * 50);
        });
      }
      tex.needsUpdate = true;
    },
  };
}
