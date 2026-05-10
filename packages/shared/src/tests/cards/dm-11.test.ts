/**
 * @module dm-11.test
 *
 * Card test: Fori the Beardless (dm-11)
 * Type: minion-character (ringwraith)
 * Effects: 2
 *
 * "Unique. Agent. +2 direct influence against Dwarves and Dwarf Factions."
 *
 * Effects tested:
 * 1. stat-modifier: +2 DI during influence-check when target race is dwarf
 * 2. stat-modifier: +2 DI during faction-influence-check when faction race is dwarf
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion candidate characters (LE/DM). No minion dwarves with mind <= 3
 * exist in the card pool (Drór is mind 4), so the influence-check effect is
 * verified directly via availableDI rather than through a play-character action.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, viablePlayCharacterActions,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';

const FORI = 'dm-11' as CardDefinitionId;

// Minion dwarf for influence-check target (mind 4 — only minion dwarf available)
const DROR = 'dm-6' as CardDefinitionId;          // dwarf, mind 4
// Non-dwarf minion character for negative test
const OSTISEN = 'le-36' as CardDefinitionId;       // man, mind 2
const LUITPRAND = 'le-23' as CardDefinitionId;     // man, mind 1 (for player 2 company)

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven (minion)
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold (minion)
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold (minion)

// Hero dwarf faction with positive influenceNumber for faction influence test
const BLUE_MOUNTAIN_DWARF_HOLD = 'tw-377' as CardDefinitionId; // free-hold
const BLUE_MOUNTAIN_DWARVES = 'tw-200' as CardDefinitionId;    // dwarf faction, influence# 9

describe('Fori the Beardless (dm-11)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonuses do not inflate base stats) ──────────────

  test('base effective DI is 1 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [FORI] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const baseDef = pool[FORI as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(1);
    expect(getCharacter(state, RESOURCE_PLAYER, FORI).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +2 DI during influence-check (character control) ──────────────

  test('+2 DI bonus applies when checking influence against a dwarf (availableDI = 3)', () => {
    // Fori base DI = 1. The +2 bonus against Dwarves gives effective DI 3 vs Drór.
    // No minion dwarf with mind <= 3 exists (Drór has mind 4), so we verify the
    // modifier directly via availableDI rather than a play-character action.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [FORI] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const foriId = findCharInstanceId(state, RESOURCE_PLAYER, FORI);
    const drorDef = pool[DROR as string] as CharacterCard;

    // With +2 DI vs dwarves: 1 + 2 = 3
    const diAgainstDwarf = availableDI(state, foriId, state.players[0], drorDef);
    expect(diAgainstDwarf).toBe(3);
  });

  test('+2 DI bonus does NOT apply to non-dwarf characters (availableDI stays 1)', () => {
    // Ostisen is race "man". Fori's +2 DI bonus is race-gated (dwarf only),
    // so DI stays at the base value of 1 when the target is a man.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [FORI] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const foriId = findCharInstanceId(state, RESOURCE_PLAYER, FORI);
    const ostisenDef = pool[OSTISEN as string] as CharacterCard;

    // No bonus for non-dwarves: DI = 1
    const diAgainstMan = availableDI(state, foriId, state.players[0], ostisenDef);
    expect(diAgainstMan).toBe(1);
  });

  test('Fori cannot control a non-dwarf character with mind 2 (DI 1 < 2, no bonus for men)', () => {
    // Ostisen is race "man" with mind 2. Fori's base DI=1 and no bonus applies
    // for men, so DI 1 < mind 2 → Fori cannot take Ostisen as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [FORI] }],
          hand: [OSTISEN],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const foriId = findCharInstanceId(state, RESOURCE_PLAYER, FORI);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const ostisenUnderFori = actions.filter(a => a.controlledBy === foriId);
    expect(ostisenUnderFori).toHaveLength(0);
  });

  // ─── Effect 2: +2 DI during faction-influence-check (dwarf factions) ─────────

  test('+2 DI bonus applies when influencing a Dwarf faction (Blue Mountain Dwarves)', () => {
    // Fori (dwarf, base DI 1) attempts to influence Blue Mountain Dwarves
    // (dwarf faction, influenceNumber 9) at Blue Mountain Dwarf-hold.
    // Modifiers:
    //   baseDI = 1
    //   +2 from Fori's stat-modifier vs dwarf factions
    //   +2 from faction's check-modifier bonus for dwarf bearer
    //   total = 5  →  need = 9 - 5 = 4
    const state = buildSitePhaseState({
      characters: [FORI],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const foriId = findCharInstanceId(state, RESOURCE_PLAYER, FORI);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const foriAttempt = influenceActions.find(
      a => a.influencingCharacterId === foriId,
    );
    expect(foriAttempt).toBeDefined();

    // baseDI(1) + DI bonus vs dwarves(2) + faction check-bonus for dwarves(2) = 5
    // need = influenceNumber(9) - totalModifier(5) = 4
    expect(foriAttempt!.need).toBe(4);
  });
});
