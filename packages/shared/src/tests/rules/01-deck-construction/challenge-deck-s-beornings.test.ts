/**
 * @module challenge-deck-s-beornings
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 *
 * Regression guard for a bug report (game mt8zow46-h1qg5c, turn 6, site
 * phase): the "(S) Await the Onset" challenge deck's "Beornings" resource
 * entry pointed at le-261, the Minion "manifestation of hero Beornings"
 * mirror card (playable only above influence 9, no marshalling-point
 * effect of its own) instead of tw-197, the Hero faction card (playable
 * above influence 7) the deck's own notes describe playing for marshalling
 * points. Every other faction resource in this deck (The Great Eagles,
 * and the sideboard factions) is the Hero version — Beornings was the sole
 * outlier, and the fallen-wizard resource rules (1.10-1.13) permit either
 * type, so nothing else catches a swap like this.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect } from 'vitest';
import type { DeckList } from '../../../index.js';

const DECK_PATH = path.join(__dirname, '../../../../../../data/decks/challenge-deck-s.json');

describe('Challenge deck (S) Await the Onset — Beornings resource', () => {
  test('references the Hero faction card (tw-197), not the Minion mirror (le-261)', () => {
    const deck = JSON.parse(fs.readFileSync(DECK_PATH, 'utf-8')) as DeckList;
    const beornings = deck.deck.resources.find(r => r.name === 'Beornings');

    expect(beornings?.card).toBe('tw-197');
  });
});
