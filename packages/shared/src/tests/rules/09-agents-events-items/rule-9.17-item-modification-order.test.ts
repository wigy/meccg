/**
 * @module rule-9.17-item-modification-order
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.17: Item Modification Order
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Prowess modifications and maximums from a character's weapon are applied before other effects. Body modifications and maximums from the character's shield, armor, and/or helmet are then applied before other effects.
 */

import { describe, test, expect } from 'vitest';
import { Phase } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH,
  GLAMDRING, THE_MITHRIL_COAT,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../../test-helpers.js';

describe('Rule 9.17 — Item Modification Order', () => {
  test('Weapon prowess modifier applied to character effective prowess', () => {
    // Glamdring (+3 prowess, max 8 non-combat) on Aragorn (base prowess=6).
    // Rule 9.17: weapon mods applied before other effects → 6+3=9, capped to 8.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const aragorn = state.players[RESOURCE_PLAYER].characters[aragornId as string];
    // Glamdring DSL effect: +3 prowess, max 8 (non-combat context) → 8
    expect(aragorn.effectiveStats.prowess).toBe(8);
  });

  test('Armor/shield/helmet body modifier applied to character effective body', () => {
    // The Mithril-coat (+3 body, max 10) on Aragorn (base body=9).
    // Rule 9.17: armor body mods applied before other effects → 9+3=12, capped to 10.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [THE_MITHRIL_COAT] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const aragorn = state.players[RESOURCE_PLAYER].characters[aragornId as string];
    // Mithril-coat DSL effect: +3 body, max 10 → 10
    expect(aragorn.effectiveStats.body).toBe(10);
  });
});
