/**
 * The bolt-dollar currency symbol (src/assets/currency/coin.png) — a riveted
 * mechanical "$". Vite bundles the PNG to a hashed URL; we kick the image load
 * off on import and hand canvas panels the decoded <img> once it's ready
 * (panels redraw on a cadence, so they pick it up the moment it lands).
 *
 * Used by the lobby coin HUD, the platform shop, and the pub wrist tags.
 */

import coinUrl from '../assets/currency/coin.png?url';

const img = new Image();
img.src = coinUrl;

/** The decoded coin symbol, or null until it finishes loading. */
export function coinImage(): HTMLImageElement | null {
  return img.complete && img.naturalWidth > 0 ? img : null;
}
