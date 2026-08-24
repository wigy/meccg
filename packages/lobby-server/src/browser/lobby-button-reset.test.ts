/**
 * @module lobby-button-reset.test
 *
 * Lobby buttons swap their own label and disable themselves the moment they
 * are clicked ("Starting...", "Stopping...") and wait for a server-driven
 * state change to undo it. Two situations never deliver that change: the
 * server rejecting the action outright, and returning from a game whose
 * launch had swept the whole `.lobby-play-btn` group disabled. Both left the
 * button dimmed for good — worst of all "Stop Existing Game", which is only
 * visible while a lingering game server still lists the player in-game, and
 * whose own reset in the 'online-players' handler runs only once that flag
 * drops back to false (by which point it is hidden again).
 *
 * `resetLobbyButtons` is the shared undo. Uses the hand-rolled DOM stub
 * pattern of `tutorial-complete-exit-button.test.ts` (the package runs vitest
 * in the default node environment, with no jsdom).
 */
import './test-dom-bootstrap.js'; // must precede the lobby-screens import (load-time window access)
import { describe, test, expect, beforeEach } from 'vitest';
import { resetLobbyButtons } from './lobby-screens.js';

class StubButton {
  textContent = '';
  disabled = false;
}

let elements: Record<string, StubButton>;

const IDS = [
  'play-tutorial-btn', 'start-tutorial-btn', 'play-heuristic-ai-btn',
  'play-real-ai-btn', 'start-real-ai-btn', 'play-mc-ai-btn',
  'play-modular-ai-btn', 'play-pseudo-ai-btn', 'stop-game-btn',
];

beforeEach(() => {
  elements = {};
  for (const id of IDS) elements[id] = new StubButton();
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
  };
});

describe('resetLobbyButtons', () => {
  test('re-enables and relabels a stop button left mid-"Stopping..."', () => {
    elements['stop-game-btn'].textContent = 'Stopping...';
    elements['stop-game-btn'].disabled = true;

    resetLobbyButtons();

    expect(elements['stop-game-btn'].disabled).toBe(false);
    expect(elements['stop-game-btn'].textContent).toBe('Stop Existing Game');
  });

  test('re-enables a stop button dimmed by an earlier launch sweep', () => {
    // What a launch used to do: disable every #lobby-screen .lobby-play-btn,
    // stop-game-btn included, without touching its label.
    for (const id of IDS) elements[id].disabled = true;
    elements['stop-game-btn'].textContent = 'Stop Existing Game';

    resetLobbyButtons();

    expect(elements['stop-game-btn'].disabled).toBe(false);
    expect(IDS.every(id => !elements[id].disabled)).toBe(true);
  });

  test('restores each launch button to its idle label', () => {
    elements['play-heuristic-ai-btn'].textContent = 'Starting...';
    elements['play-heuristic-ai-btn'].disabled = true;
    elements['start-tutorial-btn'].textContent = 'Starting...';
    elements['start-tutorial-btn'].disabled = true;

    resetLobbyButtons();

    expect(elements['play-heuristic-ai-btn'].textContent).toBe('Play vs Heuristic-AI');
    expect(elements['play-heuristic-ai-btn'].disabled).toBe(false);
    expect(elements['start-tutorial-btn'].textContent).toBe('Start');
    expect(elements['start-tutorial-btn'].disabled).toBe(false);
  });

  test('tolerates a DOM without the lobby buttons', () => {
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
    expect(() => resetLobbyButtons()).not.toThrow();
  });
});
