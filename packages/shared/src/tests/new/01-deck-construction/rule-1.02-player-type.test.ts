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
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { DeckList } from '../../../types/cards.js';

const DECKS_DIR = join(__dirname, '../../../../../../data/decks');
const VALID_ALIGNMENTS = ['hero', 'minion', 'fallen-wizard', 'balrog'] as const;

function loadAllDecks(): DeckList[] {
  const files = readdirSync(DECKS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(readFileSync(join(DECKS_DIR, f), 'utf-8')) as DeckList);
}

describe('Rule 1.02 — Player Type', () => {
  const decks = loadAllDecks();

  test('all sample decks have pool, deck, sites, and sideboard sections', () => {
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      expect(deck, `deck ${deck.id} missing pool`).toHaveProperty('pool');
      expect(deck, `deck ${deck.id} missing deck`).toHaveProperty('deck');
      expect(deck, `deck ${deck.id} missing sites`).toHaveProperty('sites');
      expect(deck, `deck ${deck.id} missing sideboard`).toHaveProperty('sideboard');
    }
  });

  test('each deck alignment is one of hero, minion, fallen-wizard, or balrog', () => {
    for (const deck of decks) {
      expect(
        VALID_ALIGNMENTS,
        `deck ${deck.id} has invalid alignment "${deck.alignment}"`,
      ).toContain(deck.alignment);
    }
  });
});
