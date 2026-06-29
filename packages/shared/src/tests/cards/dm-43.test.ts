/**
 * @module dm-43.test
 *
 * Card test: An Article Missing (dm-43)
 * Type: hazard-event (short)
 *
 * "Tap a scout agent at target company's new site. Agent may attack (not
 * counting against hazard limit) with a +4 modification to his prowess
 * during the movement/hazard phase. Attacker chooses defending characters.
 * A successful strike doesn't wound the defending character; instead the
 * company must discard one item (defender's choice). Cannot be played if
 * your opponent is a minion player."
 *
 * Card shape:
 *   - effects[0]: tap-agent-at-site (skill:"scout", prowessBonus:4,
 *     attackerAssigns:true, strikeEffect:"discard-item")
 *
 * Engine support:
 *   - tap-agent-at-site: fully implemented in legal-actions/movement-hazard.ts
 *     and reducer-movement-hazard.ts. The engine enforces the scout-skill
 *     requirement, the minion-player restriction, and builds CombatState with
 *     the correct prowess, 'attacker' assignment phase, and strikeEffect.
 *   - strikeEffect:'discard-item': implemented in reducer-combat.ts. When a
 *     successful agent strike fires this effect, combat enters the
 *     'discard-item-from-company' phase so the defender picks one item to
 *     lose, rather than wounding the character.
 *
 * Prowess math for Bill Ferny (dm-3, base 2) at home (Bree), face-down:
 *   2 (base) + 5 (face-down at home) + 4 (An Article Missing bonus) = 11
 * Agent strike roll of 12 → agentRollTotal = 12 + 11 = 23.
 * Aragorn (base prowess 6), defender roll 2 → defenderTotal = 2 + 6 = 8 < 23
 * → agent wins → discard-item phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, BREE,
  buildTestState, resetMint, makeMHState,
  dispatch, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment,
  CardStatus,
  attachItemToChar,
  charIdAt,
  makeBillFernyAgent,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { GameState, CardDefinitionId, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';

const AN_ARTICLE_MISSING = 'dm-43' as CardDefinitionId;

describe('An Article Missing (dm-43)', () => {
  beforeEach(() => resetMint());

  function baseState(withScoutAgent = true) {
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
          hand: [AN_ARTICLE_MISSING],
          siteDeck: [],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    if (!withScoutAgent) return mhState;

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

  test('playable when a scout agent is at the company destination (home site match)', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as PlayHazardAction;
    expect(action.agentInstanceId).toBeDefined();
  });

  test('NOT playable when no scout agent is at the destination', () => {
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
          hand: [AN_ARTICLE_MISSING],
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

  test('playing the card creates CombatState with attacker assignment phase and discard-item strikeEffect', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);

    const after = dispatch(state, plays[0].action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.assignmentPhase).toBe('attacker');
    expect(after.combat!.strikeEffect).toBe('discard-item');
    expect(after.combat!.strikesTotal).toBe(1);
  });

  test('CombatState prowess reflects agent base + face-down-at-home bonus + +4 bonus', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');

    const after = dispatch(state, plays[0].action);

    // Bill Ferny: prowess 2 (base) + 5 (face-down at home) + 4 (An Article Missing) = 11
    expect(after.combat!.strikeProwess).toBe(11);
  });

  test('the agent is tapped and has no remaining actions after the card resolves', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');

    const after = dispatch(state, plays[0].action);

    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.character.status).toBe(CardStatus.Tapped);
    expect(agent.remainingActions).toBe(0);
  });

  test('An Article Missing goes to the discard pile after play (short event)', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');

    const after = dispatch(state, plays[0].action);

    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile).toHaveLength(1);
    expect(after.players[HAZARD_PLAYER].discardPile[0].definitionId).toBe(AN_ARTICLE_MISSING);
  });

  test('playing the card increments the hazard count by one', () => {
    const state = baseState();
    const countBefore = (state.phaseState).hazardsPlayedThisCompany;
    const plays = viableActions(state, PLAYER_2, 'play-hazard');

    const after = dispatch(state, plays[0].action);

    const countAfter = (after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    expect(countAfter).toBe(countBefore + 1);
  });

  describe('discard-item strike effect', () => {
    /**
     * Drive the full agent combat flow through a win for the agent.
     * 1. Play An Article Missing
     * 2. Attacker assigns strike to Aragorn (company[0].characters[0])
     * 3. Attacker rolls for agent (cheat 12 → agentRollTotal = 11 + 12 = 23)
     * 4. Defender resolves strike tapping (cheat 2 → defenderTotal = 6 + 2 = 8 < 23)
     * Returns state after the strike resolves.
     */
    function playCombatThroughAgentWin(startState: GameState) {
      const plays = viableActions(startState, PLAYER_2, 'play-hazard');
      expect(plays).toHaveLength(1);
      let s = dispatch(startState, plays[0].action);

      // Attacker assigns defender (attackerAssigns = true; Aragorn is index 0)
      const aragornId = charIdAt(s, RESOURCE_PLAYER);
      s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: aragornId });

      // Attacker rolls for agent (cheat 12 → agentRollTotal = 11 + 12 = 23)
      s = dispatch({ ...s, cheatRollTotal: 12 }, { type: 'agent-strike-roll', player: PLAYER_2 });
      expect(s.combat!.agentRollTotal).toBe(23);

      // Defender resolves by tapping (cheat 2 → defenderTotal = 6 + 2 = 8 < 23 → loses)
      const resolveActions = viableActions({ ...s, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
      const tapAction = resolveActions.find(a => a.action.type === 'resolve-strike');
      expect(tapAction).toBeDefined();
      s = dispatch({ ...s, cheatRollTotal: 2 }, tapAction!.action);

      return s;
    }

    test('when agent wins and company has items, enters discard-item-from-company phase', () => {
      const state: GameState = attachItemToChar(baseState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

      const after = playCombatThroughAgentWin(state);

      expect(after.combat).not.toBeNull();
      expect(after.combat!.phase).toBe('discard-item-from-company');
      expect(after.combat!.discardItemOptions).toHaveLength(1);
    });

    test('character is NOT wounded when agent wins (discard-item replaces the wound)', () => {
      const state: GameState = attachItemToChar(baseState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

      const after = playCombatThroughAgentWin(state);

      const aragornId = charIdAt(after, RESOURCE_PLAYER);
      const aragornChar = after.players[RESOURCE_PLAYER].characters[aragornId];
      expect(aragornChar.status).not.toBe(CardStatus.Inverted);
    });

    test('defender gets one discard-item-from-company action per item in company', () => {
      const state: GameState = attachItemToChar(baseState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

      const after = playCombatThroughAgentWin(state);

      const actions = viableActions(after, PLAYER_1, 'discard-item-from-company');
      expect(actions).toHaveLength(1);
      expect(actions[0].action.type).toBe('discard-item-from-company');
    });

    test('attacker gets no actions during discard-item-from-company phase', () => {
      const state: GameState = attachItemToChar(baseState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

      const after = playCombatThroughAgentWin(state);

      const atkActions = viableActions(after, PLAYER_2, 'discard-item-from-company');
      expect(atkActions).toHaveLength(0);
    });

    test('dispatching discard-item-from-company moves the item to the discard pile', () => {
      const state: GameState = attachItemToChar(baseState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

      let after = playCombatThroughAgentWin(state);

      const actions = viableActions(after, PLAYER_1, 'discard-item-from-company');
      expect(actions).toHaveLength(1);
      after = dispatch(after, actions[0].action);

      // Item is now in defender's discard pile
      const discard = after.players[RESOURCE_PLAYER].discardPile;
      expect(discard.some(c => c.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);

      // Aragorn no longer holds the item
      const aragornId = charIdAt(after, RESOURCE_PLAYER);
      const aragornChar = after.players[RESOURCE_PLAYER].characters[aragornId];
      expect(aragornChar.items).toHaveLength(0);
    });

    test('when company has no items, combat finalizes without entering discard-item phase', () => {
      const state = baseState(); // Aragorn starts with no items

      const after = playCombatThroughAgentWin(state);

      // No items → discard-item effect is skipped; combat should be finalized (null)
      expect(after.combat).toBeNull();
    });

    test('when defender beats agent roll, there is no discard-item phase and item is retained', () => {
      const state: GameState = attachItemToChar(baseState(), RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

      const plays = viableActions(state, PLAYER_2, 'play-hazard');
      let s = dispatch(state, plays[0].action);

      const aragornId = charIdAt(s, RESOURCE_PLAYER);
      s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: aragornId });

      // Agent rolls low (2 → agentRollTotal = 11 + 2 = 13)
      s = dispatch({ ...s, cheatRollTotal: 2 }, { type: 'agent-strike-roll', player: PLAYER_2 });

      // Defender rolls high (12 → defenderTotal = 6 + 12 = 18 > 13 → wins)
      const resolveActions = viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
      const tapAction = resolveActions.find(a => a.action.type === 'resolve-strike');
      expect(tapAction).toBeDefined();
      s = dispatch({ ...s, cheatRollTotal: 12 }, tapAction!.action);

      // Defender wins → no discard-item-from-company phase
      expect(s.combat?.phase).not.toBe('discard-item-from-company');

      // Item is still on Aragorn
      const aragornChar = s.players[RESOURCE_PLAYER].characters[aragornId];
      expect(aragornChar.items).toHaveLength(1);
    });
  });
});
