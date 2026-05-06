/**
 * @module rule-9.02b-agent-combat
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 2.V.iii: Agent Hazard Attacks at Site
 * Rule 3.iv.6.1: Agent Prowess/Body Modifiers
 * Rule 3.II.2.R3/B3: Ringwraith/Balrog players — agent attacks as detainment
 *
 * Source: docs/coe-rules.md
 */

/*
 * RULING:
 *
 * Immediately following any automatic-attacks at the site, the hazard player
 * may declare that an agent hazard currently located at the company's site
 * will attack (rule 2.V.iii). The agent must be revealed at declaration.
 * An agent can only attack once per site phase (rule 2.V.iii.1).
 *
 * Prowess modifiers (rule 3.iv.6.1):
 *   -2 if wounded; +2 face-down not-at-home; +5/+1 face-down at-home;
 *   +2/+1 face-up at-home.
 *
 * Rule 3.ii.4: face-down at home → attacker assigns strikes.
 * Rule 3.II.2.R3/B3: Ringwraith/Balrog players treat agent attacks as detainment.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableActions, makeSitePhase,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId } from '../../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS } from '../../../index.js';
import type { AgentInPlay, SiteInPlay, CharacterInPlay } from '../../../index.js';

const ANARIN = 'dm-1' as CardDefinitionId;   // homesite: "Moria", prowess: 4, body: 8

const AGENT_CHAR_ID = 'test-a2b-char' as CardInstanceId;
const MORIA_SITE_ID = 'test-a2b-moria' as CardInstanceId;
const AGENT_ID = 'agent-0-0' as CompanyId;

const MORIA_SITE: SiteInPlay = {
  instanceId: MORIA_SITE_ID,
  definitionId: MORIA,
  status: CardStatus.Untapped,
};

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: ANARIN,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

function buildAgentSiteState(opts: {
  agentStatus?: CardStatus;
  agentRevealed?: boolean;
  agentSiteStack?: readonly SiteInPlay[];
  attackedThisSitePhase?: boolean;
  companySite?: CardDefinitionId;
}) {
  const companySite = opts.companySite ?? MORIA;

  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, companies: [{ site: companySite, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });

  const agent: AgentInPlay = {
    id: AGENT_ID,
    character: { ...AGENT_CHAR, status: opts.agentStatus ?? CardStatus.Untapped },
    revealed: opts.agentRevealed ?? true,
    siteStack: opts.agentSiteStack ?? [MORIA_SITE],
    actedThisTurn: false,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: opts.attackedThisSitePhase ?? false,
  };

  const withAgent = {
    ...base,
    players: [
      base.players[0],
      { ...base.players[1], agents: [agent] },
    ] as unknown as typeof base.players,
    phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }),
  };

  return withAgent;
}

describe('Rule 2.V.iii — Agent Hazard Attack at Site', () => {
  beforeEach(() => resetMint());

  describe('declare-agent-attack actions', () => {
    test('hazard player is offered declare-agent-attack for revealed agent at company site', () => {
      const state = buildAgentSiteState({ agentRevealed: true });
      const actions = viableActions(state, PLAYER_2, 'declare-agent-attack');
      expect(actions.length).toBe(1);
      expect((actions[0].action as { agentInstanceId: CardInstanceId }).agentInstanceId).toBe(AGENT_CHAR_ID);
    });

    test('hazard player is always offered pass during declare-agent-attack step', () => {
      const state = buildAgentSiteState({ agentRevealed: true });
      const passes = viableActions(state, PLAYER_2, 'pass');
      expect(passes.length).toBe(1);
    });

    test('active (resource) player has no actions during declare-agent-attack step', () => {
      const state = buildAgentSiteState({ agentRevealed: true });
      const actions = viableActions(state, PLAYER_1, 'declare-agent-attack');
      expect(actions.length).toBe(0);
      const passes = viableActions(state, PLAYER_1, 'pass');
      expect(passes.length).toBe(0);
    });

    test('face-down agent at company site IS offered as declare-agent-attack', () => {
      const state = buildAgentSiteState({ agentRevealed: false });
      const actions = viableActions(state, PLAYER_2, 'declare-agent-attack');
      // Face-down agent at Moria (home site) with company at Moria — should be offered
      expect(actions.length).toBeGreaterThan(0);
    });

    test('agent that already attacked this site phase is NOT offered again', () => {
      const state = buildAgentSiteState({ attackedThisSitePhase: true });
      const actions = viableActions(state, PLAYER_2, 'declare-agent-attack');
      expect(actions.length).toBe(0);
    });

    test('agent at a different site than the company is NOT offered', () => {
      // Agent at Moria but company is at Lorien
      const state = buildAgentSiteState({ companySite: LORIEN, agentSiteStack: [MORIA_SITE] });
      const actions = viableActions(state, PLAYER_2, 'declare-agent-attack');
      expect(actions.length).toBe(0);
    });
  });

  describe('declare-agent-attack → resolve-attacks flow', () => {
    test('pass during declare-agent-attack advances to resolve-attacks', () => {
      const state = buildAgentSiteState({ agentRevealed: true });
      const passes = viableActions(state, PLAYER_2, 'pass');
      const after = dispatch(state, passes[0].action);
      expect((after.phaseState as { step: string }).step).toBe('resolve-attacks');
    });

    test('declaring attack: combat is immediately set and step advances to resolve-attacks', () => {
      const state = buildAgentSiteState({ agentRevealed: true });
      const actions = viableActions(state, PLAYER_2, 'declare-agent-attack');
      const after = dispatch(state, actions[0].action);
      const sp = after.phaseState as { step: string; siteEntered: boolean };
      expect(sp.step).toBe('resolve-attacks');
      expect(sp.siteEntered).toBe(true);
      // Combat is built immediately (not deferred)
      expect(after.combat).not.toBeNull();
      expect(after.combat?.attackSource.type).toBe('agent');
    });

    test('declaring attack marks agent as attackedThisSitePhase = true', () => {
      const state = buildAgentSiteState({ agentRevealed: true });
      const actions = viableActions(state, PLAYER_2, 'declare-agent-attack');
      const after = dispatch(state, actions[0].action);
      expect(after.players[HAZARD_PLAYER].agents[0].attackedThisSitePhase).toBe(true);
    });
  });

  describe('combat state at declaration', () => {
    function declareAttack(opts: {
      agentStatus?: CardStatus;
      agentSiteStack?: readonly SiteInPlay[];
      companySite?: CardDefinitionId;
      agentRevealed?: boolean;
    } = {}) {
      const base = buildAgentSiteState({
        agentRevealed: opts.agentRevealed ?? true,
        agentStatus: opts.agentStatus,
        agentSiteStack: opts.agentSiteStack,
        companySite: opts.companySite,
      });
      const actions = viableActions(base, PLAYER_2, 'declare-agent-attack');
      return dispatch(base, actions[0].action);
    }

    test('face-up at home site: +2 prowess, +1 body (Anarin at Moria)', () => {
      const after = declareAttack({ agentSiteStack: [MORIA_SITE] });
      expect(after.combat?.strikeProwess).toBe(6);   // 4 + 2
      expect(after.combat?.creatureBody).toBe(9);     // 8 + 1
      expect(after.combat?.strikesTotal).toBe(1);
    });

    test('face-up not at home site: base prowess, no body modifier', () => {
      const nonHomeSiteId = 'test-a2b-nonhome' as CardInstanceId;
      const nonHomeSite: SiteInPlay = { instanceId: nonHomeSiteId, definitionId: LORIEN, status: CardStatus.Untapped };
      const after = declareAttack({ agentSiteStack: [nonHomeSite], companySite: LORIEN });
      expect(after.combat?.strikeProwess).toBe(4);   // base, no modifier
      expect(after.combat?.creatureBody).toBe(8);     // base, no modifier
    });

    test('wounded face-up at home: -2 prowess (net: +2 home -2 wound = 0)', () => {
      const after = declareAttack({ agentStatus: CardStatus.Inverted, agentSiteStack: [MORIA_SITE] });
      expect(after.combat?.strikeProwess).toBe(4);   // 4 + 2 - 2
    });

    test('face-down at home: +5 prowess, +1 body, attacker assigns strikes', () => {
      // Agent at Moria (home) face-down, company at Moria
      // Empty siteStack → agent at home; face-down at home → +5/+1
      const base = buildAgentSiteState({ agentRevealed: false, agentSiteStack: [] });
      const actions = viableActions(base, PLAYER_2, 'declare-agent-attack');
      const after = dispatch(base, actions[0].action);
      expect(after.combat?.strikeProwess).toBe(9);   // 4 + 5
      expect(after.combat?.creatureBody).toBe(9);    // 8 + 1
      expect(after.combat?.assignmentPhase).toBe('attacker');
    });

    test('face-down not at home: +2 prowess, no body modifier', () => {
      // Agent at Lorien (non-home) face-down, company at Lorien
      const nonHomeSiteId = 'test-a2b-fd-nonhome' as CardInstanceId;
      const nonHomeSite: SiteInPlay = { instanceId: nonHomeSiteId, definitionId: LORIEN, status: CardStatus.Untapped };
      const base = buildAgentSiteState({ agentRevealed: false, agentSiteStack: [nonHomeSite], companySite: LORIEN });
      const actions = viableActions(base, PLAYER_2, 'declare-agent-attack');
      const after = dispatch(base, actions[0].action);
      expect(after.combat?.strikeProwess).toBe(6);   // 4 + 2
      expect(after.combat?.creatureBody).toBe(8);    // base, no modifier
      expect(after.combat?.assignmentPhase).toBe('defender');
    });

    test('face-down agent is revealed after declaring attack', () => {
      const base = buildAgentSiteState({ agentRevealed: false, agentSiteStack: [] });
      const actions = viableActions(base, PLAYER_2, 'declare-agent-attack');
      const after = dispatch(base, actions[0].action);
      expect(after.players[HAZARD_PLAYER].agents[0].revealed).toBe(true);
    });

    test('pass in resolve-attacks (no agent attack) → advances to play-resources', () => {
      // Hazard player passes declare step → no combat
      const base = buildAgentSiteState({ agentRevealed: true });
      const withPass = dispatch(base, viableActions(base, PLAYER_2, 'pass')[0].action);
      expect((withPass.phaseState as { step: string }).step).toBe('resolve-attacks');
      expect(withPass.combat).toBeNull();
      const after = dispatch(withPass, viableActions(withPass, PLAYER_1, 'pass')[0].action);
      expect((after.phaseState as { step: string }).step).toBe('play-resources');
    });
  });
});
