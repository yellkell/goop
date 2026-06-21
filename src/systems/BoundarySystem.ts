/**
 * The platform rim barrier — your guardian. Eight translucent grid walls
 * stand around the octagon rim; they're invisible until your head drifts
 * toward the edge, then the nearby panels glow awake (exactly like the
 * room-scale boundary). Lean your head OUT past the rim and the arena's fire
 * eats your health fast — get back on your platform.
 *
 * Runs in bouts AND in Aim Training (your platform is always your platform).
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
  AdditiveBlending,
} from 'three';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { feedback } from '../fx/feedback.js';
import { app, training } from '../menu/appState.js';
import { match } from '../combat/matchState.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';
import { BOUNDARY, OCTAGON_VERTICES, PALETTE } from '../config.js';

interface Edge {
  ax: number; az: number; // segment start
  bx: number; bz: number; // segment end
  nx: number; nz: number; // outward normal (unit)
  len: number;
  mesh: Mesh;
  mat: MeshBasicMaterial;
  glow: number; // smoothed 0..1
}

/** Soft grid texture for the barrier panels (drawn once). */
function gridTexture(): CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * S;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

const _head = new Vector3();

export class BoundarySystem extends createSystem({
  combatants: { required: [Combatant, Health] },
}) {
  private edges: Edge[] = [];
  private group = new Group();
  private wasOutside = false;
  private drainTick = 0;

  init(): void {
    this.group.name = 'rim-barrier';
    const tex = gridTexture();

    const n = OCTAGON_VERTICES.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = OCTAGON_VERTICES[i];
      const [bx, bz] = OCTAGON_VERTICES[(i + 1) % n];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      // Vertices wind clockwise (viewed from above), so (-dz, dx) faces out.
      let nx = -dz / len;
      let nz = dx / len;
      const midx = (ax + bx) / 2;
      const midz = (az + bz) / 2;
      if (nx * midx + nz * midz < 0) {
        nx = -nx;
        nz = -nz;
      }

      const mat = new MeshBasicMaterial({
        map: tex,
        color: PALETTE.ember,
        transparent: true,
        opacity: 0,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      mat.map!.repeat.set(Math.max(1, Math.round(len * 3)), Math.round(BOUNDARY.wallHeight * 3));
      const mesh = new Mesh(new PlaneGeometry(len, BOUNDARY.wallHeight), mat);
      mesh.position.set(midx, BOUNDARY.wallHeight / 2, midz);
      mesh.rotation.y = -Math.atan2(dz, dx); // local +X runs along the edge
      this.group.add(mesh);

      this.edges.push({ ax, az, bx, bz, nx, nz, len, mesh, mat, glow: 0 });
    }
    this.scene.add(this.group);
  }

  update(delta: number): void {
    const active = app.state === 'playing' || app.state === 'training';
    this.group.visible = active;
    if (!active) {
      this.wasOutside = false;
      return;
    }

    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    headObj.getWorldPosition(_head);

    // Signed distance to the rim: max over edges of distance past each edge
    // (positive = outside). For a convex octagon this is exact enough.
    let worst = -Infinity;
    for (const e of this.edges) {
      const d = (_head.x - e.ax) * e.nx + (_head.z - e.az) * e.nz;
      worst = Math.max(worst, d);

      // Per-panel glow by proximity to that edge segment.
      const along = this.alongFactor(e, _head.x, _head.z);
      const near = d > -BOUNDARY.warnDistance && along;
      const target = near ? Math.min(1, 1 + d / BOUNDARY.warnDistance) * 0.65 + 0.1 : 0;
      e.glow += (target - e.glow) * Math.min(1, delta * 8);
      e.mat.opacity = e.glow;
    }

    const outside = worst > BOUNDARY.graceDepth;
    const damaging = outside && this.canDamage();
    if (damaging) {
      // Everything burns red and your health drains, fast.
      for (const e of this.edges) e.mat.color.setHex(PALETTE.danger);
      feedback.boundaryBuzz = Math.max(feedback.boundaryBuzz, 0.72);
      this.drainTick += delta;
      if (this.drainTick >= 0.2) {
        this.drainTick = 0;
        this.drain(BOUNDARY.drainPerSec * 0.2);
        feedback.playerHitFlash = Math.max(feedback.playerHitFlash, 1);
        feedback.boundaryBuzz = 1;
        feedback.srcX = 0; feedback.srcY = -1; feedback.srcZ = 0;
        sfx.boundaryBuzz(1);
        pulseHand(this.world.session, 'left', 0.75, 140);
        pulseHand(this.world.session, 'right', 0.75, 140);
      }
      if (!this.wasOutside) sfx.boundaryBuzz(1);
    } else {
      for (const e of this.edges) e.mat.color.setHex(PALETTE.ember);
      this.drainTick = 0;
    }
    this.wasOutside = damaging;
  }

  /** True if the head projects onto this edge segment (with a little slack). */
  private alongFactor(e: Edge, x: number, z: number): boolean {
    const tx = (x - e.ax) * (e.bx - e.ax) + (z - e.az) * (e.bz - e.az);
    const t = tx / (e.len * e.len);
    return t > -0.2 && t < 1.2;
  }

  /** Drain the LOCAL player only (slot 0) — the rim barrier is driven by your
   *  own head crossing your own platform, so a 2v2 ally is never docked here. */
  private drain(amount: number): void {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? 0) !== 0) continue;
      const next = Math.max(0, (e.getValue(Health, 'current') ?? 0) - amount);
      e.setValue(Health, 'current', next);
    }
  }

  private canDamage(): boolean {
    return (app.state === 'playing' && match.phase === 'playing')
      || (app.state === 'training' && training.active && training.timeLeft > 0);
  }
}
