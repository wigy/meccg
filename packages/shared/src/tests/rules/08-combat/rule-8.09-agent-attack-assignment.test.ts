/**
 * @module rule-8.09-agent-attack-assignment
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.09: Agent Attack Strike Assignment
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * For an agent hazard attack, if the agent was face-down and at its home site when its attack was declared, the attacking player chooses the defending characters.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeSitePhase, viableActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId } from '../../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS } from '../../../index.js';
import type { AgentInPlay, SiteInPlay, CharacterInPlay } from '../../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId; // homesite: "Moria"

const AGENT_CHAR_ID = 'test-809-char' as CardInstanceId;
const MORIA_SITE_ID = 'test-809-moria' as CardInstanceId;
const LORIEN_SITE_ID = 'test-809-lorien' as CardInstanceId;
const AGENT_ID = 'agent-0-0' as CompanyId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: ANARIN,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};
const MORIA_SITE: SiteInPlay = { instanceId: MORIA_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped };
const LORIEN_SITE: SiteInPlay = { instanceId: LORIEN_SITE_ID, definitionId: LORIEN, status: CardStatus.Untapped };

function buildAndDeclare(opts: { agentRevealed: boolean; agentSiteStack: readonly SiteInPlay[]; companySite: CardDefinitionId }) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, companies: [{ site: opts.companySite, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  const agent: AgentInPlay = {
    id: AGENT_ID,
    character: AGENT_CHAR,
    revealed: opts.agentRevealed,
    siteStack: opts.agentSiteStack,
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
    phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }),
  };
  const actions = viableActions(withAgent, PLAYER_2, 'declare-agent-attack');
  return dispatch(withAgent, actions[0].action);
}

describe('Rule 8.09 — Agent Attack Strike Assignment', () => {
  beforeEach(() => resetMint());

  test('If agent was face-down at home site when attack declared, attacking player chooses defending characters', () => {
    // Face-down (revealed=false) agent with empty siteStack = at home site; company at Moria (Anarin's home)
    const after = buildAndDeclare({ agentRevealed: false, agentSiteStack: [], companySite: MORIA });
    expect(after.combat?.assignmentPhase).toBe('attacker');
  });

  test('face-down agent NOT at home site: defender assigns strikes normally', () => {
    // Face-down agent with a non-home site in siteStack (Lórien, not Anarin's home)
    const after = buildAndDeclare({ agentRevealed: false, agentSiteStack: [LORIEN_SITE], companySite: LORIEN });
    expect(after.combat?.assignmentPhase).toBe('defender');
  });

  test('face-up agent at home site: defender assigns strikes (attacker bonus only for face-down at home)', () => {
    const after = buildAndDeclare({ agentRevealed: true, agentSiteStack: [MORIA_SITE], companySite: MORIA });
    expect(after.combat?.assignmentPhase).toBe('defender');
  });
});
