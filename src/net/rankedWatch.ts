/**
 * Live list of open RANKED rooms for the server browser.
 *
 * Ranked hosting is serverless (see webrtcTransport.ts `hostRanked`): a boxer
 * with no challenger yet creates an OPEN doc in the `rankedRooms` collection,
 * tagged with their name and heartbeated. This watcher subscribes to that
 * collection and reports the fresh, still-open rooms so the browser can list
 * them (each shows "1/2" — the host is in, one seat free).
 *
 * Same lifecycle discipline as queueWatch: subscribe only while the browser is
 * on screen, tear it down the moment you host/join or leave, and load Firebase
 * lazily so players who never open it never pay for the bundle.
 */

import { FIREBASE_ENABLED } from './firebaseConfig.js';
import { serverNow, syncServerClock } from './serverClock.js';

/** Rooms not heartbeated within this are abandoned hosts — hide them (mirrors
 *  LOBBY_FRESH_MS in webrtcTransport.ts). */
const FRESH_MS = 40 * 1000;

export interface RankedRoom {
  /** The `rankedRooms` doc id — passed to net.joinRanked to claim it. */
  id: string;
  /** The host's callsign, shown in the list. */
  host: string;
}

type ListListener = (rooms: RankedRoom[]) => void;

let stop: (() => void) | null = null;
let starting = false;

/**
 * Begin watching the open ranked rooms, reporting the list to `onRooms`
 * whenever it changes. No-op (empty list) if Firebase isn't the matchmaker (an
 * explicit relay has no room collection) or a watch is already live.
 */
export function startRankedWatch(onRooms: ListListener): void {
  if (stop || starting) return;
  if (!FIREBASE_ENABLED || usingExplicitRelay()) {
    onRooms([]);
    return;
  }
  starting = true;

  void (async () => {
    try {
      const { getApp, getApps, initializeApp } = await import('firebase/app');
      const { collection, getFirestore, onSnapshot, query, where } = await import('firebase/firestore');
      const { firebaseConfig } = await import('./firebaseConfig.js');
      const apps = getApps();
      const appFb = apps.length ? getApp() : initializeApp(firebaseConfig);
      const rooms = collection(getFirestore(appFb), 'rankedRooms');

      void syncServerClock(); // correct for device clock skew (see serverClock.ts)
      const unsub = onSnapshot(
        query(rooms, where('open', '==', true)),
        (snap) => {
          const now = serverNow();
          const list: RankedRoom[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data();
            const seen =
              (data.seen?.toMillis?.() as number | undefined) ??
              (data.createdAt?.toMillis?.() as number | undefined) ??
              now;
            if (now - seen <= FRESH_MS) {
              list.push({ id: docSnap.id, host: typeof data.host === 'string' ? data.host : 'BOXER' });
            }
          });
          // Stable order so rows don't jump around between snapshots.
          list.sort((a, b) => a.id.localeCompare(b.id));
          onRooms(list);
        },
        () => onRooms([]), // listener errored (rules/offline) — empty list
      );

      if (starting) {
        stop = unsub;
      } else {
        unsub(); // stopRankedWatch was called while we were connecting
      }
    } catch {
      onRooms([]); // Firebase failed to load — nothing to list
    } finally {
      starting = false;
    }
  })();
}

/** Tear the listener down (leaving the browser). Safe to call when not watching. */
export function stopRankedWatch(): void {
  starting = false;
  if (stop) {
    stop();
    stop = null;
  }
}

function usingExplicitRelay(): boolean {
  return (
    new URLSearchParams(location.search).has('server') ||
    localStorage.getItem('ibb-server') !== null
  );
}
