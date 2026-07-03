/**
 * Crash telemetry for headset playtests — there's no devtools console in the
 * Quest, so an uncaught exception (which kills the render loop: the world
 * freezes, "the game crashed") vanishes without a trace.
 *
 * This traps window `error` / `unhandledrejection`, keeps the last few in
 * localStorage (they survive the reload), and reports them on the next boot:
 * dumped to the console AND surfaced as a small line on the landing page so
 * a tester sees "something crashed last session" in-headset. Read or clear
 * them any time from the console: `ibbCrashes()` / `ibbClearCrashes()`.
 */

const KEY = 'ibb-crashes';
const MAX = 12;

function stored(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return [];
  }
}

function save(kind: string, detail: string): void {
  try {
    const entry = `${new Date().toISOString()} [${kind}] ${detail}`.slice(0, 1000);
    localStorage.setItem(KEY, JSON.stringify([...stored(), entry].slice(-MAX)));
  } catch {
    /* storage full/denied — the console line below still fires live */
  }
}

export function installCrashTrap(): void {
  window.addEventListener('error', (e) => {
    save('error', `${e.message} @ ${e.filename ?? '?'}:${e.lineno ?? 0}\n${(e.error as Error | undefined)?.stack ?? ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { stack?: string; message?: string } | undefined;
    save('promise', r?.stack ?? r?.message ?? String(e.reason));
  });

  // Report anything a previous session left behind.
  const crashes = stored();
  if (crashes.length) {
    // eslint-disable-next-line no-console
    console.warn(`[crashTrap] ${crashes.length} stored crash(es) from earlier sessions:\n${crashes.join('\n')}`);
    const sub = document.querySelector('.landing__subtitle');
    if (sub?.parentElement) {
      const note = document.createElement('p');
      note.textContent = `⚠ ${crashes.length} error(s) last session — ibbCrashes() in console`;
      note.style.cssText = 'color:#ff8a7a;font-size:0.8rem;margin-top:6px;opacity:0.85';
      sub.parentElement.insertBefore(note, sub.nextSibling);
    }
  }

  // Console helpers for remote-debugging sessions.
  (window as unknown as Record<string, unknown>).ibbCrashes = () => stored();
  (window as unknown as Record<string, unknown>).ibbClearCrashes = () => localStorage.removeItem(KEY);
}
