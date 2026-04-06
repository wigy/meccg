/**
 * @module session
 *
 * Game session persistence helpers. Saves and restores game connection
 * info (port, token, opponent) in sessionStorage so that a page refresh
 * can rejoin an active game without losing state.
 */

import {
  appState,
  GAME_PORT_KEY, GAME_TOKEN_KEY, GAME_OPPONENT_KEY,
  PSEUDO_AI_KEY, PSEUDO_AI_TOKEN_KEY,
  STORAGE_KEY,
} from './app-state.js';

/** Persist game connection info in sessionStorage so a page refresh can rejoin. */
export function saveGameSession(): void {
  if (appState.gamePort !== null && appState.gameToken !== null) {
    sessionStorage.setItem(GAME_PORT_KEY, String(appState.gamePort));
    sessionStorage.setItem(GAME_TOKEN_KEY, appState.gameToken);
  }
  if (appState.opponentName) {
    sessionStorage.setItem(GAME_OPPONENT_KEY, appState.opponentName);
  }
  if (appState.isPseudoAi) {
    sessionStorage.setItem(PSEUDO_AI_KEY, '1');
    if (appState.pseudoAiToken) sessionStorage.setItem(PSEUDO_AI_TOKEN_KEY, appState.pseudoAiToken);
  } else {
    sessionStorage.removeItem(PSEUDO_AI_KEY);
    sessionStorage.removeItem(PSEUDO_AI_TOKEN_KEY);
  }
}

/** Clear persisted game session on disconnect. */
export function clearGameSession(): void {
  sessionStorage.removeItem(GAME_PORT_KEY);
  sessionStorage.removeItem(GAME_TOKEN_KEY);
  sessionStorage.removeItem(GAME_OPPONENT_KEY);
  sessionStorage.removeItem(PSEUDO_AI_KEY);
  sessionStorage.removeItem(PSEUDO_AI_TOKEN_KEY);
}

/** Restore game connection info from sessionStorage (returns true if found). */
export function restoreGameSession(): boolean {
  const port = sessionStorage.getItem(GAME_PORT_KEY);
  const token = sessionStorage.getItem(GAME_TOKEN_KEY);
  const opponent = sessionStorage.getItem(GAME_OPPONENT_KEY);
  if (port && token) {
    appState.gamePort = Number(port);
    appState.gameToken = token;
    appState.opponentName = opponent;
    appState.isPseudoAi = sessionStorage.getItem(PSEUDO_AI_KEY) === '1';
    appState.pseudoAiToken = sessionStorage.getItem(PSEUDO_AI_TOKEN_KEY);
    return true;
  }
  return false;
}

// ---- Player name persistence ----

/** Save the player name to localStorage (standalone mode). */
export function savePlayerName(name: string): void {
  localStorage.setItem(STORAGE_KEY, name);
}

/** Load the player name from localStorage (standalone mode). */
export function loadPlayerName(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Clear the player name from localStorage. */
export function clearPlayerName(): void {
  localStorage.removeItem(STORAGE_KEY);
}
