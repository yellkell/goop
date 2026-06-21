/**
 * Live "how many are in the pub" count for the lobby's PUB door — the warm
 * mirror of the 1V1 panel's searcher count.
 *
 * The pub WS server (server/pub.mjs) reports its headcount on its plain HTTP
 * status route (`{ punters }`, CORS-open), so unlike the Firebase-backed queue
 * watch we just poll that endpoint on a slow cadence while the lobby is on
 * screen and stop the moment we leave. Unreachable → −1 (badge hides).
 */

import { PUB_REGIONS } from '../pub/config.js';

const POLL_MS = 8000;
const TIMEOUT_MS = 5000;

/** Per-region punter counts, keyed by region id (−1 = that region unreachable). */
type CountsListener = (counts: Record<string, number>) => void;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

/** One region's HTTP origin (ws→http, wss→https); its root returns status. */
function statusUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws/, 'http');
}

async function pollRegion(wsUrl: string): Promise<number> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(statusUrl(wsUrl), { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return -1;
    const data = (await res.json()) as { punters?: number };
    return typeof data.punters === 'number' ? data.punters : -1;
  } catch {
    return -1; // region unreachable — leave its count unknown
  } finally {
    clearTimeout(to);
  }
}

async function pollAll(onCounts: CountsListener): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const entries = await Promise.all(
      PUB_REGIONS.map(async (r) => [r.id, await pollRegion(r.url)] as const),
    );
    onCounts(Object.fromEntries(entries));
  } finally {
    inFlight = false;
  }
}

/** Begin polling every region's headcount, reporting them to `onCounts`. No-op
 *  if already watching. An immediate read fires so the door isn't blank first. */
export function startPubWatch(onCounts: CountsListener): void {
  if (timer) return;
  void pollAll(onCounts);
  timer = setInterval(() => void pollAll(onCounts), POLL_MS);
}

/** Stop polling (leaving the lobby). Safe to call when not watching. */
export function stopPubWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
