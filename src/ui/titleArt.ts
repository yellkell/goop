/**
 * The GOOP wordmark — the dripping-slime title banner (src/assets/ui) that
 * stands in for the plain green "GOOP" text on the menu, the wall board and
 * the creature's name plate. Vite bundles the PNG to a hashed URL; we kick
 * the load on import and hand callers the decoded image once it's ready
 * (they fall back to text until then, and redraw via onTitleReady).
 */

import titleUrl from '../assets/ui/goop-title.png?url';

const img = new Image();
let ready = false;
const waiters: Array<() => void> = [];

img.onload = () => {
  ready = true;
  for (const cb of waiters) cb();
  waiters.length = 0;
};
img.src = titleUrl;

/** The decoded banner, or null until it's loaded (draw text meanwhile). */
export function titleImage(): HTMLImageElement | null {
  return ready && img.naturalWidth > 0 ? img : null;
}

/** Run `cb` once the banner has decoded (immediately if already loaded) —
 *  surfaces use this to redraw the instant the wordmark is available. */
export function onTitleReady(cb: () => void): void {
  if (ready) cb();
  else waiters.push(cb);
}

/** Draw the banner centred on (cx, top), fitted to `maxW`×`maxH`. No-op /
 *  returns false if the art isn't decoded yet so the caller can fall back. */
export function drawTitle(
  g: CanvasRenderingContext2D,
  cx: number,
  top: number,
  maxW: number,
  maxH: number,
): boolean {
  const art = titleImage();
  if (!art) return false;
  const s = Math.min(maxW / art.width, maxH / art.height);
  const w = art.width * s;
  const h = art.height * s;
  g.drawImage(art, cx - w / 2, top, w, h);
  return true;
}
