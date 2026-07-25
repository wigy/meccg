/**
 * @module deck-import.test
 *
 * Tests for the deck importers: the native `.meccg-json` detector must
 * accept only JSON carrying our deck fields (anything else falls back to
 * the GCCG parser), and a regression: the GCCG importer must file play-deck cards by the file's
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
import { parseGccgDeck, parseMeccgJsonDeck } from './deck-import.js';

const names = (entries: { name: string }[]) => entries.map(e => e.name);

describe('meccg-json deck import', () => {
  const deck = {
    id: 'someone-elses-id',
    name: 'Riders of Rohan',
    alignment: 'hero',
    notes: 'Race to the Gap of Isen.',
    pool: [{ name: 'Gandalf', card: 'tw-1', qty: 1 }],
    deck: {
      characters: [{ name: 'Éowyn', card: 'tw-2', qty: 1 }],
      hazards: [{ name: 'Cave-drake', card: 'tw-3', qty: 2 }],
      resources: [{ name: 'And Forth He Hastened', card: 'tw-4', qty: 3 }],
    },
    sites: [{ name: 'Edhellond', card: 'tw-5', qty: 1 }],
    sideboard: [],
  };

  test('valid JSON with our deck fields is taken as it is', () => {
    const parsed = parseMeccgJsonDeck(JSON.stringify(deck));
    expect(parsed).toEqual(deck);
  });

  test('text that is not JSON is rejected', () => {
    expect(parseMeccgJsonDeck('####\nDeck\n####\n1 Gandalf')).toBeNull();
  });

  test('JSON without our deck fields is rejected', () => {
    expect(parseMeccgJsonDeck('{"name": "x"}')).toBeNull();
    expect(parseMeccgJsonDeck('[1, 2, 3]')).toBeNull();
    const noSections = { ...deck, deck: { characters: [], hazards: [] } };
    expect(parseMeccgJsonDeck(JSON.stringify(noSections))).toBeNull();
  });
});

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
