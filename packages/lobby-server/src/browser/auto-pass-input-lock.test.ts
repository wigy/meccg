/**
 * @module auto-pass-input-lock.test
 *
 * Regression test for bug report "Auto-pass" (b709af9b82181997): with the
 * auto-pass toggle on, the client fires a pass-like action on the player's
 * behalf after a short delay. When the resulting state arrives, `#pass-btn`
 * (a single persistent DOM element reused across renders) gets its
 * `onclick` rebound to the *next* phase's action. A click already in flight
 * toward the pre-auto-pass button — the player reacting to the same board
 * position — can land after that rebind and fire the new handler, silently
 * skipping a phase the player never meant to act on.
 *
 * `sendAction` (game-connection.ts) now ignores user-initiated actions for
 * `AUTO_PASS_INPUT_LOCK_MS` after an auto-pass send, closing the race. This
 * test drives `sendAction` directly against a stub WebSocket rather than
 * the full render pipeline (mirrors the mocking approach in
 * `replay-exit-clears-text-log.test.ts`).
 */

import './test-dom-bootstrap.js'; // must precede browser-module imports (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('./session.js', () => ({
  clearGameSession: vi.fn(), clearPlayerName: vi.fn(), saveGameSession: vi.fn(),
}));
vi.mock('./pseudo-ai.js', () => ({ connectPseudoAi: vi.fn() }));
vi.mock('./render.js', () => ({
  renderState: vi.fn(), renderDraft: vi.fn(), renderMHInfo: vi.fn(), renderSiteInfo: vi.fn(),
  renderFreeCouncilInfo: vi.fn(), renderGameOverView: vi.fn(), renderActions: vi.fn(),
  renderLog: vi.fn(), renderHand: vi.fn(), renderOpponentHand: vi.fn(), renderPlayerNames: vi.fn(),
  renderPhaseMeter: vi.fn(), renderDrafted: vi.fn(), renderPassButton: vi.fn(), renderDeckPiles: vi.fn(),
  resetDeckPiles: vi.fn(), showNotification: vi.fn(), prepareSiteSelection: vi.fn(),
  prepareFetchFromPile: vi.fn(), prepareRevealRemoveFromDiscard: vi.fn(), prepareArrangeDeckTop: vi.fn(),
  clearSelectionState: vi.fn(), setTargetingInstruction: vi.fn(), getTargetingInstruction: vi.fn(),
  renderChainPanel: vi.fn(), clearGameMessageLog: vi.fn(),
}));
vi.mock('./company-view.js', () => ({ renderCompanyViews: vi.fn(), resetCompanyViews: vi.fn() }));
vi.mock('./tutorial-panel.js', () => ({
  clearTutorialPanel: vi.fn(), renderTutorialPanel: vi.fn(), setExitTutorial: vi.fn(),
}));
vi.mock('./dice.js', () => ({ rollDice: vi.fn(), clearDice: vi.fn(), waitForDice: vi.fn(async () => {}) }));
vi.mock('./flip-animate.js', () => ({ snapshotPositions: vi.fn(), animateFromSnapshot: vi.fn() }));
vi.mock('./spectators.js', () => ({ setSpectators: vi.fn() }));
vi.mock('./ask-ai.js', () => ({
  handleAiExplanation: vi.fn(), setAskAiSender: vi.fn(), setObserver: vi.fn(),
}));
vi.mock('./effect-log-buffer.js', () => ({
  queueEffectLog: vi.fn(), flushEffectLog: vi.fn(), clearEffectLog: vi.fn(),
}));
vi.mock('./dice-roll-log.js', () => ({ diceRollLogLine: vi.fn(), diceRollNotification: vi.fn() }));
vi.mock('./render-toolbar-status.js', () => ({ buildToolbarStatusText: vi.fn(() => '') }));

import type { PlayerId } from '@meccg/shared';
import { appState } from './app-state.js';
import { sendAction } from './game-connection.js';

const PLAYER = 'p1' as PlayerId;

class StubWebSocket {
  static OPEN = 1;
  readyState = StubWebSocket.OPEN;
  send = vi.fn();
}

beforeEach(() => {
  appState.ws = new StubWebSocket() as unknown as typeof appState.ws;
  appState.autoPassInputLockUntil = 0;
});

describe('post-auto-pass input lock', () => {
  test('ignores a user action sent while the lock is active', () => {
    appState.autoPassInputLockUntil = Date.now() + 1000;

    sendAction({ type: 'pass', player: PLAYER });

    expect((appState.ws as unknown as StubWebSocket).send).not.toHaveBeenCalled();
  });

  test('accepts a user action once the lock has expired', () => {
    appState.autoPassInputLockUntil = Date.now() - 1;

    sendAction({ type: 'pass', player: PLAYER });

    expect((appState.ws as unknown as StubWebSocket).send).toHaveBeenCalledTimes(1);
  });
});
