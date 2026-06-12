/**
 * The look foundation for passthrough FIRE FIGHT.
 *
 * In an immersive-AR session the player's real room IS the backdrop, so we do
 * NOT draw a sky dome, a big floor, or volumetric shafts — those would paint
 * over the passthrough feed. What we DO ship is a PMREM-filtered
 * RoomEnvironment as `scene.environment`: an invisible studio light-box that
 * gives every standard material real structured reflections, so the dark
 * chassis steel and diamond plate read as glistening METAL instead of flat
 * grey — without a single visible backdrop pixel.
 *
 * The scene background is left transparent so passthrough shows through; if
 * the device can't do AR, IWSDK falls back to a VR session and we paint the
 * charcoal fallback colour.
 */

import { Color, type World } from '@iwsdk/core';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PALETTE } from '../config.js';

export function setupEnvironment(world: World): void {
  world.renderer.toneMappingExposure = 1.0;

  // Transparent backdrop so the AR passthrough feed shows through.
  world.scene.background = null;
  world.renderer.setClearColor(new Color(PALETTE.charcoal), 0);

  // Invisible studio reflections for the metalwork (never a visible dome).
  const pmrem = new PMREMGenerator(world.renderer);
  world.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  world.scene.environmentIntensity = 0.85;
  pmrem.dispose();
}
