/**
 * Match-verdict art — the hand-made neon-metal KNOCKOUT / WIN plates
 * (src/assets/verdict) that replace the stencilled verdict text on the centre
 * scoreboard. Same load-and-decode pattern as the countdown art: Vite bundles
 * each PNG to a hashed URL, the images decode on import, and the scoreboard
 * gets the right plate for a verdict once it's ready (null until then, or for
 * a verdict with no art). Only the *winner* ever sees a plate — there is no
 * loser-side KO'D plate; a knockout loss shows nothing at all.
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

/** Map a centre-board verdict to its art key, or null if it has none. WIN art
 *  covers both a round win and the match-clinching YOU WIN. There is no KO'D
 *  art — a knockout loss is suppressed upstream, so it never reaches here. */
function keyFor(message: string): string | null {
  if (message === 'KO') return 'ko';
  if (message === 'WIN' || message === 'YOU WIN') return 'win';
  return null;
}

/** The decoded verdict plate for a message, or null if there's no art for it
 *  or it hasn't decoded yet. */
export function verdictArt(message: string): HTMLImageElement | null {
  const key = keyFor(message);
  if (!key) return null;
  const img = images[key];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
