/**
 * @module as-31.test
 *
 * Card: Near to Hear a Whisper (as-31)
 * Type: hazard-event (permanent)
 *
 * "Any agent may attack a company at his site at the start of the site phase
 * if the company chooses not to enter the site. May be revealed on-guard if
 * the company chooses not to enter the site. Discard when any play deck is
 * exhausted. Cannot be duplicated."
 *
 * Effects tested:
 * 1. agent-attack-on-skip: while in play, a company's `pass` at
 *    `enter-or-skip` no longer ends its site-phase slot immediately — the
 *    hazard player gets a `declare-agent-attack` opportunity first (an agent
 *    at the company's site may still attack), and the company never counts
 *    as having entered the site (`siteEntered` stays false, so the flow never
 *    reaches `play-resources`).
 * 2. on-guard-reveal trigger company-skips-site: the card itself, held
 *    face-down on-guard, may be revealed the moment its company passes on
 *    entering the site — which activates its own agent-attack-on-skip rule
 *    for the rest of that window.
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
  ARAGORN, MORIA, LEGOLAS,
} from '../test-helpers.js';
import { Phase, CardStatus, computeLegalActions } from '../../index.js';
import type {
  SiteInPlay, CardDefinitionId, SitePhaseState, EndOfTurnPhaseState,
} from '../../index.js';

const NEAR_TO_HEAR = 'as-31' as CardDefinitionId;
const ANARIN = 'dm-1' as CardDefinitionId; // minion agent, homesite Moria, no special effects — a neutral control

function baseSkipState() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
    ],
  });
}

function stateWithAgent(revealed: boolean) {
  const agentSite: SiteInPlay = { instanceId: mint(), definitionId: MORIA, status: CardStatus.Untapped };
  const agent = { ...makeAgent(ANARIN, { revealed }), siteStack: [agentSite] };
  return withAgentInPlay(baseSkipState(), HAZARD_PLAYER, agent);
}

describe('Near to Hear a Whisper (as-31)', () => {
  beforeEach(() => resetMint());

  // --- 1. agent-attack-on-skip ------------------------------------------------

  describe('agent-attack-on-skip', () => {
    test('baseline: without the card in play, passing ends the site phase immediately (no agent-attack window)', () => {
      const withAgent = stateWithAgent(true);
      const state = { ...withAgent, phaseState: makeSitePhase({ step: 'enter-or-skip', siteEntered: false }) };

      const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

      // A single company with no card in play: the pass ends the whole site
      // phase, never offering a declare-agent-attack window.
      expect(after.phaseState.phase).toBe(Phase.EndOfTurn);
    });

    test('with the card in play, passing opens a reveal/agent-attack window instead of ending the slot', () => {
      const withAgent = stateWithAgent(true);
      const withCard = addCardInPlay(withAgent, HAZARD_PLAYER, NEAR_TO_HEAR);
      const state = { ...withCard, phaseState: makeSitePhase({ step: 'enter-or-skip', siteEntered: false }) };

      const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
      const phase = afterPass.phaseState as SitePhaseState;
      expect(phase.step).toBe('skip-site-reveal-on-guard');
      expect(phase.skippedSiteEntry).toBe(true);

      // No eligible on-guard cards here, so only pass is offered.
      expect(viableActions(afterPass, PLAYER_2, 'pass')).toHaveLength(1);
      expect(viableActions(afterPass, PLAYER_2, 'reveal-on-guard')).toHaveLength(0);
    });

    test('a face-up agent at the site may declare an attack even though the company skipped it', () => {
      const withAgent = stateWithAgent(true);
      const withCard = addCardInPlay(withAgent, HAZARD_PLAYER, NEAR_TO_HEAR);
      const state = { ...withCard, phaseState: makeSitePhase({ step: 'enter-or-skip', siteEntered: false }) };

      const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
      const afterWindowPass = dispatch(afterPass, { type: 'pass', player: PLAYER_2 });
      expect((afterWindowPass.phaseState as SitePhaseState).step).toBe('declare-agent-attack');

      const attacks = viableActions(afterWindowPass, PLAYER_2, 'declare-agent-attack');
      expect(attacks.length).toBeGreaterThan(0);

      const afterAttack = dispatch(afterWindowPass, attacks[0].action);
      expect(afterAttack.combat).not.toBeNull();
      expect(afterAttack.combat!.attackSource).toMatchObject({ type: 'agent' });
      // The company still never "entered" the site — only faced the attack
      // this card allows.
      expect((afterAttack.phaseState as SitePhaseState).siteEntered).toBe(false);
    });

    test('declining the agent attack still returns to the next company, never play-resources', () => {
      const withAgent = stateWithAgent(true);
      const withCard = addCardInPlay(withAgent, HAZARD_PLAYER, NEAR_TO_HEAR);
      const state = { ...withCard, phaseState: makeSitePhase({ step: 'enter-or-skip', siteEntered: false }) };

      const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
      const afterWindowPass = dispatch(afterPass, { type: 'pass', player: PLAYER_2 });
      const afterDecline = dispatch(afterWindowPass, { type: 'pass', player: PLAYER_2 });

      const declinedPhase = afterDecline.phaseState as SitePhaseState;
      expect(declinedPhase.step).toBe('resolve-attacks');
      expect(declinedPhase.siteEntered).toBe(false);

      const afterResolve = dispatch(afterDecline, { type: 'pass', player: PLAYER_1 });
      // Only one company existed, so the site phase ends outright — it never
      // opens play-resources for a company that skipped its site.
      expect(afterResolve.phaseState.phase).toBe(Phase.EndOfTurn);
    });
  });

  // --- 2. on-guard-reveal: company-skips-site ---------------------------------

  describe('on-guard-reveal (company-skips-site trigger)', () => {
    function stateWithOnGuardCard() {
      const { state: withOnGuard, ogCard } = placeOnGuard(baseSkipState(), RESOURCE_PLAYER, 0, NEAR_TO_HEAR);
      const state = { ...withOnGuard, phaseState: makeSitePhase({ step: 'enter-or-skip', siteEntered: false }) };
      return { state, ogCard };
    }

    test('becomes revealable the moment the company chooses not to enter the site', () => {
      const { state, ogCard } = stateWithOnGuardCard();

      const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
      const phase = afterPass.phaseState as SitePhaseState;
      expect(phase.step).toBe('skip-site-reveal-on-guard');
      expect(phase.skippedSiteEntry).toBe(true);

      const reveals = viableActions(afterPass, PLAYER_2, 'reveal-on-guard');
      expect(reveals).toHaveLength(1);
      expect((reveals[0].action as { cardInstanceId: unknown }).cardInstanceId).toBe(ogCard.instanceId);
    });

    test('revealing moves the card from on-guard into the hazard player\'s cardsInPlay', () => {
      const { state } = stateWithOnGuardCard();
      const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
      const reveals = viableActions(afterPass, PLAYER_2, 'reveal-on-guard');

      const afterReveal = dispatch(afterPass, reveals[0].action);

      expect(afterReveal.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(0);
      expect(afterReveal.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NEAR_TO_HEAR)).toBe(true);
    });

    test('revealing it activates agent-attack-on-skip for the rest of this window', () => {
      const { state } = stateWithOnGuardCard();
      const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
      const reveals = viableActions(afterPass, PLAYER_2, 'reveal-on-guard');
      const afterReveal = dispatch(afterPass, reveals[0].action);

      // Passing now (no more reveals wanted) should move on to
      // declare-agent-attack, since the just-revealed copy turned the rule on.
      const afterWindowPass = dispatch(afterReveal, { type: 'pass', player: PLAYER_2 });
      expect((afterWindowPass.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
    });

    test('with no eligible on-guard card and no copy in play, no reveal is offered', () => {
      // A different hazard-event on guard (no company-skips-site trigger) —
      // control to confirm the window is not offered indiscriminately.
      const { state: withOnGuard } = placeOnGuard(baseSkipState(), RESOURCE_PLAYER, 0, 'as-32' as CardDefinitionId);
      const state = { ...withOnGuard, phaseState: makeSitePhase({ step: 'enter-or-skip', siteEntered: false }) };

      const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
      // Neither agent-attack-on-skip nor an eligible on-guard reveal applies
      // — the pass ends the site phase immediately, as in the CoE default.
      expect(after.phaseState.phase).toBe(Phase.EndOfTurn);
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
    const withEvent = addCardInPlay(resetHandState, RESOURCE_PLAYER, NEAR_TO_HEAR);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === NEAR_TO_HEAR)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].playDeck.some(c => c.definitionId === NEAR_TO_HEAR)).toBe(true);
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === NEAR_TO_HEAR)).toBe(false);
  });

  // --- 4. duplication-limit -----------------------------------------------------

  test('cannot be duplicated — not playable when a copy is already in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [NEAR_TO_HEAR], siteDeck: [] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const withEvent = addCardInPlay(base, RESOURCE_PLAYER, NEAR_TO_HEAR);

    const playActions = computeLegalActions(withEvent, PLAYER_1)
      .filter(a => a.action.type === 'play-permanent-event');
    expect(playActions.every(a => !a.viable)).toBe(true);
  });
});
