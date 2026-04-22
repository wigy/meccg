/**
 * @module td-120.test
 *
 * Card test: Habergeon of Silver (td-120)
 * Type: hero-resource-item (major, hoard item, armor)
 *
 * Printed text:
 *   "Hoard item. Armor. Bearer receives +2 body to a maximum of 10."
 *
 * Rule coverage:
 *
 * | # | Rule                                            | Status              |
 * |---|-------------------------------------------------|---------------------|
 * | 1 | Hoard item — playable only at hoard sites       | IMPLEMENTED (test)  |
 * | 2 | Bearer receives +2 body                         | IMPLEMENTED (test)  |
 * | 3 | Bearer body capped at 10                        | IMPLEMENTED (test)  |
 *
 * "Armor" is an italicized type classification on the printed card; it does
 * not grant a mechanical effect of its own, so no test is needed for it.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, THEODEN, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  resetMint, pool,
  buildSitePhaseState, buildTestState,
  viableActions,
  getCharacter,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';
import { Phase } from '../../index.js';

const HABERGEON_OF_SILVER = 'td-120' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // hoard site (Smaug's lair)

describe('Habergeon of Silver (td-120)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Hoard-item site restriction ─────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [HABERGEON_OF_SILVER],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [HABERGEON_OF_SILVER],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at a haven (Lórien)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [ARAGORN],
      hand: [HABERGEON_OF_SILVER],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 2: +2 body bonus (below cap) ───────────────────────────────────

  test('bearer with base body 6 gets +2 body (below max 10)', () => {
    // Théoden: base body 6, +2 = 8, below the max of 10.
    const baseDef = pool[THEODEN as string] as CharacterCard;
    expect(baseDef.body).toBe(6);

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: THEODEN, items: [HABERGEON_OF_SILVER] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const theoden = getCharacter(state, RESOURCE_PLAYER, THEODEN);
    expect(theoden.effectiveStats.body).toBe(8);
  });

  test('bearer with base body 8 gets +2 body exactly at max 10', () => {
    // Legolas: base body 8, +2 = 10, lands exactly on the cap.
    const baseDef = pool[LEGOLAS as string] as CharacterCard;
    expect(baseDef.body).toBe(8);

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS, items: [HABERGEON_OF_SILVER] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const legolas = getCharacter(state, RESOURCE_PLAYER, LEGOLAS);
    expect(legolas.effectiveStats.body).toBe(10);
  });

  // ─── Rule 3: body bonus capped at max 10 ─────────────────────────────────

  test('bearer with base body 9 is capped at max 10 (not 11)', () => {
    // Aragorn: base body 9, +2 = 11, must be capped to 10.
    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.body).toBe(9);

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [HABERGEON_OF_SILVER] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const aragorn = getCharacter(state, RESOURCE_PLAYER, ARAGORN);
    expect(aragorn.effectiveStats.body).toBe(10);
  });

  // ─── No prowess change ───────────────────────────────────────────────────

  test('does not modify bearer prowess', () => {
    const baseDef = pool[ARAGORN as string] as CharacterCard;

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [HABERGEON_OF_SILVER] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const aragorn = getCharacter(state, RESOURCE_PLAYER, ARAGORN);
    expect(aragorn.effectiveStats.prowess).toBe(baseDef.prowess);
  });
});
