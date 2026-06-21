/**
 * The repurposed Firebase project (from the ARFI/curveball era) — used ONLY
 * for matchmaking + WebRTC signaling. Game traffic never touches Firebase;
 * it flows peer-to-peer over RTCDataChannels (see webrtcTransport.ts).
 *
 * A Firebase web API key is a public identifier, not a secret — access is
 * governed by Firestore security rules. For the `lobbies` collection used
 * here, rules along these lines are enough to ship:
 *
 *   match /lobbies/{lobby} {
 *     allow read, create, update, delete: if true;   // hackathon-grade
 *     match /{candidates}/{doc} { allow read, write: if true; }
 *   }
 *
 * The arcade 2v2/FFA mesh (net/meshImpl.ts) adds one more collection —
 * `arcadeRooms` — with per-pair signalling + ICE candidate subcollections:
 *
 *   match /arcadeRooms/{room} {
 *     allow read, create, update, delete: if true;
 *     match /{document=**} { allow read, write: if true; }   // sig + c{seat}
 *   }
 *
 * (Tighten with App Check / auth before a big public release.)
 *
 * Set `FIREBASE_ENABLED = false` to force the WebSocket relay everywhere.
 */

export const FIREBASE_ENABLED = true;

export const firebaseConfig = {
  apiKey: 'AIzaSyA0NYO_w6uU0Fcc6nuVPitRQaGW3B6518E',
  authDomain: 'arfi-b68f9.firebaseapp.com',
  projectId: 'arfi-b68f9',
  storageBucket: 'arfi-b68f9.firebasestorage.app',
  messagingSenderId: '188374608574',
  appId: '1:188374608574:web:108250406138b5a5988cef',
};
