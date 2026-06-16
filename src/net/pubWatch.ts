/**
 * Live "how many are in the pub" count for the lobby's PUB door — the warm
 * mirror of the 1V1 panel's searcher count.
 *
 * The pub WS server (server/pub.mjs) reports its headcount on its plain HTTP
 * status route (`{ punters }`, CORS-open), so unlike the Firebase-backed queue
 * watch we just poll that endpoint on a slow cadence while the lobby is on
 * screen and stop the moment we leave. Unreachable → −1 (badge hides).
 */

import { pubServerUrl } from '../pub/config.js';

const POLL_MS = 8000;
const TIMEOUT_MS = 5000;

type CountListener = (count: number) => void;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

/** The pub server's HTTP origin (ws→http, wss→https); its root returns status. */
function statusUrl(): string {
  return pubServerUrl().replace(/^ws/, 'http');
}

async function poll(onCount: CountListener): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(statusUrl(), { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) {
      onCount(-1);
      return;
    }
    const data = (await res.json()) as { punters?: number };
    onCount(typeof data.punters === 'number' ? data.punters : -1);
  } catch {
    onCount(-1); // server unreachable — leave the count unknown
  } finally {
    clearTimeout(to);
    inFlight = false;
  }
}

/** Begin polling the pub headcount, reporting it to `onCount`. No-op if already
 *  watching. An immediate read fires so the badge isn't blank for the first poll. */
export function startPubWatch(onCount: CountListener): void {
  if (timer) return;
  void poll(onCount);
  timer = setInterval(() => void poll(onCount), POLL_MS);
}

/** Stop polling (leaving the lobby). Safe to call when not watching. */
export function stopPubWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
