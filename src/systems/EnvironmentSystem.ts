/**
 * The optional backdrops behind the arena: bare AR passthrough, the papercraft
 * DESERT, or the dark neon OLD FACTORY fight-hall. Each opaque environment is
 * built once, hidden, then shown/hidden to match the player's `app.environment`
 * choice — a render switch, not a session switch: in immersive-AR, opaque
 * geometry paints out the passthrough feed, so showing an environment (and
 * clearing the frame opaque) replaces the real room; hiding it and clearing
 * transparent again brings passthrough back. No new "Enter VR" gesture.
 *
 * The choice is keyed off a setting, so it holds across the lobby, bot bouts,
 * quick matches and Aim Training. One system owns the background swap so the
 * three states never fight over `scene.background` / clear alpha.
 */

import { createSystem } from '@iwsdk/core';
import { Color } from 'three';
import { app, type AppEnvironment } from '../menu/appState.js';
import { buildDesert, type Desert } from '../arena/desert/index.js';
import { buildFactory, type Factory } from '../arena/factory/index.js';
import { CONFIG } from '../arena/desert/config.js';

/** The factory's enclosing void colour — clear to this so the hall reads solid. */
const FACTORY_BG = 0x05060a;

export class EnvironmentSystem extends createSystem({}) {
  private desert?: Desert;
  private factory?: Factory;
  private applied: AppEnvironment | null = null;
  private time = 0;
  private skyColor = new Color(CONFIG.sky.horizon);
  private factoryColor = new Color(FACTORY_BG);

  init(): void {
    // Shadows compiled in once up front so flipping an environment on later
    // never forces a material recompile mid-session; with no sun in AR they're
    // free.
    this.world.renderer.shadowMap.enabled = true;

    this.desert = buildDesert();
    this.scene.add(this.desert.root);
    this.factory = buildFactory();
    this.scene.add(this.factory.root);
    this.apply(app.environment); // honour the saved choice on boot
  }

  update(delta: number): void {
    this.time += delta;
    if (app.environment !== this.applied) this.apply(app.environment);
    if (app.environment === 'desert') this.desert?.update(delta, this.time);
    else if (app.environment === 'factory') this.factory?.update(delta, this.time);
  }

  /** Swap the backdrop: opaque desert/factory vs transparent AR passthrough. */
  private apply(env: AppEnvironment): void {
    this.applied = env;
    if (this.desert) this.desert.root.visible = env === 'desert';
    if (this.factory) this.factory.root.visible = env === 'factory';

    const renderer = this.world.renderer;
    if (env === 'desert') {
      this.scene.background = this.skyColor;
      renderer.setClearAlpha(1);
    } else if (env === 'factory') {
      this.scene.background = this.factoryColor;
      renderer.setClearAlpha(1);
    } else {
      // Back to passthrough: transparent backdrop, transparent clear.
      this.scene.background = null;
      renderer.setClearAlpha(0);
    }
  }
}
