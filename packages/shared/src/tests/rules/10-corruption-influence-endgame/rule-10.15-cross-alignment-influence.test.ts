/**
 * @module rule-10.15-cross-alignment-influence
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.15: Cross-Alignment Influence Penalty
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] If a Wizard player's character (not an agent hazard) makes an influence attempt against a Ringwraith player's card or a Balrog player's card, the Wizard player's roll is modified by -5.
 * [MINION] If a Ringwraith player's character (not an agent hazard) makes an influence attempt against a Wizard player's card or a Fallen-wizard player's card, the Ringwraith player's roll is modified by -5.
 * [FALLEN-WIZARD] If a Fallen-wizard player's character (not an agent hazard) makes an influence attempt against a Ringwraith player's card or a Balrog player's card, the Fallen-wizard player's roll is modified by -5.
 * [BALROG] If a Balrog player's character (not an agent hazard) makes an influence attempt against a Wizard player's card or Fallen-wizard player's card, the Balrog player's roll is modified by -5.
 */

import { describe, test, expect } from 'vitest';
import {
  buildResolutionState, attemptInfluence, defendInfluence, viableActions,
  PLAYER_1, Alignment, LEGOLAS,
} from '../../test-helpers.js';
import { crossAlignmentInfluencePenalty } from '../../../alignment-rules.js';
import type { OpponentInfluenceAttemptAction } from '../../test-helpers.js';

describe('Rule 10.15 — Cross-Alignment Influence Penalty', () => {
  test('wizard vs ringwraith: attempt carries -5 cross-alignment penalty', () => {
    const state = buildResolutionState({ p1Alignment: Alignment.Wizard, p2Alignment: Alignment.Ringwraith });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const pending = afterAttempt.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    expect(pending).toBeDefined();
    if (pending?.kind.type !== 'opponent-influence-defend') return;
    expect(pending.kind.attempt.crossAlignmentPenalty).toBe(-5);
  });

  test('wizard vs wizard: no cross-alignment penalty', () => {
    const state = buildResolutionState({ p1Alignment: Alignment.Wizard, p2Alignment: Alignment.Wizard });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const pending = afterAttempt.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    expect(pending).toBeDefined();
    if (pending?.kind.type !== 'opponent-influence-defend') return;
    expect(pending.kind.attempt.crossAlignmentPenalty).toBe(0);
  });

  test('legal-action explanation mentions cross-alignment penalty when applicable', () => {
    const state = buildResolutionState({ p1Alignment: Alignment.Wizard, p2Alignment: Alignment.Ringwraith });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].action.explanation).toContain('cross-alignment penalty: -5');
  });

  test('legal-action explanation omits penalty when alignments do not cross', () => {
    const state = buildResolutionState({ p1Alignment: Alignment.Wizard, p2Alignment: Alignment.Wizard });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].action.explanation).not.toContain('cross-alignment penalty');
  });

  test('helper — cross-alignment pairings from rules 8.W1/8.R1/8.F1/8.B1 return -5', () => {
    expect(crossAlignmentInfluencePenalty(Alignment.Wizard, Alignment.Ringwraith)).toBe(-5);
    expect(crossAlignmentInfluencePenalty(Alignment.Wizard, Alignment.Balrog)).toBe(-5);
    expect(crossAlignmentInfluencePenalty(Alignment.Ringwraith, Alignment.Wizard)).toBe(-5);
    expect(crossAlignmentInfluencePenalty(Alignment.Ringwraith, Alignment.FallenWizard)).toBe(-5);
    expect(crossAlignmentInfluencePenalty(Alignment.FallenWizard, Alignment.Ringwraith)).toBe(-5);
    expect(crossAlignmentInfluencePenalty(Alignment.FallenWizard, Alignment.Balrog)).toBe(-5);
    expect(crossAlignmentInfluencePenalty(Alignment.Balrog, Alignment.Wizard)).toBe(-5);
    expect(crossAlignmentInfluencePenalty(Alignment.Balrog, Alignment.FallenWizard)).toBe(-5);
  });

  test('helper — same-side pairings return 0 (no penalty)', () => {
    expect(crossAlignmentInfluencePenalty(Alignment.Wizard, Alignment.FallenWizard)).toBe(0);
    expect(crossAlignmentInfluencePenalty(Alignment.FallenWizard, Alignment.Wizard)).toBe(0);
    expect(crossAlignmentInfluencePenalty(Alignment.Ringwraith, Alignment.Balrog)).toBe(0);
    expect(crossAlignmentInfluencePenalty(Alignment.Balrog, Alignment.Ringwraith)).toBe(0);
    expect(crossAlignmentInfluencePenalty(Alignment.Wizard, Alignment.Wizard)).toBe(0);
  });

  test('penalty flips a would-be success into a failure', () => {
    // Baseline (same alignment): 12 + 3(DI) - 3(GI) - 2(def) - 0(ctrl) + 0 = 10 > 6(mind) → success.
    // With -5 penalty (wizard vs ringwraith): 10 + -5 = 5, NOT > 6(mind) → failure.
    const state = buildResolutionState({
      p1Alignment: Alignment.Wizard,
      p2Alignment: Alignment.Ringwraith,
      attackerCheatRoll: 12,
    });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const defState = { ...afterAttempt, cheatRollTotal: 2 };
    const { state: afterDefend } = defendInfluence(defState);
    // Legolas should survive (failure) because of the -5 penalty.
    const legolasStillThere = Object.values(afterDefend.players[1].characters).some(
      c => c.definitionId === LEGOLAS,
    );
    expect(legolasStillThere).toBe(true);
  });
});
