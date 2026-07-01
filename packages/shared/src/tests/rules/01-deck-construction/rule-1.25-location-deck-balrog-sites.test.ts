/**
 * @module rule-1.25-location-deck-balrog-sites
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.25: Location Deck - Balrog Sites
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Any player's location deck may include one copy of each Balrog site for which there is no corresponding hero or minion site, specifically Ancient Deep-hold, The Wind-deeps, The Drowning Deeps, The Rusted-deeps, and Remains of Thangorodrim; however, only a Balrog player can use these site cards for anything except playing hazards.
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, MINION_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// ba-83 = Ancient Deep-hold — designated Balrog site, no hero/minion equivalent
// ba-92 = Minas Morgul (balrog-site) — has a minion equivalent (le-390), so it is
//         NOT one of the designated sites and remains Balrog-only.

const heroDeck: DeckList = {
  id: 'test-hero-designated-balrog-site',
  name: 'Hero Designated Balrog Site Test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Rivendell', card: 'tw-421' as CardDefinitionId, qty: 4 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30],
  },
};

const minionDeck: DeckList = {
  id: 'test-minion-designated-balrog-site',
  name: 'Minion Designated Balrog Site Test',
  alignment: 'minion',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Minas Morgul', card: 'le-390' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...MINION_RESOURCES_30],
  },
};

describe('Rule 1.25 — Location Deck - Balrog Sites', () => {
  test('a hero location deck may include a designated Balrog site with no hero/minion equivalent', () => {
    const deck: DeckList = {
      ...heroDeck,
      sites: [...heroDeck.sites, { name: 'Ancient Deep-hold', card: 'ba-83' as CardDefinitionId, qty: 1 }],
    };
    expect(validateDeck(deck, pool).some(e => e.card === ('ba-83' as CardDefinitionId))).toBe(false);
  });

  test('a minion location deck may include a designated Balrog site with no hero/minion equivalent', () => {
    const deck: DeckList = {
      ...minionDeck,
      sites: [...minionDeck.sites, { name: 'Ancient Deep-hold', card: 'ba-83' as CardDefinitionId, qty: 1 }],
    };
    expect(validateDeck(deck, pool).some(e => e.card === ('ba-83' as CardDefinitionId))).toBe(false);
  });

  test('a hero location deck cannot include a Balrog site that has a hero/minion equivalent', () => {
    const deck: DeckList = {
      ...heroDeck,
      sites: [...heroDeck.sites, { name: 'Minas Morgul (Balrog)', card: 'ba-92' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool).filter(e => e.card === ('ba-92' as CardDefinitionId));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('rule 1.25');
  });

  test('a minion location deck cannot include a Balrog site that has a hero/minion equivalent', () => {
    const deck: DeckList = {
      ...minionDeck,
      sites: [...minionDeck.sites, { name: 'Minas Morgul (Balrog)', card: 'ba-92' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool).filter(e => e.card === ('ba-92' as CardDefinitionId));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('rule 1.25');
  });
});
