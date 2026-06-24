/**
 * Jukebox songs. Drop your `.mp3` (or `.m4a`/AAC) files into `./songs/`
 * (src/pub/songs) and commit them — they're auto-discovered here at BUILD time
 * via Vite's glob, so there's no list to maintain. Tracks play in FILENAME
 * order, so prefix them to set the order (e.g. "01-", "02-") — the leading
 * number is stripped from the marquee name ("01-sweet-home.mp3" → "SWEET
 * HOME"). MusicSystem plays them; the pub server syncs the chosen track index
 * across the whole room.
 */

const files = import.meta.glob('./songs/*.{mp3,m4a}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export interface Track {
  name: string;
  url: string;
}

function prettyName(path: string): string {
  const base = (path.split('/').pop() ?? path)
    .replace(/\.(mp3|m4a)$/i, '')
    .replace(/^\d+[-_\s]*/, ''); // drop the ordering prefix
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase() || 'UNTITLED';
}

/** Every committed song, sorted by filename. Empty until you add files. */
export const TRACKS: Track[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url]) => ({ name: prettyName(path), url }));
