/**
 * Browser-only admin panel for moderating the pub.
 *
 * Hold Z + A + P together (in a regular desktop browser — there's no keyboard
 * in the headset) and a small overlay pops up listing everyone currently in
 * the room, each with a BAN button. Banning closes that punter's socket — which
 * also cuts their voice, since voice rides the same socket — and blocks their
 * rejoin by IP + device id.
 *
 * Bans only take effect if the admin key matches the server's ADMIN_TOKEN, so
 * the panel opening for anyone is harmless; the server is the real gate. The
 * key is taken from `?admin=…` (remembered after the first visit) or typed into
 * the panel. yellkell can never be banned — enforced on the server.
 */

import { pubSendRaw } from './net.js';
import { bus, pub } from './state.js';

const TOKEN_KEY = 'ibb-pub-admin';
const CHORD = ['KeyZ', 'KeyA', 'KeyP'];

function loadToken(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get('admin');
    if (fromUrl) localStorage.setItem(TOKEN_KEY, fromUrl);
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function saveToken(t: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* storage unavailable — token lives for this session only */
  }
}

let panel: HTMLDivElement | null = null;
let listEl: HTMLDivElement | null = null;
let statusEl: HTMLDivElement | null = null;
let tokenInput: HTMLInputElement | null = null;

function setStatus(text: string, ok: boolean): void {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = ok ? '#7dff5a' : '#ff6b6b';
}

function renderList(): void {
  if (!listEl) return;
  listEl.replaceChildren();
  const punters = [...pub.punters.values()];
  if (punters.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No other punters in right now.';
    empty.style.cssText = 'opacity:0.6;padding:8px 2px;';
    listEl.appendChild(empty);
    return;
  }
  for (const p of punters) {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;gap:10px;padding:7px 2px;border-top:1px solid rgba(255,255,255,0.08);';

    const dot = document.createElement('span');
    dot.style.cssText = `width:12px;height:12px;border-radius:50%;flex:0 0 auto;background:#${p.accent
      .toString(16)
      .padStart(6, '0')};`;

    const label = document.createElement('span');
    label.textContent = `${p.name}  (${p.id})`;
    label.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    row.append(dot, label);

    if (p.name.trim().toLowerCase() === 'yellkell') {
      const guard = document.createElement('span');
      guard.textContent = 'protected';
      guard.style.cssText = 'opacity:0.5;font-size:12px;';
      row.appendChild(guard);
    } else {
      const ban = document.createElement('button');
      ban.textContent = 'BAN';
      ban.style.cssText =
        'background:#e8352a;color:#fff;border:0;border-radius:5px;padding:5px 12px;font-weight:700;cursor:pointer;';
      ban.addEventListener('click', () => {
        const token = tokenInput?.value.trim() ?? '';
        saveToken(token);
        pubSendRaw({ t: 'admin-ban', token, id: p.id });
        setStatus(`banning ${p.name}…`, true);
      });
      row.appendChild(ban);
    }
    listEl.appendChild(row);
  }
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:16px;right:16px;z-index:99999;width:320px;max-height:80vh;overflow:auto;' +
    'background:rgba(18,20,26,0.96);color:#eef1f6;border:1px solid rgba(255,255,255,0.15);' +
    'border-radius:10px;padding:14px 16px;font:14px/1.4 system-ui,sans-serif;' +
    'box-shadow:0 10px 40px rgba(0,0,0,0.5);';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
  const title = document.createElement('strong');
  title.textContent = 'CLUB ADMIN';
  title.style.cssText = 'letter-spacing:0.06em;color:#ffb000;';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.style.cssText = 'background:none;border:0;color:#aeb6c2;font-size:18px;cursor:pointer;';
  close.addEventListener('click', hidePanel);
  head.append(title, close);

  tokenInput = document.createElement('input');
  tokenInput.type = 'password';
  tokenInput.placeholder = 'admin key';
  tokenInput.value = loadToken();
  tokenInput.style.cssText =
    'width:100%;box-sizing:border-box;margin-bottom:10px;padding:6px 8px;border-radius:5px;' +
    'border:1px solid rgba(255,255,255,0.2);background:#0d0f14;color:#eef1f6;';

  listEl = document.createElement('div');
  statusEl = document.createElement('div');
  statusEl.style.cssText = 'min-height:18px;margin-top:10px;font-size:13px;';

  el.append(head, tokenInput, listEl, statusEl);
  return el;
}

function showPanel(): void {
  if (!panel) {
    panel = buildPanel();
    document.body.appendChild(panel);
  }
  panel.style.display = 'block';
  renderList();
}

function hidePanel(): void {
  if (panel) panel.style.display = 'none';
}

function isPanelOpen(): boolean {
  return !!panel && panel.style.display !== 'none';
}

/** A plain banner shown to a punter the moment an admin removes them. */
function showBannedNotice(): void {
  const el = document.createElement('div');
  el.textContent = "You've been removed from the pub.";
  el.style.cssText =
    'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(10,10,14,0.92);color:#ff6b6b;font:700 24px system-ui,sans-serif;text-align:center;padding:24px;';
  document.body.appendChild(el);
}

const pressed = new Set<string>();

function typingInField(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

/** Wire up the chord listener and live panel/notice updates. Call once on boot. */
export function installAdminPanel(): void {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hidePanel();
      return;
    }
    pressed.add(e.code);
    if (!isPanelOpen() && !typingInField() && CHORD.every((c) => pressed.has(c))) showPanel();
  });
  window.addEventListener('keyup', (e) => pressed.delete(e.code));
  window.addEventListener('blur', () => pressed.clear());

  // Keep the roster live while the panel is open.
  const refresh = (): void => {
    if (isPanelOpen()) renderList();
  };
  bus.on('joined', refresh);
  bus.on('left', refresh);

  bus.on('adminResult', ({ ok, msg }) => {
    setStatus(msg, ok);
    if (ok) renderList();
  });
  bus.on('banned', showBannedNotice);
}
