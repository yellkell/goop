/**
 * Live list of open RAID lobbies for the raid browser.
 *
 * A raid host creates an OPEN room doc in `arcadeRooms` (mode 'raid') tagged
 * with the squad's callsigns; this watcher subscribes to those and reports the
 * fresh, still-open, not-yet-started ones so the browser can list them (each
 * shows the host's name, the head-count and the hardcore flag).
 *
 * Same lifecycle discipline as rankedWatch: subscribe only while the raid
 * browser is on screen, tear it down on host/join/close, and load Firebase
 * lazily so players who never open it never pay for the bundle.
 */

import { FIREBASE_ENABLED } from './firebaseConfig.js';

/** Lobbies older than this with nobody starting them are abandoned — hide. */
const FRESH_MS = 15 * 60 * 1000;

export interface RaidRoom {
  /** The `arcadeRooms` doc id — passed to mesh.joinRaid to claim a seat. */
  id: string;
  /** The host's callsign, shown in the list. */
  host: string;
  /** Seats filled so far (of 4). */
  count: number;
  /** The lobby's hardcore breaker, so joiners know what they're in for. */
  hardcore: boolean;
}

type ListListener = (rooms: RaidRoom[]) => void;

let stop: (() => void) | null = null;
let starting = false;

/** Begin watching the open raid lobbies, reporting the list on every change. */
export function startRaidWatch(onRooms: ListListener): void {
  if (stop || starting) return;
  if (!FIREBASE_ENABLED) {
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
      const rooms = collection(getFirestore(appFb), 'arcadeRooms');

      const unsub = onSnapshot(
        query(rooms, where('mode', '==', 'raid'), where('open', '==', true)),
        (snap) => {
          const now = Date.now();
          const list: RaidRoom[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.started === true) return;
            const created = (data.createdAt?.toMillis?.() as number | undefined) ?? now;
            if (now - created > FRESH_MS) return;
            const seats = (data.seats as string[]) ?? [];
            const names = (data.names as string[]) ?? [];
            list.push({
              id: docSnap.id,
              host: typeof names[0] === 'string' && names[0] ? names[0] : 'BOXER',
              count: seats.filter(Boolean).length,
              hardcore: data.hardcore === true,
            });
          });
          list.sort((a, b) => a.id.localeCompare(b.id)); // stable rows
          onRooms(list);
        },
        () => onRooms([]), // listener errored (rules/offline) — empty list
      );

      if (starting) {
        stop = unsub;
      } else {
        unsub(); // stopRaidWatch was called while we were connecting
      }
    } catch {
      onRooms([]); // Firebase failed to load — nothing to list
    } finally {
      starting = false;
    }
  })();
}

/** Tear the listener down (leaving the browser). Safe when not watching. */
export function stopRaidWatch(): void {
  starting = false;
  if (stop) {
    stop();
    stop = null;
  }
}
