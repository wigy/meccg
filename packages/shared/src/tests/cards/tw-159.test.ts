/**
 * @module tw-159.test
 *
 * Card test: Gimli (tw-159)
 * Type: hero-character
 * Prowess 5 / Body 8 / Mind 6 / DI 2 / MP 2
 * Skills: warrior, diplomat
 * Race: dwarf
 * Homesite: Iron Hill Dwarf-hold
 * Effects: 4
 *
 * "Unique. +2 direct influence against the Iron Hill Dwarves faction,
 *  +2 prowess against Orcs. +1 direct influence against Elves and Elf factions."
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                                             |
 * |---|-------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | +2 DI vs Iron Hill Dwarves (faction)      | IMPLEMENTED | stat-modifier, reason=faction-influence-check     |
 * | 2 | +2 prowess vs Orcs                        | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc      |
 * | 3 | +1 DI vs Elves (character influence)      | IMPLEMENTED | stat-modifier, reason=influence-check, target=elf |
 * | 4 | +1 DI vs Elf factions                     | IMPLEMENTED | stat-modifier, reason=faction-influence-check     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI, HALDIR, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, THRANDUILS_HALLS,
  WOOD_ELVES,
  buildSitePhaseState,
  findCharInstanceId, pool, RESOURCE_PLAYER,
  getCharacter,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';

const IRON_HILL_DWARVES = 'tw-261' as CardDefinitionId;
const IRON_HILL_DWARF_HOLD = 'tw-403' as CardDefinitionId;

function makeGimliOrgState() {
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

function makeGimliCombatState() {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Gimli (tw-159)', () => {
  beforeEach(() => resetMint());

  // ── Base stats ─────────────────────────────────────────────────────────────

  test('base effective DI is 2 (conditional bonuses do not inflate base stats)', () => {
    const state = makeGimliOrgState();
    const gimliDef = pool[GIMLI as string] as CharacterCard;
    expect(gimliDef.directInfluence).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.directInfluence).toBe(gimliDef.directInfluence);
  });

  // ── Effect 1: +2 DI vs Iron Hill Dwarves faction ───────────────────────────

  test('+2 DI reduces need when Gimli influences Iron Hill Dwarves faction', () => {
    // influenceNumber(8) - baseDI(2) - diBonusVsIronHillDwarves(2) - dwarfCheckMod(2) = 2
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: IRON_HILL_DWARF_HOLD,
      hand: [IRON_HILL_DWARVES],
    });

    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const gimliAttempt = influenceActions.find(a => a.influencingCharacterId === gimliId);
    expect(gimliAttempt).toBeDefined();
    // 9 - (2 + 2) - 2 = 3 (DI 2 base + 2 bonus, dwarf check +2)
    expect(gimliAttempt!.need).toBe(3);
  });

  // ── Effect 2: +2 prowess vs Orcs ───────────────────────────────────────────

  test('+2 prowess in combat against Orcs', () => {
    const state = makeGimliCombatState();
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const gimli = state.players[RESOURCE_PLAYER].characters[gimliId];
    const gimliDef = pool[GIMLI as string] as CharacterCard;

    const prowessVsOrc = computeCombatProwess(state, gimli, gimliDef, Race.Orc);
    // Base prowess 5 + 2 bonus = 7
    expect(prowessVsOrc).toBe(gimliDef.prowess + 2);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = makeGimliCombatState();
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const gimli = state.players[RESOURCE_PLAYER].characters[gimliId];
    const gimliDef = pool[GIMLI as string] as CharacterCard;

    expect(computeCombatProwess(state, gimli, gimliDef, Race.Troll)).toBe(gimliDef.prowess);
    expect(computeCombatProwess(state, gimli, gimliDef, Race.Undead)).toBe(gimliDef.prowess);
    expect(computeCombatProwess(state, gimli, gimliDef, Race.Wolf)).toBe(gimliDef.prowess);
  });

  // ── Effect 3: +1 DI vs Elves (character influence-check) ───────────────────

  test('+1 DI bonus against Elf characters via availableDI', () => {
    // Gimli base DI = 2; Haldir is an elf — availableDI should return 3
    const state = makeGimliOrgState();
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const haldirDef = pool[HALDIR as string] as CharacterCard;

    const di = availableDI(state, gimliId, state.players[RESOURCE_PLAYER], haldirDef);
    expect(di).toBe(3); // base 2 + 1 elf bonus
  });

  test('+1 DI bonus allows Gimli to control Haldir (elf, mind 3) as a follower', () => {
    // Gimli DI 2 + 1 elf bonus = 3 >= Haldir mind 3 → control is legal.
    // Without the bonus DI 2 < mind 3, so Haldir cannot be a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [GIMLI, LEGOLAS] }], hand: [HALDIR], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const actions = computeLegalActions(state, PLAYER_1);
    const playCharActions = actions
      .filter(a => a.viable && a.action.type === 'play-character')
      .map(a => a.action as { type: 'play-character'; controlledBy?: string });

    const haldirUnderGimli = playCharActions.filter(a => a.controlledBy === gimliId);
    expect(haldirUnderGimli.length).toBeGreaterThanOrEqual(1);
  });

  test('+1 DI bonus does not apply to non-Elf characters', () => {
    // Aragorn is a dunadan (man), not an elf — no bonus applies.
    const state = makeGimliOrgState();
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const aragornDef = pool[ARAGORN as string] as CharacterCard;

    const di = availableDI(state, gimliId, state.players[RESOURCE_PLAYER], aragornDef);
    expect(di).toBe(2); // base only, no bonus
  });

  // ── Effect 4: +1 DI vs Elf factions (faction-influence-check) ─────────────

  test('+1 DI bonus applies when Gimli influences an Elf faction (Wood-elves)', () => {
    // influenceNumber(8) - baseDI(2) - diBonusVsElfFaction(1) - dwarfCheckMod(-2) = 7
    // Without the +1 DI bonus: need = 8 - 2 - (-2) = 8
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const gimliAttempt = influenceActions.find(a => a.influencingCharacterId === gimliId);
    expect(gimliAttempt).toBeDefined();
    // 9 - (2 + 1) - (-2) = 8 (DI 2 base + 1 bonus vs elf faction, dwarf check -2)
    expect(gimliAttempt!.need).toBe(8);
  });
});
