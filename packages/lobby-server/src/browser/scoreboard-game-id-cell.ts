/**
 * @module scoreboard-game-id-cell
 *
 * The scoreboard's "Game ID" cell, with the link that opens the game's replay.
 *
 * Kept apart from the page so the one decision it makes — offer a replay only
 * for a game that has an ID to replay — is testable without a DOM.
 */

import { escapeHtml } from './html-utils.js';

/**
 * The `<dd>` for a completed game's ID. Games recorded before the server
 * stored game IDs have nothing to look a recording up by, so they get the
 * plain em dash rather than a link that could only fail.
 */
export function gameIdCell(gameId: string | null): string {
  if (!gameId) return '<dd class="scoreboard-game-id">—</dd>';
  const id = escapeHtml(gameId);
  return `<dd class="scoreboard-game-id">${id}`
    + ` <button type="button" class="scoreboard-replay-link" data-replay-game="${id}"`
    + ' title="Watch this game play out move by move">Replay</button></dd>';
}
