/**
 * The optional papercraft DESERT arena (ported from yellkell/vrenv). Builds the
 * whole environment once, hidden, then shows or hides it to match the player's
 * `app.environment` choice — a toggle that holds across the lobby, bot bouts,
 * quick matches and Aim Training because it's keyed off a setting, not the
 * match state.
 *
 * AR ↔ desert is a render switch, not a session switch: in immersive-AR opaque
 * geometry replaces the passthrough feed, so showing the desert's opaque sky
 * dome (and clearing the frame opaque) paints the real room out; hiding it and
 * clearing transparent again brings passthrough back. No new "Enter VR" gesture.
 */

import { createSystem } from '@iwsdk/core';
import { Color } from 'three';
import { app } from '../menu/appState.js';
import { buildDesert, type Desert } from '../arena/desert/index.js';
import { CONFIG } from '../arena/desert/config.js';

export class DesertSystem extends createSystem({}) {
  private desert?: Desert;
  private applied: 'ar' | 'desert' | null = null;
  private time = 0;
  private skyColor = new Color(CONFIG.sky.horizon);

  init(): void {
    // Shadows compiled in once up front so flipping the desert on later never
    // forces a material recompile mid-session; with no sun in AR they're free.
    this.world.renderer.shadowMap.enabled = true;

    this.desert = buildDesert();
    this.scene.add(this.desert.root);
    this.apply(app.environment); // honour the saved choice on boot
  }

  update(delta: number): void {
    this.time += delta;
    if (app.environment !== this.applied) this.apply(app.environment);
    if (app.environment === 'desert') this.desert?.update(delta, this.time);
  }

  /** Swap the backdrop: opaque desert vs transparent AR passthrough. */
  private apply(env: 'ar' | 'desert'): void {
    this.applied = env;
    const desert = env === 'desert';
    if (this.desert) this.desert.root.visible = desert;

    const renderer = this.world.renderer;
    if (desert) {
      // Opaque sky so passthrough is fully painted out behind the dunes.
      this.scene.background = this.skyColor;
      renderer.setClearAlpha(1);
    } else {
      // Back to passthrough: transparent backdrop, transparent clear.
      this.scene.background = null;
      renderer.setClearAlpha(0);
    }
  }
}
