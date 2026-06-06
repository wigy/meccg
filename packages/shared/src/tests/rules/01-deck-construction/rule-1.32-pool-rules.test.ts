/**
 * @module rule-1.32-pool-rules
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.32: Pool Rules
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A pool is a set of up to 10 non-avatar characters that adhere to any deck restrictions when considered in conjunction with the play deck and the sideboard other than total number of characters (i.e. a player may have up to 10 characters in their pool even if they already have up to 10 non-avatar characters in their play deck). A pool may also contain up to two non-unique, non-hoard minor items that adhere to any deck restrictions when considered in conjunction with the play deck and the sideboard.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard, isAvatarCharacter, isItemCard } from '../../../index.js';

describe('Rule 1.32 — Pool Rules', () => {
  test('Pool contains only non-avatar characters (up to 10) and non-unique non-hoard minor items (up to 2)', () => {
    const decks = loadAllDecks();

    for (const deck of decks) {
      let nonAvatarCharCount = 0;
      let minorItemCount = 0;

      for (const entry of deck.pool) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        const qty = entry.qty;

        if (isCharacterCard(def) && !isAvatarCharacter(def)) {
          nonAvatarCharCount += qty;
        } else if (isItemCard(def) && def.subtype === 'minor' && !def.unique && !(def.keywords?.includes('hoard'))) {
          minorItemCount += qty;
        } else {
          expect.fail(
            `deck ${deck.id}: pool entry "${entry.card}" (${def?.cardType ?? 'unknown'}) is neither a non-avatar character nor a non-unique non-hoard minor item`,
          );
        }
      }

      expect(
        nonAvatarCharCount,
        `deck ${deck.id}: pool has ${nonAvatarCharCount} non-avatar characters (max 10)`,
      ).toBeLessThanOrEqual(10);

      expect(
        minorItemCount,
        `deck ${deck.id}: pool has ${minorItemCount} non-unique non-hoard minor items (max 2)`,
      ).toBeLessThanOrEqual(2);
    }
  });
});
