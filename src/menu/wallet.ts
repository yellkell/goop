/**
 * The player's coin wallet — the bolt-dollar currency (the riveted "$").
 *
 * It's a single non-negative integer kept in localStorage under 'ff-coins'.
 * Both entry points share it: the arena (index.html) and the pub (pub.html)
 * are same-origin, so they read and write the very same wallet. Each page
 * loads the balance fresh on boot (navigating between them is a full reload),
 * so there's no live cross-tab sync to worry about.
 *
 * Coins are EARNED at the same moments as XP (net/leaderboard.ts calls
 * addCoins), SPENT in the platform shop (menu), and traded by hand in the pub
 * (pull one off your wrist to drop it; catch one onto your wrist to bank it).
 *
 * UI panels read `coins.balance` and can watch `coins.version`, which bumps on
 * every change, to know when to redraw.
 */

const KEY = 'ff-coins';

function load(): number {
  try {
    const n = parseInt(localStorage.getItem(KEY) ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export const coins = {
  balance: load(),
  /** Bumped on every change so canvas panels can cheaply notice and redraw. */
  version: 1,
};

function persist(): void {
  try {
    localStorage.setItem(KEY, String(coins.balance));
  } catch {
    /* storage unavailable — the balance stays for this session at least */
  }
  coins.version += 1;
}

/** Award coins (earned alongside XP, or banked from a caught pub coin). */
export function addCoins(amount: number): void {
  const n = Math.floor(amount);
  if (n <= 0) return;
  coins.balance += n;
  persist();
}

/**
 * Try to spend `amount`. Returns true and debits the wallet if you can afford
 * it; returns false and changes nothing if you can't (the caller can play a
 * deny sound). Spending one coin to a pub-floor drop goes through here too.
 */
export function spendCoins(amount: number): boolean {
  const n = Math.floor(amount);
  if (n <= 0) return true;
  if (coins.balance < n) return false;
  coins.balance -= n;
  persist();
  return true;
}

/** Whether the wallet can cover `amount` right now. */
export function canAfford(amount: number): boolean {
  return coins.balance >= Math.floor(amount);
}
