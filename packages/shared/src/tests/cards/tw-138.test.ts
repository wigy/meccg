/**
 * @module tw-138.test
 *
 * Card test: Dáin II (tw-138)
 * Type: hero-character
 * Prowess 5 / Body 8 / Mind 7 / DI 3 / MP 2
 * Skills: warrior, diplomat
 * Race: dwarf
 * Homesite: Iron Hill Dwarf-hold
 * Effects: 4
 *
 * "Unique. +2 direct influence against the Iron Hill Dwarves faction,
 *  +2 prowess against Orcs. +1 direct influence against Men and Man factions."
 *
 * "Men" is the race Man; Dúnedain are a separate race in MECCG and are not
 * covered by the bonus (contrast Firiel dm-10, which names Dúnedain explicitly).
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                                             |
 * |---|-------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | +2 DI vs Iron Hill Dwarves (faction)      | IMPLEMENTED | stat-modifier, reason=faction-influence-check     |
 * | 2 | +2 prowess vs Orcs                        | IMPLEMENTED | stat-modifier, reason=combat, enemy.race=orc      |
 * | 3 | +1 DI vs Men (character influence)        | IMPLEMENTED | stat-modifier, reason=influence-check, target=man |
 * | 4 | +1 DI vs Man factions                     | IMPLEMENTED | stat-modifier, reason=faction-influence-check     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  MEN_OF_ANORIEN,
  buildSitePhaseState,
  findCharInstanceId, pool, RESOURCE_PLAYER,
  getCharacter,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';

const DAIN_II = 'tw-138' as CardDefinitionId;
const IRON_HILL_DWARVES = 'tw-261' as CardDefinitionId;
const IRON_HILL_DWARF_HOLD = 'tw-403' as CardDefinitionId;
/** Erkenbrand — Man, mind 4: out of reach on Dáin's printed DI 3, in reach with the +1. */
const ERKENBRAND = 'tw-148' as CardDefinitionId;
/** Boromir II — Dúnadan, mind 4: the same mind, but not a Man, so no bonus. */
const BOROMIR_II = 'tw-134' as CardDefinitionId;

