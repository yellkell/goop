/**
 * Device↔server clock offset for matchmaking freshness.
 *
 * Lobbies carry Firestore SERVER timestamps (`seen`/`createdAt`), but a client
 * decides whether a lobby is "live" by comparing that stamp to its OWN clock
 * with a tight window (LOBBY_FRESH_MS, ~40 s). VR headsets routinely drift —
 * asleep/woken, wrong timezone, no NTP — and a device whose clock is off by
 * more than that window sees EVERY open lobby as stale: it never claims one and
 * never crosses over to another host, so two people both searching never find
 * each other (while private codes, with a 10-minute window, keep working).
 *
 * We fix it by measuring the offset once: write a throwaway doc with
 * serverTimestamp(), read it straight back FROM THE SERVER (so the stamp is
 * resolved, not a pending null), and record serverMillis − localMillis. From
 * then on `serverNow()` returns the device clock corrected onto server time, so
 * freshness windows mean what they say regardless of how wrong the local clock
 * is. The probe doc is `open:false`, so it never shows up as a queue lobby; it's
 * deleted right after. If the probe fails we fall back to a zero offset — i.e.
 * exactly the old behaviour, never worse.
 */

let offset: number | null = null;
let syncing: Promise<void> | null = null;

/** The local clock corrected onto server time (ms). Equals Date.now() until the
 *  first successful {@link syncServerClock}. */
export function serverNow(): number {
  return Date.now() + (offset ?? 0);
}

/** Measure the server-clock offset once (cached). Cheap to over-call: a no-op
 *  after the first success, and concurrent callers share the one probe. */
export function syncServerClock(): Promise<void> {
  if (offset !== null) return Promise.resolve();
  if (!syncing) {
    syncing = (async () => {
      try {
        const { getApp, getApps, initializeApp } = await import('firebase/app');
        const { addDoc, collection, deleteDoc, getDocFromServer, getFirestore, serverTimestamp } =
          await import('firebase/firestore');
        const { firebaseConfig } = await import('./firebaseConfig.js');
        const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
        const dbi = getFirestore(app);
        // open:false → invisible to the matchmaking query and the queue counter.
        const ref = await addDoc(collection(dbi, 'lobbies'), { open: false, probe: true, t: serverTimestamp() });
        const snap = await getDocFromServer(ref); // server read → the stamp is resolved
        const sv = (snap.data()?.t as { toMillis?: () => number } | undefined)?.toMillis?.();
        offset = typeof sv === 'number' ? sv - Date.now() : 0;
        void deleteDoc(ref).catch(() => {});
      } catch {
        offset = 0; // can't probe — assume no skew (status quo, never worse)
      } finally {
        syncing = null;
      }
    })();
  }
  return syncing;
}
