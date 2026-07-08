/**
 * @module dm-17.test
 *
 * Card test: Ivic (dm-17)
 * Type: minion-character
 * Race: Man | Skills: warrior, diplomat | Prowess/Body: 5/8 | Mind: 6 | DI: 2 | MP: 2
 * Homesites: Southron Oasis, Variag Camp, Pelargir
 *
 * "Unique. Agent."
 *
 * Ivic has no special effects beyond the generic `agent` keyword, so the whole
 * card is exercised by the generic agent machinery:
 *
 * Rules exercised:
 * - "Agent." — keywords includes "agent"; Ivic can be played face-down as a
 *   hazard during the opponent's M/H phase and counts one against the hazard
 *   limit (rule 2.IV.vii.1), and is blocked once the limit is reached.
 * - "Unique." — unique: true; a second Ivic revealed while one is already
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

const IVIC = 'dm-17' as CardDefinitionId;
const PELARGIR = 'le-398' as CardDefinitionId; // one of Ivic's home sites

const IVIC_CHAR_ID = 'test-ivic-char' as CardInstanceId;
const PELARGIR_SITE_ID = 'test-ivic-pelargir-site' as CardInstanceId;

const IVIC_CHAR: CharacterInPlay = {
  instanceId: IVIC_CHAR_ID,
  definitionId: IVIC,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

describe('Ivic (dm-17)', () => {
  beforeEach(() => resetMint());

  test('can be played as a face-down agent hazard during M/H phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [IVIC], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };

    const agentActions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(agentActions.length).toBeGreaterThan(0);
  });

  test('playing Ivic as hazard places him face-down, untapped, and increments hazard count', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [IVIC], siteDeck: [RIVENDELL] },
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

  test('Ivic blocked as hazard when hazard limit is reached', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [IVIC], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 2 }) };

    const agentActions = viableActions(withMH, PLAYER_2, 'play-agent-hazard');
    expect(agentActions).toHaveLength(0);
  });

  test('uniqueness: revealing Ivic when he is already face-up in play discards the new agent', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const secondCharId = 'test-ivic-char-2' as CardInstanceId;
    const secondPelargirSiteId = 'test-ivic-pelargir-site-2' as CardInstanceId;

    const revealedAgent: AgentInPlay = {
      id: 'agent-ivic-0' as CompanyId,
      character: IVIC_CHAR,
      revealed: true,
      siteStack: [{ instanceId: PELARGIR_SITE_ID, definitionId: PELARGIR, status: CardStatus.Untapped }],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const faceDownAgent: AgentInPlay = {
      id: 'agent-ivic-1' as CompanyId,
      character: { ...IVIC_CHAR, instanceId: secondCharId },
      revealed: false,
      siteStack: [],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const pelargirCardForReveal = { instanceId: secondPelargirSiteId, definitionId: PELARGIR };
    const withAgents = {
      ...state,
      players: [
        state.players[0],
        {
          ...state.players[1],
          agents: [revealedAgent, faceDownAgent],
          siteDeck: [...state.players[1].siteDeck, pelargirCardForReveal],
        },
      ] as unknown as typeof state.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const revealActions = viableActions(withAgents, PLAYER_2, 'reveal-agent');
    const revealAction = revealActions.find(a => (a.action as { agentId: CompanyId }).agentId === 'agent-ivic-1');
    expect(revealAction).toBeDefined();

    const after = dispatch(withAgents, revealAction!.action);

    // Second Ivic (duplicate unique) is discarded
    expect(after.players[HAZARD_PLAYER].agents).toHaveLength(1);
    expect(after.players[HAZARD_PLAYER].agents[0].id).toBe('agent-ivic-0');
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === secondCharId)).toBe(true);
  });
});
