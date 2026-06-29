/**
 * MEWH §9 — Hero item on an Orc/Troll bearer: bonuses ignored.
 *
 * Source: The White Hand Insert, "Special Orc & Troll Rules": "An Orc or Troll
 * character may be the bearer of a hero item, but all bonuses and special
 * abilities are ignored (all restrictions to movement and playability still
 * apply)."
 *
 * The item's corruption points are a cost, not a bonus, so they still apply. A
 * Man bearer of the same hero item gets the full bonus, confirming the
 * suppression is keyed on the Orc/Troll race.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import {
  buildTestState, resetMint, attachItemToChar, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, RIVENDELL, LORIEN, MINAS_TIRITH,
  Phase,
} from '../test-helpers.js';

const DAGGER = 'tw-206' as CardDefinitionId; // hero item: +1 prowess (max 8), 1 corruption point
const GORBAG = 'le-11' as CardDefinitionId;  // Orc, prowess 6
const ASTERNAK = 'le-1' as CardDefinitionId; // Man, prowess 5

describe('MEWH §9 — hero item on an Orc/Troll bearer', () => {
  beforeEach(() => resetMint());

  test('a hero item gives no prowess bonus to an Orc bearer, but its corruption point still applies', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [GORBAG, ASTERNAK] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, GORBAG, DAGGER);
    state = attachItemToChar(state, RESOURCE_PLAYER, ASTERNAK, DAGGER);
    state = recomputeDerived(state);

    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const asternakId = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const gorbag = state.players[RESOURCE_PLAYER].characters[gorbagId];
    const asternak = state.players[RESOURCE_PLAYER].characters[asternakId];

    // Orc: base prowess 6, hero-item +1 ignored → stays 6; corruption point still applies.
    expect(gorbag.effectiveStats.prowess).toBe(6);
    expect(gorbag.effectiveStats.corruptionPoints).toBe(1);

    // Man: base prowess 5, hero-item +1 applies → 6.
    expect(asternak.effectiveStats.prowess).toBe(6);
    expect(asternak.effectiveStats.corruptionPoints).toBe(1);
  });
});
