/**
 * @module deck-legality-join-parity.test
 *
 * Regression test: a deck the deck editor reports as legal must be reported
 * legal by the game server too.
 *
 * The editor and the server run the SAME rule engine (`validateDeck`), so any
 * disagreement came from the input, not the rules. The join message used to
 * carry the play deck as one flat card list; the server rebuilt the
 * characters/hazards/resources grouping by looking at each card's `cardType`.
 * That re-bucketing mis-filed character-typed cards a hero player legitimately
 * placed in the hazard section — agents played as hazards (Baduila dm-2) and
 * the "manifestation" agents Lobelia (dm-28) / My Precious (dm-29), all of
 * `cardType` `minion-character`. Moved into the character bucket, they dropped
 * the hazard total below the resource total and the creature count below the
 * 12-creature minimum, so the server rejected a deck the editor accepted.
 *
 * The fix has `buildJoinFromDeck` attach the structured deck the editor
 * validated (`JoinMessage.deckList`); the server validates that verbatim. This
 * test builds a legal hero deck whose legality depends on three such agents
 * sitting in the hazard section and asserts the join message carries the deck
 * the editor validated, with the grouping intact.
 */

import './test-dom-bootstrap.js'; // app-state reads `window.__meccg` at module load
import { describe, test, expect } from 'vitest';
import { validateDeck } from '@meccg/shared';
import type { DeckList } from '@meccg/shared';
import { buildJoinFromDeck, cardPool, type FullDeck } from './app-state.js';

// Ten non-unique hero resources (×3 = 30 resources).
const HERO_RESOURCES = ['tw-206', 'tw-259', 'tw-254', 'tw-322', 'tw-306', 'tw-196', 'tw-224', 'tw-266', 'tw-274', 'tw-327'];
// Four non-unique hazard creatures (×3 = 12 creatures — exactly the minimum).
const HAZARD_CREATURES = ['tw-020', 'tw-074', 'tw-015', 'tw-072'];
// Five non-unique hazard events (×3 = 15).
const HAZARD_EVENTS = ['tw-28', 'tw-32', 'tw-108', 'tw-21', 'tw-61'];
// Three agents a hero deck plays as hazards. Each is `minion-character`, so a
// cardType-based split files them as characters; each counts as ½ a creature.
const HAZARD_AGENTS = ['dm-2', 'dm-28', 'dm-29'];
const GANDALF = 'tw-156'; // hero avatar (Wizard)

const entry = (card: string, qty: number) => ({ name: cardPool[card]?.name ?? card, card, qty });

// A legal hero deck: 30 resources, and 30 hazards whose 12-creature minimum and
// resource/hazard parity both rely on the three agents being counted as hazards.
const DECK: FullDeck = {
  id: 'parity', name: 'Parity', alignment: 'hero',
  pool: [], sites: [], sideboard: [], antiFwSideboard: [],
  deck: {
    characters: [entry(GANDALF, 1)],
    resources: HERO_RESOURCES.map(id => entry(id, 3)),
    hazards: [
      ...HAZARD_CREATURES.map(id => entry(id, 3)),
      ...HAZARD_EVENTS.map(id => entry(id, 3)),
      ...HAZARD_AGENTS.map(id => entry(id, 1)),
    ],
  },
};

describe('join-message deck legality parity', () => {
  test('the deck is legal in the editor', () => {
    // Sanity: the editor validates the deck object directly and finds no error.
    expect(validateDeck(DECK as unknown as DeckList, cardPool)).toEqual([]);
  });

  test('the join message carries the exact deck the editor validated', () => {
    const join = buildJoinFromDeck(DECK, 'wigy');
    expect(join.deckList).toBeDefined();
    // The server validates join.deckList; it must reach the editor's verdict.
    expect(validateDeck(join.deckList as DeckList, cardPool))
      .toEqual(validateDeck(DECK as unknown as DeckList, cardPool));
  });

  test('character-typed hazards stay in the hazard section over the wire', () => {
    const join = buildJoinFromDeck(DECK, 'wigy');
    const hazardIds = new Set<string>((join.deckList as DeckList).deck.hazards.map(e => e.card as string));
    for (const agent of HAZARD_AGENTS) {
      // The card's own type is a character type — a cardType-based split (the
      // pre-fix server reconstruction) would misfile it — yet the deck list
      // keeps it where the player put it: the hazard section.
      expect(cardPool[agent]?.cardType).toBe('minion-character');
      expect(hazardIds.has(agent)).toBe(true);
    }
  });
});
