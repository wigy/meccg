/**
 * @module challenge-deck-f-minas-morgul
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 *
 * Regression guard for a bug report ("Spies and traitors"): the
 * "(F) Spies and Traitors" challenge deck's location deck had no
 * Minas Morgul, leaving Adûnaphel's minions with only one Darkhaven
 * (Dol Guldur). Every other Ringwraith challenge deck starting at
 * Dol Guldur also carries Minas Morgul, and nothing else (deck
 * validation allows any site mix) catches its omission.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect } from 'vitest';
import type { DeckList } from '../../../index.js';

const DECK_PATH = path.join(__dirname, '../../../../../../data/decks/challenge-deck-f.json');

describe('Challenge deck (F) Spies and Traitors — location deck', () => {
  test('includes Minas Morgul (le-390)', () => {
    const deck = JSON.parse(fs.readFileSync(DECK_PATH, 'utf-8')) as DeckList;
    const morgul = deck.sites.find(s => s.card === 'le-390');

    expect(morgul?.qty).toBe(1);
  });
});
