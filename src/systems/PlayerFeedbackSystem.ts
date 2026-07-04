/**
 * Player damage feedback: a subtle, DIRECTIONAL red glow at the edge of view,
 * pointing toward where the hit came from, that quickly fades. Head-locked
 * and alpha-blended; it never moves you — purely a visual cue. Rim-barrier
 * drain points the glow downward (at your feet — get back on the platform).
 */

import { createSystem, CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from '@iwsdk/core';
import { feedback } from '../fx/feedback.js';

const S = 256;

export class PlayerFeedbackSystem extends createSystem({}) {
  private ctx?: CanvasRenderingContext2D;
  private tex?: CanvasTexture;
  private mat?: MeshBasicMaterial;
  private _q = new Quaternion();
  private _v = new Vector3();
  private t = 0;

  init(): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    this.ctx = canvas.getContext('2d')!;
    this.tex = new CanvasTexture(canvas);
    this.mat = new MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const plane = new Mesh(new PlaneGeometry(2.8, 2.1), this.mat);
    plane.position.set(0, 0, -0.6); // just in front of the eyes
    plane.renderOrder = 999;
    plane.name = 'player-hit-vignette';
    const head = this.playerHeadEntity?.object3D;
    if (head) head.add(plane);
    else this.scene.add(plane);
  }

  update(delta: number): void {
    this.t += delta;
    feedback.playerHitFlash = Math.max(0, feedback.playerHitFlash - delta * 2.6);
    feedback.boundaryBuzz = Math.max(0, feedback.boundaryBuzz - delta * 1.8);
    const f = Math.max(feedback.playerHitFlash, feedback.boundaryBuzz);
    if (!this.mat) return;
    if (f <= 0) {
      this.mat.opacity = 0;
      return;
    }

    if (feedback.boundaryBuzz > feedback.playerHitFlash * 0.65) {
      this.drawBoundaryBuzz(feedback.boundaryBuzz);
      this.mat.opacity = Math.min(0.78, 0.28 + feedback.boundaryBuzz * 0.5);
      return;
    }

    // World incoming direction → head-local.
    const head = this.playerHeadEntity?.object3D;
    this._v.set(feedback.srcX, feedback.srcY, feedback.srcZ);
    if (head) {
      head.getWorldQuaternion(this._q).invert();
      this._v.applyQuaternion(this._q);
    }
    const theta = Math.atan2(this._v.x, -this._v.z); // 0 = front, + = right
    const behind = -this._v.z < 0;

    this.drawGlow(theta, behind);
    this.mat.opacity = f * 0.42;
  }

  private drawBoundaryBuzz(f: number): void {
    const ctx = this.ctx!;
    ctx.clearRect(0, 0, S, S);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 34);
    const g = ctx.createRadialGradient(S / 2, S * 0.78, S * 0.08, S / 2, S * 0.62, S * 0.72);
    g.addColorStop(0, `rgba(255,190,70,${0.45 + f * 0.25})`);
    g.addColorStop(0.42, `rgba(232,45,25,${0.36 + pulse * 0.16})`);
    g.addColorStop(1, 'rgba(120,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    ctx.strokeStyle = `rgba(255,55,32,${0.25 + f * 0.28})`;
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, S - 12, S - 12);
    ctx.lineWidth = 2;
    for (let y = 18 + ((this.t * 90) % 18); y < S; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(S, y - 22);
      ctx.stroke();
    }

    ctx.fillStyle = `rgba(0,0,0,${0.16 + pulse * 0.08})`;
    for (let y = 0; y < S; y += 9) ctx.fillRect(0, y, S, 3);
    this.tex!.needsUpdate = true;
  }

  private drawGlow(theta: number, behind: boolean): void {
    const ctx = this.ctx!;
    ctx.clearRect(0, 0, S, S);
    const lateral = Math.max(-1, Math.min(1, Math.sin(theta)));
    const cx = S / 2 + lateral * S * 0.46;
    const cy = behind ? S * 0.9 : S * 0.5;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.55);
    g.addColorStop(0, 'rgba(235,60,30,0.85)');
    g.addColorStop(0.5, 'rgba(225,40,25,0.35)');
    g.addColorStop(1, 'rgba(220,30,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    this.tex!.needsUpdate = true;
  }
}
