/**
 * The in-game name keyboard — an industrial smoked-steel plate of clickable
 * keys, raycast by the same menu pointers. It pops up ONCE per player: the
 * first time they do something that puts a name on the leaderboard (starting
 * Aim Training or queueing for multiplayer). The typed callsign is saved and
 * shared by both boards forever after.
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import { UI, hazardStrip, plate, stencilFont } from '../ui/industrial.js';

const KW = 640;
const KH = 480;
const MAX_LEN = 12;

const ROWS: string[][] = [
  [...'1234567890'],
  [...'QWERTYUIOP'],
  [...'ASDFGHJKL'],
  [...'ZXCVBNM', '-'],
];

interface KeyZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NameKeyboard {
  mesh: Mesh;
  /** Show the keyboard, prefilled (usually with the auto callsign). `prompt` is
   *  the heading line (defaults to the battle-name prompt); `maxLen` caps the
   *  entry length (defaults to the 12-char name limit). */
  open(initial: string, prompt?: string, maxLen?: number): void;
  close(): void;
  isOpen(): boolean;
  /** Map a hit UV to the key under it, or null. */
  hitTest(u: number, v: number): string | null;
  /** Apply a key press; when OK lands, returns the finished text (possibly an
   *  empty string — the caller may clear a note); otherwise null. */
  press(key: string): string | null;
  /** Update hover highlight (redraws only on change). */
  setHover(key: string | null): void;
}

export function createNameKeyboard(scene: Scene): NameKeyboard {
  const canvas = document.createElement('canvas');
  canvas.width = KW;
  canvas.height = KH;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'middle';
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(0.84, 0.63),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  mesh.name = 'name-keyboard';
  mesh.position.set(0, 1.38, -0.95);
  mesh.visible = false;
  scene.add(mesh);

  let text = '';
  let prompt = 'ENTER YOUR BATTLE NAME';
  let maxLen = MAX_LEN;
  let hover: string | null = null;
  let zones: KeyZone[] = [];

  const key = (id: string, x: number, y: number, w: number, h: number, label = id): void => {
    zones.push({ id, x, y, w, h });
    const hot = hover === id;
    plate(ctx, x, y, w, h, {
      cut: 8,
      fill: hot ? 'rgba(255,176,0,0.22)' : 'rgba(150,150,170,0.10)',
      stroke: hot ? UI.amber : UI.steelDim,
      rivets: false,
    });
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(h * 0.48)}px system-ui, sans-serif`;
    ctx.fillStyle = hot ? UI.amber : UI.text;
    ctx.fillText(label, x + w / 2, y + h / 2 + 2);
  };

  const draw = (): void => {
    zones = [];
    ctx.clearRect(0, 0, KW, KH);
    plate(ctx, 8, 8, KW - 16, KH - 16, { cut: 26, fill: 'rgba(12,13,17,0.74)', stroke: UI.amberSoft });
    hazardStrip(ctx, 40, 28, 56, 14, UI.amber);
    ctx.textAlign = 'left';
    ctx.font = stencilFont(24);
    ctx.fillStyle = UI.amberSoft;
    ctx.fillText(prompt, 112, 36);

    // The entry field, with a cursor while there's room to type. The font
    // shrinks to keep a long note on one line (a name never gets close).
    plate(ctx, 60, 62, KW - 120, 62, { cut: 12, fill: 'rgba(20,22,28,0.9)', stroke: UI.steel, rivets: false });
    ctx.textAlign = 'center';
    ctx.fillStyle = UI.text;
    const shown = text + (text.length < maxLen ? '_' : '');
    const fieldW = KW - 120 - 40;
    let fs = 40;
    ctx.font = stencilFont(fs);
    const w = ctx.measureText(shown).width;
    if (w > fieldW) {
      fs = Math.max(18, Math.floor((fs * fieldW) / w));
      ctx.font = stencilFont(fs);
    }
    ctx.fillText(shown, KW / 2, 94);

    // The key grid.
    const keyH = 56;
    const gap = 8;
    let y = 148;
    for (const row of ROWS) {
      const keyW = 52;
      const total = row.length * keyW + (row.length - 1) * gap;
      let x = (KW - total) / 2;
      for (const k of row) {
        key(k, x, y, keyW, keyH);
        x += keyW + gap;
      }
      y += keyH + gap;
    }
    // Bottom row: DEL | SPACE | OK. Spaces are valid in both a name and a note.
    key('back', 72, y, 120, keyH, 'DEL');
    key('space', 200, y, 240, keyH, 'SPACE');
    key('ok', 448, y, 120, keyH, 'OK');

    texture.needsUpdate = true;
  };

  return {
    mesh,
    open(initial, p, max) {
      maxLen = max ?? MAX_LEN;
      text = initial.slice(0, maxLen);
      prompt = p ?? 'ENTER YOUR BATTLE NAME';
      hover = null;
      mesh.visible = true;
      draw();
    },
    close() {
      mesh.visible = false;
    },
    isOpen() {
      return mesh.visible;
    },
    hitTest(u, v) {
      const px = u * KW;
      const py = (1 - v) * KH;
      for (const z of zones) {
        if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) return z.id;
      }
      return null;
    },
    press(k) {
      // OK always reports a value — even an empty one, so the caller can clear a
      // note. A non-OK key returns null (nothing finished yet).
      if (k === 'ok') return text.trim();
      if (k === 'back') {
        text = text.slice(0, -1);
      } else if (k === 'space') {
        // No leading or double spaces — they'd only get stripped on save.
        if (text.length > 0 && !text.endsWith(' ') && text.length < maxLen) text += ' ';
      } else if (text.length < maxLen) {
        text += k;
      }
      draw();
      return null;
    },
    setHover(k) {
      if (k === hover) return;
      hover = k;
      draw();
    },
  };
}
