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
  buildTestState, resetMint, Phase, dispatch, mint,
  makeSitePhase, placeOnGuard, viableActions, resolveChain,
  PLAYER_1, PLAYER_2,
  LEGOLAS, ARAGORN,
  BARROW_WIGHT, FOOLISH_WORDS, KNIGHTS_OF_DOL_AMROTH,
  LORIEN, MORIA, MINAS_TIRITH, DOL_AMROTH,
} from '../../test-helpers.js';
import type { OnGuardCard, CardDefinitionId, GameState } from '../../../index.js';

/** Place a revealed on-guard card on a company. */
function placeRevealedOnGuard(
  state: GameState,
  playerIdx: number,
  companyIdx: number,
  hazardDefId: CardDefinitionId,
): { state: GameState; ogCard: OnGuardCard } {
  const ogCard: OnGuardCard = { instanceId: mint(), definitionId: hazardDefId, revealed: true };
  const company = state.players[playerIdx].companies[companyIdx];
  const updatedCompany = { ...company, onGuardCards: [...company.onGuardCards, ogCard] };
  const updatedCompanies = [...state.players[playerIdx].companies];
  updatedCompanies[companyIdx] = updatedCompany;
  const updatedPlayer = { ...state.players[playerIdx], companies: updatedCompanies };
  const p0 = playerIdx === 0 ? updatedPlayer : state.players[0];
  const p1 = playerIdx === 1 ? updatedPlayer : state.players[1];
  return { state: { ...state, players: [p0, p1] as unknown as typeof state.players }, ogCard };
}

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

    const nextState = dispatch(testState, { type: 'reveal-on-guard', player: PLAYER_2, cardInstanceId: ogCard.instanceId });
    expect(nextState.chain).toBeNull();
    expect(nextState.combat).toBeNull();
    const og = nextState.players[0].companies[0].onGuardCards;
    expect(og).toHaveLength(1);
    expect(og[0].revealed).toBe(true);
  });

  test('at Step 4 (resolve-attacks), declared creature enters the chain', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const { state: withOG } = placeRevealedOnGuard(base, 0, 0, BARROW_WIGHT);
    const testState = {
      ...withOG,
      phaseState: makeSitePhase({ step: 'resolve-attacks', siteEntered: true }),
    };

    const afterResolve = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    expect(afterResolve.chain).not.toBeNull();
    expect(afterResolve.chain!.priority).toBe(PLAYER_1);
  });

  test('after creature chain resolves at Step 4, combat is initiated', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const { state: withOG } = placeRevealedOnGuard(base, 0, 0, BARROW_WIGHT);
    const testState = {
      ...withOG,
      phaseState: makeSitePhase({ step: 'resolve-attacks', siteEntered: true }),
    };

    const afterPass = dispatch(testState, { type: 'pass', player: PLAYER_1 });
    const afterChain = resolveChain(afterPass);
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

    const afterAttempt = dispatch(testState, viableActions(testState, PLAYER_1, 'influence-attempt')[0].action);
    const afterReveal = dispatch(afterAttempt, viableActions(afterAttempt, PLAYER_2, 'reveal-on-guard')[0].action);

    expect(afterReveal.chain).not.toBeNull();
    expect(afterReveal.chain!.priority).toBe(PLAYER_1);
  });
});
