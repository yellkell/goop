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
    feedback.playerHitFlash = Math.max(0, feedback.playerHitFlash - delta * 2.6);
    const f = feedback.playerHitFlash;
    if (!this.mat) return;
    if (f <= 0) {
      this.mat.opacity = 0;
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
