/**
 * @module deck-import.test
 *
 * Regression test: the GCCG importer must file play-deck cards by the file's
 * category comments, falling back to the resolved card type only when no
 * category precedes the line.
 *
 * Agents such as My Precious (dm-29) are `minion-character`-typed cards that
 * a deck legitimately runs in its hazard section — GCCG exports them under a
 * `# Hazard (n)` category. The importer used to OR the category and card-type
 * checks, so the character card type overrode the explicit hazard category
 * and the agent landed in the character section.
 */

import './test-dom-bootstrap.js'; // app-state reads `window.__meccg` at module load
import { describe, test, expect } from 'vitest';
import { parseGccgDeck } from './deck-import.js';

const names = (entries: { name: string }[]) => entries.map(e => e.name);

describe('GCCG deck import section split', () => {
  test('a character-typed agent under a hazard category imports as a hazard', () => {
    const text = [
      '####',
      'Deck',
      '####',
      '# Hero Character (1)',
      '1 Gandalf',
      '# Hazard (3)',
      '2 My Precious (DM)',
      '1 Cave-drake',
      '# Hero Resource (1)',
      '1 And Forth He Hastened',
    ].join('\n');

    const parsed = parseGccgDeck(text, 'fallback');
    expect(parsed.unmatched).toEqual([]);
    expect(names(parsed.deck.characters)).toEqual(['Gandalf']);
    expect(names(parsed.deck.hazards)).toEqual(['My Precious', 'Cave-drake']);
    expect(names(parsed.deck.resources)).toEqual(['And Forth He Hastened']);
    expect(parsed.deck.hazards[0]).toMatchObject({ card: 'dm-29', qty: 2 });
  });

  test('without a category the resolved card type decides the section', () => {
    const text = [
      '####',
      'Deck',
      '####',
      '1 Gandalf',
      '1 Cave-drake',
      '1 And Forth He Hastened',
    ].join('\n');

    const parsed = parseGccgDeck(text, 'fallback');
    expect(names(parsed.deck.characters)).toEqual(['Gandalf']);
    expect(names(parsed.deck.hazards)).toEqual(['Cave-drake']);
    expect(names(parsed.deck.resources)).toEqual(['And Forth He Hastened']);
  });
});
