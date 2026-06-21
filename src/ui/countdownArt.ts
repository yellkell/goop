/**
 * The pre-round countdown art — hand-made neon-metal "3 / 2 / 1 / FIGHT"
 * plates (src/assets/countdown) that replace the programmatically stencilled
 * numbers on the centre scoreboard. Vite bundles each PNG to a hashed URL; we
 * kick the image loads on import and hand the scoreboard the right plate for a
 * countdown beat, returning it only once decoded so the canvas draws it the
 * instant it's ready and falls back to text until then.
 */

const modules = import.meta.glob('../assets/countdown/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const images: Partial<Record<string, HTMLImageElement>> = {};
for (const [path, url] of Object.entries(modules)) {
  const stem = (path.split('/').pop() ?? '').replace(/\.png$/i, '');
  const img = new Image();
  img.src = url;
  images[stem] = img;
}

/** Map a centre-board message to its countdown art key, or null if it has none. */
function keyFor(message: string): string | null {
  if (message === '1' || message === '2' || message === '3') return message;
  if (message === 'FIGHT') return 'fight';
  return null;
}

/** The decoded countdown plate for a message (3/2/1/FIGHT), or null if there's
 *  no art for it or it hasn't decoded yet. */
export function countdownArt(message: string): HTMLImageElement | null {
  const key = keyFor(message);
  if (!key) return null;
  const img = images[key];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
