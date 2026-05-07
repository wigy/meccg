/**
 * @module rule-9.01-agent-actions
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.01: Agent Actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The hazard player may use one against the hazard limit to have an agent hazard take an "agent action" during an opponent's movement/hazard phase. An agent hazard must have been in play at the start of the turn in order to take an agent action, and each agent hazard can only take one agent action per turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId, MovementHazardPhaseState } from '../../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS } from '../../../index.js';
import type { AgentInPlay, SiteInPlay, CharacterInPlay } from '../../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId;   // homesite: "Moria"
const BADUILA = 'dm-2' as CardDefinitionId;  // homesite: "Goblin-gate, Mount Gundabad"

describe('Rule 9.01 — Agent Actions: play-agent-hazard', () => {
  beforeEach(() => resetMint());

  test('play-agent-hazard is legal during play-hazards step when agent in hand', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ANARIN], siteDeck: [RIVENDELL, MORIA] },
      ],
    });

    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }) };
    const actions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions.every(a => a.action.type === 'play-agent-hazard')).toBe(true);
  });

  test('play-agent-hazard is legal even when no matching home site in hazard player site deck (site chosen at reveal)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        // Baduila's homesite is "Goblin-gate, Mount Gundabad" — neither is in site deck
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BADUILA], siteDeck: [RIVENDELL, MORIA] },
      ],
    });

    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }) };
    const viable = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    // Action is offered (home site requirement is at reveal, not play)
    expect(viable.length).toBe(1);
  });

  test('play-agent-hazard not offered when hazard limit is reached', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ANARIN], siteDeck: [RIVENDELL, MORIA] },
      ],
    });

    // Limit reached: hazardsPlayedThisCompany >= hazardLimitAtReveal
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 2 }) };
    const viable = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(viable.length).toBe(0);
  });

  test('dispatch play-agent-hazard: agent appears face-down in hazard player agents, removed from hand, site deck unchanged, hazard count incremented', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ANARIN], siteDeck: [RIVENDELL, MORIA] },
      ],
    });

    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }) };
    const actions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(actions.length).toBeGreaterThanOrEqual(1);

    const after = dispatch(withMH, actions[0].action);
    const hazardPlayer = after.players[HAZARD_PLAYER];

    // Agent removed from hand
    expect(hazardPlayer.hand.every(c => c.definitionId !== ANARIN)).toBe(true);
    // Site deck is unchanged (home site NOT removed at play time — rule 9.04)
    expect(hazardPlayer.siteDeck.length).toBe(withMH.players[HAZARD_PLAYER].siteDeck.length);
    // Agent added to agents array, face-down with empty site stack
    expect(hazardPlayer.agents.length).toBe(1);
    const agent = hazardPlayer.agents[0];
    expect(agent.revealed).toBe(false);
    expect(agent.inPlayAtTurnStart).toBe(false);
    expect(agent.actedThisTurn).toBe(false);
    expect(agent.siteStack.length).toBe(0);
    // Hazard count incremented
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
  });

  test('agent cannot act on the turn it was played (inPlayAtTurnStart = false)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ANARIN], siteDeck: [RIVENDELL, MORIA] },
      ],
    });

    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }) };
    const actions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    const after = dispatch(withMH, actions[0].action);

    expect(after.players[HAZARD_PLAYER].agents[0].inPlayAtTurnStart).toBe(false);
  });

  test('one play-agent-hazard action per agent card in hand (not per home site)', () => {
    // Baduila has "Goblin-gate, Mount Gundabad" — even with both in site deck, only one play action
    const GOBLIN_GATE = 'tw-398' as CardDefinitionId; // Goblin-gate
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BADUILA], siteDeck: [RIVENDELL, GOBLIN_GATE] },
      ],
    });

    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };
    const actions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    // One agent card in hand → one action (home site chosen at reveal, not here)
    expect(actions.length).toBe(1);
  });

  test('agent with inPlayAtTurnStart=true gets actions; actedThisTurn=true blocks further; inPlayAtTurnStart=false blocks entirely', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const agentChar: CharacterInPlay = {
      instanceId: 'test-901-char' as CardInstanceId,
      definitionId: ANARIN,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      controlledBy: 'general',
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
    const moriaSite: SiteInPlay = {
      instanceId: 'test-901-moria' as CardInstanceId,
      definitionId: MORIA,
      status: CardStatus.Untapped,
    };
    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: agentChar,
      revealed: true,
      siteStack: [moriaSite],
      actedThisTurn: false,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agent] },
      ] as unknown as typeof base.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    // Agent in play at turn start: actions offered
    const moveActions = viableActions(withAgent, PLAYER_2, 'agent-move');
    expect(moveActions.length).toBeGreaterThan(0);

    // After performing one action, actedThisTurn=true → no more agent actions
    const after = dispatch(withAgent, moveActions[0].action);
    expect(after.players[HAZARD_PLAYER].agents[0].actedThisTurn).toBe(true);
    expect(viableActions(after, PLAYER_2, 'agent-move').length).toBe(0);

    // Agent NOT in play at turn start: no actions offered at all
    const newTurnAgent: AgentInPlay = { ...agent, inPlayAtTurnStart: false };
    const withNewAgent = {
      ...withAgent,
      players: [
        withAgent.players[0],
        { ...withAgent.players[1], agents: [newTurnAgent] },
      ] as unknown as typeof withAgent.players,
    };
    expect(viableActions(withNewAgent, PLAYER_2, 'agent-move').length).toBe(0);
  });
});
