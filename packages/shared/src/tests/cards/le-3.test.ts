/**
 * @module le-3.test
 *
 * Card test: Bróin (le-3)
 * Type: minion-character (ringwraith)
 * Prowess 3 / Body 8 / Mind 3 / DI 0 / MP 1
 * Skills: warrior, scout
 * Race: dwarf
 * Homesite: Moria
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
 * The bonus is a combat-only modifier: it must not leak into the character's
 * base effective prowess (organization phase), and it must change the outcome
 * of a real strike resolution against an Orc/Elf attacker.
 *
 * Fixture alignment: minion-character, so tests use minion sites (LE) and a
 * Ringwraith-aligned defending player.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  findCharInstanceId, getCharacter, pool, RESOURCE_PLAYER,
  makeSingleCharCombatState, executeAction,
} from '../test-helpers.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';
import { Alignment, Race } from '../../index.js';

const BROIN = 'le-3' as CardDefinitionId;
const BROIN_BASE_PROWESS = 3;

// Minion sites (LE)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold, Bróin's homesite
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold

function makeBroinState() {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA_MINION, characters: [BROIN] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
      { id: PLAYER_2, companies: [], hand: [], siteDeck: [BARAD_DUR] },
    ],
  });
}

function makeBroinCombat(creatureRace: Race) {
  return makeSingleCharCombatState({
    heroDefId: BROIN,
    creatureRace,
    creatureProwess: 10,
    creatureBody: 5,
    alignment: Alignment.Ringwraith,
    site: MORIA_MINION,
    siteDeck: [MINAS_MORGUL],
  });
}

describe('Bróin (le-3)', () => {
  beforeEach(() => resetMint());

  // ── Base stats: the bonus is combat-only and must not inflate them ──

  test('base effective prowess is 3 (combat bonus does not inflate base stats)', () => {
    const state = makeBroinState();

    expect(getCharacter(state, RESOURCE_PLAYER, BROIN).effectiveStats.prowess).toBe(BROIN_BASE_PROWESS);
  });

  // ── Effect 1: +1 prowess in combat vs Orcs ──

  test('+1 prowess in combat against Orcs', () => {
    const state = makeBroinState();
    const broinId = findCharInstanceId(state, RESOURCE_PLAYER, BROIN);
    const broin = state.players[RESOURCE_PLAYER].characters[broinId];
    const broinDef = pool[BROIN as string] as CharacterCard;

    // Base prowess 3 + 1 bonus = 4
    expect(computeCombatProwess(state, broin, broinDef, Race.Orc)).toBe(BROIN_BASE_PROWESS + 1);
  });

  // ── Effect 2: +1 prowess in combat vs Elves ──

  test('+1 prowess in combat against Elves', () => {
    const state = makeBroinState();
    const broinId = findCharInstanceId(state, RESOURCE_PLAYER, BROIN);
    const broin = state.players[RESOURCE_PLAYER].characters[broinId];
    const broinDef = pool[BROIN as string] as CharacterCard;

    // Base prowess 3 + 1 bonus = 4
    expect(computeCombatProwess(state, broin, broinDef, Race.Elf)).toBe(BROIN_BASE_PROWESS + 1);
  });

  // ── No bonus against other races ──

  test('no prowess bonus against non-Orc, non-Elf enemies', () => {
    const state = makeBroinState();
    const broinId = findCharInstanceId(state, RESOURCE_PLAYER, BROIN);
    const broin = state.players[RESOURCE_PLAYER].characters[broinId];
    const broinDef = pool[BROIN as string] as CharacterCard;

    expect(computeCombatProwess(state, broin, broinDef, Race.Troll)).toBe(BROIN_BASE_PROWESS);
    expect(computeCombatProwess(state, broin, broinDef, Race.Undead)).toBe(BROIN_BASE_PROWESS);
    expect(computeCombatProwess(state, broin, broinDef, Race.Dwarf)).toBe(BROIN_BASE_PROWESS);
    expect(computeCombatProwess(state, broin, broinDef, Race.Man)).toBe(BROIN_BASE_PROWESS);
  });

  // ── End-to-end: the bonus decides a real strike resolution ──
  //
  // Bróin taps to fight (full prowess) against a 10-prowess creature and rolls 6.
  //  - vs Orc/Elf: 6 + 3 + 1 = 10 → ties the creature's prowess → ineffectual,
  //    no wound, no body check.
  //  - vs any other race: 6 + 3 = 9 < 10 → strike succeeds → Bróin is wounded
  //    and a body check against him follows.

  test('strike against an Orc ties thanks to the bonus — no wound', () => {
    const ready = makeBroinCombat(Race.Orc);

    const afterAssign = executeAction(ready, PLAYER_1, 'assign-strike');
    const afterStrike = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 6, true);

    expect(afterStrike.combat?.bodyCheckTarget).not.toBe('character');
  });

  test('strike against an Elf ties thanks to the bonus — no wound', () => {
    const ready = makeBroinCombat(Race.Elf);

    const afterAssign = executeAction(ready, PLAYER_1, 'assign-strike');
    const afterStrike = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 6, true);

    expect(afterStrike.combat?.bodyCheckTarget).not.toBe('character');
  });

  test('same strike against a Troll wounds Bróin — the bonus does not apply', () => {
    const ready = makeBroinCombat(Race.Troll);

    const afterAssign = executeAction(ready, PLAYER_1, 'assign-strike');
    const afterStrike = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 6, true);

    expect(afterStrike.combat?.bodyCheckTarget).toBe('character');
  });
});
