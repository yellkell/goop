/**
 * Your boxing gloves: a glove locked to each controller grip whenever you're
 * in the arena (bout or training). The accent glow follows the hue you pick
 * on the lobby's GLOVE ACCENT slider. They squeeze down slightly when you
 * grip, and hide in the lobby so the menu lasers read clearly.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import type { Group } from 'three';
import { buildGlove, GLOVE_VISUAL_SCALE, setAvatarAccent } from '../avatar/boxer.js';
import { hueToColor } from '../config.js';
import { app } from '../menu/appState.js';

const HANDS = ['left', 'right'] as const;

export class PlayerGloveSystem extends createSystem({}) {
  private gloves: Partial<Record<'left' | 'right', Group>> = {};
  private accentHue = Number.NaN;

  update(delta: number): void {
    const show = app.state === 'playing' || app.state === 'training';
    // Recolour the neon when the slider moves — cheap material tweak, no rebuild.
    const recolour = this.accentHue !== app.accentHue;
    const accent = hueToColor(app.accentHue);
    for (const hand of HANDS) {
      const grip = this.world.playerSpaceEntities.gripSpaces[hand]?.object3D;
      if (!grip) continue;

      let glove = this.gloves[hand];
      if (!glove) {
        glove = buildGlove(0, accent);
        glove.name = `player-glove-${hand}`;
        grip.add(glove);
        this.gloves[hand] = glove;
      } else if (recolour) {
        setAvatarAccent(glove, accent);
      }
      glove.visible = show;
      if (!show) continue;

      // A little squash while squeezing — feels grippy without physics.
      const squeezing = this.input.xr.gamepads[hand]?.getButtonPressed(InputComponent.Squeeze) ?? false;
      const target = GLOVE_VISUAL_SCALE * (squeezing ? 0.88 : 1);
      const s = glove.scale.x + (target - glove.scale.x) * Math.min(1, delta * 14);
      glove.scale.setScalar(s);
    }
    this.accentHue = app.accentHue;
  }
}
