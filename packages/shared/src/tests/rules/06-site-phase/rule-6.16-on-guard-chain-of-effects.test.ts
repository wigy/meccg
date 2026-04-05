/**
 * @module rule-6.16-on-guard-chain-of-effects
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.16: On-Guard Chain of Effects
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * When an on-guard card is revealed in response to a resource being played, it initiates a separate chain of events that is treated as if it had been declared immediately prior to the chain of effects during which it was revealed. Once players finish responding to this on-guard-initiated chain of effects and the on-guard chain resolves (as well as any passive-condition-initiated chains of effects that would normally follow), the original chain of effects then resumes.
 *
 * On-guard creatures revealed at Step 1 are declared for attack but do not
 * initiate combat until Step 4 (resolve-attacks), where they enter the chain.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  makeSitePhase, placeOnGuard, viableActions, resolveChain,
  PLAYER_1, PLAYER_2,
  LEGOLAS, ARAGORN,
  BARROW_WIGHT, FOOLISH_WORDS, KNIGHTS_OF_DOL_AMROTH,
  LORIEN, MORIA, MINAS_TIRITH, DOL_AMROTH,
} from '../../test-helpers.js';
import type { SitePhaseState } from '../../../index.js';

describe('Rule 6.16 — On-Guard Chain of Effects', () => {
  beforeEach(() => resetMint());

  test('creature reveal at Step 1 is a declaration — no chain yet', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const { state, ogCard } = placeOnGuard(base, 0, 0, BARROW_WIGHT);
    const testState = { ...state, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const result = reduce(testState, { type: 'reveal-on-guard', player: PLAYER_2, cardInstanceId: ogCard.instanceId });
    expect(result.error).toBeUndefined();
    expect(result.state.chain).toBeNull();
    expect(result.state.combat).toBeNull();
    expect((result.state.phaseState as SitePhaseState).declaredOnGuardAttacks).toHaveLength(1);
  });

  test('at Step 4 (resolve-attacks), declared creature enters the chain', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const { ogCard } = placeOnGuard(base, 0, 0, BARROW_WIGHT);
    const testState = {
      ...base,
      phaseState: makeSitePhase({ step: 'resolve-attacks', siteEntered: true, declaredOnGuardAttacks: [ogCard] }),
    };

    const afterResolve = reduce(testState, { type: 'pass', player: PLAYER_1 });
    expect(afterResolve.error).toBeUndefined();
    expect(afterResolve.state.chain).not.toBeNull();
    expect(afterResolve.state.chain!.priority).toBe(PLAYER_1);
  });

  test('after creature chain resolves at Step 4, combat is initiated', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const { ogCard } = placeOnGuard(base, 0, 0, BARROW_WIGHT);
    const testState = {
      ...base,
      phaseState: makeSitePhase({ step: 'resolve-attacks', siteEntered: true, declaredOnGuardAttacks: [ogCard] }),
    };

    const afterPass = reduce(testState, { type: 'pass', player: PLAYER_1 });
    const afterChain = resolveChain(afterPass.state);
    expect(afterChain.combat).not.toBeNull();
  });

  test('revealed on-guard event at resource play initiates a nested chain', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_AMROTH, characters: [ARAGORN] }], hand: [KNIGHTS_OF_DOL_AMROTH], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const { state } = placeOnGuard(base, 0, 0, FOOLISH_WORDS);
    const testState = { ...state, phaseState: makeSitePhase() };

    const afterAttempt = reduce(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);
    const afterReveal = reduce(afterAttempt.state, viableActions(afterAttempt.state, PLAYER_2, 'reveal-on-guard')[0].action);

    expect(afterReveal.state.chain).not.toBeNull();
    expect(afterReveal.state.chain!.priority).toBe(PLAYER_1);
  });
});
