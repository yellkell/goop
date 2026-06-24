/**
 * The optional opaque ARENA BACKDROPS — the papercraft DESERT and the
 * dilapidated FACTORY (both ported/built in the spirit of yellkell/vrenv).
 * Builds each once, hidden, then shows the one matching `app.environment`
 * ('ar' | 'desert' | 'factory') — a toggle that holds across the lobby, bot
 * bouts, quick matches and Aim Training because it's keyed off a setting.
 *
 * AR ↔ backdrop is a render switch, not a session switch: in immersive-AR
 * opaque geometry replaces the passthrough feed, so showing an opaque sky dome
 * (and clearing the frame opaque) paints the real room out; hiding it and
 * clearing transparent again brings passthrough back. No new "Enter VR" gesture.
 */

import { createSystem } from '@iwsdk/core';
import { Color } from 'three';
import { app, type AppEnvironment } from '../menu/appState.js';
import { buildDesert, type Desert } from '../arena/desert/index.js';
import { buildFactory, type Factory } from '../arena/factory/index.js';
import { CONFIG } from '../arena/desert/config.js';

export class DesertSystem extends createSystem({}) {
  private desert?: Desert;
  private factory?: Factory;
  private applied: AppEnvironment | null = null;
  private time = 0;
  private desertSky = new Color(CONFIG.sky.horizon);

  init(): void {
    // Shadows compiled in once up front so flipping a backdrop on later never
    // forces a material recompile mid-session; with no sun in AR they're free.
    this.world.renderer.shadowMap.enabled = true;
    // Nothing that casts a shadow ever MOVES (only the static desert props do),
    // so the shadow map is identical every frame — render it once per backdrop
    // change instead of every frame. A real GPU saving with no visible change.
    this.world.renderer.shadowMap.autoUpdate = false;

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

  /** Swap the backdrop: an opaque desert/factory dome vs transparent AR passthrough. */
  private apply(env: AppEnvironment): void {
    this.applied = env;
    if (this.desert) this.desert.root.visible = env === 'desert';
    if (this.factory) this.factory.root.visible = env === 'factory';
    // Re-bake the (otherwise frozen) shadow map once to reflect the new backdrop.
    this.world.renderer.shadowMap.needsUpdate = true;

    const renderer = this.world.renderer;
    if (env === 'ar') {
      // Back to passthrough: transparent backdrop, transparent clear.
      this.scene.background = null;
      renderer.setClearAlpha(0);
    } else {
      // Opaque sky so passthrough is fully painted out behind the scene.
      this.scene.background = env === 'factory' && this.factory ? this.factory.skyColor : this.desertSky;
      renderer.setClearAlpha(1);
    }
  }
}
