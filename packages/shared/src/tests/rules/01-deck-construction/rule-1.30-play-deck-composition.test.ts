/**
 * @module rule-1.30-play-deck-composition
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.30: Play Deck Composition
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A play deck may include between 30-50 resources, a number of hazards equal to the number of resources, up to 10 non-avatar characters, and up to three avatars with any combination allowed except for three different avatars.
 * The hazard portion of a play deck must include at least 12 creatures. The following hazards count as half of a creature (rounded down) for the purpose of meeting this 12-creature requirement:
 * • An agent that counts as a hazard
 * • An "Ahunt" or "At Home" Dragon manifestation
 * • A creature that is also playable as an event
 * • A Spawn permanent-event
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard, isAvatarCharacter } from '../../../index.js';

describe('Rule 1.30 — Play Deck Composition', () => {
  // Note: resource/hazard count balance (30-50 resources, equal hazards) and
  // the 12-creature minimum are not validated here — only the character limits.
  test('Play deck character section: ≤10 non-avatar characters; ≤3 avatars; not 3 different avatar types', () => {
    const decks = loadAllDecks();

    for (const deck of decks) {
      let nonAvatarCount = 0;
      let totalAvatarCount = 0;
      const avatarNames = new Set<string>();

      for (const entry of deck.deck.characters) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        const qty = entry.qty;

        if (isCharacterCard(def) && isAvatarCharacter(def)) {
          totalAvatarCount += qty;
          avatarNames.add(def.name);
        } else if (isCharacterCard(def)) {
          nonAvatarCount += qty;
        }
      }

      expect(
        nonAvatarCount,
        `deck ${deck.id}: ${nonAvatarCount} non-avatar characters in deck (max 10)`,
      ).toBeLessThanOrEqual(10);

      expect(
        totalAvatarCount,
        `deck ${deck.id}: ${totalAvatarCount} avatar copies in deck (max 3)`,
      ).toBeLessThanOrEqual(3);

      expect(
        avatarNames.size,
        `deck ${deck.id}: deck has 3 different avatar types — ${[...avatarNames].join(', ')} (max 2 different)`,
      ).toBeLessThanOrEqual(2);
    }
  });
});
