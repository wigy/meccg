/**
 * @module rule-5.19-creature-resolves-combat
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.19: Creature Resolves into Combat
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * When a creature card resolves, its attack immediately initiates combat against the company; combat from multiple attacks follows immediately in succession.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  playCreatureHazardAndResolve,
  makeWildernessMHState, makeDoubleWildernessMHState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  ORC_PATROL, CAVE_DRAKE,
  handCardId, companyIdAt,
} from '../../test-helpers.js';
import { Phase } from '../../../index.js';

describe('Rule 5.19 — Creature Resolves into Combat', () => {
  beforeEach(() => resetMint());

  test('When creature resolves, its attack immediately initiates combat against the company', () => {
    // Orc-patrol is played against P1's company moving through a wilderness
    // region. Once both players pass chain priority (resolveChain), the
    // creature's attack must immediately create an active combat state.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const gameState = { ...state, phaseState: makeWildernessMHState() };
    const orcId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      gameState, PLAYER_2, orcId, companyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Combat must be active and sourced from the creature card
    expect(after.combat).not.toBeNull();
    expect(after.combat!.attackSource.type).toBe('creature');
    expect(after.combat!.companyId).toBe(companyId);
  });

  test('Multiple creature attacks follow immediately in succession (Cave-drake has two strikes)', () => {
    // Cave-drake carries two strikes in one attack, both of which must be
    // assigned and resolved before combat finalizes. After the creature
    // resolves, the combat must enter the assign-strikes phase with the
    // correct strike count from the card.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    // Cave-drake requires two wilderness regions in the path. Use the
    // double-wilderness variant which supplies exactly that.
    const doubleWildernessMH = makeDoubleWildernessMHState();
    const gameState = { ...state, phaseState: doubleWildernessMH };
    const drakeId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      gameState, PLAYER_2, drakeId, companyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.attackSource.type).toBe('creature');
    // Cave-drake has 2 strikes; combat opens in the assign-strikes phase
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.phase).toBe('assign-strikes');
  });
});
