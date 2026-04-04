/**
 * @module rule-6.14-on-guard-reveal-at-resource
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.14: On-Guard Reveal When Playing Resource
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * On-guard Cards - In addition to revealing a creature or hazard that affects an automatic-attack prior to automatic-attacks resolving, the hazard player may reveal an on-guard card during a company's site phase when the company attempts to play a resource that would tap the site if successfully played. This action can only be taken if the card being revealed is a hazard event that would directly affect the company (or an associated entity) or an influence check (including an effect that depends on the result of a currently declared influence attempt), AND any targets for the card existed as legal targets during the company's preceding movement/hazard phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  makeSitePhase, placeOnGuard, viableActions, resolveChain,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS, ARAGORN,
  FOOLISH_WORDS, KNIGHTS_OF_DOL_AMROTH,
  LORIEN, MINAS_TIRITH, DOL_AMROTH,
} from '../../test-helpers.js';
import type { SitePhaseState } from '../../../index.js';

/** Build state: PLAYER_1 at Dol Amroth with Aragorn, faction in hand, Foolish Words on-guard. */
function buildScenario(characters = [ARAGORN]) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, companies: [{ site: DOL_AMROTH, characters }], hand: [KNIGHTS_OF_DOL_AMROTH], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  const { state, ogCard } = placeOnGuard(base, 0, 0, FOOLISH_WORDS);
  return { testState: { ...state, phaseState: makeSitePhase() }, ogCard };
}

describe('Rule 6.14 — On-Guard Reveal When Playing Resource', () => {
  beforeEach(() => resetMint());

  test('influence-attempt with on-guard cards enters awaitingOnGuardReveal', () => {
    const { testState } = buildScenario();

    const influenceAction = viableActions(testState, PLAYER_1, 'influence-attempt')[0];
    expect(influenceAction).toBeDefined();

    const result = reduce(testState, influenceAction.action);
    expect(result.error).toBeUndefined();
    expect((result.state.phaseState as SitePhaseState).awaitingOnGuardReveal).toBe(true);
    expect((result.state.phaseState as SitePhaseState).pendingResourceAction).not.toBeNull();
  });

  test('hazard player gets RevealOnGuardAction for on-guard hazard events', () => {
    const { testState, ogCard } = buildScenario();

    const afterAttempt = reduce(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);
    const revealActions = viableActions(afterAttempt.state, PLAYER_2, 'reveal-on-guard');

    expect(revealActions.length).toBeGreaterThanOrEqual(1);
    expect((revealActions[0].action as { cardInstanceId: string }).cardInstanceId).toBe(ogCard.instanceId);
  });

  test('character-targeting events generate one reveal action per character', () => {
    const { testState } = buildScenario([ARAGORN, GANDALF]);

    const afterAttempt = reduce(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);
    const revealActions = viableActions(afterAttempt.state, PLAYER_2, 'reveal-on-guard');

    // Foolish Words has play-target: character → one action per character
    expect(revealActions).toHaveLength(2);
    const targets = revealActions.map(ea => (ea.action as { targetCharacterId?: string }).targetCharacterId);
    expect(new Set(targets).size).toBe(2);
  });

  test('pass clears the on-guard window and executes the pending resource', () => {
    const { testState } = buildScenario();

    const afterAttempt = reduce(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);

    // Hazard player passes — pending resource should execute
    const afterPass = reduce(afterAttempt.state, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.error).toBeUndefined();
    expect((afterPass.state.phaseState as SitePhaseState).awaitingOnGuardReveal).toBe(false);
    expect((afterPass.state.phaseState as SitePhaseState).pendingResourceAction).toBeNull();
  });

  test('revealing on-guard initiates a chain; after chain resolves, pending resource executes', () => {
    const { testState } = buildScenario();

    const afterAttempt = reduce(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);
    const revealAction = viableActions(afterAttempt.state, PLAYER_2, 'reveal-on-guard')[0];
    const afterReveal = reduce(afterAttempt.state, revealAction.action);

    expect(afterReveal.error).toBeUndefined();
    expect(afterReveal.state.chain).not.toBeNull();

    // Resolve the chain
    const afterChain = resolveChain(afterReveal.state);
    expect(afterChain.chain).toBeNull();

    // Pass to trigger pending resource execution
    const afterExec = reduce(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterExec.error).toBeUndefined();
    expect((afterExec.state.phaseState as SitePhaseState).pendingResourceAction).toBeNull();
  });
});
