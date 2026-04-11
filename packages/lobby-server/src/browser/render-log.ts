/**
 * @module render-log
 *
 * Renders log messages and toast notifications in the game UI.
 */

import type { CardDefinition } from '@meccg/shared';
import { $ } from './render-utils.js';
import { textToHtml, tagCardImages } from './render-text-format.js';

/** Append a message to the log. Auto-scrolls to bottom. */
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
 * Show a brief toast notification overlay.
 * The toast auto-dismisses after the CSS animation completes (~9.4s).
 * Visible in both debug and visual view modes.
 *
 * Legacy overload: pass `true` for error, or a card pool object directly.
 */
export function showNotification(
  message: string,
  opts?: boolean | Readonly<Record<string, CardDefinition>> | NotificationOptions,
): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Normalise legacy overloads into NotificationOptions
  let options: NotificationOptions;
  if (opts === true) {
    options = { error: true };
  } else if (opts && typeof opts === 'object' && !('error' in opts || 'cardPool' in opts || 'opponent' in opts)) {
    options = { cardPool: opts as Readonly<Record<string, CardDefinition>> };
  } else {
    options = (opts as NotificationOptions) ?? {};
  }

  const displayMessage = options.opponent ? `${options.opponent}: ${message}` : message;

  const toast = document.createElement('div');
  toast.className = options.error
    ? 'toast toast--error'
    : 'opponent' in options
      ? 'toast toast--opponent'
      : 'toast';
  toast.innerHTML = textToHtml(displayMessage);
  if (options.cardPool) tagCardImages(toast, options.cardPool);
  container.appendChild(toast);
  toast.addEventListener('animationend', (e) => {
    if (e.animationName === 'toast-out') toast.remove();
  });
}
