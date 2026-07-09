/**
 * @module dm-23.test
 *
 * Card test: Râisha (dm-23)
 * Type: minion-character
 * Race: Man | Skills: warrior, scout | Prowess/Body: 5/9 | Mind: 5 | DI: 1 | MP: 2
 * Homesites: Variag Camp, Easterling Camp, Southron Oasis
 *
 * "Unique. Agent."
 *
 * Râisha has no special effects beyond the generic `agent` keyword, so the whole
 * card is exercised by the generic agent machinery:
 *
 * Rules exercised:
 * - "Agent." — keywords includes "agent"; Râisha can be played face-down as a
 *   hazard during the opponent's M/H phase and counts one against the hazard
 *   limit (rule 2.IV.vii.1), and is blocked once the limit is reached.
 * - "Unique." — unique: true; a second Râisha revealed while one is already
 *   face-up is immediately discarded (rule 9.05).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  BREE, RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId } from '../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS } from '../../index.js';
import type { AgentInPlay, CharacterInPlay, MovementHazardPhaseState } from '../../index.js';

const RAISHA = 'dm-23' as CardDefinitionId;
const SOUTHRON_OASIS = 'le-404' as CardDefinitionId; // one of Râisha's home sites

const RAISHA_CHAR_ID = 'test-raisha-char' as CardInstanceId;
const OASIS_SITE_ID = 'test-raisha-oasis-site' as CardInstanceId;

const RAISHA_CHAR: CharacterInPlay = {
  instanceId: RAISHA_CHAR_ID,
  definitionId: RAISHA,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

describe('Râisha (dm-23)', () => {
  beforeEach(() => resetMint());

  test('can be played as a face-down agent hazard during M/H phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [RAISHA], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };

    const agentActions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(agentActions.length).toBeGreaterThan(0);
  });

  test('playing Râisha as hazard places her face-down, untapped, and increments hazard count', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [RAISHA], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };

    const agentActions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    const after = dispatch(withMH, agentActions[0].action);

    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.revealed).toBe(false);
    expect(agent.character.status).toBe(CardStatus.Untapped);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
  });

  test('Râisha blocked as hazard when hazard limit is reached', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [RAISHA], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 2 }) };

    const agentActions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(agentActions).toHaveLength(0);
  });

  test('uniqueness: revealing Râisha when she is already face-up in play discards the new agent', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const secondCharId = 'test-raisha-char-2' as CardInstanceId;
    const secondOasisSiteId = 'test-raisha-oasis-site-2' as CardInstanceId;

    const revealedAgent: AgentInPlay = {
      id: 'agent-raisha-0' as CompanyId,
      character: RAISHA_CHAR,
      revealed: true,
      siteStack: [{ instanceId: OASIS_SITE_ID, definitionId: SOUTHRON_OASIS, status: CardStatus.Untapped }],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const faceDownAgent: AgentInPlay = {
      id: 'agent-raisha-1' as CompanyId,
      character: { ...RAISHA_CHAR, instanceId: secondCharId },
      revealed: false,
      siteStack: [],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const oasisCardForReveal = { instanceId: secondOasisSiteId, definitionId: SOUTHRON_OASIS };
    const withAgents = {
      ...state,
      players: [
        state.players[0],
        {
          ...state.players[1],
          agents: [revealedAgent, faceDownAgent],
          siteDeck: [...state.players[1].siteDeck, oasisCardForReveal],
        },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const revealActions = viableActions(withAgents, PLAYER_2, 'reveal-agent');
    const revealAction = revealActions.find(a => (a.action as { agentId: CompanyId }).agentId === 'agent-raisha-1');
    expect(revealAction).toBeDefined();

    const after = dispatch(withAgents, revealAction!.action);

    // Second Râisha (duplicate unique) is discarded
    expect(after.players[HAZARD_PLAYER].agents).toHaveLength(1);
    expect(after.players[HAZARD_PLAYER].agents[0].id).toBe('agent-raisha-0');
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === secondCharId)).toBe(true);
  });
});
