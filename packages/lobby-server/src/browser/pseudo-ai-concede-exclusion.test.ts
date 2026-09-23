/**
 * @module pseudo-ai-concede-exclusion.test
 *
 * Regression test for bug report 2a8f3352a4633dab (game mucfigl4-i5p28c,
 * stateSeq 9): a pseudo-AI seat auto-conceded mid character-draft after only
 * 4 of 12 picks. `withConcedeAction` (`@meccg/shared`) always appends a
 * viable `concede` entry to a seat's legal actions; a seat merely waiting on
 * its opponent's simultaneous draft pick (`draft.currentPick !== null`)
 * legitimately has no other legal action, so `concede` was its lone viable
 * entry. `renderPseudoAiActions`'s "auto-pick the sole viable option"
 * shortcut then fired it with no human ever clicking anything.
 *
 * Mirrors `auto-pass-concede-exclusion.test.ts`, which fixed the identical
 * hazard in the human action panel's auto-pass logic.
 */

import './test-dom-bootstrap.js'; // must precede browser-module imports (load-time window access)
import { describe, test, expect } from 'vitest';
import type { PlayerId } from '@meccg/shared';
import { getPseudoAiAutoPick, type DescribedAction } from './pseudo-ai.js';

const PLAYER = 'p2' as PlayerId;

describe('pseudo-AI panel excludes the always-present concede action from auto-pick', () => {
  test('does not auto-fire when concede is the only viable action', () => {
    const actions: DescribedAction[] = [
      { text: 'Concede', action: { type: 'concede', player: PLAYER }, viable: true },
    ];

    expect(getPseudoAiAutoPick(actions)).toBeNull();
  });

  test('still auto-fires for a genuine sole action alongside the always-present concede entry', () => {
    const draftStop = { type: 'draft-stop', player: PLAYER } as const;
    const actions: DescribedAction[] = [
      { text: 'Stop drafting', action: draftStop, viable: true },
      { text: 'Concede', action: { type: 'concede', player: PLAYER }, viable: true },
    ];

    expect(getPseudoAiAutoPick(actions)).toEqual(draftStop);
  });

  test('does not auto-fire when several real options remain', () => {
    const actions: DescribedAction[] = [
      { text: 'Pick A', action: { type: 'draft-pick', player: PLAYER, characterInstanceId: 'p2-1' as never }, viable: true },
      { text: 'Pick B', action: { type: 'draft-pick', player: PLAYER, characterInstanceId: 'p2-2' as never }, viable: true },
      { text: 'Concede', action: { type: 'concede', player: PLAYER }, viable: true },
    ];

    expect(getPseudoAiAutoPick(actions)).toBeNull();
  });
});
