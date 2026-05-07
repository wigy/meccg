/**
 * @module rule-8.18-agent-attack-rolls
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.18: Agent Attack Rolls
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * For agent hazard attacks, when the defending player rolls to resolve a strike, the attacking player simultaneously makes a roll and adds the agent's modified prowess. Agent rolls are further modified by: -2 prowess if agent is wounded; +2 prowess if agent was face-down when attack was declared and not at agent's home site; +5 prowess and +1 body if agent was face-down when attack was declared and at its home site; and +2 prowess and +1 body if agent was face-up when attack was declared and at its home site.
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

// Anarin: homesite "Moria", prowess 4, body 8
const ANARIN = 'dm-1' as CardDefinitionId;

const AGENT_CHAR_ID = 'test-818-char' as CardInstanceId;
const MORIA_SITE_ID = 'test-818-moria' as CardInstanceId;
const LORIEN_SITE_ID = 'test-818-lorien' as CardInstanceId;
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

function buildAndDeclare(opts: {
  agentRevealed: boolean;
  agentSiteStack: readonly SiteInPlay[];
  agentStatus?: CardStatus;
  companySite: CardDefinitionId;
}) {
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
    character: { ...AGENT_CHAR, status: opts.agentStatus ?? CardStatus.Untapped },
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

describe('Rule 8.18 — Agent Attack Rolls', () => {
  beforeEach(() => resetMint());

  test('Agent attacks: both players roll; agent prowess used as target; face-down at home: +5 prowess, +1 body', () => {
    // Anarin base: prowess 4, body 8. Face-down at home → +5/+1 → strikeProwess 9, body 9
    const after = buildAndDeclare({ agentRevealed: false, agentSiteStack: [], companySite: MORIA });
    expect(after.combat?.strikeProwess).toBe(9);  // 4 + 5
    expect(after.combat?.creatureBody).toBe(9);   // 8 + 1
  });

  test('face-down not at home: +2 prowess, no body modifier', () => {
    // Face-down agent at Lórien (non-home), company at Lórien → +2 prowess
    const after = buildAndDeclare({ agentRevealed: false, agentSiteStack: [LORIEN_SITE], companySite: LORIEN });
    expect(after.combat?.strikeProwess).toBe(6);  // 4 + 2
    expect(after.combat?.creatureBody).toBe(8);   // base, no modifier
  });

  test('face-up at home: +2 prowess, +1 body', () => {
    // Revealed agent at Moria (home), company at Moria → +2/+1
    const after = buildAndDeclare({ agentRevealed: true, agentSiteStack: [MORIA_SITE], companySite: MORIA });
    expect(after.combat?.strikeProwess).toBe(6);  // 4 + 2
    expect(after.combat?.creatureBody).toBe(9);   // 8 + 1
  });

  test('face-up not at home: base prowess and body, no modifier', () => {
    const after = buildAndDeclare({ agentRevealed: true, agentSiteStack: [LORIEN_SITE], companySite: LORIEN });
    expect(after.combat?.strikeProwess).toBe(4);  // base
    expect(after.combat?.creatureBody).toBe(8);   // base
  });

  test('wounded agent: -2 prowess modifier applied on top of position modifier', () => {
    // Wounded face-up at home: +2 home, -2 wounded = net 0 → strikeProwess 4
    const after = buildAndDeclare({
      agentRevealed: true,
      agentSiteStack: [MORIA_SITE],
      agentStatus: CardStatus.Inverted,
      companySite: MORIA,
    });
    expect(after.combat?.strikeProwess).toBe(4);  // 4 + 2 - 2
  });
});
