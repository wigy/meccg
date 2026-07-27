/**
 * @module tw-183.test
 *
 * Card test: Thorin II (tw-183)
 * Type: hero-character
 * Prowess 5 / Body 8 / Mind 8 / DI 2 / MP 3
 * Skills: warrior, scout, diplomat
 * Race: dwarf
 * Homesite: Blue Mountain Dwarf-hold
 * Effects: 4
 *
 * "Unique. +2 direct influence against the Blue Mountain Dwarves faction.
 *  +3 prowess against Orcs. +2 direct influence against Dwarves and Dwarf factions."
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                                                          |
 * |---|--------------------------------------------|-------------|----------------------------------------------------------------|
 * | 1 | +2 DI vs Blue Mountain Dwarves faction     | IMPLEMENTED | stat-modifier, reason=faction-influence-check, faction.name    |
 * | 2 | +3 prowess vs Orcs                         | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc                   |
 * | 3 | +2 DI vs Dwarf characters                  | IMPLEMENTED | stat-modifier, reason=influence-check, target.race=dwarf       |
 * | 4 | +2 DI vs Dwarf factions                    | IMPLEMENTED | stat-modifier, reason=faction-influence-check, faction.race    |
 *
 * Playable: YES
 * Certified: 2026-05-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, KILI, HALDIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BLUE_MOUNTAIN_DWARF_HOLD,
  BLUE_MOUNTAIN_DWARVES,
  findCharInstanceId, viablePlayCharacterActions, buildSitePhaseState,
  getCharacter, pool, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import { computeLegalActions, Race } from '../../index.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';

const THORIN_II = 'tw-183' as CardDefinitionId;

function makeThorinState() {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [THORIN_II] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Thorin II (tw-183)', () => {
  beforeEach(() => resetMint());

  // ── Effect 2: +3 prowess in combat vs Orcs ──

  test('+3 prowess in combat against Orcs', () => {
    const state = makeThorinState();
    const thorinId = findCharInstanceId(state, RESOURCE_PLAYER, THORIN_II);
    const thorin = state.players[RESOURCE_PLAYER].characters[thorinId];
    const thorinDef = pool[THORIN_II as string] as CharacterCard;

    const prowessVsOrc = computeCombatProwess(state, thorin, thorinDef, Race.Orc);
    // Base prowess 5 + 3 bonus = 8
    expect(prowessVsOrc).toBe(thorinDef.prowess + 3);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = makeThorinState();
    const thorinId = findCharInstanceId(state, RESOURCE_PLAYER, THORIN_II);
    const thorin = state.players[RESOURCE_PLAYER].characters[thorinId];
    const thorinDef = pool[THORIN_II as string] as CharacterCard;

    expect(computeCombatProwess(state, thorin, thorinDef, Race.Troll)).toBe(thorinDef.prowess);
    expect(computeCombatProwess(state, thorin, thorinDef, Race.Undead)).toBe(thorinDef.prowess);
    expect(computeCombatProwess(state, thorin, thorinDef, Race.Ringwraith)).toBe(thorinDef.prowess);
  });

  // ── Effect 3: +2 DI vs Dwarf characters ──

  test('+2 DI allows Thorin to control a dwarf character (Kíli, mind 3) as a follower', () => {
    // Thorin base DI = 2. Kíli is a dwarf with mind 3.
    // Without the +2 DI bonus, DI 2 < mind 3 → cannot control.
    // With the bonus, DI 4 >= mind 3 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [THORIN_II] }],
          hand: [KILI],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const thorinId = findCharInstanceId(state, RESOURCE_PLAYER, THORIN_II);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const kiliUnderThorin = actions.filter(a => a.controlledBy === thorinId);
    expect(kiliUnderThorin.length).toBeGreaterThanOrEqual(1);
  });

  test('+2 DI bonus does not apply to non-dwarf characters', () => {
    // Haldir is an elf with mind 3. Thorin has base DI 2.
    // The +2 DI bonus only applies against dwarves, so DI stays 2 < mind 3.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [THORIN_II] }],
          hand: [HALDIR],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const thorinId = findCharInstanceId(state, RESOURCE_PLAYER, THORIN_II);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const haldirUnderThorin = actions.filter(a => a.controlledBy === thorinId);
    expect(haldirUnderThorin).toHaveLength(0);
  });

  // ── Effects 1 + 4: +2 DI (Blue Mountain Dwarves specific) and +2 DI (Dwarf faction) stack ──

  test('+2 DI vs Blue Mountain Dwarves faction and +2 DI vs Dwarf factions stack (need=2)', () => {
    // Blue Mountain Dwarves: influenceNumber=10, Dwarves get +2 from the faction's check-modifier.
    // Thorin DI 2 + 2 (Blue Mountain Dwarves specific) + 2 (Dwarf faction) = 6 effective DI.
    // need = 10 - 6 - 2 (Dwarf check modifier) = 2.
    const state = buildSitePhaseState({
      characters: [THORIN_II],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const thorinId = findCharInstanceId(state, RESOURCE_PLAYER, THORIN_II);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const thorinAttempt = influenceActions.find(a => a.influencingCharacterId === thorinId);
    expect(thorinAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) - diBonusBMDwarves(2) - diBonusDwarfFaction(2) - dwarfCheckMod(2) = 2
    expect(thorinAttempt!.need).toBe(2);
  });

  // ── Sanity: base stats not inflated by conditional bonuses ──

  test('base effective prowess is 5 (combat bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN_II] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const thorinDef = pool[THORIN_II as string] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, THORIN_II).effectiveStats.prowess).toBe(thorinDef.prowess);
    expect(thorinDef.prowess).toBe(5);
  });

  test('base effective DI is 2 (DI bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN_II] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const thorinDef = pool[THORIN_II as string] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, THORIN_II).effectiveStats.directInfluence).toBe(thorinDef.directInfluence);
    expect(thorinDef.directInfluence).toBe(2);
  });
});
