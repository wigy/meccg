/**
 * @module update-play-controls-watch-button.test
 *
 * `updatePlayControls()` used to end with a blanket sweep that set
 * `disabled = !hasDeck` on EVERY button inside a `.lobby-player-item` — but
 * those items also hold the ongoing-games' Watch buttons (always enabled:
 * watching needs no deck, and `.lobby-game-item` rows deliberately get no
 * deck gating in `renderOnlineList`) and Cancel-challenge buttons. Since
 * `updatePlayControls` runs from `loadDecks()` on every lobby/decks screen
 * show, a deckless player had their Watch buttons dimmed until an unrelated
 * `online-players` broadcast re-rendered the list — and, symmetrically, a
 * Watch button self-disabled as "Joining..." was force re-enabled once a deck
 * was selected. The fix re-renders the online list (each button re-derives
 * its own state) instead of blanket-toggling, via the cross-bundle
 * `window.__meccg.renderOnlineList` callback registered by lobby-screens.
 *
 * Uses the hand-rolled DOM stub pattern of `lobby-button-reset.test.ts`
 * (vitest runs in the default node environment, no jsdom).
 */
import './test-dom-bootstrap.js'; // must precede the deck-browser import (load-time window access)
import { describe, test, expect, beforeEach } from 'vitest';
import { updatePlayControls } from './deck-browser.js';
import { appState } from './app-state.js';

class StubButton {
  textContent = '';
  disabled = false;
}

let listButtons: StubButton[];
let renderOnlineListCalls: number;

beforeEach(() => {
  // Two stand-ins for what the old sweep iterated: every button inside a
  // .lobby-player-item — a game row's Watch button and a Cancel button.
  listButtons = [new StubButton(), new StubButton()];
  renderOnlineListCalls = 0;
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: () => null,
    querySelectorAll: () => listButtons,
  };
  window.__meccg!.renderOnlineList = () => { renderOnlineListCalls += 1; };
  appState.currentDeckId = null;
});

describe('updatePlayControls online-list buttons', () => {
  test('with no deck selected, online-list buttons are not blanket-disabled (Watch stays clickable)', () => {
    updatePlayControls();
    expect(listButtons.every(b => !b.disabled)).toBe(true);
  });

  test('re-renders the online list so each button re-derives its own disabled state', () => {
    updatePlayControls();
    expect(renderOnlineListCalls).toBe(1);
  });

  test('with a deck selected, a Watch button self-disabled as "Joining..." is not force re-enabled', () => {
    appState.currentDeckId = 'deck-1';
    listButtons[0].textContent = 'Joining...';
    listButtons[0].disabled = true;
    updatePlayControls();
    expect(listButtons[0].disabled).toBe(true);
  });
});
