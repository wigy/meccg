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
import type { AgentInPlay, CharacterInPlay } from '../../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId;   // homesite: "Moria"

const AGENT_CHAR_ID = 'test-agent-char' as CardInstanceId;
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

/** Build a state with a face-down agent (siteStack=[]) and Moria in the hazard player's siteDeck. */
function buildStateWithAgent(opts: {
  revealed?: boolean;
  anotherRevealedAgent?: boolean;
  moriaSiteId?: CardInstanceId;
}) {
  const moriaSiteId = opts.moriaSiteId ?? ('test-moria-site' as CardInstanceId);
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  // Add Moria to hazard player's siteDeck (home site for Anarin)
  const moriaSiteCard = { instanceId: moriaSiteId, definitionId: MORIA };

  const agent: AgentInPlay = {
    id: AGENT_ID,
    character: AGENT_CHAR,
    revealed: opts.revealed ?? false,
    siteStack: [],  // empty — home site chosen at reveal (rule 9.04)
    remainingActions: 1,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
  };

  const agents: AgentInPlay[] = [agent];

  if (opts.anotherRevealedAgent) {
    const anotherMoriaSiteId = 'test-moria-site-2' as CardInstanceId;
    const dup: AgentInPlay = {
      id: 'agent-1-0' as CompanyId,
      character: { ...AGENT_CHAR, instanceId: 'test-agent-char-2' as CardInstanceId },
      revealed: true,
      siteStack: [{ instanceId: anotherMoriaSiteId, definitionId: MORIA, status: CardStatus.Untapped }],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
    };
    agents.push(dup);
  }

  return {
    ...base,
    players: [
      base.players[0],
      {
        ...base.players[1],
        agents,
        siteDeck: [...base.players[1].siteDeck, moriaSiteCard],
      },
    ] as unknown as typeof base.players,
    phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
  };
}

describe('Rule 9.03 — Agent Reveal', () => {
  beforeEach(() => resetMint());

  test('reveal-agent is legal during play-hazards when matching home site is in location deck', () => {
    const state = buildStateWithAgent({});
    const actions = viableActions(state, PLAYER_2, 'reveal-agent');
    expect(actions.length).toBe(1);
  });

  test('reveal-agent is NOT offered for already-revealed agents', () => {
    const state = buildStateWithAgent({ revealed: true });
    const actions = viableActions(state, PLAYER_2, 'reveal-agent');
    expect(actions.length).toBe(0);
  });

  test('reveal-agent is offered even when no matching home site in location deck (agent revealed without site, discarded at end of turn)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        // No Moria in siteDeck
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const agent: AgentInPlay = {
      id: AGENT_ID,
      character: AGENT_CHAR,
      revealed: false,
      siteStack: [],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
    };
    const state = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agent] },
      ] as unknown as typeof base.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
    };
    const actions = viableActions(state, PLAYER_2, 'reveal-agent');
    // Reveal is still offered — just without a homeSiteInstanceId
    expect(actions.length).toBe(1);
    expect(actions[0].action.type).toBe('reveal-agent');
    const revealAction = actions[0].action as { homeSiteInstanceId?: unknown };
    expect(revealAction.homeSiteInstanceId).toBeUndefined();
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

  test('revealed agent has revealed=true, siteStack=[homesite], home site removed from location deck', () => {
    const moriaSiteId = 'test-moria-site' as CardInstanceId;
    const state = buildStateWithAgent({ moriaSiteId });
    const revealActions = viableActions(state, PLAYER_2, 'reveal-agent');
    expect(revealActions.length).toBe(1);

    const after = dispatch(state, revealActions[0].action);
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.revealed).toBe(true);
    expect(agent.siteStack.length).toBe(1);
    expect(agent.siteStack[0].instanceId).toBe(moriaSiteId);
    // Home site removed from location deck
    expect(after.players[HAZARD_PLAYER].siteDeck.every(s => s.instanceId !== moriaSiteId)).toBe(true);
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
