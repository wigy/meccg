/**
 * @module deck-editor-starting-items.test
 *
 * Regression test for bug report ceb18417ad0bc077: "Athelas is not included
 * in the pool of items that a starting hero company can include."
 *
 * The pool card browser's "Starting items" toggle matched only cards
 * carrying the `starting-item` keyword. That keyword marks non-item cards
 * (Stage resources, resource-events) that may be placed with a starting
 * company in lieu of a minor item — it is not printed on every ordinary
 * minor item. Per CoE 1.7, any non-unique, non-hoard minor item qualifies as
 * a starting item regardless of that keyword, so items like Athelas (tw-195),
 * Elven Cloak, Healing Herbs, Miruvor, and Potion of Prowess never appeared
 * in the browser even though the server accepted them.
 */

import './test-dom-bootstrap.js'; // app-state reads `window.__meccg` at module load
import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardDefinitionId } from '@meccg/shared';
import { typeToggles } from './deck-editor.js';

const pool = loadCardPool();

const startingItemsMatch = (defId: CardDefinitionId): boolean => {
  const toggle = typeToggles('pool').find(t => t.title === 'Starting items');
  if (!toggle) throw new Error('Starting items toggle not found');
  const def = pool[defId as string];
  if (!def) throw new Error(`Unknown card ${defId as string}`);
  return toggle.match(def);
};

describe('deck editor pool browser — Starting items toggle', () => {
  test('matches a non-unique, non-hoard minor item without the starting-item keyword (Athelas, tw-195)', () => {
    expect(startingItemsMatch('tw-195' as CardDefinitionId)).toBe(true);
  });

  test('still matches minor items explicitly tagged starting-item (Dagger of Westernesse, tw-206)', () => {
    expect(startingItemsMatch('tw-206' as CardDefinitionId)).toBe(true);
  });
});
