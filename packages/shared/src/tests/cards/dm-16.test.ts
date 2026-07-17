/**
 * @module dm-16.test
 *
 * Card test: Herion (dm-16)
 * Type: minion-character
 * Race: Man | Skills: warrior, ranger | Prowess/Body: 5/7 | Mind: 3 | DI: 0 | MP: 1
 * Homesites: Lond Galen, Dol Amroth
 *
 * "Unique. Agent."
 *
 * Herion has no special effects beyond the generic `agent` keyword, so the whole
 * card is exercised by the generic agent machinery:
 *
 * Rules exercised:
 * - "Agent." — keywords includes "agent"; Herion can be played face-down as a
 *   hazard during the opponent's M/H phase and counts one against the hazard
 *   limit (rule 2.IV.vii.1), and is blocked once the limit is reached.
 * - "Unique." — unique: true; a second Herion revealed while one is already
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

const HERION = 'dm-16' as CardDefinitionId;
const LOND_GALEN = 'le-386' as CardDefinitionId; // one of Herion's home sites

const HERION_CHAR_ID = 'test-herion-char' as CardInstanceId;
const LOND_GALEN_SITE_ID = 'test-herion-lond-galen-site' as CardInstanceId;

const HERION_CHAR: CharacterInPlay = {
  instanceId: HERION_CHAR_ID,
  definitionId: HERION,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

describe('Herion (dm-16)', () => {
  beforeEach(() => resetMint());

  test('can be played as a face-down agent hazard during M/H phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [HERION], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };

    const agentActions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(agentActions.length).toBeGreaterThan(0);
  });

  test('playing Herion as hazard places him face-down, untapped, and increments hazard count', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [HERION], siteDeck: [RIVENDELL] },
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

  test('Herion blocked as hazard when hazard limit is reached', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [HERION], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 2 }) };

    const agentActions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(agentActions).toHaveLength(0);
  });

  test('uniqueness: revealing Herion when he is already face-up in play discards the new agent', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const secondCharId = 'test-herion-char-2' as CardInstanceId;
    const secondLondGalenSiteId = 'test-herion-lond-galen-site-2' as CardInstanceId;

    const revealedAgent: AgentInPlay = {
      id: 'agent-herion-0' as CompanyId,
      character: HERION_CHAR,
      revealed: true,
      siteStack: [{ instanceId: LOND_GALEN_SITE_ID, definitionId: LOND_GALEN, status: CardStatus.Untapped }],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const faceDownAgent: AgentInPlay = {
      id: 'agent-herion-1' as CompanyId,
      character: { ...HERION_CHAR, instanceId: secondCharId },
      revealed: false,
      siteStack: [],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const londGalenCardForReveal = { instanceId: secondLondGalenSiteId, definitionId: LOND_GALEN };
    const withAgents = {
      ...state,
      players: [
        state.players[0],
        {
          ...state.players[1],
          agents: [revealedAgent, faceDownAgent],
          siteDeck: [...state.players[1].siteDeck, londGalenCardForReveal],
        },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const revealActions = viableActions(withAgents, PLAYER_2, 'reveal-agent');
    const revealAction = revealActions.find(a => (a.action as { agentId: CompanyId }).agentId === 'agent-herion-1');
    expect(revealAction).toBeDefined();

    const after = dispatch(withAgents, revealAction!.action);

    // Second Herion (duplicate unique) is discarded
    expect(after.players[HAZARD_PLAYER].agents).toHaveLength(1);
    expect(after.players[HAZARD_PLAYER].agents[0].id).toBe('agent-herion-0');
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === secondCharId)).toBe(true);
  });
});
