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
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12, HAZARD_DECK_30 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

const validDeck: DeckList = {
  id: 'test-deck-composition',
  name: 'Deck Composition Test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 }],
    hazards: [...HAZARD_DECK_30],
    resources: [...HERO_RESOURCES_30],
  },
};

describe('Rule 1.30 — Play Deck Composition', () => {
  test('Valid deck (30 resources, 30 hazards, 0 non-avatar characters) has no composition error', () => {
    expect(validateDeck(validDeck, pool).filter(e => ['resources', 'hazards', 'characters'].includes(e.section))).toHaveLength(0);
  });

  test('Hazards fewer than resources (30 resources, 29 hazards) produces a hazards error', () => {
    // Drop one hazard so the deck has 30 resources but only 29 hazards.
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        hazards: [...HAZARD_CREATURES_12,
          { name: 'Orc-lieutenant', card: 'tw-073' as CardDefinitionId, qty: 3 },
          { name: 'Orc-warband', card: 'tw-076' as CardDefinitionId, qty: 3 },
          { name: 'Orc-watch', card: 'tw-078' as CardDefinitionId, qty: 3 },
          { name: 'Doors of Night', card: 'tw-28' as CardDefinitionId, qty: 3 },
          { name: 'Twilight', card: 'tw-106' as CardDefinitionId, qty: 3 },
          { name: 'Choking Shadows', card: 'tw-21' as CardDefinitionId, qty: 2 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'hazards' && e.message.includes('must equal'))).toBe(true);
  });

  test('Hazards more than resources (30 resources, 31 hazards) produces a hazards error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        hazards: [...HAZARD_DECK_30, { name: 'Wargs', card: 'tw-109' as CardDefinitionId, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'hazards' && e.message.includes('must equal'))).toBe(true);
  });

  test('Fewer than 30 resources produces a resources error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: { ...validDeck.deck, resources: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 29 }] },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'resources' && e.message.includes('min 30'))).toBe(true);
  });

  test('More than 50 resources produces a resources error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: { ...validDeck.deck, resources: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 51 }] },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'resources' && e.message.includes('max 50'))).toBe(true);
  });

  test('Fewer than 12 creatures in hazards produces a hazards error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: { ...validDeck.deck, hazards: [{ name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 11 }] },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'hazards' && e.message.includes('min 12'))).toBe(true);
  });

  // Rule 1.5.1 / CRF 22: agents that count as hazards, dual creature/event
  // hazards, Dragon "Ahunt"/"At Home" manifestations, and Spawn permanent-events
  // each count as HALF a creature toward the 12-creature minimum (rounded down).
  // Regression for the "Pallando vs H" report: the counter previously scored
  // dual creatures as full creatures and ignored agents and Dragon
  // manifestations entirely, so a deck with 11 full creatures + several half
  // creatures was miscounted as valid.

  // 11 ordinary (full) hazard creatures — one short of the 12 minimum on their
  // own, so any half-creature category can be exercised on top of them.
  const ELEVEN_FULL_CREATURES = [
    { name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 3 },
    { name: 'Orc-patrol', card: 'tw-074' as CardDefinitionId, qty: 3 },
    { name: 'Barrow-wight', card: 'tw-015' as CardDefinitionId, qty: 3 },
    { name: 'Orc-guard', card: 'tw-072' as CardDefinitionId, qty: 2 },
  ];

  test('A creature also playable as an event counts as half a creature (rule 1.5.1)', () => {
    // 11 full creatures + Mouth of Sauron (dual creature/event) = 11.5 → 11 < 12.
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        hazards: [...ELEVEN_FULL_CREATURES, { name: 'Mouth of Sauron', card: 'tw-65' as CardDefinitionId, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'hazards' && e.message.includes('min 12'))).toBe(true);
  });

  test('Two agents in the hazard section count as one creature for a hero deck (rule 1.5.1)', () => {
    // 11 full creatures + 2 agents × ½ = 12 → no creature error.
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        hazards: [
          ...ELEVEN_FULL_CREATURES,
          { name: 'Bill Ferny', card: 'dm-3' as CardDefinitionId, qty: 1 },
          { name: 'Deallus', card: 'dm-5' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'hazards' && e.message.includes('min 12'))).toBe(false);
  });

  test('Manifestation agents modelled as hazard events count as half a creature each (rule 1.5.1)', () => {
    // My Precious (dm-29) and Lobelia (dm-28) are agents modelled as hazard
    // events, not character cards. They were previously scored 0 (the agent
    // branch only matched character cards), so a deck relying on them fell
    // short. 11 full creatures + 2 manifestation agents × ½ = 12 → no error.
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        hazards: [
          ...ELEVEN_FULL_CREATURES,
          { name: 'My Precious', card: 'dm-29' as CardDefinitionId, qty: 1 },
          { name: 'Lobelia Sackville-Baggins', card: 'dm-28' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'hazards' && e.message.includes('min 12'))).toBe(false);
  });

  test('Dragon "Ahunt"/"At Home" manifestations count as half a creature each (rule 1.5.1)', () => {
    // 11 full creatures + Itangast Ahunt + Daelomin at Home = 11 + 2×½ = 12.
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        hazards: [
          ...ELEVEN_FULL_CREATURES,
          { name: 'Itangast Ahunt', card: 'td-37' as CardDefinitionId, qty: 1 },
          { name: 'Daelomin at Home', card: 'td-11' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'hazards' && e.message.includes('min 12'))).toBe(false);
  });

  test('More than 10 non-avatar characters produces a characters error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        characters: [
          { name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 },
          { name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 11 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'characters' && e.message.includes('max 10'))).toBe(true);
  });
});
