/**
 * @module combat-zero-strike-fizzle.test
 *
 * Regression from heuristic self-play (decks g/h, sim seeds 2030024,
 * 2030100, 2030111): an attack whose strike count was reduced to zero
 * before assignment began sat in the `assign-strikes` window with nothing
 * to assign — the defender-phase action generator returned an empty list
 * (no pass), neither player had a viable action, and the game deadlocked.
 *
 * Engine invariant: every legal-action branch must always offer at least
 * one action, and the reducer must accept it. A zero-strike attack now
 * offers the defender a pass, and `handleCombatPass` fizzles the attack
 * (mirroring the dissolved-company fizzle): combat finalizes with no
 * strikes resolved and the creature goes to the attacker's discard pile.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  viableActions, dispatch, companyIdAt,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import { Phase, CardStatus, Race } from '../../../index.js';
import type { CombatState, GameState, CardInstanceId, CardDefinitionId } from '../../../index.js';

const WOLVES = 'tw-114' as CardDefinitionId;

describe('combat: a zero-strike attack always has an exit (assign-strikes)', () => {
  beforeEach(() => resetMint());

  test('defender is offered pass and the attack fizzles to the attacker discard pile', () => {
    const wolvesId = 'wolves-combat-1' as CardInstanceId;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          // The attacking creature lives in the attacker's cardsInPlay for
          // the duration of combat.
          cardsInPlay: [{ instanceId: wolvesId, definitionId: WOLVES, status: CardStatus.Untapped }],
        },
      ],
    });

    // An attack whose strikes were reduced to zero before any assignment.
    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: wolvesId },
      companyId: companyIdAt(base, RESOURCE_PLAYER),
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 0,
      strikeProwess: 9,
      creatureBody: null,
      creatureRace: Race.Animal,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes',
      assignmentPhase: 'defender',
      bodyCheckTarget: null,
      detainment: false,
    };
    const state: GameState = { ...base, phaseState: makeMHState(), combat };

    // The defender must still have an exit: pass is offered.
    const passes = viableActions(state, PLAYER_1, 'pass');
    expect(passes.length).toBeGreaterThan(0);

    // The reducer accepts it: combat fizzles, no strike was resolved, and
    // the undefeated creature lands in the attacker's discard pile.
    const after = dispatch(state, passes[0].action);
    expect(after.combat).toBeNull();
    expect(after.players[1].discardPile.map(c => c.instanceId)).toContain(wolvesId);
    expect(after.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(wolvesId);
    // No kill marshalling points for a fizzled attack.
    expect(after.players[0].killPile).toHaveLength(0);
  });
});
