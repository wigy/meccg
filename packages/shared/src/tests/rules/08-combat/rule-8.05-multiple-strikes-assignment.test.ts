/**
 * @module rule-8.05-multiple-strikes-assignment
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.05: Multiple Strikes Assignment
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Effects that would allow a character to be assigned multiple strikes must be declared before strikes are assigned. If a character is assigned to more than one strike from an attack, a separate strike sequence is initiated for each strike. If a character facing multiple strikes is eliminated by one of the strikes, any remaining unresolved strikes assigned to the character are considered successful.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { CardStatus } from '../../../index.js';
import { computeLegalActions } from '../../../index.js';
import type { GameState, CombatState } from '../../../index.js';
import type { ResolveStrikeAction } from '../../../types/actions-movement-hazard.js';
import {
  makeDetainmentStrikeState, executeAction, resetMint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  BARROW_WIGHT,
} from '../../test-helpers.js';

/** Build a combat where `characterId` is assigned TWO strikes from one attack. */
function twoStrikeCombat(opts: { strikeProwess: number; charStatus?: CardStatus }): { state: GameState; characterId: string } {
  const { state, characterId } = makeDetainmentStrikeState({
    detainment: false,
    strikeProwess: opts.strikeProwess,
    creatureInPlay: BARROW_WIGHT,
    charStatus: opts.charStatus,
  });
  const combat: CombatState = {
    ...(state.combat as CombatState),
    strikesTotal: 2,
    strikeAssignments: [
      { characterId, excessStrikes: 0, resolved: false },
      { characterId, excessStrikes: 0, resolved: false },
    ],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
  };
  return { state: { ...state, combat }, characterId: characterId as string };
}

describe('Rule 8.05 — Multiple Strikes Assignment', () => {
  beforeEach(() => resetMint());

  test('a character assigned two strikes faces two separate strike sequences in order', () => {
    // Low creature prowess → Aragorn wins each strike (success, no creature body).
    const { state } = twoStrikeCombat({ strikeProwess: 4 });

    // First strike sequence resolves but combat continues to the second.
    const afterFirst = executeAction(state, PLAYER_1, 'resolve-strike', 10, false);
    expect(afterFirst.combat).not.toBeNull();
    expect(afterFirst.combat!.currentStrikeIndex).toBe(1);
    expect(afterFirst.combat!.strikeAssignments[0].resolved).toBe(true);
    expect(afterFirst.combat!.strikeAssignments[1].resolved).toBe(false);

    // Second strike sequence resolves — combat then ends.
    const afterSecond = executeAction(afterFirst, PLAYER_1, 'resolve-strike', 10, false);
    expect(afterSecond.combat).toBeNull();
  });

  test('a wound carried into the next sequence lowers prowess for it', () => {
    // The "need" of a strike rises by 2 once the character is wounded (inverted),
    // i.e. a wound from the first sequence makes the following one harder.
    const needFor = (status: CardStatus): number => {
      const { state } = twoStrikeCombat({ strikeProwess: 10, charStatus: status });
      const action = (computeLegalActions(state, PLAYER_1)
        .filter(a => a.action.type === 'resolve-strike') as { action: ResolveStrikeAction }[])
        .find(a => a.action.tapToFight)!.action;
      return action.need;
    };
    expect(needFor(CardStatus.Inverted)).toBe(needFor(CardStatus.Untapped) + 2);
  });

  test('elimination during the first sequence cancels the remaining strike', () => {
    // High creature prowess → Aragorn is wounded by the first strike; a failed
    // body check eliminates him, and the second strike never resolves.
    const { state, characterId } = twoStrikeCombat({ strikeProwess: 20 });

    const wounded = executeAction(state, PLAYER_1, 'resolve-strike', 2, false);
    expect(wounded.combat!.phase).toBe('body-check');

    // The body check is rolled by the attacking (hazard) player; a high roll
    // exceeds Aragorn's body and eliminates him.
    const eliminated = executeAction(wounded, PLAYER_2, 'body-check-roll', 12);
    // Combat ends — the remaining strike is not faced separately.
    expect(eliminated.combat).toBeNull();
    expect(eliminated.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === characterId)).toBe(true);
    expect(eliminated.players[RESOURCE_PLAYER].characters[characterId]).toBeUndefined();
  });
});
