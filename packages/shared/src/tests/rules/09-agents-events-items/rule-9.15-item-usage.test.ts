/**
 * @module rule-9.15-item-usage
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.15: Item Usage
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Characters can bear any number of items, but each character can only use one weapon, armor, shield, and helmet at a time. Items that aren't in use don't have any effect on their bearer.
 * An item's effects are only implemented while the item is in use, including modifications that the item applies to its bearer's prowess, body, direct influence, skills, and/or other attributes. This rule does not apply to the item's marshalling points or corruption points, because those are attributes of the item card and not its effects.
 * When an item is played on a character that is able to use its effects, the item is considered to be in use upon resolution and any modifications to the bearer's attributes are applied immediately.
 */

import { describe, expect, test } from 'vitest';
import { GIMLI, RIVENDELL, LORIEN, LEGOLAS, MINAS_TIRITH } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import { Phase } from '../../../index.js';
import {
  PLAYER_1,
  PLAYER_2,
  buildTestState,
  findCharInstanceId, RESOURCE_PLAYER,
} from '../../test-helpers.js';

// Adamant Helmet (td-96): Helmet, +1 body, 1 corruption point. Non-unique
// (3 copies allowed per deck) so it's the natural fixture for "two helmets
// borne by the same character" — currently the only helmet card with a
// stat modifier in the data, hence the local-only constant.
const ADAMANT_HELMET = 'td-96' as CardDefinitionId;

describe('Rule 9.15 — Item Usage (Helmet)', () => {
  test('a single helmet contributes its +1 body modifier', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [{ defId: GIMLI, items: [ADAMANT_HELMET] }],
          }],
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
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const gimli = state.players[0].characters[gimliId as string];
    // Gimli base body 8, +1 from one Adamant Helmet = 9.
    expect(gimli.effectiveStats.body).toBe(9);
  });

  test('two helmets only contribute one body modifier (rule 9.15)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [{
              defId: GIMLI,
              items: [ADAMANT_HELMET, ADAMANT_HELMET],
            }],
          }],
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
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const gimli = state.players[0].characters[gimliId as string];
    // Without rule 9.15 enforcement both helmets would stack to body 10;
    // with enforcement only the first is "in use" and contributes +1.
    expect(gimli.effectiveStats.body).toBe(9);
  });

  test('borne-but-unused helmets still contribute corruption points', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [{
              defId: GIMLI,
              items: [ADAMANT_HELMET, ADAMANT_HELMET],
            }],
          }],
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
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const gimli = state.players[0].characters[gimliId as string];
    // Each Adamant Helmet has 1 CP; both contribute since CP is an
    // attribute of the card, not an effect (rule 9.15 carve-out).
    expect(gimli.effectiveStats.corruptionPoints).toBe(2);
  });
});
