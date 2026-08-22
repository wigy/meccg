/**
 * @module challenge-decks-valid
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 *
 * Data-integrity guard: every deck shipped in `data/decks/` must be a legal
 * deck under the same {@link validateDeck} rules a player deck is held to.
 * These are the curated challenge decks the lobby offers and the sim trains
 * on, so an illegal one is a real defect — it cannot be started, and a
 * card-data change that alters what validates (a uniqueness flag, a banned
 * list, a site type) could silently break one with nothing else catching it.
 *
 * One case per deck file so a failure names the offending deck and lists its
 * specific rule violations, rather than collapsing all decks into one opaque
 * assertion.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect } from 'vitest';
import { validateDeck, loadCardPool } from '../../../index.js';
import type { DeckList } from '../../../index.js';

const DECKS_DIR = path.join(__dirname, '../../../../../../data/decks');

function deckFiles(): string[] {
  return fs.readdirSync(DECKS_DIR).filter(f => f.endsWith('.json')).sort();
}

const pool = loadCardPool();
const files = deckFiles();

describe('Shipped challenge decks are legal', () => {
  test('there is at least one deck to check (the directory resolved)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)('%s validates with no errors', (file) => {
    const deck = JSON.parse(fs.readFileSync(path.join(DECKS_DIR, file), 'utf-8')) as DeckList;
    const errors = validateDeck(deck, pool);
    // Surface the actual rule messages on failure, not just a count.
    expect(errors.map(e => `[${e.section}] ${e.message}`)).toEqual([]);
  });
});
