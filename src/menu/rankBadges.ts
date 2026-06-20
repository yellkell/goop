/**
 * The Bronze→Overlord rank-badge art (src/assets/ranks/00-bronze.png …
 * 08-overlord.png). Vite bundles each PNG to a hashed URL; we kick off the
 * image loads on import and hand the lobby the right emblem for a tier index.
 * `rankBadge` returns an image only once decoded, so canvas panels draw it the
 * moment it's ready and skip it before then (the lobby redraws on a cadence).
 */

import { SRGBColorSpace, Texture } from 'three';

const modules = import.meta.glob('../assets/ranks/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

// Filenames are zero-padded (00…08), so a plain sort is tier order.
const urls = Object.keys(modules)
  .sort()
  .map((k) => modules[k]);

const images = urls.map((url) => {
  const img = new Image();
  img.src = url;
  return img;
});

/** The decoded badge for a tier index (0 = Bronze), or null until it loads. */
export function rankBadge(index: number): HTMLImageElement | null {
  const img = images[index];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

const texCache: Array<Texture | null> = images.map(() => null);

/** The badge as a Three texture (for the 3D promotion FX), or null until loaded. */
export function rankBadgeTexture(index: number): Texture | null {
  const img = rankBadge(index);
  if (!img) return null;
  let tex = texCache[index];
  if (!tex) {
    tex = new Texture(img);
    tex.colorSpace = SRGBColorSpace;
    tex.needsUpdate = true;
    texCache[index] = tex;
  }
  return tex;
}
