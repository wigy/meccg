/**
 * @module tw-158.test
 *
 * Card test: Gildor Inglorion (tw-158)
 * Type: hero-character
 * Prowess 5 / Body 7 / Mind 4 / DI 0 / MP 1
 * Skills: warrior, ranger
 * Homesite: Rivendell
 * Effects: 1 — stat-modifier prowess +2 vs Orcs
 *
 * "Unique. +2 prowess against Orcs."
 *
 * Engine Support:
 * | # | Feature                     | Status      | Notes                                        |
 * |---|-----------------------------|-------------|----------------------------------------------|
 * | 1 | +2 prowess vs Orcs          | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc |
 *
 * Playable: YES
 * Certified: 2026-04-24
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  findCharInstanceId, pool, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';

const GILDOR_INGLORION = 'tw-158' as CardDefinitionId;

function makeGildorState() {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [GILDOR_INGLORION] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Gildor Inglorion (tw-158)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +2 prowess in combat vs Orcs ──

  test('+2 prowess in combat against Orcs', () => {
    const state = makeGildorState();
    const gildorId = findCharInstanceId(state, RESOURCE_PLAYER, GILDOR_INGLORION);
    const gildor = state.players[RESOURCE_PLAYER].characters[gildorId as string];
    const gildorDef = pool[GILDOR_INGLORION as string] as CharacterCard;

    const prowessVsOrc = computeCombatProwess(state, gildor, gildorDef, 'orc');
    // Base prowess 5 + 2 bonus = 7
    expect(prowessVsOrc).toBe(gildorDef.prowess + 2);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = makeGildorState();
    const gildorId = findCharInstanceId(state, RESOURCE_PLAYER, GILDOR_INGLORION);
    const gildor = state.players[RESOURCE_PLAYER].characters[gildorId as string];
    const gildorDef = pool[GILDOR_INGLORION as string] as CharacterCard;

    expect(computeCombatProwess(state, gildor, gildorDef, 'troll')).toBe(gildorDef.prowess);
    expect(computeCombatProwess(state, gildor, gildorDef, 'undead')).toBe(gildorDef.prowess);
    expect(computeCombatProwess(state, gildor, gildorDef, 'nazgul')).toBe(gildorDef.prowess);
  });
});
