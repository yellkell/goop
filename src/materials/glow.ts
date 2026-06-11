/**
 * Additive "glow" toolkit — a bloom-like look without full-screen
 * post-processing (fragile/expensive in stereo WebXR). Everything renders
 * additively with depthWrite off, so hot cores bleed soft halos.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Sprite,
  SpriteMaterial,
  type ColorRepresentation,
  type Texture,
} from 'three';

let _glowTex: Texture | undefined;

/** A soft radial falloff texture (white core → transparent edge), cached. */
export function glowTexture(): Texture {
  if (_glowTex) return _glowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _glowTex = new CanvasTexture(canvas);
  return _glowTex;
}

/** A camera-facing additive glow halo. */
export function glowSprite(color: ColorRepresentation, size: number, opacity = 1): Sprite {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      color: new Color(color),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      opacity,
    }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}
