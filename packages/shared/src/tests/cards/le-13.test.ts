/**
 * @module le-13.test
 *
 * Card test: Gulla (le-13)
 * Type: minion-character (ringwraith)
 * Prowess 5 / Body 8 / Mind 4 / DI 0 / MP 1
 * Skills: warrior, ranger
 * Homesite: Carn Dûm
 * Effects: 2 — stat-modifier prowess +1 vs Orcs, stat-modifier prowess +1 vs Elves
 *
 * "Unique. +1 prowess against Orcs and Elves."
 *
 * Engine Support:
 * | # | Feature              | Status      | Notes                                        |
 * |---|----------------------|-------------|----------------------------------------------|
 * | 1 | +1 prowess vs Orcs   | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc |
 * | 2 | +1 prowess vs Elves  | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=elf |
 *
 * Fixture alignment: minion-character, so tests use minion sites (LE).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  findCharInstanceId, pool, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';

const GULLA = 'le-13' as CardDefinitionId;

// Minion sites (LE)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold

function makeGullaState() {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [GULLA] }], hand: [], siteDeck: [MINAS_MORGUL] },
      { id: PLAYER_2, companies: [], hand: [], siteDeck: [BARAD_DUR] },
    ],
  });
}

describe('Gulla (le-13)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess in combat vs Orcs ──

  test('+1 prowess in combat against Orcs', () => {
    const state = makeGullaState();
    const gullaId = findCharInstanceId(state, RESOURCE_PLAYER, GULLA);
    const gulla = state.players[RESOURCE_PLAYER].characters[gullaId];
    const gullaDef = pool[GULLA as string] as CharacterCard;

    // Base prowess 5 + 1 bonus = 6
    expect(computeCombatProwess(state, gulla, gullaDef, 'orc')).toBe(gullaDef.prowess + 1);
  });

  // ── Effect 2: +1 prowess in combat vs Elves ──

  test('+1 prowess in combat against Elves', () => {
    const state = makeGullaState();
    const gullaId = findCharInstanceId(state, RESOURCE_PLAYER, GULLA);
    const gulla = state.players[RESOURCE_PLAYER].characters[gullaId];
    const gullaDef = pool[GULLA as string] as CharacterCard;

    // Base prowess 5 + 1 bonus = 6
    expect(computeCombatProwess(state, gulla, gullaDef, 'elf')).toBe(gullaDef.prowess + 1);
  });

  // ── No bonus against other races ──

  test('no prowess bonus against non-Orc, non-Elf enemies', () => {
    const state = makeGullaState();
    const gullaId = findCharInstanceId(state, RESOURCE_PLAYER, GULLA);
    const gulla = state.players[RESOURCE_PLAYER].characters[gullaId];
    const gullaDef = pool[GULLA as string] as CharacterCard;

    expect(computeCombatProwess(state, gulla, gullaDef, 'troll')).toBe(gullaDef.prowess);
    expect(computeCombatProwess(state, gulla, gullaDef, 'undead')).toBe(gullaDef.prowess);
    expect(computeCombatProwess(state, gulla, gullaDef, 'dwarf')).toBe(gullaDef.prowess);
    expect(computeCombatProwess(state, gulla, gullaDef, 'man')).toBe(gullaDef.prowess);
  });
});
