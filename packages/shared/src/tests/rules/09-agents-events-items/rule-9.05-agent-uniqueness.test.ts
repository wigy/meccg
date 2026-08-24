/**
 * @module rule-9.05-agent-uniqueness
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.05: Agent Uniqueness
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Only face-up agent hazards are considered for uniqueness. If an agent hazard is revealed to be an identical manifestation of a unique character or hazard already in play, the more recently revealed agent is immediately discarded.
 * The current site for an agent hazard is considered in play while the site is face-up.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId } from '../../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS } from '../../../index.js';
import type { AgentInPlay, CharacterInPlay } from '../../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId;   // unique; homesite: "Moria"

const AGENT_CHAR_ID = 'test-uniq-agent-char' as CardInstanceId;
const MORIA_SITE_ID = 'test-uniq-moria-site' as CardInstanceId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: ANARIN,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

describe('Rule 9.05 — Agent Uniqueness', () => {
  beforeEach(() => resetMint());

  test('face-down agent not counted for uniqueness — reveal still attempted even if identical character is in play', () => {
    // Anarin (unique) is already in play as a resource character for PLAYER_1.
    // PLAYER_2 has a face-down Anarin agent. Face-down agents are not counted for
    // uniqueness, so the reveal attempt is legal (though it will be discarded on reveal).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, ANARIN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: false,
      siteStack: [],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const moriaSiteCard = { instanceId: MORIA_SITE_ID, definitionId: MORIA };
    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [agent], siteDeck: [...state.players[1].siteDeck, moriaSiteCard] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
    };

    // Reveal is offered — face-down agents do not conflict with uniqueness
    const revealActions = viableActions(withAgent, PLAYER_2, 'reveal-agent');
    expect(revealActions.length).toBeGreaterThan(0);
  });

  test('revealing a unique agent that duplicates a face-up character already in play immediately discards the agent', () => {
    // Anarin (unique) already in PLAYER_1's company — face-up in play.
    // PLAYER_2 reveals an Anarin agent → uniqueness conflict → agent discarded immediately.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, ANARIN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: false,
      siteStack: [],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const moriaSiteCard = { instanceId: MORIA_SITE_ID, definitionId: MORIA };
    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [agent], siteDeck: [...state.players[1].siteDeck, moriaSiteCard] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
    };

    const revealActions = viableActions(withAgent, PLAYER_2, 'reveal-agent');
    const after = dispatch(withAgent, revealActions[0].action);

    // Agent is discarded (not in agents array)
    expect(after.players[HAZARD_PLAYER].agents).toHaveLength(0);
    // Character card goes to hazard player's discard pile
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === AGENT_CHAR_ID)).toBe(true);
    // Regression: the chosen home site was never taken out of the location
    // deck, so the discard must leave it there — it used to be deleted from
    // the deck entirely, vanishing the card instance from the game state.
    expect(after.players[HAZARD_PLAYER].siteDeck.some(s => s.instanceId === MORIA_SITE_ID)).toBe(true);
  });

  test('revealing a unique agent that duplicates another revealed agent immediately discards the newer one', () => {
    // Two Anarin agents: one already revealed (face-up), one being revealed now.
    const firstAgentId = 'agent-0-0' as CompanyId;
    const secondAgentId = 'agent-0-1' as CompanyId;
    const secondCharId = 'test-uniq-agent-char-2' as CardInstanceId;
    const secondMoriaSiteId = 'test-uniq-moria-site-2' as CardInstanceId;

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const alreadyRevealedAgent: AgentInPlay = {
      id: firstAgentId,
      character: AGENT_CHAR,
      revealed: true,
      siteStack: [{ instanceId: MORIA_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const faceDownAgent: AgentInPlay = {
      id: secondAgentId,
      character: { ...AGENT_CHAR, instanceId: secondCharId },
      revealed: false,
      siteStack: [],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const secondMoriaSiteCard = { instanceId: secondMoriaSiteId, definitionId: MORIA };
    const withAgents = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [alreadyRevealedAgent, faceDownAgent], siteDeck: [...state.players[1].siteDeck, secondMoriaSiteCard] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
    };

    const revealActions = viableActions(withAgents, PLAYER_2, 'reveal-agent');
    // Only the face-down one can be revealed
    const revealAction = revealActions.find(a => (a.action as { agentId: CompanyId }).agentId === secondAgentId);
    expect(revealAction).toBeDefined();

    const after = dispatch(withAgents, revealAction!.action);

    // Second agent discarded
    expect(after.players[HAZARD_PLAYER].agents).toHaveLength(1);
    expect(after.players[HAZARD_PLAYER].agents[0].id).toBe(firstAgentId);
    // Second character in discard
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === secondCharId)).toBe(true);
  });
});
