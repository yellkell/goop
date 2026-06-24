/**
 * Western set-dressing in papercraft (ported from yellkell/vrenv): a leaning
 * signpost, a sun-bleached cattle skull and a broken fence — just enough story.
 */

import { BoxGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, type Group as GroupT, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial } from 'three';
import { CONFIG } from './config.js';
import { makePaper } from './paper.js';
import { desertHeight } from './terrain.js';

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
  // Weathered plank base + a little grain and a routed dark border.
  ctx.fillStyle = '#9c6a3e';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#5a3a20';
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    const y = (i + 0.5) * (H / 7);
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(i) * 4);
    ctx.lineTo(W, y - Math.sin(i) * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#4a2f1a';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, W - 12, H - 12);

  // "GASKET" in black, stencilled bold, hard against the left so it clears the
  // arrow. Measure it so the arrow always starts past the last letter.
  ctx.fillStyle = '#141008';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = "800 96px 'Arial Narrow', Impact, system-ui, sans-serif";
  const tx = 30;
  ctx.fillText('GASKET', tx, H / 2 + 2);
  const textEnd = tx + ctx.measureText('GASKET').width;

  // A fat arrow pointing right, with a clear gap after the word.
  const sx = Math.min(textEnd + 44, W - 150);
  const ex = W - 26;
  const cy = H / 2 + 2;
  ctx.strokeStyle = '#141008';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, cy);
  ctx.lineTo(ex - 24, cy);
  ctx.stroke();
  ctx.fillStyle = '#141008';
  ctx.beginPath();
  ctx.moveTo(ex, cy);
  ctx.lineTo(ex - 48, cy - 36);
  ctx.lineTo(ex - 48, cy + 36);
  ctx.closePath();
  ctx.fill();

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
  const place = (g: Group, x: number, z: number, ry: number): void => {
    g.position.set(x, desertHeight(x, z), z);
    g.rotateY(ry);
    parent.add(g);
  };
  place(signpost(), 4.5, -5, -0.5);
  place(skull(), -3.2, -3.5, 0.8);
  place(fence(), -7, 6, 0.3);
}
