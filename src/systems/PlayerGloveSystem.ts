/**
 * Your boxing gloves: an ember-orange glove locked to each controller grip
 * whenever you're in the arena (bout or training). They squeeze down slightly
 * when you grip, and hide in the lobby so the menu lasers read clearly.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import type { Group } from 'three';
import { buildGlove } from '../avatar/boxer.js';
import { app } from '../menu/appState.js';

const HANDS = ['left', 'right'] as const;

export class PlayerGloveSystem extends createSystem({}) {
  private gloves: Partial<Record<'left' | 'right', Group>> = {};

  update(delta: number): void {
    const show = app.state === 'playing' || app.state === 'training';
    for (const hand of HANDS) {
      const grip = this.world.playerSpaceEntities.gripSpaces[hand]?.object3D;
      if (!grip) continue;

      let glove = this.gloves[hand];
      if (!glove) {
        glove = buildGlove(0);
        glove.name = `player-glove-${hand}`;
        grip.add(glove);
        this.gloves[hand] = glove;
      }
      glove.visible = show;
      if (!show) continue;

      // A little squash while squeezing — feels grippy without physics.
      const squeezing = this.input.xr.gamepads[hand]?.getButtonPressed(InputComponent.Squeeze) ?? false;
      const target = squeezing ? 0.88 : 1;
      const s = glove.scale.x + (target - glove.scale.x) * Math.min(1, delta * 14);
      glove.scale.setScalar(s);
    }
  }
}
