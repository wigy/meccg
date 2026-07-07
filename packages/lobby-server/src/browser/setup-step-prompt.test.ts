/**
 * @module setup-step-prompt.test
 *
 * Regression test for bug report fa3a80fc22ae212b (game mrahfk9s-eaeybx, seq
 * 19): during the character-deck-draft setup step the board offered
 * `add-character-to-deck` actions but showed no on-screen text telling the
 * player they must click characters to add them to their play deck — the phase
 * meter only renders a terse "Deck Draft" segment. {@link setupStepPrompt} now
 * returns an instruction banner for the deck-draft (and sibling) setup steps
 * whenever the viewer still holds a viable action, which `renderSetupBanner`
 * draws at the top of the visual board.
 */

import './test-dom-bootstrap.js';
import { describe, test, expect } from 'vitest';
import type { PlayerView, EvaluatedAction } from '@meccg/shared';
import { setupStepPrompt } from './render-board.js';

const addToDeck: EvaluatedAction = {
  action: { type: 'add-character-to-deck', player: 'p1', characterInstanceId: 'p1-9' },
  viable: true,
} as unknown as EvaluatedAction;

const passOnly: EvaluatedAction = {
  action: { type: 'pass', player: 'p1' },
  viable: true,
} as unknown as EvaluatedAction;

const setupView = (step: string, legalActions: EvaluatedAction[]): PlayerView =>
  ({ phaseState: { phase: 'setup', setupStep: { step } }, legalActions } as unknown as PlayerView);

describe('setupStepPrompt', () => {
  test('prompts the player to build their play deck during character-deck-draft', () => {
    const prompt = setupStepPrompt(setupView('character-deck-draft', [addToDeck, passOnly]));
    expect(prompt).not.toBeNull();
    expect(prompt?.title).toBe('Build Your Play Deck');
    expect(prompt?.detail.toLowerCase()).toContain('play deck');
  });

  test('returns null once the viewer has finished the step (no viable actions)', () => {
    // A player who pressed Done has an empty legal-action set and is waiting for
    // the opponent — they must not see the instruction.
    expect(setupStepPrompt(setupView('character-deck-draft', []))).toBeNull();
  });

  test('uses item-draft wording during the item-draft step', () => {
    const prompt = setupStepPrompt(setupView('item-draft', [passOnly]));
    expect(prompt?.title).toBe('Assign Starting Items');
  });

  test('returns null outside the setup phase', () => {
    const view = { phaseState: { phase: 'organization' }, legalActions: [passOnly] } as unknown as PlayerView;
    expect(setupStepPrompt(view)).toBeNull();
  });
});
