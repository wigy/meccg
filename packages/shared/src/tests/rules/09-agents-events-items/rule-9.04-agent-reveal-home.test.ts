/**
 * @module rule-9.04-agent-reveal-home
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.04: Agent Reveal at Home Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Revealing an agent hazard at its home site is not considered movement. A site card from the agent player's location deck that is listed as one of the agent's home sites must be placed with the agent when it is revealed; if the agent player does not have an available site in their location deck, the agent is immediately discarded at the end of the current turn.
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
import type { AgentInPlay, SiteInPlay, CharacterInPlay } from '../../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId;   // homesite: "Moria"

const AGENT_CHAR_ID = 'test-home-agent-char' as CardInstanceId;
const AGENT_SITE_ID = 'test-home-agent-site' as CardInstanceId;

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

const HOME_SITE: SiteInPlay = {
  instanceId: AGENT_SITE_ID,
  definitionId: MORIA,
  status: CardStatus.Untapped,
};

/** Build a state with a face-down agent at its home site (siteStack = [homesite]). */
function buildAgentAtHomeSite() {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  const agent: AgentInPlay = {
    id: 'agent-0-0' as CompanyId,
    character: AGENT_CHAR,
    revealed: false,
    siteStack: [HOME_SITE],
    actedThisTurn: false,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: false,
  };

  return {
    ...base,
    players: [
      base.players[0],
      { ...base.players[1], agents: [agent] },
    ] as unknown as typeof base.players,
    phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
  };
}

describe('Rule 9.04 — Agent Reveal at Home Site', () => {
  beforeEach(() => resetMint());

  test('revealing at home site (siteStack = 1) is not movement and always legal', () => {
    const state = buildAgentAtHomeSite();
    const revealActions = viableActions(state, PLAYER_2, 'reveal-agent');
    expect(revealActions.length).toBe(1);

    const after = dispatch(state, revealActions[0].action);
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.revealed).toBe(true);
    expect(agent.siteStack.length).toBe(1);
    // Agent NOT in discard — reveal at homesite is always legal
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ANARIN)).toBe(false);
  });

  test.todo('Revealing at home site is not movement; must place site from location deck; if no available site, discarded at end of turn');
});
