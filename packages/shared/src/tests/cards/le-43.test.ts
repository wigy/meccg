/**
 * @module le-43.test
 *
 * Card test: Threlin (le-43)
 * Type: minion-character (ringwraith), unique
 * Race: dwarf | Skills: warrior, diplomat
 * Stats: prowess 4, body 7, mind 5, direct influence 2, MP 2
 * Homesite: Minas Morgul
 *
 * "Unique. +2 direct influence against Dwarves and Dwarf factions.
 *  +1 prowess against Orcs and Elves."
 *
 * Rules covered by this test:
 *   1. +2 DI during influence-check when the target character race is dwarf
 *      (lets Threlin control a mind-4 dwarf as a follower: DI 2 + 2 >= 4).
 *   2. The DI bonus is race-gated — a mind-3 non-dwarf stays out of reach
 *      (DI 2 < 3).
 *   3. +2 DI during faction-influence-check when the faction's race is dwarf
 *      (Petty-dwarves, influence# 12 → need 8).
 *   4. The faction DI bonus is race-gated: a non-dwarf faction with the same
 *      influence number at the same site (Woses of the Eryn Vorn, 12) yields
 *      need 10 instead.
 *   5. +1 prowess in combat against Orcs.
 *   6. +1 prowess in combat against Elves.
 *   7. Neither bonus inflates the printed base stats.
 *
 * Engine Support:
 * | # | Feature                     | Status      | Notes                                                   |
 * |---|-----------------------------|-------------|---------------------------------------------------------|
 * | 1 | +2 DI vs Dwarves            | IMPLEMENTED | stat-modifier, reason=influence-check, target.race=dwarf |
 * | 2 | +2 DI vs Dwarf factions     | IMPLEMENTED | stat-modifier, reason=faction-influence-check            |
 * | 3 | +1 prowess vs Orcs          | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc            |
 * | 4 | +1 prowess vs Elves         | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=elf            |
 *
 * Fixture alignment: minion-character, so tests use minion sites, minion
 * candidate characters and minion factions (LE/AS).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, viablePlayCharacterActions, firstFactionInfluenceAttempt,
  getCharacter, pool,
} from '../test-helpers.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';
import { Race } from '../../index.js';

const THRELIN = 'le-43' as CardDefinitionId;

// Minion candidate characters for the influence-check (follower control) tests.
const GULLA = 'le-13' as CardDefinitionId;      // dwarf, mind 4 — reachable only with the +2 bonus
const TROLL_LOUT = 'le-44' as CardDefinitionId; // troll, mind 3 — out of reach without a bonus

// Minion factions, both playable at The Worthy Hills with influence# 12.
const PETTY_DWARVES = 'as-65' as CardDefinitionId;  // dwarf faction
const WOSES_OF_THE_ERYN_VORN = 'le-296' as CardDefinitionId; // wose faction (race control)

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId;     // haven (Threlin's homesite)
const DOL_GULDUR = 'le-367' as CardDefinitionId;       // haven
const THE_WORTHY_HILLS = 'le-415' as CardDefinitionId; // ruins-and-lairs
const MORIA_MINION = 'le-392' as CardDefinitionId;     // shadow-hold (site-deck filler)
const BARAD_DUR = 'le-352' as CardDefinitionId;        // dark-hold (site-deck filler)

describe('Threlin (le-43)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 7: conditional bonuses do not inflate base stats ───────────────────

  test('base effective DI and prowess are the printed values', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [THRELIN] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [TROLL_LOUT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const baseDef = pool[THRELIN as string] as CharacterCard;
    const threlin = getCharacter(state, RESOURCE_PLAYER, THRELIN);
    expect(threlin.effectiveStats.directInfluence).toBe(baseDef.directInfluence);
    expect(threlin.effectiveStats.prowess).toBe(baseDef.prowess);
  });

  // ─── Rule 1: +2 DI during influence-check (follower control) ─────────────────

  test('+2 DI vs Dwarves lets Threlin control Gulla (dwarf, mind 4) as a follower', () => {
    // Threlin base DI 2. Gulla is a dwarf with mind 4.
    // Without the bonus: DI 2 < mind 4 → cannot control.
    // With the +2 DI vs Dwarves: DI 4 >= mind 4 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [THRELIN] }], hand: [GULLA], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [TROLL_LOUT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const threlinId = findCharInstanceId(state, RESOURCE_PLAYER, THRELIN);
    const underThrelin = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === threlinId);
    expect(underThrelin.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 2: the character DI bonus is race-gated ────────────────────────────

  test('+2 DI bonus does NOT apply to a non-Dwarf character (troll, mind 3)', () => {
    // Troll Lout is race "troll" with mind 3 — a lower mind than the dwarf
    // Threlin can control above. The bonus is race-gated, so DI stays 2 < 3.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [THRELIN] }], hand: [TROLL_LOUT], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GULLA] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const threlinId = findCharInstanceId(state, RESOURCE_PLAYER, THRELIN);
    const underThrelin = viablePlayCharacterActions(state, PLAYER_1).filter(a => a.controlledBy === threlinId);
    expect(underThrelin).toHaveLength(0);
  });

  // ─── Rule 3: +2 DI during faction-influence-check vs a Dwarf faction ─────────

  test('+2 DI vs Dwarf factions reduces the influence need for Petty-dwarves', () => {
    // Petty-dwarves (dwarf faction, influence# 12) at The Worthy Hills.
    // need = influence#(12) - baseDI(2) - diBonusVsDwarfFaction(2) = 8.
    const state = buildSitePhaseState({
      characters: [THRELIN],
      site: THE_WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });

    const threlinId = findCharInstanceId(state, RESOURCE_PLAYER, THRELIN);
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(threlinId);
    expect(attempt!.need).toBe(8);
  });

  // ─── Rule 4: the faction DI bonus is race-gated ──────────────────────────────

  test('the faction DI bonus does NOT apply to a non-Dwarf faction of the same influence number', () => {
    // Woses of the Eryn Vorn (wose faction) is also influence# 12 at The Worthy
    // Hills, so the only difference from Petty-dwarves is race.
    // need = influence#(12) - baseDI(2) = 10 (no bonus).
    const state = buildSitePhaseState({
      characters: [THRELIN],
      site: THE_WORTHY_HILLS,
      hand: [WOSES_OF_THE_ERYN_VORN],
    });

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  // ─── Rules 5 & 6: +1 prowess in combat vs Orcs and Elves ─────────────────────

  test('+1 prowess in combat against Orcs and Elves', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [THRELIN] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const threlinId = findCharInstanceId(state, RESOURCE_PLAYER, THRELIN);
    const threlin = state.players[RESOURCE_PLAYER].characters[threlinId];
    const threlinDef = pool[THRELIN as string] as CharacterCard;

    // Base prowess 4 + 1 bonus = 5
    expect(computeCombatProwess(state, threlin, threlinDef, Race.Orc)).toBe(threlinDef.prowess + 1);
    expect(computeCombatProwess(state, threlin, threlinDef, Race.Elf)).toBe(threlinDef.prowess + 1);
  });

  test('no prowess bonus against non-Orc, non-Elf enemies', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [THRELIN] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const threlinId = findCharInstanceId(state, RESOURCE_PLAYER, THRELIN);
    const threlin = state.players[RESOURCE_PLAYER].characters[threlinId];
    const threlinDef = pool[THRELIN as string] as CharacterCard;

    expect(computeCombatProwess(state, threlin, threlinDef, Race.Troll)).toBe(threlinDef.prowess);
    expect(computeCombatProwess(state, threlin, threlinDef, Race.Dwarf)).toBe(threlinDef.prowess);
    expect(computeCombatProwess(state, threlin, threlinDef, Race.Man)).toBe(threlinDef.prowess);
    expect(computeCombatProwess(state, threlin, threlinDef, Race.Undead)).toBe(threlinDef.prowess);
  });
});
