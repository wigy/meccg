/**
 * @module rule-meas-creature-as-auto-attack
 *
 * MEAS §5 — Any hazard creature you play as an automatic-attack is DISCARDED if
 * defeated; it is NOT placed in your opponent's marshalling-point pile.
 *
 * Contrast with an ordinary hazard creature defeated during the M/H phase,
 * which is placed in the defending (resource) player's kill pile and awards
 * kill marshalling points.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { GameState, CombatState } from '../../index.js';
import {
  makeDetainmentStrikeState, executeAction, resetMint,
  PLAYER_1, RESOURCE_PLAYER, HAZARD_PLAYER,
  BARROW_WIGHT,
} from '../test-helpers.js';

describe('MEAS §5 — Creatures played as automatic-attacks', () => {
  beforeEach(() => resetMint());

  test('a creature played as an auto-attack and defeated goes to the hazard player discard, awarding no MP', () => {
    const { state, creatureInstanceId } = makeDetainmentStrikeState({
      detainment: false,
      strikeProwess: 3,
      creatureInPlay: BARROW_WIGHT,
    });
    const siteInst = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const asPlayedAuto: GameState = {
      ...state,
      combat: {
        ...(state.combat as CombatState),
        attackSource: { type: 'played-auto-attack', instanceId: creatureInstanceId, siteInstanceId: siteInst },
      },
    };

    const after = executeAction(asPlayedAuto, PLAYER_1, 'resolve-strike', 12, false);

    // Discarded by the playing (hazard) player; not in the resource player's MP pile.
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
    // The defending (resource) player gains NO kill marshalling points.
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(0);
  });

  test('contrast: an ordinary hazard creature defeated lands in the resource player kill pile and awards MP', () => {
    const { state, creatureInstanceId } = makeDetainmentStrikeState({
      detainment: false,
      strikeProwess: 3,
      creatureInPlay: BARROW_WIGHT,
    });

    const after = executeAction(state, PLAYER_1, 'resolve-strike', 12, false);

    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creatureInstanceId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creatureInstanceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.kill).toBeGreaterThan(0);
  });
});
