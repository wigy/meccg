/**
 * @module dm-62.test
 *
 * Card test: Great Need or Purpose (dm-62)
 * Type: hazard-event (long/permanent)
 *
 * Text:
 *   "Each agent may take an extra agent action each time he normally takes an
 *   agent action. Cannot be duplicated."
 *
 * Effects:
 * | # | Rule                                          | Status      | Notes                                     |
 * |---|-----------------------------------------------|-------------|-------------------------------------------|
 * | 1 | Each agent gets +1 extra agent action per turn | IMPLEMENTED | extra-agent-actions value:1 in untap      |
 * | 2 | Cannot be duplicated                          | IMPLEMENTED | duplication-limit scope:game max:1        |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  addCardInPlay,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId } from '../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS } from '../../index.js';
import type { AgentInPlay, SiteInPlay, CharacterInPlay, UntapPhaseState } from '../../index.js';

const GREAT_NEED_OR_PURPOSE = 'dm-62' as CardDefinitionId;
const ANARIN = 'dm-1' as CardDefinitionId;

const AGENT_CHAR_ID = 'test-gn-char' as CardInstanceId;
const MORIA_SITE_ID = 'test-gn-moria' as CardInstanceId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: ANARIN,
  status: CardStatus.Tapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const MORIA_SITE: SiteInPlay = {
  instanceId: MORIA_SITE_ID,
  definitionId: MORIA,
  status: CardStatus.Untapped,
};

const AGENT: AgentInPlay = {
  id: 'agent-0-0' as CompanyId,
  character: AGENT_CHAR,
  revealed: true,
  siteStack: [MORIA_SITE],
  remainingActions: 0,
  inPlayAtTurnStart: true,
  attackedThisSitePhase: false,
  discardAtEndOfTurn: false,
};

// During PLAYER_2's turn PLAYER_2 is the active (resource) player.
// performUntap refreshes the active player's agents, so agents belonging to
// PLAYER_2 are refreshed when PLAYER_2 is active.
function buildUntapState() {
  const base = buildTestState({
    activePlayer: PLAYER_2,
    phase: Phase.Untap,
    players: [
      { id: PLAYER_1, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  const phaseState: UntapPhaseState = {
    phase: Phase.Untap,
    untapped: false,
    hazardSideboardDestination: null,
    hazardSideboardFetched: 0,
    hazardSideboardAccessed: false,
    resourcePlayerPassed: false,
    hazardPlayerPassed: false,
  };

  return {
    ...base,
    players: [
      base.players[0],
      { ...base.players[1], agents: [AGENT] },
    ] as unknown as typeof base.players,
    phaseState,
  };
}

describe('Great Need or Purpose (dm-62)', () => {
  beforeEach(() => resetMint());

  // ── Extra agent actions granted on untap ────────────────────────────────

  test('without GNoP in play, agent gets 1 remaining action after untap', () => {
    const state = buildUntapState();

    // PLAYER_2 is the active player this turn — untap refreshes PLAYER_2's agents
    const after = dispatch(state, { type: 'untap', player: PLAYER_2 });

    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.remainingActions).toBe(1);
  });

  test('with GNoP in play, agent gets 2 remaining actions after untap', () => {
    // GNoP is in PLAYER_2's cardsInPlay (the active player who owns the agents)
    const stateWithCard = addCardInPlay(buildUntapState(), HAZARD_PLAYER, GREAT_NEED_OR_PURPOSE);

    const after = dispatch(stateWithCard, { type: 'untap', player: PLAYER_2 });

    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.remainingActions).toBe(2);
  });

  // ── Agent can take 2 actions when GNoP is in play ───────────────────────

  test('agent can take a second action in the same turn when GNoP is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const agentWith2Actions: AgentInPlay = {
      ...AGENT,
      character: { ...AGENT_CHAR, status: CardStatus.Untapped },
      remainingActions: 2,
    };

    const state = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agentWith2Actions] },
      ] as unknown as typeof base.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0 }),
    };

    // First action: tap agent to key creatures (consumes 1 remaining action)
    const keyActions = viableActions(state, PLAYER_2, 'agent-key-creatures');
    expect(keyActions.length).toBeGreaterThan(0);

    const afterFirst = dispatch(state, keyActions[0].action);
    const agentAfterFirst = afterFirst.players[HAZARD_PLAYER].agents[0];
    expect(agentAfterFirst.remainingActions).toBe(1);
    expect(agentAfterFirst.character.status).toBe(CardStatus.Tapped);

    // Second action still available (agent is tapped but remainingActions > 0)
    const untapActions = viableActions(afterFirst, PLAYER_2, 'agent-untap');
    expect(untapActions.length).toBeGreaterThan(0);

    const afterSecond = dispatch(afterFirst, untapActions[0].action);
    const agentAfterSecond = afterSecond.players[HAZARD_PLAYER].agents[0];
    expect(agentAfterSecond.remainingActions).toBe(0);
  });

  test('agent cannot take a third action even when GNoP is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const agentExhausted: AgentInPlay = {
      ...AGENT,
      character: { ...AGENT_CHAR, status: CardStatus.Tapped },
      remainingActions: 0,
    };

    const state = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agentExhausted] },
      ] as unknown as typeof base.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0 }),
    };

    const actions = viableActions(state, PLAYER_2, 'agent-move');
    expect(actions).toHaveLength(0);
  });

  // ── Duplication limit ────────────────────────────────────────────────────

  test('cannot play GNoP when one is already in play (duplication-limit scope:game)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GREAT_NEED_OR_PURPOSE], siteDeck: [] },
      ],
    });

    const stateWithAlreadyInPlay = addCardInPlay(
      {
        ...base,
        phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0 }),
      },
      HAZARD_PLAYER,
      GREAT_NEED_OR_PURPOSE,
    );

    const plays = viableActions(stateWithAlreadyInPlay, PLAYER_2, 'play-hazard');
    const gnoPlays = plays.filter(a => {
      const action = a.action as { cardInstanceId?: CardInstanceId };
      if (!action.cardInstanceId) return false;
      const card = stateWithAlreadyInPlay.players[HAZARD_PLAYER].hand.find(
        c => c.instanceId === action.cardInstanceId,
      );
      return card?.definitionId === GREAT_NEED_OR_PURPOSE;
    });
    expect(gnoPlays).toHaveLength(0);
  });
});
