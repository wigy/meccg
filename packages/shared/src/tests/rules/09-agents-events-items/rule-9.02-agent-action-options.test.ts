/**
 * @module rule-9.02-agent-action-options
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.02: Agent Action Options
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * An agent action may be initiated from the following options:
 * • Move agent to non-Under-deeps site in same/adjacent region (taps agent).
 * • Return all sites to location deck, return agent to home site (does not tap).
 * • Heal a wounded agent (to tapped).
 * • Untap a tapped agent.
 * • Turn face-down an untapped revealed agent (does not tap).
 * • Tap untapped agent to make creatures keyable to its current site for rest of turn.
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

const AGENT_CHAR_ID = 'test-a2-char' as CardInstanceId;
const MORIA_SITE_ID = 'test-a2-moria' as CardInstanceId;
const AGENT_ID = 'agent-0-0' as CompanyId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: ANARIN,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const MORIA_SITE: SiteInPlay = {
  instanceId: MORIA_SITE_ID,
  definitionId: MORIA,
  status: CardStatus.Untapped,
};

// A reachable non-haven site from Moria (nearestHaven: Lórien, same as Minas Tirith)
const REACHABLE_SITE_ID = 'test-a2-reachable' as CardInstanceId;

function buildAgentState(opts: {
  status?: CardStatus;
  revealed?: boolean;
  siteStack?: readonly SiteInPlay[];
  inPlayAtTurnStart?: boolean;
  actedThisTurn?: boolean;
}) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });

  const agent: AgentInPlay = {
    id: AGENT_ID,
    character: { ...AGENT_CHAR, status: opts.status ?? CardStatus.Untapped },
    revealed: opts.revealed ?? true,
    siteStack: opts.siteStack ?? [MORIA_SITE],
    actedThisTurn: opts.actedThisTurn ?? false,
    inPlayAtTurnStart: opts.inPlayAtTurnStart ?? true,
    attackedThisSitePhase: false,
  };

  // P2 siteDeck: MORIA (for return-home tests) + MINAS_TIRITH (reachable from Moria, for move tests)
  // Note: MORIA_SITE (with MORIA_SITE_ID) is in the agent's siteStack — a different instance in the deck.
  const moriaDeckCard = { instanceId: 'test-a2-moria-deck' as CardInstanceId, definitionId: MORIA };
  const reachableCard = { instanceId: REACHABLE_SITE_ID, definitionId: MINAS_TIRITH };

  return {
    ...base,
    players: [
      base.players[0],
      {
        ...base.players[1],
        agents: [agent],
        siteDeck: [moriaDeckCard, reachableCard],
      },
    ] as unknown as typeof base.players,
    phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0 }),
  };
}

describe('Rule 9.02 — Agent Action Options', () => {
  beforeEach(() => resetMint());

  describe('agent-move', () => {
    test('move actions offered when agent is untapped', () => {
      const state = buildAgentState({ status: CardStatus.Untapped });
      const actions = viableActions(state, PLAYER_2, 'agent-move');
      expect(actions.length).toBeGreaterThan(0);
    });

    test('move actions offered when agent is tapped', () => {
      const state = buildAgentState({ status: CardStatus.Tapped });
      const actions = viableActions(state, PLAYER_2, 'agent-move');
      expect(actions.length).toBeGreaterThan(0);
    });

    test('move NOT offered when agent is wounded (Inverted)', () => {
      const state = buildAgentState({ status: CardStatus.Inverted });
      const actions = viableActions(state, PLAYER_2, 'agent-move');
      expect(actions.length).toBe(0);
    });

    test('move taps the agent', () => {
      const state = buildAgentState({ status: CardStatus.Untapped });
      const moveActions = viableActions(state, PLAYER_2, 'agent-move');
      expect(moveActions.length).toBeGreaterThan(0);

      const after = dispatch(state, moveActions[0].action);
      const agent = after.players[HAZARD_PLAYER].agents[0];
      expect(agent.character.status).toBe(CardStatus.Tapped);
    });

    test('move pushes destination onto siteStack and removes it from siteDeck', () => {
      const state = buildAgentState({ status: CardStatus.Untapped });
      const moveActions = viableActions(state, PLAYER_2, 'agent-move');
      expect(moveActions.length).toBeGreaterThan(0);

      const before = state.players[HAZARD_PLAYER];
      const after = dispatch(state, moveActions[0].action);
      const agent = after.players[HAZARD_PLAYER].agents[0];

      expect(agent.siteStack.length).toBe(before.agents[0].siteStack.length + 1);
      const destId = (moveActions[0].action as { destinationSiteInstanceId: CardInstanceId }).destinationSiteInstanceId;
      expect(after.players[HAZARD_PLAYER].siteDeck.every(s => s.instanceId !== destId)).toBe(true);
    });

    test('move from empty siteStack (face-down at home) uses home site adjacency', () => {
      // Face-down agent with no siteStack — should be able to move from home site
      const state = buildAgentState({ siteStack: [], revealed: false, status: CardStatus.Untapped });
      const actions = viableActions(state, PLAYER_2, 'agent-move');
      // Should still have legal moves (Moria is adjacent to other sites)
      expect(actions.length).toBeGreaterThan(0);
    });

    test('move costs 1 hazard slot', () => {
      const state = buildAgentState({ status: CardStatus.Untapped });
      const moveActions = viableActions(state, PLAYER_2, 'agent-move');
      const before = (state.phaseState).hazardsPlayedThisCompany;
      const after = dispatch(state, moveActions[0].action);
      expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
    });

    test('move not offered when agent has already acted this turn', () => {
      const state = buildAgentState({ actedThisTurn: true });
      const actions = viableActions(state, PLAYER_2, 'agent-move');
      expect(actions.length).toBe(0);
    });

    test('move not offered when agent was not in play at start of turn', () => {
      const state = buildAgentState({ inPlayAtTurnStart: false });
      const actions = viableActions(state, PLAYER_2, 'agent-move');
      expect(actions.length).toBe(0);
    });
  });

  describe('agent-return-home', () => {
    test('return-home offered for a face-down agent — no site card needed', () => {
      const state = buildAgentState({ revealed: false, siteStack: [MORIA_SITE] });
      const actions = viableActions(state, PLAYER_2, 'agent-return-home');
      expect(actions.length).toBe(1);
      const a = actions[0].action as { homeSiteInstanceId?: unknown };
      expect(a.homeSiteInstanceId).toBeUndefined();
    });

    test('return-home face-down: siteStack becomes empty, site returned to deck, agent NOT tapped', () => {
      const state = buildAgentState({ revealed: false, siteStack: [MORIA_SITE], status: CardStatus.Untapped });
      const actions = viableActions(state, PLAYER_2, 'agent-return-home');
      const after = dispatch(state, actions[0].action);
      const agent = after.players[HAZARD_PLAYER].agents[0];

      expect(agent.siteStack.length).toBe(0);
      expect(agent.character.status).toBe(CardStatus.Untapped); // NOT tapped
      expect(after.players[HAZARD_PLAYER].siteDeck.some(s => s.instanceId === MORIA_SITE_ID)).toBe(true);
    });

    test('return-home face-up: home site card placed with agent, siteStack = [homesite], agent NOT tapped', () => {
      const state = buildAgentState({ revealed: true, siteStack: [MORIA_SITE], status: CardStatus.Untapped });
      const actions = viableActions(state, PLAYER_2, 'agent-return-home');
      expect(actions.length).toBeGreaterThan(0);

      const after = dispatch(state, actions[0].action);
      const agent = after.players[HAZARD_PLAYER].agents[0];

      expect(agent.siteStack.length).toBe(1);
      expect(agent.character.status).toBe(CardStatus.Untapped); // NOT tapped (rule 4.1)
    });

    test('return-home costs 1 hazard slot', () => {
      const state = buildAgentState({ revealed: false, siteStack: [MORIA_SITE] });
      const actions = viableActions(state, PLAYER_2, 'agent-return-home');
      const before = (state.phaseState).hazardsPlayedThisCompany;
      const after = dispatch(state, actions[0].action);
      expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
    });
  });

  describe('agent-heal', () => {
    test('heal offered when agent is wounded (Inverted)', () => {
      const state = buildAgentState({ status: CardStatus.Inverted });
      const actions = viableActions(state, PLAYER_2, 'agent-heal');
      expect(actions.length).toBe(1);
    });

    test('heal NOT offered when agent is not wounded', () => {
      const state = buildAgentState({ status: CardStatus.Tapped });
      const actions = viableActions(state, PLAYER_2, 'agent-heal');
      expect(actions.length).toBe(0);
    });

    test('heal sets status to Tapped and costs 1 hazard slot', () => {
      const state = buildAgentState({ status: CardStatus.Inverted });
      const actions = viableActions(state, PLAYER_2, 'agent-heal');
      const after = dispatch(state, actions[0].action);
      expect(after.players[HAZARD_PLAYER].agents[0].character.status).toBe(CardStatus.Tapped);
      expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
    });
  });

  describe('agent-untap', () => {
    test('untap offered when agent is tapped', () => {
      const state = buildAgentState({ status: CardStatus.Tapped });
      const actions = viableActions(state, PLAYER_2, 'agent-untap');
      expect(actions.length).toBe(1);
    });

    test('untap NOT offered when agent is untapped', () => {
      const state = buildAgentState({ status: CardStatus.Untapped });
      const actions = viableActions(state, PLAYER_2, 'agent-untap');
      expect(actions.length).toBe(0);
    });

    test('untap sets status to Untapped and costs 1 hazard slot', () => {
      const state = buildAgentState({ status: CardStatus.Tapped });
      const actions = viableActions(state, PLAYER_2, 'agent-untap');
      const after = dispatch(state, actions[0].action);
      expect(after.players[HAZARD_PLAYER].agents[0].character.status).toBe(CardStatus.Untapped);
      expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
    });
  });

  describe('agent-turn-face-down', () => {
    test('turn-face-down offered when agent is revealed and untapped', () => {
      const state = buildAgentState({ revealed: true, status: CardStatus.Untapped });
      const actions = viableActions(state, PLAYER_2, 'agent-turn-face-down');
      expect(actions.length).toBe(1);
    });

    test('turn-face-down NOT offered when agent is already face-down', () => {
      const state = buildAgentState({ revealed: false, status: CardStatus.Untapped });
      const actions = viableActions(state, PLAYER_2, 'agent-turn-face-down');
      expect(actions.length).toBe(0);
    });

    test('turn-face-down NOT offered when agent is tapped', () => {
      const state = buildAgentState({ revealed: true, status: CardStatus.Tapped });
      const actions = viableActions(state, PLAYER_2, 'agent-turn-face-down');
      expect(actions.length).toBe(0);
    });

    test('turn-face-down sets revealed=false, does NOT tap, costs 1 hazard slot', () => {
      const state = buildAgentState({ revealed: true, status: CardStatus.Untapped });
      const actions = viableActions(state, PLAYER_2, 'agent-turn-face-down');
      const after = dispatch(state, actions[0].action);
      const agent = after.players[HAZARD_PLAYER].agents[0];
      expect(agent.revealed).toBe(false);
      expect(agent.character.status).toBe(CardStatus.Untapped); // not tapped
      expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
    });
  });

  describe('agent-key-creatures', () => {
    test('key-creatures offered when agent is untapped', () => {
      const state = buildAgentState({ status: CardStatus.Untapped });
      const actions = viableActions(state, PLAYER_2, 'agent-key-creatures');
      expect(actions.length).toBe(1);
    });

    test('key-creatures NOT offered when agent is tapped', () => {
      const state = buildAgentState({ status: CardStatus.Tapped });
      const actions = viableActions(state, PLAYER_2, 'agent-key-creatures');
      expect(actions.length).toBe(0);
    });

    test('key-creatures taps agent and costs 1 hazard slot', () => {
      const state = buildAgentState({ status: CardStatus.Untapped });
      const actions = viableActions(state, PLAYER_2, 'agent-key-creatures');
      const after = dispatch(state, actions[0].action);
      expect(after.players[HAZARD_PLAYER].agents[0].character.status).toBe(CardStatus.Tapped);
      expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
    });
  });

  describe('one action per turn gate', () => {
    test('no agent actions offered after agent has acted this turn', () => {
      const state = buildAgentState({ actedThisTurn: true });
      const agentActionTypes = ['agent-move', 'agent-move-back', 'agent-return-home', 'agent-heal', 'agent-untap', 'agent-turn-face-down', 'agent-key-creatures'];
      for (const type of agentActionTypes) {
        expect(viableActions(state, PLAYER_2, type).length).toBe(0);
      }
    });

    test('no agent actions offered for agent not in play at start of turn', () => {
      const state = buildAgentState({ inPlayAtTurnStart: false });
      const agentActionTypes = ['agent-move', 'agent-move-back', 'agent-return-home', 'agent-heal', 'agent-untap', 'agent-turn-face-down', 'agent-key-creatures'];
      for (const type of agentActionTypes) {
        expect(viableActions(state, PLAYER_2, type).length).toBe(0);
      }
    });
  });
});
