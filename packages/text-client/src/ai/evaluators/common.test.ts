import { describe, test, expect } from 'vitest';
import type { CardDefinition } from '@meccg/shared';
import { resourcePlayableAt } from './common.js';
import type { AnySiteCard } from './common.js';

// Minimal mock for a site card used in scoring tests.
function mockSite(siteType: string, name = 'Test Site'): AnySiteCard {
  return {
    siteType,
    name,
    playableResources: [],
    sitePath: [],
  } as unknown as AnySiteCard;
}

// Minimal mock for a resource event card with play-target: site.
function mockSiteTargetEvent(filter: Record<string, unknown>): CardDefinition {
  return {
    cardType: 'hero-resource-event',
    effects: [
      { type: 'play-target', target: 'site', filter },
    ],
  } as unknown as CardDefinition;
}

// Minimal mock for a resource event card without site targeting.
function mockUntargetedEvent(): CardDefinition {
  return {
    cardType: 'hero-resource-event',
    effects: [],
  } as unknown as CardDefinition;
}

describe('resourcePlayableAt', () => {
  describe('hero-resource-event with play-target: site', () => {
    const windlordFilter = {
      $or: [
        { siteType: { $in: ['dark-hold', 'shadow-hold'] } },
        { name: 'Isengard' },
      ],
    };
    const card = mockSiteTargetEvent(windlordFilter);

    test('returns true for a matching dark-hold site', () => {
      expect(resourcePlayableAt(card, mockSite('dark-hold', 'Carn Dûm'))).toBe(true);
    });

    test('returns true for a matching shadow-hold site', () => {
      expect(resourcePlayableAt(card, mockSite('shadow-hold', 'Moria'))).toBe(true);
    });

    test('returns true for the named Isengard site', () => {
      expect(resourcePlayableAt(card, mockSite('ruins-and-lairs', 'Isengard'))).toBe(true);
    });

    test('returns false for a haven (non-matching site type)', () => {
      expect(resourcePlayableAt(card, mockSite('haven', 'Rivendell'))).toBe(false);
    });

    test('returns false for a border-hold', () => {
      expect(resourcePlayableAt(card, mockSite('border-hold', 'Bree'))).toBe(false);
    });
  });

  test('returns false for a resource event without play-target: site', () => {
    const card = mockUntargetedEvent();
    expect(resourcePlayableAt(card, mockSite('dark-hold', 'Carn Dûm'))).toBe(false);
  });
});
