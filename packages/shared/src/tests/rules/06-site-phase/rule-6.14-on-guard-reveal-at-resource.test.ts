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
  resetMint, dispatch, resolveChain,
  viableActions,
  buildOnGuardSiteScenario,
  PLAYER_1, PLAYER_2,
  GANDALF, ARAGORN,
  FOOLISH_WORDS, DOORS_OF_NIGHT, KNIGHTS_OF_DOL_AMROTH,
  DOL_AMROTH,
} from '../../test-helpers.js';

const DEFAULT_SCENARIO = {
  site: DOL_AMROTH,
  heroHand: [KNIGHTS_OF_DOL_AMROTH],
  onGuard: FOOLISH_WORDS,
} as const;

describe('Rule 6.14 — On-Guard Reveal When Playing Resource', () => {
  beforeEach(() => resetMint());

  test('influence-attempt with on-guard cards initiates a chain', () => {
    const { testState } = buildOnGuardSiteScenario(DEFAULT_SCENARIO);

    const influenceAction = viableActions(testState, PLAYER_1, 'influence-attempt')[0];
    expect(influenceAction).toBeDefined();

    const nextState = dispatch(testState, influenceAction.action);
    // Chain is active (faction card on chain, opponent has priority)
    expect(nextState.chain).not.toBeNull();
    expect(nextState.chain!.priority).toBe(PLAYER_2);
    expect(nextState.chain!.entries).toHaveLength(1);
    expect(nextState.chain!.entries[0].payload.type).toBe('influence-attempt');
  });

  test('hazard player gets RevealOnGuardAction during influence-attempt chain', () => {
    const { testState, ogCard } = buildOnGuardSiteScenario(DEFAULT_SCENARIO);

    const afterAttempt = dispatch(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);
    const revealActions = viableActions(afterAttempt, PLAYER_2, 'reveal-on-guard');

    expect(revealActions.length).toBeGreaterThanOrEqual(1);
    expect((revealActions[0].action as { cardInstanceId: string }).cardInstanceId).toBe(ogCard.instanceId);
  });

  test('character-targeting events generate one reveal action per character', () => {
    const { testState } = buildOnGuardSiteScenario({ ...DEFAULT_SCENARIO, heroChars: [ARAGORN, GANDALF] });

    const afterAttempt = dispatch(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);
    const revealActions = viableActions(afterAttempt, PLAYER_2, 'reveal-on-guard');

    // Foolish Words has play-target: character → one action per character
    expect(revealActions).toHaveLength(2);
    const targets = revealActions.map(ea => (ea.action as { targetCharacterId?: string }).targetCharacterId);
    expect(new Set(targets).size).toBe(2);
  });

  test('both players passing chain priority resolves influence attempt', () => {
    const { testState } = buildOnGuardSiteScenario(DEFAULT_SCENARIO);

    const afterAttempt = dispatch(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);

    // Resolve chain (both players pass). Auto-resolution stops at the
    // influence-attempt entry, which pauses the chain so the player can
    // commit to the roll via a pending faction-influence-roll resolution.
    const afterChain = resolveChain(afterAttempt);
    expect(viableActions(afterChain, PLAYER_1, 'faction-influence-roll')).toHaveLength(1);
  });

  test('revealing on-guard pushes entry onto chain; after chain resolves, influence roll executes', () => {
    const { testState } = buildOnGuardSiteScenario(DEFAULT_SCENARIO);

    const afterAttempt = dispatch(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);
    const revealAction = viableActions(afterAttempt, PLAYER_2, 'reveal-on-guard')[0];
    const afterReveal = dispatch(afterAttempt, revealAction.action);

    expect(afterReveal.chain).not.toBeNull();
    // Chain now has 2 entries: influence-attempt + on-guard event
    expect(afterReveal.chain!.entries).toHaveLength(2);

    // Resolve the chain. The on-guard event resolves first, then auto-resolve
    // pauses at the influence-attempt entry awaiting the player's roll.
    const afterChain = resolveChain(afterReveal);
    expect(viableActions(afterChain, PLAYER_1, 'faction-influence-roll')).toHaveLength(1);
  });

  test('hazard events without on-guard-reveal trigger cannot be revealed (e.g. Doors of Night)', () => {
    // Doors of Night is an environment event with no on-guard-reveal effect.
    // Per rule 2.V.6, it does not directly affect the company, so it must
    // not be revealable from on-guard during an influence attempt.
    const { testState } = buildOnGuardSiteScenario({ ...DEFAULT_SCENARIO, onGuard: DOORS_OF_NIGHT });

    const afterAttempt = dispatch(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);
    const revealActions = viableActions(afterAttempt, PLAYER_2, 'reveal-on-guard');

    expect(revealActions).toHaveLength(0);
  });
});
