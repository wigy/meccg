/**
 * @module roll-history
 *
 * Full, untruncated per-game dice-roll history for the Developer Tools
 * "Roll History" panel (`#roll-history-modal`).
 *
 * `#game-log-panel`'s toast view clips old lines out of the visible window
 * and, via `MAX_NAME_LENGTH` in `dice-roll-log.ts`, ellipsis-truncates long
 * character/site names to keep a roll line inside the panel's clipped width.
 * That truncation happens at the point `diceRollNotification()` builds the
 * toast text, so the full name cannot be recovered from the toast log after
 * the fact. This module instead records the already-untruncated
 * `diceRollLogLine()` text for every roll as it arrives, independent of
 * `gameMessageLog`, so a player can always look up a roll that scrolled off
 * or was clipped in the toast panel.
 *
 * Lines are captured by {@link recordRollHistoryLine} at the same point
 * `game-connection.ts` calls `renderLog(diceRollLogLine(rollEffect))`, and
 * cleared by {@link clearRollHistory} alongside the rest of the per-game log
 * lifecycle (see `clearGameMessageLog()` in `render-log.ts`).
 */

/** Full per-game roll history, in arrival order. Cleared on new game. */
let rollHistoryLines: string[] = [];

/** Whether the roll-history panel is currently on screen. */
function panelOpen(): boolean {
  return document.getElementById('roll-history-modal')?.classList.contains('hidden') === false;
}

/** Append one line to the visible list and scroll it into view. */
function appendLine(list: HTMLElement, line: string): void {
  const el = document.createElement('div');
  el.textContent = line;
  list.appendChild(el);
  list.scrollTop = list.scrollHeight;
}

/**
 * Record one untruncated roll line. Appends it live to the panel when the
 * panel is currently open; otherwise it is just stored for the next open.
 */
export function recordRollHistoryLine(line: string): void {
  rollHistoryLines.push(line);
  if (!panelOpen()) return;
  const list = document.getElementById('roll-history-list');
  if (list) appendLine(list, line);
}

/** Clear the roll history. Called when a new game is assigned. */
export function clearRollHistory(): void {
  rollHistoryLines = [];
  document.getElementById('roll-history-list')?.replaceChildren();
}

/** Show the panel, rendering the full history from scratch. */
export function openRollHistoryPanel(): void {
  const modal = document.getElementById('roll-history-modal');
  const list = document.getElementById('roll-history-list');
  if (!modal || !list) return;
  list.replaceChildren();
  for (const line of rollHistoryLines) appendLine(list, line);
  modal.classList.remove('hidden');
}

/** Hide the panel. Safe to call when it is already hidden. */
export function closeRollHistoryPanel(): void {
  document.getElementById('roll-history-modal')?.classList.add('hidden');
}

/** Wire the toolbar button and the panel's close affordances. */
export function installRollHistory(): void {
  document.getElementById('roll-history-btn')?.addEventListener('click', () => openRollHistoryPanel());
  document.getElementById('roll-history-close')?.addEventListener('click', () => closeRollHistoryPanel());
  document.getElementById('roll-history-backdrop')?.addEventListener('click', () => closeRollHistoryPanel());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panelOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    closeRollHistoryPanel();
  }, true);
}
