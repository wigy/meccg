/**
 * @module render-log
 *
 * Renders log messages and the in-game message panel. The panel lives in the
 * top-right corner and has two modes:
 *
 * - **live tail** — new messages fade in as toasts and auto-dismiss after the
 *   CSS animation. Matches the pre-redesign toast behaviour.
 * - **history** — when the user presses PgUp/PgDn (see `keyboard-shortcuts`),
 *   the panel switches to a static window of recent messages from the log.
 *   Pressing End, or a new message arriving after the 10-second browse
 *   window elapses, returns the panel to live tail.
 *
 * The full message log is kept per-game in `gameMessageLog.messages` and
 * cleared via `clearGameMessageLog()` when a new game is assigned.
 */

import type { CardDefinition } from '@meccg/shared';
import { $ } from './render-utils.js';
import { textToHtml, tagCardImages } from './render-text-format.js';

/** Kind of a game message — drives CSS colouring. */
export type GameMessageKind = 'info' | 'error' | 'opponent' | 'system';

/** A single stored message in the per-game log. */
export interface GameMessage {
  id: number;
  at: number;
  kind: GameMessageKind;
  html: string;
}

/** In-memory per-game message log. Cleared on new game. */
export const gameMessageLog = {
  messages: [] as GameMessage[],
  nextId: 1,
  /** 0 = viewing live tail; N = scrolled N messages back from the end. */
  scrollOffset: 0,
  /** If set, browsing mode is active until this timestamp (Date.now()). */
  browseUntil: null as number | null,
};

/** Number of history entries visible in a single "page". */
const HISTORY_PAGE_SIZE = 10;

/** Browse window length after a PgUp/PgDn press. */
const BROWSE_WINDOW_MS = 10_000;

/** Clear the game message log (called when a new game is assigned). */
export function clearGameMessageLog(): void {
  gameMessageLog.messages = [];
  gameMessageLog.nextId = 1;
  gameMessageLog.scrollOffset = 0;
  gameMessageLog.browseUntil = null;
  renderGameLogPanel();
}

/** True when the browse window is currently armed. */
function isBrowsing(): boolean {
  return gameMessageLog.browseUntil !== null && Date.now() < gameMessageLog.browseUntil;
}

/** Arm the browse window. Called by keyboard-shortcuts on PgUp/PgDn. */
export function armBrowseWindow(): void {
  gameMessageLog.browseUntil = Date.now() + BROWSE_WINDOW_MS;
}

/** Drop out of browsing mode and return to live tail. */
export function returnToLiveTail(): void {
  gameMessageLog.scrollOffset = 0;
  gameMessageLog.browseUntil = null;
  renderGameLogPanel();
}

/**
 * Scroll the history view by `delta` messages (positive = older).
 * Clamps to valid range. Arms the browse window as a side effect.
 */
export function scrollHistory(delta: number): void {
  armBrowseWindow();
  const max = Math.max(0, gameMessageLog.messages.length - HISTORY_PAGE_SIZE);
  gameMessageLog.scrollOffset = Math.max(0, Math.min(max, gameMessageLog.scrollOffset + delta));
  renderGameLogPanel();
}

/** One page forward / back in history. */
export function pageHistoryUp(): void {
  scrollHistory(HISTORY_PAGE_SIZE);
}
export function pageHistoryDown(): void {
  scrollHistory(-HISTORY_PAGE_SIZE);
}

/** Render the game-log panel based on current mode. */
function renderGameLogPanel(): void {
  const panel = document.getElementById('game-log-panel');
  const header = document.getElementById('game-log-header');
  const entries = document.getElementById('game-log-entries');
  if (!panel || !header || !entries) return;

  if (isBrowsing()) {
    panel.classList.add('game-log-panel--history');
    const total = gameMessageLog.messages.length;
    const end = total - gameMessageLog.scrollOffset;
    const start = Math.max(0, end - HISTORY_PAGE_SIZE);
    header.classList.remove('hidden');
    header.textContent = `◀ history (${start + 1}–${end} of ${total}) · browsing`;
    entries.replaceChildren();
    for (let i = start; i < end; i++) {
      const msg = gameMessageLog.messages[i];
      entries.appendChild(buildEntryElement(msg, true));
    }
  } else {
    panel.classList.remove('game-log-panel--history');
    header.classList.add('hidden');
    header.textContent = '';
    // Live tail: don't clear existing fading entries — they animate and remove
    // themselves. Only a scroll-back→live-tail transition clears them.
  }
}

