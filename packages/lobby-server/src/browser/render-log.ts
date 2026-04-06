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

/**
 * Show a brief toast notification overlay.
 * The toast auto-dismisses after the CSS animation completes (~3.4s).
 * Visible in both debug and visual view modes.
 */
export function showNotification(message: string, isError = false): void {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = isError ? 'toast toast--error' : 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  toast.addEventListener('animationend', (e) => {
    if (e.animationName === 'toast-out') toast.remove();
  });
}
