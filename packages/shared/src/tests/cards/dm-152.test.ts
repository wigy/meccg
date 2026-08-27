/**
 * @module dm-152.test
 *
 * Card: Ordered to Kill (dm-152)
 * Type: hero-resource-event (permanent)
 *
 * "Each face up agent must attack if a company enters a site where he is
 * located. Additionally, any unrevealed on-guard cards are discarded instead
 * of being returned to their owner's hand. Discard when any play deck is
 * exhausted. Cannot be duplicated."
 *
 * Effects tested:
 * 1. force-agent-attack: while in play, the hazard player's pass option
 *    during the declare-agent-attack step (CoE 2.V.iii) is removed whenever
 *    a *revealed* agent stands at the company's current site — the attack
 *    becomes mandatory. A face-down agent at the same site remains optional,
 *    and pass stays available when no qualifying agent is present at all.
 * 2. discard-unrevealed-on-guard: at site-phase cleanup, on-guard cards left
 *    on a company (always unrevealed by that point) go to the hazard
 *    player's discard pile instead of their hand.
 * 3. on-event play-deck-exhausted: the card moves to the discard pile when a
 *    play deck exhaust completes.
 * 4. duplication-limit scope:game max:1: cannot be played while a copy is
 *    already in cardsInPlay.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint,
  dispatch, viableActions,
  makeSitePhase, makeAgent, withAgentInPlay, placeOnGuard, addCardInPlay,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, MORIA,
  expectInPile, expectNotInPile,
} from '../test-helpers.js';
import { Phase, CardStatus, computeLegalActions } from '../../index.js';
import type {
  SiteInPlay, CardDefinitionId, EndOfTurnPhaseState,
} from '../../index.js';

const ORDERED_TO_KILL = 'dm-152' as CardDefinitionId;
const ANARIN = 'dm-1' as CardDefinitionId; // minion agent, homesite Moria, no special effects — a neutral control
const STOUT_MEN = 'as-21' as CardDefinitionId; // hazard creature, for on-guard

describe('Ordered to Kill (dm-152)', () => {
  beforeEach(() => resetMint());

  // --- 1. force-agent-attack -------------------------------------------------

  describe('force-agent-attack', () => {
    function declareStateWithAgent(revealed: boolean) {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const agentSite: SiteInPlay = { instanceId: mint(), definitionId: MORIA, status: CardStatus.Untapped };
      const agent = { ...makeAgent(ANARIN, { revealed }), siteStack: [agentSite] };
      const withAgent = withAgentInPlay(base, HAZARD_PLAYER, agent);
      return { ...withAgent, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) };
    }

    test('baseline: pass is offered alongside a face-up agent attack (no card in play)', () => {
      const state = declareStateWithAgent(true);
      expect(viableActions(state, PLAYER_2, 'declare-agent-attack').length).toBeGreaterThan(0);
      expect(viableActions(state, PLAYER_2, 'pass')).toHaveLength(1);
    });

    test('a face-up agent at the company\'s site must attack — pass is unavailable', () => {
      const state = addCardInPlay(declareStateWithAgent(true), RESOURCE_PLAYER, ORDERED_TO_KILL);

      const attacks = viableActions(state, PLAYER_2, 'declare-agent-attack');
      expect(attacks.length).toBeGreaterThan(0);
      expect(viableActions(state, PLAYER_2, 'pass')).toHaveLength(0);

      // The forced attack still resolves normally.
      const after = dispatch(state, attacks[0].action);
      expect(after.combat).not.toBeNull();
      expect(after.combat!.attackSource).toMatchObject({ type: 'agent' });
    });

    test('a face-down agent at the site remains optional — pass stays available', () => {
      const state = addCardInPlay(declareStateWithAgent(false), RESOURCE_PLAYER, ORDERED_TO_KILL);

      expect(viableActions(state, PLAYER_2, 'declare-agent-attack').length).toBeGreaterThan(0);
      expect(viableActions(state, PLAYER_2, 'pass')).toHaveLength(1);
    });

    test('pass stays available when no agent is present at all', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const declareState = { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) };
      const state = addCardInPlay(declareState, RESOURCE_PLAYER, ORDERED_TO_KILL);

      expect(viableActions(state, PLAYER_2, 'declare-agent-attack')).toHaveLength(0);
      expect(viableActions(state, PLAYER_2, 'pass')).toHaveLength(1);
    });
  });

  // --- 2. discard-unrevealed-on-guard -----------------------------------------

  describe('discard-unrevealed-on-guard', () => {
    function siteCleanupStateWithOnGuard() {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const { state: withOnGuard, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, STOUT_MEN);
      const companyId = withOnGuard.players[RESOURCE_PLAYER].companies[0].id;
      const atCleanup = { ...withOnGuard, phaseState: makeSitePhase({ step: 'select-company', handledCompanyIds: [companyId] }) };
      return { atCleanup, ogCard };
    }

    test('baseline: leftover on-guard cards return to the hazard player\'s hand (no card in play)', () => {
      const { atCleanup, ogCard } = siteCleanupStateWithOnGuard();

      const after = dispatch(atCleanup, { type: 'pass', player: PLAYER_1 });

      expectInPile(after, HAZARD_PLAYER, 'hand', ogCard.definitionId);
      expect(after.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(0);
    });

    test('with Ordered to Kill in play, leftover on-guard cards are discarded instead', () => {
      const { atCleanup, ogCard } = siteCleanupStateWithOnGuard();
      const withEvent = addCardInPlay(atCleanup, RESOURCE_PLAYER, ORDERED_TO_KILL);

      const after = dispatch(withEvent, { type: 'pass', player: PLAYER_1 });

      expectInPile(after, HAZARD_PLAYER, 'discardPile', ogCard.definitionId);
      expectNotInPile(after, HAZARD_PLAYER, 'hand', ogCard.definitionId);
      expect(after.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(0);
    });
  });

  // --- 3. play-deck-exhausted --------------------------------------------------

  test('card discards when a play deck exhaust completes', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [], playDeck: [], discardPile: [LEGOLAS] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, RESOURCE_PLAYER, ORDERED_TO_KILL);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === ORDERED_TO_KILL)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    // Own deck exhausting: CRF 22 "Exhausted" shuffles the discard into the new play deck.
    expectInPile(afterPass, RESOURCE_PLAYER, 'playDeck', ORDERED_TO_KILL);
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === ORDERED_TO_KILL)).toBe(false);
  });

  // --- 4. duplication-limit -----------------------------------------------------

  test('cannot be duplicated — not playable when a copy is already in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [ORDERED_TO_KILL], siteDeck: [] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const withEvent = addCardInPlay(base, RESOURCE_PLAYER, ORDERED_TO_KILL);

    const playActions = computeLegalActions(withEvent, PLAYER_1)
      .filter(a => a.action.type === 'play-permanent-event');
    expect(playActions.every(a => !a.viable)).toBe(true);
  });
});
