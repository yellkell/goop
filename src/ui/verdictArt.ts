/**
 * End-of-bout verdict plates (WIN / KO / TIME / DRAW) — the hand-made art
 * harvested from FIRE FIGHT (src/assets/verdict), loaded the same way as the
 * countdown plates: kicked at import, handed over only once decoded.
 */

const modules = import.meta.glob('../assets/verdict/*.png', {
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

/** The decoded plate for a verdict key (win/ko/time/draw), or null. */
export function verdictArt(key: string): HTMLImageElement | null {
  const img = images[key];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
