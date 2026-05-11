/**
 * @module rule-6.07-agent-attacks-at-site
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.07: Step 3: Agent Attacks at Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Entering a Site, Step 3 (Revealing Agent Attacks) - Immediately following any automatic-attacks at the site (or after the company declares that they are entering a site with no automatic-attacks), the hazard player may declare that an agent hazard currently located at the company's site will attack, with the condition that the agent must be revealed when the attack is declared if not already revealed.
 * An agent hazard can only attack once per site phase.
 * Agent hazard attacks are not keyed to anything.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeSitePhase, viableActions,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId } from '../../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS } from '../../../index.js';
import type { AgentInPlay, SiteInPlay, CharacterInPlay } from '../../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId;   // homesite: "Moria", prowess: 4, body: 8
const BADUILA = 'dm-2' as CardDefinitionId;  // homesite: "Goblin-gate, Mount Gundabad"

const AGENT_CHAR_ID = 'test-607-char' as CardInstanceId;
const AGENT_CHAR_ID_2 = 'test-607-char2' as CardInstanceId;
const MORIA_SITE_ID = 'test-607-moria' as CardInstanceId;
const MORIA_SITE_ID_2 = 'test-607-moria2' as CardInstanceId;
const AGENT_ID = 'agent-0-0' as CompanyId;
const AGENT_ID_2 = 'agent-0-1' as CompanyId;

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

function buildDeclareState(opts: { attackedThisSitePhase?: boolean; agentRevealed?: boolean } = {}) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  const agent: AgentInPlay = {
    id: AGENT_ID,
    character: AGENT_CHAR,
    revealed: opts.agentRevealed ?? true,
    siteStack: [MORIA_SITE],
    remainingActions: 1,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: opts.attackedThisSitePhase ?? false,
    discardAtEndOfTurn: false,
  };
  return {
    ...base,
    players: [
      base.players[0],
      { ...base.players[1], agents: [agent] },
    ] as unknown as typeof base.players,
    phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }),
  };
}

describe('Rule 6.07 — Step 3: Agent Attacks at Site', () => {
  beforeEach(() => resetMint());

  test('After auto-attacks, hazard player may declare agent hazard attack at company site; each agent may attack once per site phase', () => {
    // Hazard player CAN declare attack when agent is at company's site
    const state = buildDeclareState({ agentRevealed: true });
    const declareActions = viableActions(state, PLAYER_2, 'declare-agent-attack');
    expect(declareActions.length).toBeGreaterThan(0);

    // After declaring, combat is set (attack is initiated)
    const after = dispatch(state, declareActions[0].action);
    expect(after.combat).not.toBeNull();
    expect(after.combat?.attackSource.type).toBe('agent');

    // Agent is marked as having attacked this site phase
    expect(after.players[HAZARD_PLAYER].agents[0].attackedThisSitePhase).toBe(true);
  });

  test('agent that already attacked this site phase cannot attack again', () => {
    const state = buildDeclareState({ attackedThisSitePhase: true });
    const declareActions = viableActions(state, PLAYER_2, 'declare-agent-attack');
    expect(declareActions.length).toBe(0);
  });

  test('two agents at same site can each declare one attack in the same site phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const makeAgent = (id: CompanyId, charId: CardInstanceId, defId: CardDefinitionId, siteId: CardInstanceId): AgentInPlay => ({
      id,
      character: { instanceId: charId, definitionId: defId, status: CardStatus.Untapped, items: [], allies: [], hazards: [], followers: [], controlledBy: 'general', effectiveStats: ZERO_EFFECTIVE_STATS },
      revealed: true,
      siteStack: [{ instanceId: siteId, definitionId: MORIA, status: CardStatus.Untapped }],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    });
    const state = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [makeAgent(AGENT_ID, AGENT_CHAR_ID, ANARIN, MORIA_SITE_ID), makeAgent(AGENT_ID_2, AGENT_CHAR_ID_2, BADUILA, MORIA_SITE_ID_2)] },
      ] as unknown as typeof base.players,
      phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }),
    };

    // Both agents are available to attack
    const actions = viableActions(state, PLAYER_2, 'declare-agent-attack');
    expect(actions.length).toBe(2);
  });

  test('face-down agent is revealed when attack is declared', () => {
    const state = buildDeclareState({ agentRevealed: false });
    const declareActions = viableActions(state, PLAYER_2, 'declare-agent-attack');
    expect(declareActions.length).toBeGreaterThan(0);

    const after = dispatch(state, declareActions[0].action);
    expect(after.players[HAZARD_PLAYER].agents[0].revealed).toBe(true);
  });
});
