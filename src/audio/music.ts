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

/** Hard invariant: pause every track except the one we're about to play, so
 *  lobby / battle / victory can NEVER stack on top of each other. */
function soloExcept(keep: 'lobby' | 'battle' | 'victory' | 'none'): void {
  if (keep !== 'lobby') lobby?.pause();
  if (keep !== 'battle') battle?.pause();
  if (keep !== 'victory') victory?.pause();
}

/** Cancel a pending victory→lobby handoff (call when a new bout starts so a
 *  stale timer can't bring the lobby track up over a countdown/fight). */
export function cancelMusicHandoff(): void {
  clearTimeout(handoffTimer);
}

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
  soloExcept('lobby'); // stop battle AND the victory sting
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

/** A bout begins: cut the lobby/sting, loop a random battle track. No-ops the
 *  track choice if one's already rolling, so the score carries straight
 *  through the rest periods of a multi-round contest. */
export function startBattleMusic(): void {
  clearTimeout(handoffTimer);
  soloExcept('battle'); // stop lobby AND the victory sting
  if (isMusicMuted() || battleUrls.length === 0) return;
  if (battle && !battle.paused) return; // already scoring this match
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

/** Match over (win): kill everything else, ring the sting, then lobby. */
export function playVictoryThenLobby(): void {
  clearTimeout(handoffTimer);
  soloExcept('victory'); // stop lobby AND battle
  if (isMusicMuted()) return;
  if (!victory) victory = new Audio(victoryUrl);
  victory.volume = VICTORY_VOLUME;
  victory.currentTime = 0;
  void victory.play().catch(() => {});
  handoffTimer = window.setTimeout(() => startLobbyMusic(), 8000);
}

/** Match over (loss/draw): silence, then straight back to the lobby. */
export function backToLobbyMusic(): void {
  clearTimeout(handoffTimer);
  soloExcept('none'); // stop everything
  handoffTimer = window.setTimeout(() => startLobbyMusic(), 1400);
}
