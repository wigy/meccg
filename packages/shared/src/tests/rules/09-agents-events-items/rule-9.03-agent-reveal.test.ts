/**
 * @module rule-9.03-agent-reveal
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.03: Agent Reveal
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The hazard player may reveal an agent hazard during a resource player's movement/hazard phase (which isn't an agent action and doesn't count against the hazard limit). An agent is revealed by turning it face-up, along with its current site which must remain face-up while the agent is face-up and is then returned to its player's location deck when the agent leaves play or moves while face-up.
 * When an agent hazard is revealed, its previous sites are revealed to check for legal movement and then are returned to the agent player's location deck without having been in play (and thus are not affected by environment effects). If the agent's movement was or has become illegal when the agent is revealed, whether the movement was from one of the agent's home sites or from a site that was left face-up when the agent was previously turned face-down, the agent is immediately discarded and its current site is similarly returned to the agent player's location deck.
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

const AGENT_CHAR_ID = 'test-agent-char' as CardInstanceId;
const AGENT_SITE_ID = 'test-agent-site' as CardInstanceId;
const AGENT_ID = 'agent-0-0' as CompanyId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: ANARIN,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const AGENT_SITE: SiteInPlay = {
  instanceId: AGENT_SITE_ID,
  definitionId: MORIA,
  status: CardStatus.Untapped,
};

/** Build a state with a face-down agent already in the hazard player's agents array. */
function buildStateWithAgent(opts: {
  revealed?: boolean;
  anotherRevealedAgent?: boolean;
}) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  const agent: AgentInPlay = {
    id: AGENT_ID,
    character: AGENT_CHAR,
    revealed: opts.revealed ?? false,
    siteStack: [AGENT_SITE],
    actedThisTurn: false,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: false,
  };

  const agents: AgentInPlay[] = [agent];

  if (opts.anotherRevealedAgent) {
    const dup: AgentInPlay = {
      id: 'agent-1-0' as CompanyId,
      character: { ...AGENT_CHAR, instanceId: 'test-agent-char-2' as CardInstanceId },
      revealed: true,
      siteStack: [AGENT_SITE],
      actedThisTurn: false,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
    };
    agents.push(dup);
  }

  const withAgent = {
    ...base,
    players: [
      base.players[0],
      { ...base.players[1], agents },
    ] as unknown as typeof base.players,
    phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
  };

  return withAgent;
}

describe('Rule 9.03 — Agent Reveal', () => {
  beforeEach(() => resetMint());

  test('reveal-agent is legal during play-hazards for face-down agents', () => {
    const state = buildStateWithAgent({});
    const actions = viableActions(state, PLAYER_2, 'reveal-agent');
    expect(actions.length).toBe(1);
  });

  test('reveal-agent is NOT offered for already-revealed agents', () => {
    const state = buildStateWithAgent({ revealed: true });
    const actions = viableActions(state, PLAYER_2, 'reveal-agent');
    expect(actions.length).toBe(0);
  });

  test('reveal-agent does not cost a hazard slot (hazard count unchanged)', () => {
    const state = buildStateWithAgent({});
    const revealActions = viableActions(state, PLAYER_2, 'reveal-agent');
    expect(revealActions.length).toBe(1);

    const before = (state.phaseState).hazardsPlayedThisCompany;
    const after = dispatch(state, revealActions[0].action);
    const afterCount = (after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    expect(afterCount).toBe(before);
  });

  test('revealed agent has revealed=true and siteStack remains 1 entry', () => {
    const state = buildStateWithAgent({});
    const revealActions = viableActions(state, PLAYER_2, 'reveal-agent');
    const after = dispatch(state, revealActions[0].action);
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.revealed).toBe(true);
    expect(agent.siteStack.length).toBe(1);
  });

  test('unique agent discarded if same definitionId is already face-up in agents', () => {
    const state = buildStateWithAgent({ anotherRevealedAgent: true });
    const revealActions = viableActions(state, PLAYER_2, 'reveal-agent');
    const firstReveal = revealActions.find(a =>
      a.action.type === 'reveal-agent' &&
      (a.action as { agentId: CompanyId }).agentId === AGENT_ID,
    );
    expect(firstReveal).toBeDefined();

    const after = dispatch(state, firstReveal!.action);
    // Newly-revealed agent shares definitionId with existing face-up agent → discarded
    const facedUpAgents = after.players[HAZARD_PLAYER].agents.filter(a => a.revealed);
    const faceDownAgents = after.players[HAZARD_PLAYER].agents.filter(a => !a.revealed);
    expect(facedUpAgents.length).toBe(1);
    expect(faceDownAgents.length).toBe(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ANARIN)).toBe(true);
  });
});
