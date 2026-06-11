/**
 * The look foundation for passthrough Iron Balls Boxing.
 *
 * In an immersive-AR session the player's real room IS the backdrop, so we do
 * NOT draw a sky dome, a big floor, or volumetric shafts — those would paint
 * over the passthrough feed. We keep neutral tone mapping plus a soft
 * warm-vs-cool image-based light so the iron, gloves and fire pick up gentle
 * tints (cool slate above, ember warmth below).
 *
 * The scene background is left transparent so passthrough shows through; if
 * the device can't do AR, IWSDK falls back to a VR session and we paint the
 * charcoal fallback colour.
 */

import { Color, IBLGradient, type World } from '@iwsdk/core';
import { PALETTE } from '../config.js';

/** hex → [r,g,b,a] in 0..1 for Types.Color component fields. */
function rgba(hex: number, a = 1): [number, number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b, a];
}

export function setupEnvironment(world: World): void {
  world.renderer.toneMappingExposure = 1.0;

  // Transparent backdrop so the AR passthrough feed shows through.
  world.scene.background = null;
  world.renderer.setClearColor(new Color(PALETTE.charcoal), 0);

  // Cool slate sky, warm ember ground — lighting only, never a visible dome.
  const env = world.createTransformEntity(undefined, { persistent: true });
  env.addComponent(IBLGradient, {
    sky: rgba(0xaebbd0),
    equator: rgba(0xf2ede4),
    ground: rgba(0xffb46a),
    intensity: 1.05,
  });
}
