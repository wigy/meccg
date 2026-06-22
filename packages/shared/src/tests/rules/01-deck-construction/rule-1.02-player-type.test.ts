/**
 * @module rule-1.02-player-type
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.02: Player Type
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Each player chooses what type of player they will be: Wizard, Ringwraith, Fallen-wizard, or Balrog (which is differentiated from Ringwraith for the sake of clarity in the following game rules; see the Council of Elrond Official Tournament Policies for how Ringwraith and Balrog overlap when declaring alignments in General Opponent tournaments).
 */

import { describe, test, expect } from 'vitest';
import { validateDeck } from '../../../index.js';
import { pool } from '../../test-helpers.js';
import type { DeckList } from '../../../index.js';

const ALIGNMENTS = ['hero', 'minion', 'fallen-wizard', 'balrog'] as const;

/** A minimal structurally-complete deck of the given player type (custom fixture). */
function minimalDeck(alignment: DeckList['alignment']): DeckList {
  return {
    id: `fixture-${alignment}`,
    name: `Fixture ${alignment}`,
    alignment,
    pool: [],
    deck: { characters: [], hazards: [], resources: [] },
    sites: [],
    sideboard: [],
  };
}

describe('Rule 1.02 — Player Type', () => {
  test('a deck may declare any of the four player types', () => {
    for (const alignment of ALIGNMENTS) {
      const deck = minimalDeck(alignment);
      // The declared player type is accepted — no structural ("general") error
      // is raised for the alignment itself.
      const generalErrors = validateDeck(deck, pool).filter(e => e.section === 'general');
      expect(generalErrors, `alignment "${alignment}" should be a valid player type`).toHaveLength(0);
    }
  });

  test('player type drives alignment-specific validation (FW avatar must match)', () => {
    // A Fallen-wizard deck declaring a Wizard avatar is rejected, while the same
    // avatar in a hero deck is fine — confirming the declared player type governs
    // the rules applied. (Saruman tw-181 = Wizard avatar.)
    const avatar = { name: 'Saruman', card: 'tw-181', qty: 3 } as DeckList['deck']['characters'][number];
    const fwDeck: DeckList = { ...minimalDeck('fallen-wizard'), deck: { characters: [avatar], hazards: [], resources: [] } };
    const heroDeck: DeckList = { ...minimalDeck('hero'), deck: { characters: [avatar], hazards: [], resources: [] } };

    expect(validateDeck(fwDeck, pool).some(e => e.message.includes('Fallen-wizard avatar'))).toBe(true);
    expect(validateDeck(heroDeck, pool).some(e => e.message.includes('Fallen-wizard avatar'))).toBe(false);
  });
});
