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
import { isAvatarCharacter, isCharacterCard } from '../../../index.js';

describe('Rule 1.30 — Play Deck Composition', () => {
  test('Play deck may include up to 3 avatars, but not three different avatars', () => {
    const decks = loadAllDecks();
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      const avatarEntries = deck.deck.characters.filter(e => {
        if (!e.card) return false;
        const def = pool[e.card];
        return isCharacterCard(def) && isAvatarCharacter(def);
      });
      const totalAvatars = avatarEntries.reduce((sum, e) => sum + (e.qty ?? 1), 0);
      const distinctAvatarIds = new Set(avatarEntries.map(e => e.card));
      expect(totalAvatars, `deck ${deck.id}: has ${totalAvatars} avatar cards (max 3)`).toBeLessThanOrEqual(3);
      if (totalAvatars >= 3) {
        expect(
          distinctAvatarIds.size,
          `deck ${deck.id}: has 3+ avatars but ${distinctAvatarIds.size} distinct avatar cards (max 2 different allowed)`,
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  test('Hazard portion must include at least 12 creatures (challenge decks)', () => {
    const decks = loadAllDecks().filter(d => d.id.startsWith('challenge-deck'));
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      const creatureCount = deck.deck.hazards
        .filter(e => e.card && pool[e.card]?.cardType === 'hazard-creature')
        .reduce((sum, e) => sum + (e.qty ?? 1), 0);
      expect(creatureCount, `deck ${deck.id}: only ${creatureCount} creatures in hazards (need at least 12)`).toBeGreaterThanOrEqual(12);
    }
  });

  test.todo('30-50 resources, equal number of hazards, up to 10 non-avatar characters');
});
