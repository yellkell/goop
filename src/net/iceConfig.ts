/**
 * ICE server configuration for every peer-to-peer transport (1v1 duel, the
 * private-code lobby, and the 2v2/FFA/raid mesh).
 *
 * STUN alone lets two peers discover their public address, but it can't punch
 * through a symmetric NAT, a strict corporate/school firewall, a VPN, or
 * carrier-grade NAT (mobile hotspots). Those players used to hang forever at
 * "loading"/"joining" because the direct path never formed. A TURN server
 * RELAYS the media when a direct path is impossible — the difference between
 * "works on friendly networks" and "works for everyone".
 *
 * TURN credentials come from Metered (https://metered.ca). Fill in the two
 * identifiers below; both are CLIENT-SIDE ids (like the Firebase apiKey here),
 * rate-limited and domain-restrictable in the Metered dashboard, so shipping
 * them in the bundle is expected. We fetch FRESH, rotating credentials from
 * Metered's API at startup and cache them; if it's unconfigured or the fetch
 * fails, we fall back to STUN-only (today's behaviour — no regression).
 *
 *   METERED_SUBDOMAIN — your app subdomain, e.g. 'ironballs' for the account
 *                       whose relay lives at ironballs.metered.live.
 *   METERED_API_KEY   — the "API Key" on that app's dashboard page.
 */

const METERED_SUBDOMAIN = 'firefight'; // firefight.metered.live
const METERED_API_KEY = 'c515a1719a26b14df71020c53db644d3acaf';

/** Google's public STUN — kept as the first entry even alongside TURN, since a
 *  direct P2P path (when one exists) is always cheaper than relaying. */
const STUN_ONLY: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

let cached: RTCIceServer[] = STUN_ONLY;
let priming: Promise<RTCIceServer[]> | null = null;

/** The current ICE servers (STUN-only until/unless the TURN fetch resolves). */
export function iceConfig(): RTCConfiguration {
  return { iceServers: cached };
}

/**
 * Resolve the ICE servers, fetching Metered's rotating TURN credentials once
 * and caching them. Safe to await before every connection — the fetch runs at
 * most once (subsequent calls return the same in-flight/settled promise), and
 * any failure leaves the STUN-only fallback in place so a connection is still
 * attempted (direct paths keep working; only relay-needing peers lose out).
 */
export async function ensureIceServers(): Promise<RTCIceServer[]> {
  if (!METERED_SUBDOMAIN || !METERED_API_KEY) return cached; // unconfigured — STUN only
  if (priming) return priming;
  priming = (async () => {
    try {
      const res = await fetch(
        `https://${METERED_SUBDOMAIN}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`,
      );
      if (!res.ok) throw new Error(`turn creds ${res.status}`);
      const servers = (await res.json()) as RTCIceServer[];
      if (Array.isArray(servers) && servers.length) {
        cached = [STUN_ONLY[0], ...servers]; // prefer a direct path, relay as backup
      }
    } catch {
      /* leave the STUN-only fallback — a firewalled peer just won't relay */
    }
    return cached;
  })();
  return priming;
}

// Kick the fetch off at import so credentials are usually ready before the
// player ever reaches a lobby (the connection paths await it regardless).
void ensureIceServers();
