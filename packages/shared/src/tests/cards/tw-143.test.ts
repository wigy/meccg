/**
 * @module tw-143.test
 *
 * Card test: Elladan (tw-143)
 * Type: hero-character
 * Prowess 5 / Body 8 / Mind 4 / DI 0 / MP 1
 * Skills: warrior, ranger
 * Race: elf
 * Homesite: Rivendell
 * Effects: 1 — stat-modifier prowess +1 vs Orcs
 *
 * "Unique. +1 prowess against Orcs."
 *
 * Engine Support:
 * | # | Feature                     | Status      | Notes                                        |
 * |---|-----------------------------|-------------|----------------------------------------------|
 * | 1 | +1 prowess vs Orcs          | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc |
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

const ELLADAN = 'tw-143' as CardDefinitionId;

function makeElladanState() {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ELLADAN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Elladan (tw-143)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess in combat vs Orcs ──

  test('+1 prowess in combat against Orcs', () => {
    const state = makeElladanState();
    const elladanId = findCharInstanceId(state, RESOURCE_PLAYER, ELLADAN);
    const elladan = state.players[RESOURCE_PLAYER].characters[elladanId as string];
    const elladanDef = pool[ELLADAN as string] as CharacterCard;

    const prowessVsOrc = computeCombatProwess(state, elladan, elladanDef, 'orc');
    // Base prowess 5 + 1 bonus = 6
    expect(prowessVsOrc).toBe(elladanDef.prowess + 1);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = makeElladanState();
    const elladanId = findCharInstanceId(state, RESOURCE_PLAYER, ELLADAN);
    const elladan = state.players[RESOURCE_PLAYER].characters[elladanId as string];
    const elladanDef = pool[ELLADAN as string] as CharacterCard;

    expect(computeCombatProwess(state, elladan, elladanDef, 'troll')).toBe(elladanDef.prowess);
    expect(computeCombatProwess(state, elladan, elladanDef, 'undead')).toBe(elladanDef.prowess);
    expect(computeCombatProwess(state, elladan, elladanDef, 'nazgul')).toBe(elladanDef.prowess);
  });
});
