/**
 * @module rule-8.01-combat-initiation
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.01: Combat Initiation
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Combat is initiated by creatures, automatic-attacks, and some other hazards. Creatures and characters (and allies, since they count as characters during combat) have values in the card's bottom-left shield icon for "prowess" (the number on the left of the "/") and "body" (the number on the right of the "/", although most creatures don't have a body value). Automatic-attacks list the attack's prowess in the card's text.
 * The resolution of a declared attack initiates "combat," which proceeds through the following Steps 1-5 (3.i-v).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  dispatch, resolveChain,
  makeWildernessMHState,
  handCardId, companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import { Phase } from '../../../index.js';

describe('Rule 8.01 — Combat Initiation', () => {
  beforeEach(() => resetMint());

  test('Playing a creature and resolving the chain initiates combat with correct attack stats', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gameState = { ...state, phaseState: makeWildernessMHState() };

    const orcId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);

    const afterHazard = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    const afterChain = resolveChain(afterHazard);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(6);
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.defendingPlayerId).toBe(PLAYER_1);
    expect(afterChain.combat!.attackingPlayerId).toBe(PLAYER_2);
  });
});
