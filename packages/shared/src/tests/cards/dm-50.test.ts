/**
 * @module dm-50.test
 *
 * Card test: Cunning Foes (dm-50)
 * Type: hazard-event (short)
 *
 * "Tap a warrior agent at target company's new site. Agent attacks
 * (not counting against hazard limit) with a +3 modification to his prowess
 * during the movement/hazard phase. Attacker chooses defending characters.
 * Cannot be played if your opponent is a minion player."
 *
 * Card shape:
 *   - effects[0]: tap-agent-at-site (skill:"warrior", prowessBonus:3,
 *     attackerAssigns:true)
 *
 * Engine support:
 *   - tap-agent-at-site: fully implemented in legal-actions/movement-hazard.ts
 *     and reducer-movement-hazard.ts. The engine enforces the warrior-skill
 *     requirement, the agent-location check (face-down agents with no site
 *     stack match by home-site name), the minion-player restriction, and builds
 *     CombatState with the correct prowess and 'attacker' assignment phase.
 *
 * Prowess math for Bill Ferny (dm-3, base 2) at home (Bree), face-down:
 *   2 (base) + 5 (face-down at home) + 3 (Cunning Foes bonus) = 10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN,
  RIVENDELL, LORIEN, BREE,
  buildTestState, resetMint, mint, makeMHState,
  dispatch, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment,
  CardStatus, ZERO_EFFECTIVE_STATS,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CompanyId, AgentInPlay, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';

const CUNNING_FOES = 'dm-50' as CardDefinitionId;
const BILL_FERNY = 'dm-3' as CardDefinitionId;

/** Build a face-down Bill Ferny agent with no site stack (treated as at home site). */
function makeBillFernyAgent(): AgentInPlay {
  return {
    id: 'agent-bill-ferny-0' as CompanyId,
    character: {
      instanceId: mint(),
      definitionId: BILL_FERNY,
      status: CardStatus.Untapped,
      items: [],
      allies: [],
      hazards: [],
      followers: [],
      controlledBy: 'general' as const,
      effectiveStats: ZERO_EFFECTIVE_STATS,
    },
    revealed: false,
    siteStack: [],
    remainingActions: 1,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
  };
}

describe('Cunning Foes (dm-50)', () => {
  beforeEach(() => resetMint());

  /**
   * Build a standard MH-phase state with P1 moving to Bree.
   * P2 has Cunning Foes in hand; optionally includes Bill Ferny as a
   * face-down agent (no site stack → treated as at his home site Bree).
   */
  function baseState(withWarriorAgent = true) {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: BREE }],
          hand: [],
          siteDeck: [BREE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [CUNNING_FOES],
          siteDeck: [],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    if (!withWarriorAgent) return mhState;

    return {
      ...mhState,
      players: [
        mhState.players[RESOURCE_PLAYER],
        {
          ...mhState.players[HAZARD_PLAYER],
          agents: [makeBillFernyAgent()],
        },
      ] as typeof mhState.players,
    };
  }

  test('playable when a warrior agent is at the company destination (home site match)', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as PlayHazardAction;
    expect(action.agentInstanceId).toBeDefined();
  });

  test('NOT playable when no warrior agent is at the destination', () => {
    const state = baseState(false);
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.filter(a => a.viable)).toHaveLength(0);
  });

  test('NOT playable against a minion (Ringwraith) player', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: BREE }],
          hand: [],
          siteDeck: [BREE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [CUNNING_FOES],
          siteDeck: [],
        },
      ],
    });
    const mhState = {
      ...state,
      phaseState: makeMHState(),
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], agents: [makeBillFernyAgent()] },
      ] as typeof state.players,
    };
    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(plays.filter(a => a.viable)).toHaveLength(0);
  });

  test('playing Cunning Foes creates CombatState with attacker-assigns assignment phase', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);

    const after = dispatch(state, plays[0].action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.assignmentPhase).toBe('attacker');
    expect(after.combat!.strikesTotal).toBe(1);
  });

  test('CombatState prowess reflects agent base + face-down-at-home bonus + Cunning Foes +3', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');

    const after = dispatch(state, plays[0].action);

    // Bill Ferny: prowess 2 (base) + 5 (face-down at home) + 3 (Cunning Foes) = 10
    expect(after.combat!.strikeProwess).toBe(10);
  });

  test('the agent is tapped and has no remaining actions after the card resolves', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');

    const after = dispatch(state, plays[0].action);

    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.character.status).toBe(CardStatus.Tapped);
    expect(agent.remainingActions).toBe(0);
  });

  test('Cunning Foes goes to the discard pile after play (short event)', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');

    const after = dispatch(state, plays[0].action);

    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile).toHaveLength(1);
    expect(after.players[HAZARD_PLAYER].discardPile[0].definitionId).toBe(CUNNING_FOES);
  });

  test('playing the card increments the hazard count by one', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const countBefore = (state.phaseState).hazardsPlayedThisCompany;

    const after = dispatch(state, plays[0].action);

    const countAfter = (after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    expect(countAfter).toBe(countBefore + 1);
  });
});
