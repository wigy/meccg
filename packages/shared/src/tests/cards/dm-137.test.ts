/**
 * @module dm-137.test
 *
 * Card test: Here Is a Snake! (dm-137)
 * Type: hero-resource-event (wizard alignment, short event)
 * Effects: 3
 *   1. play-window: movement-hazard, step play-hazards (after cards have
 *      been drawn)
 *   2. play-target: company
 *   3. on-event self-enters-play → enqueue-reveal-hazards-choice, target
 *      target-company
 *
 * Text:
 *   "Playable on a company during its movement/hazard phase after cards have
 *    been drawn. Opponent may reveal to you any number of hazards from his
 *    hand. He may only play hazards he revealed to you (including on-guard
 *    cards) for the remainder of target company's movement/hazard phase.
 *    Alternatively, a face-down agent is tapped and revealed."
 *
 * Engine Support:
 * | # | Rule (card text)                                        | Status      | Mechanism                                                    |
 * |---|----------------------------------------------------------|-------------|---------------------------------------------------------------|
 * | 1 | Playable on a company during M/H after cards drawn       | IMPLEMENTED | play-window movement-hazard/play-hazards + play-target company|
 * | 2 | Opponent may reveal any number of hazards from hand      | IMPLEMENTED | reveal-hazards-choice resolution, reveal-hazard-for-snake      |
 * | 3 | He may only play revealed hazards for rest of the M/H     | IMPLEMENTED | only-revealed-hazards-on-company constraint (play-hazard filter)|
 * | 4 | ...including on-guard cards                              | IMPLEMENTED | onGuardWindowActions consults the same constraint directly    |
 * | 5 | Alternatively, a face-down agent is tapped and revealed  | IMPLEMENTED | tap-reveal-agent-for-snake (only while nothing yet revealed)   |
 *
 * Playable: YES
 * Certified: 2026-08-01
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  companyIdAt, findHandCardId, mint, placeOnGuard,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, CompanyId, GameState, GameAction, ResolutionId,
  PlayShortEventAction, PlayHazardAction,
} from '../../index.js';
import { Phase, CardStatus, Alignment, ZERO_EFFECTIVE_STATS } from '../../index.js';
import type { AgentInPlay, CharacterInPlay, SiteInPlay } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const HERE_IS_A_SNAKE = 'dm-137' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;
const LEGOLAS = 'tw-168' as CardDefinitionId;
const LORIEN = 'tw-408' as CardDefinitionId;
const MORIA = 'tw-413' as CardDefinitionId;
const GLAMDRING = 'tw-244' as CardDefinitionId; // hero-resource-item, for the on-guard deferred-play test

// Two simple hazard-event cards (both `play-target: character`, so they are
// playable against Aragorn with no region/site keying setup required).
const LURE_OF_THE_SENSES = 'tw-60' as CardDefinitionId; // hazard-event, non-Ringwraith character
const FOOLISH_WORDS = 'td-25' as CardDefinitionId;      // hazard-event, any character

// Baduila (dm-2): minion agent character, homesite "Goblin-gate, Mount Gundabad".
const BADUILA = 'dm-2' as CardDefinitionId;
const AGENT_CHAR_ID = 'test-dm137-agent-char' as CardInstanceId;
const AGENT_SITE_ID = 'test-dm137-agent-site' as CardInstanceId;

// Heedless Revelry (le-114): on-guard-reveal trigger "resource-play" with a
// playedFilter admitting hero-resource-item plays — used for the "including
// on-guard cards" scenario.
const HEEDLESS_REVELRY = 'le-114' as CardDefinitionId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: BADUILA,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const AGENT_SITE: SiteInPlay = {
  instanceId: AGENT_SITE_ID,
  definitionId: MORIA,
  status: CardStatus.Untapped,
};

const BASE_AGENT: AgentInPlay = {
  id: 'agent-0-0' as CompanyId,
  character: AGENT_CHAR,
  revealed: false,
  siteStack: [AGENT_SITE],
  remainingActions: 1,
  inPlayAtTurnStart: true,
  attackedThisSitePhase: false,
  discardAtEndOfTurn: false,
};

/**
 * P1 (hero) has one company at Lórien in the movement/hazard phase's
 * play-hazards step, with "Here Is a Snake!" and Glamdring in hand. P2
 * (Ringwraith) has a filler company and, by default, two hazard-events in
 * hand to reveal. Neither player has a location deck, so tap-reveal-agent's
 * `revealAgentActions` always takes the no-home-site branch (reveal is
 * unconditional, agent discarded at end of turn) — irrelevant to what these
 * tests check.
 */
