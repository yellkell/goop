/**
 * Western set-dressing in papercraft (ported from yellkell/vrenv): a leaning
 * signpost, a sun-bleached cattle skull and a broken fence — just enough story.
 */

import { BoxGeometry, ConeGeometry, CylinderGeometry, type Group as GroupT, Group, IcosahedronGeometry, Mesh } from 'three';
import { CONFIG } from './config.js';
import { makePaper } from './paper.js';
import { desertHeight } from './terrain.js';

const P = CONFIG.palette;

function signpost(): Group {
  const g = new Group();
  const wood = makePaper(P.wood, 0.98);
  const post = new Mesh(new BoxGeometry(0.14, 2.2, 0.14), wood);
  post.position.y = 1.1;
  const board = new Mesh(new BoxGeometry(1.4, 0.4, 0.08), makePaper('#9c6a3e', 0.98));
  board.position.set(0.25, 1.8, 0);
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
