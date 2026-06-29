/**
 * Battle music — quiet background score for a live bout. When a match starts we
 * pick ONE of the battle tracks at random and loop it under the fight; when the
 * match ends we stop it and play a short victory sting (both players hear it).
 *
 * It sits a notch under the lobby music (it's background, not the main event)
 * and obeys the SAME mute as the lobby track, so the lobby mute button silences
 * everything. Plain HTMLAudioElements — long loops that just need play/pause.
 */

import { isMusicMuted } from './menuMusic.js';
import victoryUrl from '../assets/music/victory.mp3?url';

// Auto-discovered battle tracks — drop more .mp3s in assets/music/battle.
const battleUrls = Object.values(
  import.meta.glob('../assets/music/battle/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<
    string,
    string
  >,
);

const BATTLE_VOLUME = 0.18; // quiet background, well under the lobby music (0.5)
const VICTORY_VOLUME = 0.26;

let battle: HTMLAudioElement | null = null;
let victory: HTMLAudioElement | null = null;

/** Start a random battle track (looping). No-op if already playing, muted, or
 *  there are no tracks. Call when a bout begins. */
export function startBattleMusic(): void {
  if (isMusicMuted() || battleUrls.length === 0) return;
  if (battle && !battle.paused) return; // already scoring this bout
  const url = battleUrls[Math.floor(Math.random() * battleUrls.length)];
  if (!battle) {
    battle = new Audio();
    battle.loop = true;
    battle.volume = BATTLE_VOLUME;
  }
  if (battle.src !== url) battle.src = url;
  battle.currentTime = 0;
  void battle.play().catch(() => {
    /* autoplay blocked or decode failed — stay silent */
  });
}

/** Silence everything — the battle track AND the victory sting. Call when we
 *  leave the bout to the lobby (the lobby music takes over from here). */
export function stopBattleMusic(): void {
  battle?.pause();
  victory?.pause();
}

/** Play the end-of-match victory sting once (for everyone in the bout). */
export function playVictory(): void {
  battle?.pause(); // duck the battle score, but DON'T cut a sting already ringing
  if (isMusicMuted()) return;
  if (!victory) {
    victory = new Audio(victoryUrl);
    victory.volume = VICTORY_VOLUME;
  }
  victory.currentTime = 0;
  void victory.play().catch(() => {
    /* blocked or decode failed — no sting */
  });
}
