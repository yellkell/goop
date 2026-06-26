/**
 * Western set-dressing in papercraft (ported from yellkell/vrenv): a leaning
 * signpost, a sun-bleached cattle skull and a broken fence — just enough story.
 */

import { BoxGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, type Group as GroupT, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial } from 'three';
import { CONFIG } from './config.js';
import { makePaper } from './paper.js';
import { desertHeight } from './terrain.js';
import { collapseStatic } from '../merge.js';

const P = CONFIG.palette;

/** A painted directional sign face: weathered board with black "GASKET" and a
 *  big arrow pointing the way — the Gasket Gazette's home town, thataway. */
function gasketSignTexture(): CanvasTexture {
  const W = 600;
  const H = 170;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  let seed = 9;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // A real WOODEN plank: a warm vertical tone gradient, long horizontal grain
  // streaks running the length of the board (wavy, varied tones), and a couple
  // of knots — so it reads unmistakably as wood, not a flat tan card.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#aa7642');
  grad.addColorStop(0.5, '#996737');
  grad.addColorStop(1, '#85572f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 30; i++) {
    const y = rnd() * H;
    ctx.strokeStyle = rnd() < 0.5 ? '#754c2a' : '#b48150';
    ctx.globalAlpha = 0.08 + rnd() * 0.16;
    ctx.lineWidth = 1 + rnd() * 2.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    const seg = 6;
    for (let s = 1; s <= seg; s++) {
      ctx.lineTo((W * s) / seg, y + Math.sin(s * 1.2 + i) * (2.5 + rnd() * 5));
    }
    ctx.stroke();
  }
  // Knots, kept to the corners so they never sit under the lettering.
  for (const [kx, ky] of [
    [W * 0.1, H * 0.78],
    [W * 0.9, H * 0.26],
  ]) {
    for (let ring = 11; ring > 1; ring -= 3) {
      ctx.strokeStyle = '#5a3a20';
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(kx, ky, ring, ring * 0.68, 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#3a2415';
    ctx.beginPath();
    ctx.ellipse(kx, ky, 3, 2, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Routed dark border frame.
  ctx.strokeStyle = '#4a2f1a';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, W - 12, H - 12);

  // "Gasket" hand-PAINTED: a casual script with each letter nudged, tilted and
  // resized a touch off a fixed seed, brush-edged (fill + soft round stroke), so
  // it reads as daubed on by hand rather than typeset. Measure as we go so the
  // arrow always starts clear of the last letter.
  const word = 'Gasket';
  ctx.fillStyle = '#141008';
  ctx.strokeStyle = '#141008';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const baseY = H / 2 + 4;
  let x = 40;
  for (const ch of word) {
    const px = 86 + Math.round((rnd() - 0.5) * 14); // slightly uneven sizes
    ctx.font = `italic 700 ${px}px 'Brush Script MT', 'Segoe Script', 'Comic Sans MS', cursive`;
    const w = ctx.measureText(ch).width;
    ctx.save();
    ctx.translate(x + w / 2, baseY + (rnd() - 0.5) * 12);
    ctx.rotate((rnd() - 0.5) * 0.16); // hand-tilt each glyph
    ctx.fillText(ch, 0, 0);
    ctx.strokeText(ch, 0, 0); // brushy edge thickening
    ctx.restore();
    x += w + 4 + (rnd() - 0.5) * 6;
  }
  const textEnd = x;

  // A hand-drawn arrow pointing right: a slightly bowed shaft + a rough head.
  const sx = Math.min(textEnd + 30, W - 140);
  const ex = W - 26;
  const cy = H / 2 + 6;
  ctx.lineCap = 'round';
  ctx.lineWidth = 15;
  ctx.beginPath();
  ctx.moveTo(sx, cy + 4);
  ctx.quadraticCurveTo((sx + ex) / 2, cy - 8, ex - 20, cy); // gentle bow
  ctx.stroke();
  // Two strokes for the head, drawn like a quick hand flick (not a filled wedge).
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(ex, cy);
  ctx.lineTo(ex - 44, cy - 30);
  ctx.moveTo(ex, cy);
  ctx.lineTo(ex - 40, cy + 34);
  ctx.stroke();

  const tex = new CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function signpost(): Group {
  const g = new Group();
  const wood = makePaper(P.wood, 0.98);
  // The post stands BEHIND the board (negative z) so it never crosses the
  // painted face — it used to sit in front and hide the first letters.
  const post = new Mesh(new BoxGeometry(0.14, 2.2, 0.14), wood);
  post.position.set(-0.05, 1.1, -0.12);
  const board = new Mesh(
    new BoxGeometry(1.5, 0.42, 0.07),
    new MeshStandardMaterial({ map: gasketSignTexture(), roughness: 0.95, metalness: 0 }),
  );
  board.position.set(0.32, 1.8, 0);
  board.rotation.z = -0.06;
  g.add(post, board);
  g.rotation.z = 0.05;
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function skull(): Group {
  const g = new Group();
  const bone = makePaper(P.bone, 0.95);
  const cranium = new Mesh(new IcosahedronGeometry(0.28, 0), bone);
  cranium.scale.set(1, 0.8, 1.1);
  cranium.position.y = 0.24;
  const snout = new Mesh(new BoxGeometry(0.22, 0.18, 0.3), bone);
  snout.position.set(0, 0.16, 0.28);
  g.add(cranium, snout);
  for (const side of [-1, 1]) {
    const horn = new Mesh(new ConeGeometry(0.06, 0.5, 6), bone);
    horn.position.set(side * 0.28, 0.34, -0.05);
    horn.rotation.z = side * 1.2;
    g.add(horn);
  }
  for (const side of [-1, 1]) {
    const socket = new Mesh(new IcosahedronGeometry(0.07, 0), makePaper('#3a2c1d', 1));
    socket.position.set(side * 0.12, 0.26, 0.22);
    g.add(socket);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function fence(): Group {
  const g = new Group();
  const wood = makePaper(P.wood, 0.98);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const post = new Mesh(new CylinderGeometry(0.07, 0.08, 1.3, 6), wood);
    post.position.set(i * 1.3, 0.55 - (i === 2 ? 0.3 : 0), 0);
    post.rotation.z = i === 2 ? 0.4 : (Math.random() - 0.5) * 0.08;
    g.add(post);
    if (i < n - 1 && i !== 1) {
      for (const y of [0.5, 0.95]) {
        const rail = new Mesh(new BoxGeometry(1.3, 0.07, 0.05), wood);
        rail.position.set(i * 1.3 + 0.65, y, 0);
        g.add(rail);
      }
    }
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export function buildProps(parent: GroupT): void {
  // Set-dressing is static; collapse it (the wood across the signpost and fence
  // shares one material, so it merges) — the painted sign keeps its own texture.
  const group = new Group();
  const place = (g: Group, x: number, z: number, ry: number): void => {
    g.position.set(x, desertHeight(x, z), z);
    g.rotateY(ry);
    group.add(g);
  };
  place(signpost(), 4.5, -5, -0.5);
  place(skull(), -3.2, -3.5, 0.8);
  place(fence(), -7, 6, 0.3);
  collapseStatic(group);
  parent.add(group);
}
