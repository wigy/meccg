/**
 * @module render-log
 *
 * Renders the per-game text log in the top-right panel.
 *
 * The panel shows a window of the most recent messages as plain text (no
 * background box). CSS caps the panel height at half the screen and clips
 * older messages that overflow above.
 *
 * The view is anchored:
 * - `anchor === null` → live-tail: the panel always shows the newest
 *   messages; new messages render at the bottom.
 * - `anchor === N` → fixed: the window ends at absolute index N. New
 *   messages arrive and are stored in the log but the visible window does
 *   not shift (no autoscroll).
 *
 * PgUp/PgDn and the mouse wheel shift the anchor one line at a time. End
 * returns to live tail. Paging down past the newest message also returns
 * to live tail.
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
  /**
   * When null, the panel follows the tail (newest always visible).
   * When a number, the panel is anchored to show the window ending at
   * that absolute index — incoming messages do not shift the view.
   */
  anchor: null as number | null,
};

/** Max number of messages drawn at a time. CSS clips further based on height. */
const VISIBLE_WINDOW = 50;

/** Clear the game message log (called when a new game is assigned). */
export function clearGameMessageLog(): void {
  gameMessageLog.messages = [];
  gameMessageLog.nextId = 1;
  gameMessageLog.anchor = null;
  renderGameLogPanel();
}

/** Drop out of anchored mode and follow the tail again. */
export function returnToLiveTail(): void {
  gameMessageLog.anchor = null;
  renderGameLogPanel();
}

/**
 * Shift the view by `delta` messages (positive = older, negative = newer).
 * Paging newer past the tail drops back to live-tail mode.
 */
export function scrollHistory(delta: number): void {
  const total = gameMessageLog.messages.length;
  if (total === 0) return;
  const current = gameMessageLog.anchor ?? total;
  const next = current - delta;
  if (next >= total) {
    returnToLiveTail();
    return;
  }
  gameMessageLog.anchor = Math.max(1, next);
  renderGameLogPanel();
}

/** One line back in history. */
export function pageHistoryUp(): void {
  scrollHistory(1);
}

/** One line forward toward the tail. */
export function pageHistoryDown(): void {
  scrollHistory(-1);
}

/** Render the game-log panel based on current anchor. */
function renderGameLogPanel(): void {
  const panel = document.getElementById('game-log-panel');
  const header = document.getElementById('game-log-header');
  const entries = document.getElementById('game-log-entries');
  if (!panel || !header || !entries) return;

  const total = gameMessageLog.messages.length;
  const end = gameMessageLog.anchor ?? total;
  const start = Math.max(0, end - VISIBLE_WINDOW);

  if (gameMessageLog.anchor !== null) {
    panel.classList.add('game-log-panel--history');
    header.classList.remove('hidden');
    header.textContent = `◀ log ${start + 1}–${end} of ${total} · End to return`;
  } else {
    panel.classList.remove('game-log-panel--history');
    header.classList.add('hidden');
    header.textContent = '';
  }

  entries.replaceChildren();
  for (let i = start; i < end; i++) {
    entries.appendChild(buildEntryElement(gameMessageLog.messages[i]));
  }
}

/** Build a DOM entry for a stored message. */
function buildEntryElement(msg: GameMessage): HTMLElement {
  const entry = document.createElement('div');
  const kindClass =
    msg.kind === 'error' ? ' toast--error'
    : msg.kind === 'opponent' ? ' toast--opponent'
    : msg.kind === 'system' ? ' toast--system'
    : '';
  entry.className = `toast${kindClass}`;
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
 * Append a message to the per-game log and render the panel.
 *
 * If the view is anchored to a fixed position (user scrolled back), the
 * message is stored silently and the visible window is not shifted.
 *
 * Legacy overload: pass `true` for error, or a card pool object directly.
 */
export function showNotification(
  message: string,
  opts?: boolean | Readonly<Record<string, CardDefinition>> | NotificationOptions,
): void {
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

  const msg: GameMessage = { id: gameMessageLog.nextId++, at: Date.now(), kind, html };
  gameMessageLog.messages.push(msg);

  // Anchored: store silently, don't touch the view.
  if (gameMessageLog.anchor !== null) return;

  renderGameLogPanel();
}
