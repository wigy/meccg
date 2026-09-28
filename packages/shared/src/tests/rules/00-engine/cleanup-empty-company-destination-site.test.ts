/**
 * @module cleanup-empty-company-destination-site.test
 *
 * Regression for a site-instance leak in `cleanupEmptyCompanies`. When a
 * company loses its last character it is dropped from the game, and the
 * function returns the company's *current* site to the location deck — but it
 * forgot the *planned destination*. `plan-movement` draws the destination card
 * out of the site deck and stores it only on the company, so dropping the
 * company without returning the destination deleted that site instance
 * outright, violating the engine invariant that no card instance may ever
 * disappear (packages/shared/CLAUDE.md). The function's own docstring recorded
 * the leak as "located but not diagnosed".
 */

import { describe, test, expect } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState,
} from '../../test-helpers.js';
import { Phase, Alignment } from '../../../index.js';
import { cleanupEmptyCompanies } from '../../../engine/reducer-utils.js';

describe('cleanupEmptyCompanies conserves a dissolved company\'s planned destination', () => {
  test('returns the planned destination site to the location deck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: RIVENDELL }],
          hand: [], siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = state.players[RESOURCE_PLAYER].companies[0];
    const destInstId = company.destinationSite?.instanceId;
    const currentInstId = company.currentSite?.instanceId;
    expect(destInstId).toBeDefined();
    // plan-movement pulled the destination out of the site deck, so it lives
    // only on the company — nowhere else in the game state.
    expect(state.players[RESOURCE_PLAYER].siteDeck.some(c => c.instanceId === destInstId)).toBe(false);

    // The company's sole character is eliminated, leaving it empty.
    const emptied = {
      ...state,
      players: [
        { ...state.players[0], companies: [{ ...company, characters: [] }] },
        state.players[1],
      ],
    } as typeof state;

    const result = cleanupEmptyCompanies(emptied);

    expect(result.players[RESOURCE_PLAYER].companies).toHaveLength(0);
    const deckIds = result.players[RESOURCE_PLAYER].siteDeck.map(c => c.instanceId);
    // Both the current site and the planned destination survive, back in the deck.
    expect(deckIds).toContain(destInstId);
    expect(deckIds).toContain(currentInstId);
  });

  // Regression (sim seed 97001, decks b vs f): two companies moved to the same
  // site, so they shared one site instance, and both were wiped out in
  // combat. The current-site loop returned that one card once per empty
  // company, leaving two copies of the same instance in the location deck.
  test('returns a site shared by two empty companies only once', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Wizard,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: RIVENDELL, characters: [LEGOLAS] },
          ],
          hand: [], siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });

    const [first, second] = state.players[RESOURCE_PLAYER].companies;
    const sharedSite = first.currentSite!;
    // Both companies now stand at the same site instance with no characters.
    const emptied = {
      ...state,
      players: [
        {
          ...state.players[0],
          companies: [
            { ...first, characters: [] },
            { ...second, characters: [], currentSite: sharedSite },
          ],
        },
        state.players[1],
      ],
    } as typeof state;

    const result = cleanupEmptyCompanies(emptied);

    expect(result.players[RESOURCE_PLAYER].companies).toHaveLength(0);
    const copies = result.players[RESOURCE_PLAYER].siteDeck.filter(c => c.instanceId === sharedSite.instanceId);
    expect(copies).toHaveLength(1);
  });
});