function baseState(hazardHand: CardDefinitionId[] = [LURE_OF_THE_SENSES, FOOLISH_WORDS]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: LORIEN, characters: [ARAGORN] }],
        hand: [HERE_IS_A_SNAKE, GLAMDRING],
        siteDeck: [],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: hazardHand,
        siteDeck: [],
      },
    ],
  });
  return { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
}

function playSnake(state: GameState): GameState {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, HERE_IS_A_SNAKE);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  return dispatch(state, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: cardId,
    targetCompanyId: companyId,
  });
}

describe('dm-137 — Here Is a Snake!', () => {
  beforeEach(() => resetMint());

  test('playable on a company during the M/H phase after cards have been drawn', () => {
    const state = baseState();
    const cardId = findHandCardId(state, RESOURCE_PLAYER, HERE_IS_A_SNAKE);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
  });

  test('not playable during an earlier M/H step (before cards have been drawn)', () => {
    const state = { ...baseState(), phaseState: makeMHState({ activeCompanyIndex: 0, step: 'order-effects' }) };
    const cardId = findHandCardId(state, RESOURCE_PLAYER, HERE_IS_A_SNAKE);

    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playing it enqueues a reveal-hazards-choice resolution for the opponent', () => {
    const state = baseState();
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playSnake(state);

    expect(after.pendingResolutions).toHaveLength(1);
    const top = after.pendingResolutions[0];
    expect(top.actor).toBe(PLAYER_2);
    expect(top.kind).toEqual({ type: 'reveal-hazards-choice', companyId, revealedIds: [] });
  });

  test('opponent may reveal each hazard card in hand, or pass — non-hazard cards are not offered', () => {
    const after = playSnake(baseState());

    const reveals = viableActions(after, PLAYER_2, 'reveal-hazard-for-snake');
    expect(reveals).toHaveLength(2);
    const revealedIds = new Set(reveals.map(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId));
    expect(revealedIds.has(findHandCardId(after, HAZARD_PLAYER, LURE_OF_THE_SENSES))).toBe(true);
    expect(revealedIds.has(findHandCardId(after, HAZARD_PLAYER, FOOLISH_WORDS))).toBe(true);

    expect(viableActions(after, PLAYER_2, 'pass')).toHaveLength(1);
  });

  test('revealing a hazard records it publicly and appends it to the resolution', () => {
    const after = playSnake(baseState());
    const lureId = findHandCardId(after, HAZARD_PLAYER, LURE_OF_THE_SENSES);

    const revealed = dispatch(after, { type: 'reveal-hazard-for-snake', player: PLAYER_2, cardInstanceId: lureId });

    expect(revealed.revealedInstances[lureId]).toBe(LURE_OF_THE_SENSES);
    expect(revealed.pendingResolutions).toHaveLength(1);
    expect(revealed.pendingResolutions[0].kind).toMatchObject({ type: 'reveal-hazards-choice', revealedIds: [lureId] });
    // The card stays in hand — revealing shows its identity, it isn't played.
    expect(revealed.players[HAZARD_PLAYER].hand.some(c => c.instanceId === lureId)).toBe(true);
  });

  test('finalizing after revealing one hazard restricts the company to that hazard for the rest of its M/H phase', () => {
    const companyId = companyIdAt(baseState(), RESOURCE_PLAYER);
    const after = playSnake(baseState());
    const lureId = findHandCardId(after, HAZARD_PLAYER, LURE_OF_THE_SENSES);
    const foolishId = findHandCardId(after, HAZARD_PLAYER, FOOLISH_WORDS);

    const revealed = dispatch(after, { type: 'reveal-hazard-for-snake', player: PLAYER_2, cardInstanceId: lureId });
    const finalized = dispatch(revealed, { type: 'pass', player: PLAYER_2 });

    expect(finalized.pendingResolutions).toHaveLength(0);
    expect(finalized.activeConstraints).toHaveLength(1);
    const constraint = finalized.activeConstraints[0];
    expect(constraint.kind).toEqual({ type: 'only-revealed-hazards-on-company', allowedInstanceIds: [lureId] });
    expect(constraint.scope).toEqual({ kind: 'company-mh-phase', companyId });
    expect(constraint.target).toEqual({ kind: 'company', companyId });

    const plays = viableActions(finalized, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const playableIds = new Set(plays.map(a => a.cardInstanceId));
    expect(playableIds.has(lureId)).toBe(true);
    expect(playableIds.has(foolishId)).toBe(false);
  });

  test('passing without revealing anything blocks every hazard play against the company for the rest of its M/H phase', () => {
    const unplayed = baseState();
    const companyId = companyIdAt(unplayed, RESOURCE_PLAYER);

    // Sanity: both hazards are playable before "Here Is a Snake!" is played
    // (the reveal-hazards-choice resolution isn't queued yet).
    const before = viableActions(unplayed, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    expect(before.length).toBeGreaterThan(0);

    const after = playSnake(unplayed);
    const finalized = dispatch(after, { type: 'pass', player: PLAYER_2 });
    expect(finalized.activeConstraints[0].kind).toEqual({ type: 'only-revealed-hazards-on-company', allowedInstanceIds: [] });

    const plays = viableActions(finalized, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    expect(plays).toHaveLength(0);
  });

  test('the constraint clears at the end of the company\'s M/H phase (company-mh-phase scope)', () => {
    const after = playSnake(baseState());
    const finalized = dispatch(after, { type: 'pass', player: PLAYER_2 });
    expect(finalized.activeConstraints).toHaveLength(1);
    expect(finalized.activeConstraints[0].scope.kind).toBe('company-mh-phase');
  });

  describe('alternative: tap and reveal a face-down agent', () => {
    function withAgent(state: GameState, agent: AgentInPlay = BASE_AGENT): GameState {
      return {
        ...state,
        players: [
          state.players[0],
          { ...state.players[1], agents: [agent] },
        ] as unknown as typeof state.players,
      };
    }

    test('offered while nothing has been revealed yet', () => {
      const after = playSnake(withAgent(baseState()));
      const taps = viableActions(after, PLAYER_2, 'tap-reveal-agent-for-snake');
      expect(taps).toHaveLength(1);
      expect((taps[0].action as { agentId: CompanyId }).agentId).toBe(BASE_AGENT.id);
    });

    test('not offered once a hazard has already been revealed', () => {
      const after = playSnake(withAgent(baseState()));
      const lureId = findHandCardId(after, HAZARD_PLAYER, LURE_OF_THE_SENSES);
      const revealed = dispatch(after, { type: 'reveal-hazard-for-snake', player: PLAYER_2, cardInstanceId: lureId });
      expect(viableActions(revealed, PLAYER_2, 'tap-reveal-agent-for-snake')).toHaveLength(0);
    });

    test('not offered for a tapped agent — only untapped face-down agents qualify', () => {
      const tappedAgent: AgentInPlay = { ...BASE_AGENT, character: { ...AGENT_CHAR, status: CardStatus.Tapped } };
      const after = playSnake(withAgent(baseState(), tappedAgent));
      expect(viableActions(after, PLAYER_2, 'tap-reveal-agent-for-snake')).toHaveLength(0);
    });

    test('taps and reveals the agent, and imposes no hazard-play restriction on the company', () => {
      const companyId = companyIdAt(baseState(), RESOURCE_PLAYER);
      const after = playSnake(withAgent(baseState()));
      const taps = viableActions(after, PLAYER_2, 'tap-reveal-agent-for-snake');

      const resolved = dispatch(after, taps[0].action);

      expect(resolved.pendingResolutions).toHaveLength(0);
      // No constraint added — the alternative escapes the reveal restriction entirely.
      expect(resolved.activeConstraints).toHaveLength(0);

      const agent = resolved.players[HAZARD_PLAYER].agents.find(a => a.id === BASE_AGENT.id)!;
      expect(agent.revealed).toBe(true);
      expect(agent.character.status).toBe(CardStatus.Tapped);

      // Both hazards remain fully playable against the company.
      const plays = viableActions(resolved, PLAYER_2, 'play-hazard')
        .map(ea => ea.action as PlayHazardAction)
        .filter(a => a.targetCompanyId === companyId);
      expect(plays.length).toBeGreaterThan(0);
    });
  });

  describe('"including on-guard cards"', () => {
    /**
     * Places Heedless Revelry (le-114, `on-guard-reveal trigger:
     * resource-play`) face-down on the resource player's company and opens an
     * `on-guard-window` reveal-window for the hazard player, deferring a
     * `play-hero-resource` play of Glamdring (matches Heedless Revelry's
     * `playedFilter`). `buildAllowList`, given the on-guard card's instance
     * ID, decides whether an `only-revealed-hazards-on-company` constraint is
     * installed and what it allows — `null` means no constraint at all.
     */
    function stateWithOnGuardWindow(buildAllowList: (ogCardId: CardInstanceId) => CardInstanceId[] | null) {
      const base = baseState([]);
      const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, HEEDLESS_REVELRY);
      const companyId = companyIdAt(withOG, RESOURCE_PLAYER);
      const itemCardId = findHandCardId(withOG, RESOURCE_PLAYER, GLAMDRING);
      const resourcePlayerId = withOG.players[RESOURCE_PLAYER].id;
      const hazardPlayerId = withOG.players[HAZARD_PLAYER].id;

      const deferredAction: GameAction = {
        type: 'play-hero-resource',
        player: resourcePlayerId,
        cardInstanceId: itemCardId,
        companyId,
      };

      let withWindow: GameState = {
        ...withOG,
        pendingResolutions: [{
          id: 'og-window-snake' as ResolutionId,
          source: null,
          actor: hazardPlayerId,
          scope: { kind: 'phase', phase: Phase.MovementHazard },
          kind: { type: 'on-guard-window', stage: 'reveal-window', deferredAction },
        }],
      };

      const allowedInstanceIds = buildAllowList(ogCard.instanceId);
      if (allowedInstanceIds !== null) {
        withWindow = addConstraint(withWindow, {
          source: mint(),
          sourceDefinitionId: HERE_IS_A_SNAKE,
          scope: { kind: 'company-mh-phase', companyId },
          target: { kind: 'company', companyId },
          kind: { type: 'only-revealed-hazards-on-company', allowedInstanceIds },
        });
      }
      return { state: withWindow, ogCard };
    }

    test('baseline: revealable when no restriction is active', () => {
      const { state, ogCard } = stateWithOnGuardWindow(() => null);
      const reveals = viableActions(state, PLAYER_2, 'reveal-on-guard');
      expect(reveals).toHaveLength(1);
      expect((reveals[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId).toBe(ogCard.instanceId);
    });

    test('a restricted company cannot reveal an on-guard card outside the revealed set', () => {
      const { state } = stateWithOnGuardWindow(() => []);
      expect(viableActions(state, PLAYER_2, 'reveal-on-guard')).toHaveLength(0);
      // The window is still open — the opponent may only pass.
      expect(viableActions(state, PLAYER_2, 'pass')).toHaveLength(1);
    });

    test('an on-guard card that WAS revealed to the resource player may still be revealed', () => {
      const { state, ogCard } = stateWithOnGuardWindow(ogCardId => [ogCardId]);
      const reveals = viableActions(state, PLAYER_2, 'reveal-on-guard');
      expect(reveals).toHaveLength(1);
      expect((reveals[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId).toBe(ogCard.instanceId);
    });
  });
});
