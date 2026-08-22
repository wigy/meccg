/**
 * @module dm-15
 *
 * Card: The Grimburgoth (dm-15)
 * Type: minion-character (ringwraith alignment)
 * Homesite: Dol Guldur
 * Prowess: 7, Body: 9, Mind: 8, DI: 2, MP: 3
 * Keywords: agent, sorcery-user
 *
 * Rules:
 * - Unique. Agent. Can use sorcery.
 * - Agent only: may tap at a company's new site to attack that company
 *   during its movement/hazard phase with +2 prowess.
 *
 * The agent-tap-attack ability taps the agent (not as an agent action, not
 * against hazard limit) during the opponent's M/H phase to initiate combat.
 * Prowess is computed before reveal (rule 9.06):
 *   - Face-down, not at home: base + 2 (face-down bonus) + 2 (effect) = +4
 *   - Face-down, at home: base + 5 (face-down at-home bonus) + 2 (effect) = +7
 *   - Face-up, at home: base + 2 (at-home bonus) + 2 (effect) = +4
 *   - Face-up, not at home: base + 2 (effect) = +2
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId } from '../../index.js';
import { Phase, CardStatus, Alignment, ZERO_EFFECTIVE_STATS } from '../../index.js';
import type { AgentInPlay, CharacterInPlay, SiteInPlay } from '../../index.js';

const GRIMBURGOTH = 'dm-15' as CardDefinitionId;
const DOL_GULDUR = 'tw-387' as CardDefinitionId;

const AGENT_CHAR_ID = 'test-dm15-agent-char' as CardInstanceId;
const DOL_GULDUR_SITE_ID = 'test-dm15-dol-guldur-site' as CardInstanceId;
const HOME_SITE_DECK_ID = 'test-dm15-home-site-deck' as CardInstanceId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: AGENT_CHAR_ID,
  definitionId: GRIMBURGOTH,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const DOL_GULDUR_SITE: SiteInPlay = {
  instanceId: DOL_GULDUR_SITE_ID,
  definitionId: DOL_GULDUR,
  status: CardStatus.Untapped,
};

describe('dm-15 — The Grimburgoth', () => {
  beforeEach(() => resetMint());

  test('face-up agent at home site (Dol Guldur) offers agent-tap-attack action', () => {
    // The Grimburgoth is face-up at Dol Guldur. Hero company is moving to Dol Guldur.
    // Prowess: 7 (base) + 2 (at-home, face-up) + 2 (effect bonus) = 11.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: DOL_GULDUR }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: true,
      siteStack: [DOL_GULDUR_SITE],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [agent] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0, destinationSiteName: 'Dol Guldur' }),
    };

    const attackActions = viableActions(withAgent, PLAYER_2, 'agent-tap-attack');
    expect(attackActions.length).toBe(1);

    // Dispatch the attack and verify combat is set up correctly
    const after = dispatch(withAgent, attackActions[0].action);

    // Combat is active with agent as attacker
    expect(after.combat).not.toBeNull();
    expect(after.combat!.attackSource).toMatchObject({ type: 'agent', instanceId: AGENT_CHAR_ID });

    // Prowess: 7 (base) + 2 (at-home face-up) + 2 (effect) = 11
    expect(after.combat!.strikeProwess).toBe(11);
    // Rule 3.iv.6.1: at home the agent also gets +1 body — 9 (base) + 1 = 10.
    // Regression: the M/H helper applied only the prowess half of the rule.
    expect(after.combat!.creatureBody).toBe(10);

    // Agent is tapped
    const agentAfter = after.players[1].agents.find(a => a.character.instanceId === AGENT_CHAR_ID);
    expect(agentAfter).toBeDefined();
    expect(agentAfter!.character.status).toBe(CardStatus.Tapped);
    // Not actedThisTurn — this is NOT an agent action, remainingActions unchanged
    expect(agentAfter!.remainingActions).toBe(1);
  });

  test('face-down agent at home site revealed and tapped with correct prowess bonus', () => {
    // The Grimburgoth is face-down at Dol Guldur (his home). Company moves to Dol Guldur.
    // Prowess: 7 (base) + 5 (face-down at-home) + 2 (effect) = 14 (computed before reveal).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: DOL_GULDUR }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    // Face-down agent at Dol Guldur
    const faceDownAgent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: { ...AGENT_CHAR, status: CardStatus.Untapped },
      revealed: false,
      siteStack: [DOL_GULDUR_SITE],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    // Home site in hazard player's site deck for the reveal-with-home-site path
    const homeSiteInDeck: SiteInPlay = { instanceId: HOME_SITE_DECK_ID, definitionId: DOL_GULDUR, status: CardStatus.Untapped };

    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [faceDownAgent], siteDeck: [homeSiteInDeck] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0, destinationSiteName: 'Dol Guldur' }),
    };

    // The agent's site card is already on top of its own stack (it holds the
    // physical Dol Guldur copy), so the reveal needs no deck card: only the
    // plain action is offered. Regression: a homeSiteInstanceId variant was
    // offered here and executing it deleted the deck's home-site copy from
    // the game state.
    const attackActions = viableActions(withAgent, PLAYER_2, 'agent-tap-attack');
    expect(attackActions.length).toBe(1);
    expect((attackActions[0].action as { homeSiteInstanceId?: CardInstanceId }).homeSiteInstanceId).toBeUndefined();

    const after = dispatch(withAgent, attackActions[0].action);

    // Agent is now revealed and tapped, keeping its own site card.
    const agentAfter = after.players[1].agents.find(a => a.character.instanceId === AGENT_CHAR_ID);
    expect(agentAfter).toBeDefined();
    expect(agentAfter!.revealed).toBe(true);
    expect(agentAfter!.character.status).toBe(CardStatus.Tapped);
    expect(agentAfter!.siteStack.map(s => s.instanceId)).toEqual([DOL_GULDUR_SITE_ID]);
    // Not doomed: the rule 4.2.2/9.04 discard penalty applies only to reveals
    // at a home site with no available site card — this agent has its site.
    expect(agentAfter!.discardAtEndOfTurn).toBe(false);
    // The deck's Dol Guldur copy is untouched — not deleted from the game.
    expect(after.players[1].siteDeck.some(s => s.instanceId === HOME_SITE_DECK_ID)).toBe(true);

    // Prowess: 7 + 5 (face-down at-home) + 2 (bonus) = 14
    expect(after.combat!.strikeProwess).toBe(14);
    // Rule 3.iv.6.1: face-down at home also gets +1 body — 9 (base) + 1 = 10.
    expect(after.combat!.creatureBody).toBe(10);
  });

  test('action not offered when agent is at a different site than company destination', () => {
    // The Grimburgoth is face-up at Moria, but company is moving to Dol Guldur.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: DOL_GULDUR }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const moriaSite: SiteInPlay = {
      instanceId: 'test-dm15-moria-site' as CardInstanceId,
      definitionId: MORIA,
      status: CardStatus.Untapped,
    };

    const agentAtMoria: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: true,
      siteStack: [moriaSite],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [agentAtMoria] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0, destinationSiteName: 'Dol Guldur' }),
    };

    const attackActions = viableActions(withAgent, PLAYER_2, 'agent-tap-attack');
    expect(attackActions).toHaveLength(0);
  });

  test('action not offered when agent is wounded', () => {
    // A wounded (Inverted) agent may not use the agent-tap-attack ability.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: DOL_GULDUR }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const woundedAgent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: { ...AGENT_CHAR, status: CardStatus.Inverted },
      revealed: true,
      siteStack: [DOL_GULDUR_SITE],
      remainingActions: 0,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [woundedAgent] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0, destinationSiteName: 'Dol Guldur' }),
    };

    const attackActions = viableActions(withAgent, PLAYER_2, 'agent-tap-attack');
    expect(attackActions).toHaveLength(0);
  });

  test('action not offered when agent was not in play at turn start', () => {
    // Agent played this turn cannot use agent-tap-attack.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: DOL_GULDUR }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const newAgent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: true,
      siteStack: [DOL_GULDUR_SITE],
      remainingActions: 1,
      inPlayAtTurnStart: false, // played this turn
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [newAgent] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0, destinationSiteName: 'Dol Guldur' }),
    };

    const attackActions = viableActions(withAgent, PLAYER_2, 'agent-tap-attack');
    expect(attackActions).toHaveLength(0);
  });

  test('agent tap-attack against a Ringwraith company is detainment (rule 3.II.2.R3)', () => {
    // Regression: the M/H agent-attack builders hard-coded detainment: false;
    // the site-phase declare-agent-attack path computes it from the defending
    // player's alignment. A Ringwraith (or Balrog) player treats agent hazard
    // attacks against their companies as detainment.
    const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
    const CARN_DUM = 'le-359' as CardDefinitionId;
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [ORC_CAPTAIN], destinationSite: DOL_GULDUR }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const agent: AgentInPlay = {
      id: 'agent-0-0' as CompanyId,
      character: AGENT_CHAR,
      revealed: true,
      siteStack: [DOL_GULDUR_SITE],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const withAgent = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], agents: [agent] },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0, destinationSiteName: 'Dol Guldur' }),
    };

    const attackActions = viableActions(withAgent, PLAYER_2, 'agent-tap-attack');
    expect(attackActions.length).toBe(1);
    const after = dispatch(withAgent, attackActions[0].action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.detainment).toBe(true);
  });
});
