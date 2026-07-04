/**
 * Music — harvested straight from FIRE FIGHT's crate: the lobby spins
 * "Start Again", a bout picks one of the battle tracks at random, and a KO
 * rings the victory sting before handing back to the lobby. Plain
 * HTMLAudioElements, one small handoff so the sting and lobby never overlap.
 */

import lobbyUrl from '../assets/music/start-again.m4a?url';
import victoryUrl from '../assets/music/victory.mp3?url';

const battleUrls = Object.values(
  import.meta.glob('../assets/music/battle/*.{mp3,m4a}', { eager: true, query: '?url', import: 'default' }) as Record<
    string,
    string
  >,
);

const LOBBY_VOLUME = 0.32;
const BATTLE_VOLUME = 0.2;
const VICTORY_VOLUME = 0.28;
const MUTE_KEY = 'goop-music-muted';

let lobby: HTMLAudioElement | null = null;
let battle: HTMLAudioElement | null = null;
let victory: HTMLAudioElement | null = null;
let handoffTimer = 0;

export function isMusicMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function toggleMusicMuted(): boolean {
  const muted = !isMusicMuted();
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode — session-only */
  }
  if (muted) {
    lobby?.pause();
    battle?.pause();
    victory?.pause();
  } else {
    startLobbyMusic();
  }
  return muted;
}

/** Lobby loop. Safe to call repeatedly; call once from the entry gesture. */
export function startLobbyMusic(): void {
  clearTimeout(handoffTimer);
  battle?.pause();
  if (isMusicMuted()) return;
  if (!lobby) {
    lobby = new Audio(lobbyUrl);
    lobby.loop = true;
    lobby.volume = LOBBY_VOLUME;
  }
  if (lobby.paused) {
    lobby.currentTime = 0;
    void lobby.play().catch(() => {});
  }
}

/** A bout begins: fade the lobby out fast, loop a random battle track.
 *  No-ops if a battle track is already rolling, so the score carries
 *  straight through the rest periods of a multi-round contest. */
export function startBattleMusic(): void {
  clearTimeout(handoffTimer);
  lobby?.pause();
  victory?.pause();
  if (isMusicMuted() || battleUrls.length === 0) return;
  if (battle && !battle.paused) return;
  const url = battleUrls[Math.floor(Math.random() * battleUrls.length)];
  if (!battle) {
    battle = new Audio();
    battle.loop = true;
  }
  if (battle.src !== url) battle.src = url;
  battle.volume = BATTLE_VOLUME;
  battle.currentTime = 0;
  void battle.play().catch(() => {});
}

/** Bout over: kill the battle track, ring the sting, then lobby after a beat. */
export function playVictoryThenLobby(): void {
  battle?.pause();
  clearTimeout(handoffTimer);
  if (isMusicMuted()) return;
  if (!victory) victory = new Audio(victoryUrl);
  victory.volume = VICTORY_VOLUME;
  victory.currentTime = 0;
  void victory.play().catch(() => {});
  handoffTimer = window.setTimeout(() => startLobbyMusic(), 8000);
}

/** Bout over without ceremony (loss/draw): straight back to the lobby. */
export function backToLobbyMusic(): void {
  battle?.pause();
  clearTimeout(handoffTimer);
  handoffTimer = window.setTimeout(() => startLobbyMusic(), 1400);
}