/** Build a DOM entry for a stored message. */
function buildEntryElement(msg: GameMessage, history: boolean): HTMLElement {
  const entry = document.createElement('div');
  const kindClass =
    msg.kind === 'error' ? ' toast--error'
    : msg.kind === 'opponent' ? ' toast--opponent'
    : msg.kind === 'system' ? ' toast--system'
    : '';
  entry.className = `toast${kindClass}${history ? ' toast--history' : ''}`;
  entry.innerHTML = msg.html;
  return entry;
}

/** Append a message to the debug-view log. Auto-scrolls to bottom. */
export function renderLog(message: string, cardPool?: Readonly<Record<string, CardDefinition>>): void {
  const el = $('log');
  const line = document.createElement('div');
  line.innerHTML = textToHtml(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (cardPool) tagCardImages(line, cardPool);
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

/** Options for {@link showNotification}. */
export interface NotificationOptions {
  /** When true, display as an error toast. */
  error?: boolean;
  /** Card pool used to render card-image hovers in the toast text. */
  cardPool?: Readonly<Record<string, CardDefinition>>;
  /**
   * When set, display as an opponent-action toast (blue color).
   * If non-empty, the message is prefixed with `"<name>: "`.
   */
  opponent?: string;
}

/**
 * Append a message to the per-game log and, when in live-tail mode, show it
 * as a fading toast in the top-right panel.
 *
 * If the user is browsing history and the 10-second browse window has not
 * elapsed, the message is stored silently without disturbing the view. If
 * the browse window has expired, the first new message clears history mode
 * and renders as a fresh toast.
 *
 * Legacy overload: pass `true` for error, or a card pool object directly.
 */
export function showNotification(
  message: string,
  opts?: boolean | Readonly<Record<string, CardDefinition>> | NotificationOptions,
): void {
  const entries = document.getElementById('game-log-entries');
  if (!entries) return;

  // Normalise legacy overloads into NotificationOptions.
  let options: NotificationOptions;
  if (opts === true) {
    options = { error: true };
  } else if (opts && typeof opts === 'object' && !('error' in opts || 'cardPool' in opts || 'opponent' in opts)) {
    options = { cardPool: opts as Readonly<Record<string, CardDefinition>> };
  } else {
    options = (opts as NotificationOptions) ?? {};
  }

  const displayMessage = options.opponent ? `${options.opponent}: ${message}` : message;
  const kind: GameMessageKind = options.error
    ? 'error'
    : options.opponent !== undefined
      ? 'opponent'
      : 'info';

  // Format the message HTML once (with card-image hovers if a pool was given).
  const tmp = document.createElement('div');
  tmp.innerHTML = textToHtml(displayMessage);
  if (options.cardPool) tagCardImages(tmp, options.cardPool);
  const html = tmp.innerHTML;

  // Store in the per-game log.
  const msg: GameMessage = { id: gameMessageLog.nextId++, at: Date.now(), kind, html };
  gameMessageLog.messages.push(msg);

  // Browsing and still inside the window → buffer silently.
  if (isBrowsing()) return;

  // Browse window expired: drop history mode, let the new message fade in.
  if (gameMessageLog.browseUntil !== null) {
    returnToLiveTail();
  }

  // Live tail: append a fading toast. It self-removes on animationend.
  const toast = buildEntryElement(msg, false);
  toast.addEventListener('animationend', (e) => {
    if (e.animationName === 'toast-out') toast.remove();
  });
  entries.appendChild(toast);
}