function makeDainOrgState() {
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: LORIEN, characters: [DAIN_II] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

function makeDainCombatState() {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [DAIN_II] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Dáin II (tw-138)', () => {
  beforeEach(() => resetMint());

  // ── Base stats ─────────────────────────────────────────────────────────────

  test('base effective DI is 3 (conditional bonuses do not inflate base stats)', () => {
    const state = makeDainOrgState();
    const dainDef = pool[DAIN_II as string] as CharacterCard;
    expect(dainDef.directInfluence).toBe(3);
    expect(getCharacter(state, RESOURCE_PLAYER, DAIN_II).effectiveStats.directInfluence).toBe(dainDef.directInfluence);
  });

  // ── Effect 1: +2 DI vs Iron Hill Dwarves faction ───────────────────────────

  test('+2 DI reduces need when Dáin influences the Iron Hill Dwarves faction', () => {
    // influence # 9 - (DI 3 + 2 bonus) - dwarf standard modification (+2) = 2.
    // Without the +2 DI bonus the need would be 4.
    const state = buildSitePhaseState({
      characters: [DAIN_II],
      site: IRON_HILL_DWARF_HOLD,
      hand: [IRON_HILL_DWARVES],
    });

    const dainId = findCharInstanceId(state, RESOURCE_PLAYER, DAIN_II);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const dainAttempt = influenceActions.find(a => a.influencingCharacterId === dainId);
    expect(dainAttempt).toBeDefined();
    expect(dainAttempt!.need).toBe(2);
  });

  // ── Effect 2: +2 prowess vs Orcs ───────────────────────────────────────────

  test('+2 prowess in combat against Orcs', () => {
    const state = makeDainCombatState();
    const dainId = findCharInstanceId(state, RESOURCE_PLAYER, DAIN_II);
    const dain = state.players[RESOURCE_PLAYER].characters[dainId];
    const dainDef = pool[DAIN_II as string] as CharacterCard;

    // Base prowess 5 + 2 bonus = 7
    expect(computeCombatProwess(state, dain, dainDef, Race.Orc)).toBe(dainDef.prowess + 2);
  });

  test('no prowess bonus against non-Orc enemies', () => {
    const state = makeDainCombatState();
    const dainId = findCharInstanceId(state, RESOURCE_PLAYER, DAIN_II);
    const dain = state.players[RESOURCE_PLAYER].characters[dainId];
    const dainDef = pool[DAIN_II as string] as CharacterCard;

    expect(computeCombatProwess(state, dain, dainDef, Race.Troll)).toBe(dainDef.prowess);
    expect(computeCombatProwess(state, dain, dainDef, Race.Undead)).toBe(dainDef.prowess);
    expect(computeCombatProwess(state, dain, dainDef, Race.Man)).toBe(dainDef.prowess);
  });

  // ── Effect 3: +1 DI vs Men (character influence-check) ─────────────────────

  test('+1 DI bonus against Man characters via availableDI', () => {
    const state = makeDainOrgState();
    const dainId = findCharInstanceId(state, RESOURCE_PLAYER, DAIN_II);
    const erkenbrandDef = pool[ERKENBRAND as string] as CharacterCard;

    expect(erkenbrandDef.race).toBe(Race.Man);
    expect(availableDI(state, dainId, state.players[RESOURCE_PLAYER], erkenbrandDef)).toBe(4); // 3 + 1
  });

  test('+1 DI bonus allows Dáin to control Erkenbrand (Man, mind 4) as a follower', () => {
    // Dáin DI 3 + 1 Man bonus = 4 >= Erkenbrand mind 4 → control is legal.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [DAIN_II, LEGOLAS] }], hand: [ERKENBRAND], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const dainId = findCharInstanceId(state, RESOURCE_PLAYER, DAIN_II);
    const underDain = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-character')
      .map(a => a.action as { type: 'play-character'; controlledBy?: string })
      .filter(a => a.controlledBy === dainId);

    expect(underDain.length).toBeGreaterThanOrEqual(1);
  });

  test('no DI bonus against Dúnedain — Boromir II (mind 4) cannot be Dáin’s follower', () => {
    // Dúnedain are a distinct race from Men: Dáin's DI stays 3 < mind 4.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [DAIN_II, LEGOLAS] }], hand: [BOROMIR_II], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const dainId = findCharInstanceId(state, RESOURCE_PLAYER, DAIN_II);
    const boromirDef = pool[BOROMIR_II as string] as CharacterCard;
    expect(availableDI(state, dainId, state.players[RESOURCE_PLAYER], boromirDef)).toBe(3);

    const underDain = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-character')
      .map(a => a.action as { type: 'play-character'; controlledBy?: string })
      .filter(a => a.controlledBy === dainId);

    expect(underDain).toHaveLength(0);
  });

  test('no DI bonus against Elf or Dúnadan characters', () => {
    const state = makeDainOrgState();
    const dainId = findCharInstanceId(state, RESOURCE_PLAYER, DAIN_II);
    const player = state.players[RESOURCE_PLAYER];

    expect(availableDI(state, dainId, player, pool[LEGOLAS as string] as CharacterCard)).toBe(3);
    expect(availableDI(state, dainId, player, pool[ARAGORN as string] as CharacterCard)).toBe(3);
  });

  // ── Effect 4: +1 DI vs Man factions (faction-influence-check) ──────────────

  test('+1 DI bonus applies when Dáin influences a Man faction (Men of Anórien)', () => {
    // influence # 8 - (DI 3 + 1 Man-faction bonus) = 4; the faction's Dúnedain
    // standard modification does not apply to a dwarf. Without the bonus: 5.
    const state = buildSitePhaseState({
      characters: [DAIN_II],
      site: MINAS_TIRITH,
      hand: [MEN_OF_ANORIEN],
    });

    const dainId = findCharInstanceId(state, RESOURCE_PLAYER, DAIN_II);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const dainAttempt = influenceActions.find(a => a.influencingCharacterId === dainId);
    expect(dainAttempt).toBeDefined();
    expect(dainAttempt!.need).toBe(4);
  });
});
