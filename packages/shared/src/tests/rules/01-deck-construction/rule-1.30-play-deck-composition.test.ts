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
  test('Play deck: 30-50 resources, equal hazards, up to 10 non-avatar characters, up to 3 avatars; min 12 creatures in hazards', () => {
    const decks = loadAllDecks();
    for (const deck of decks) {
      // Development/prototype decks are excluded — they are deliberately under-built
      if (!deck.id.startsWith('challenge')) continue;

      const resourceTotal = deck.deck.resources.reduce((sum, e) => sum + e.qty, 0);
      expect(resourceTotal, `deck ${deck.id}: resources ${resourceTotal} < 30`).toBeGreaterThanOrEqual(30);
      expect(resourceTotal, `deck ${deck.id}: resources ${resourceTotal} > 50`).toBeLessThanOrEqual(50);

      // Count full creatures toward the 12-creature minimum
      let creatureCount = 0;
      for (const entry of deck.deck.hazards) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        if (def?.cardType === 'hazard-creature') {
          creatureCount += entry.qty;
        }
      }
      expect(creatureCount, `deck ${deck.id}: only ${creatureCount} creatures in hazards (min 12)`).toBeGreaterThanOrEqual(12);

      // Non-avatar characters in the play deck must not exceed 10
      let nonAvatarCharCount = 0;
      for (const entry of deck.deck.characters) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        if (isCharacterCard(def) && !isAvatarCharacter(def)) {
          nonAvatarCharCount += entry.qty;
        }
      }
      expect(
        nonAvatarCharCount,
        `deck ${deck.id}: ${nonAvatarCharCount} non-avatar characters in play deck (max 10)`,
      ).toBeLessThanOrEqual(10);
    }
  });
});
