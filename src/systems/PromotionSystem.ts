/**
 * The promotion celebration. When the player lands back in the lobby having
 * crossed into a higher Bronze→Overlord tier, a badge medallion pops up in
 * front of them: the old emblem charges with gathering embers, bursts and
 * swaps to the new emblem in a shower of fire, holds with a pulsing glow, then
 * fades.
 *
 * XP only changes during play/training (away from the menu), so on the first
 * lobby frame we just record the current tier — no animation, which also stops
 * a cloud-sync XP load from faking a promotion. After that, any time the live
 * tier climbs above what we last showed, we play.
 */

import { createSystem } from '@iwsdk/core';
import {
  CanvasTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type Sprite,
} from 'three';
import { app } from '../menu/appState.js';
import { tierForXp } from '../menu/progression.js';
import { rankBadgeTexture } from '../menu/rankBadges.js';
import { myStats } from '../net/leaderboard.js';
import { glowSprite } from '../materials/glow.js';
import { emberBurst, spawnEmber } from '../fx/fire.js';
import { UI, stencilFont } from '../ui/industrial.js';
import * as sfx from '../audio/sfx.js';

const EMBER = 0xff7a18;
const _badgePos = new Vector3();

const CHARGE = 0.55;
const HOLD = 1.6;
const FADE = 0.8;
const TOTAL = CHARGE + HOLD + FADE;

export class PromotionSystem extends createSystem({}) {
  private group?: Group;
  private glow?: Sprite;
  private badge?: Mesh;
  private label?: Mesh;
  private labelTex?: CanvasTexture;

  private shownTier = -1;
  private animating = false;
  private t = 0;
  private to = 0;
  private swapped = false;
  private emberTimer = 0;

  update(delta: number): void {
    if (this.animating) {
      this.run(delta);
      return;
    }
    if (app.state !== 'menu') return;

    const cur = tierForXp(myStats().xp).index;
    if (this.shownTier < 0) {
      this.shownTier = cur; // first sighting — establish the baseline silently
      return;
    }
    if (cur > this.shownTier) this.start(this.shownTier, cur);
  }

  private start(from: number, to: number): void {
    this.build();
    const tex = rankBadgeTexture(from);
    const mat = this.badge!.material as MeshBasicMaterial;
    if (!tex) {
      this.shownTier = to; // art not decoded yet — skip gracefully
      return;
    }
    mat.map = tex;
    mat.opacity = 1;
    mat.needsUpdate = true;

    this.to = to;
    this.drawLabel(tierForXp(myStats().xp).name);
    this.group!.position.set(0, 1.62, -0.95);
    this.group!.scale.setScalar(0.001);
    this.group!.visible = true;
    this.t = 0;
    this.swapped = false;
    this.emberTimer = 0;
    this.animating = true;
    sfx.roundBell();
  }

  private run(delta: number): void {
    if (app.state !== 'menu') {
      this.finish();
      return;
    }
    this.t += delta;
    const g = this.group!;
    const badgeMat = this.badge!.material as MeshBasicMaterial;
    const labelMat = this.label!.material as MeshBasicMaterial;
    this.badge!.getWorldPosition(_badgePos);

    if (this.t < CHARGE) {
      const k = this.t / CHARGE;
      g.scale.setScalar(this.easeOutBack(k));
      this.glow!.material.opacity = 0.3 * k;
      labelMat.opacity = Math.max(0, k * 2 - 1);
      this.emberTimer -= delta;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.04;
        spawnEmber(_badgePos, 0.55, false);
      }
    } else if (!this.swapped) {
      this.swapped = true;
      g.scale.setScalar(1);
      const tex = rankBadgeTexture(this.to);
      if (tex) {
        badgeMat.map = tex;
        badgeMat.needsUpdate = true;
      }
      emberBurst(_badgePos, 40, false);
      emberBurst(_badgePos, 16, true);
      this.glow!.material.opacity = 1;
      sfx.matchEnd(true);
    } else if (this.t < CHARGE + HOLD) {
      g.scale.setScalar(1);
      this.glow!.material.opacity = 0.55 + 0.25 * Math.sin(this.t * 9);
      this.emberTimer -= delta;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.09;
        spawnEmber(_badgePos, 0.75, false);
      }
    } else if (this.t < TOTAL) {
      const k = (this.t - CHARGE - HOLD) / FADE;
      badgeMat.opacity = 1 - k;
      labelMat.opacity = 1 - k;
      this.glow!.material.opacity = (1 - k) * 0.5;
      g.scale.setScalar(1 + k * 0.15);
    } else {
      this.finish();
    }
  }

  private finish(): void {
    this.animating = false;
    if (this.group) this.group.visible = false;
    this.shownTier = this.to;
  }

  private build(): void {
    if (this.group) return;
    const group = new Group();
    group.name = 'promotion-fx';
    group.visible = false;

    const glow = glowSprite(EMBER, 0.95, 0);
    group.add(glow);

    const badge = new Mesh(
      new PlaneGeometry(0.34, 0.4),
      new MeshBasicMaterial({ transparent: true, opacity: 1, depthWrite: false, side: DoubleSide }),
    );
    badge.position.z = 0.002;
    group.add(badge);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const labelTex = new CanvasTexture(canvas);
    labelTex.minFilter = LinearFilter;
    const label = new Mesh(
      new PlaneGeometry(0.52, 0.1625),
      new MeshBasicMaterial({ map: labelTex, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
    );
    label.position.set(0, -0.31, 0.002);
    group.add(label);

    this.scene.add(group);
    this.group = group;
    this.glow = glow;
    this.badge = badge;
    this.label = label;
    this.labelTex = labelTex;
  }

  private drawLabel(tierName: string): void {
    const canvas = this.labelTex!.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = stencilFont(50);
    ctx.fillStyle = UI.amber;
    ctx.fillText('PROMOTED', canvas.width / 2, 44);
    ctx.font = stencilFont(58);
    ctx.fillStyle = UI.emberBright;
    ctx.fillText(tierName, canvas.width / 2, 112);
    this.labelTex!.needsUpdate = true;
  }

  private easeOutBack(k: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  }
}
