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
 * Only declared or ongoing effects may be considered when determining the validity of revealing an on-guard card. Potential effects cannot be considered (except for passive conditions that would depend on the result of a declared influence attempt).
 * Cards that are specifically playable on a character facing an attack or strike cannot be revealed on-guard because the target did not exist during the movement/hazard phase.
 * If an on-guard card is revealed that would (indirectly) tap a character that was just tapped to play a resource, the character remains tapped and the play of the resource proceeds normally.
 * On-guard cards placed on a company's site can only be revealed against, and can only affect, the same company on which the on-guard card was placed or a new company comprising that same company (unless the hazard states that it affects all versions of the site).
 * When an on-guard card is revealed, it immediately ceases to be considered an on-guard card.
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

describe('Rule 6.16 — On-Guard Chain of Effects', () => {
  beforeEach(() => resetMint());

  test('revealed on-guard creature initiates a chain, not direct combat', () => {
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
    expect(result.state.chain).not.toBeNull();
    expect(result.state.combat).toBeNull();
  });

  test('resource player gets chain priority after creature reveal', () => {
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
    expect(result.state.chain!.priority).toBe(PLAYER_1);
  });

  test('after chain resolves, creature combat is initiated', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const { state, ogCard } = placeOnGuard(base, 0, 0, BARROW_WIGHT);
    const testState = { ...state, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const afterReveal = reduce(testState, { type: 'reveal-on-guard', player: PLAYER_2, cardInstanceId: ogCard.instanceId });
    const afterChain = resolveChain(afterReveal.state);
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
