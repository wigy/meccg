/**
 * @module td-96.test
 *
 * Card test: Adamant Helmet (td-96)
 * Type: hero-resource-item (minor, hoard item, helmet)
 *
 * Printed text:
 *   "Hoard item. Helmet. +1 to body to a maximum of 9.
 *    Cancels all dark enchantments targetting bearer."
 *
 * Rule coverage:
 *
 * | # | Rule                                            | Status              |
 * |---|-------------------------------------------------|---------------------|
 * | 1 | Hoard item — playable only at hoard sites       | IMPLEMENTED (test)  |
 * | 2 | Bearer receives +1 body                         | IMPLEMENTED (test)  |
 * | 3 | Bearer body capped at 9                         | IMPLEMENTED (test)  |
 * | 4 | Cancels all dark enchantments targetting bearer | NOT IMPLEMENTED     |
 *
 * Rule 4 has no engine support: there is no DSL effect for cancelling
 * cards by keyword and no infrastructure for the "dark-enchantment"
 * keyword class to be cancelled. None of the dark enchantment hazards
 * (DM-54, DM-78, TD-16, TD-17, TD-48) are present in card data either,
 * so even a stub cancellation would have no targets to act on. This
 * card is therefore NOT certified pending engine support for hazard
 * cancellation by keyword.
 *
 * "Helmet" is an italicized type classification on the printed card; it
 * does not grant a mechanical effect of its own, so no test is needed for
 * it (it functions only as a slot/keyword tag for other cards to filter on).
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

const ADAMANT_HELMET = 'td-96' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // hoard site (Smaug's lair)

describe('Adamant Helmet (td-96)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Hoard-item site restriction ─────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at a haven (Lórien)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 2: +1 body bonus (below cap) ───────────────────────────────────

  test('bearer with base body 6 gets +1 body (below max 9)', () => {
    // Théoden: base body 6, +1 = 7, well below the max of 9.
    const baseDef = pool[THEODEN as string] as CharacterCard;
    expect(baseDef.body).toBe(6);

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: THEODEN, items: [ADAMANT_HELMET] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const theoden = getCharacter(state, RESOURCE_PLAYER, THEODEN);
    expect(theoden.effectiveStats.body).toBe(7);
  });

  test('bearer with base body 8 gets +1 body exactly at max 9', () => {
    // Legolas: base body 8, +1 = 9, lands exactly on the cap.
    const baseDef = pool[LEGOLAS as string] as CharacterCard;
    expect(baseDef.body).toBe(8);

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS, items: [ADAMANT_HELMET] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const legolas = getCharacter(state, RESOURCE_PLAYER, LEGOLAS);
    expect(legolas.effectiveStats.body).toBe(9);
  });

  // ─── Rule 3: body bonus capped at max 9 ──────────────────────────────────

  test('bearer with base body 9 is capped at max 9 (not 10)', () => {
    // Aragorn: base body 9, +1 = 10, must be capped to 9.
    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.body).toBe(9);

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [ADAMANT_HELMET] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const aragorn = getCharacter(state, RESOURCE_PLAYER, ARAGORN);
    expect(aragorn.effectiveStats.body).toBe(9);
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
          companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [ADAMANT_HELMET] }] }],
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
