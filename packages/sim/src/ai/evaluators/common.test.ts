import { describe, test, expect } from 'vitest';
import type { CardDefinition } from '@meccg/shared';
import { Alignment, loadCardPool } from '@meccg/shared';
import { resourcePlayableAt, siteDangerFor } from './common.js';
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

  // Real definitions: the gates below are exactly the ones the engine applies,
  // and the AI must not price a card at a site the engine will refuse
  // (game msygr2v0-z5h2i8: the travel module sent a company to Zarak Dûm for
  // plays that did not exist there).
  describe('playableAt `when` gates (allies)', () => {
    const pool = loadCardPool();
    const warWolf = pool['le-157']; // Ruins & Lairs with a Wolf attack, or Shadow-hold with an Orc attack
    const zarakDum = pool['le-417'] as AnySiteCard; // Ruins & Lairs, Dragon automatic-attack
    const weathertop = pool['as-169'] as AnySiteCard; // Ruins & Lairs, Wolves automatic-attack

    test('War-wolf is not playable at a Ruins & Lairs with a Dragon attack', () => {
      expect(resourcePlayableAt(warWolf, zarakDum)).toBe(false);
    });

    test('War-wolf is playable at a Ruins & Lairs with a Wolf attack', () => {
      expect(resourcePlayableAt(warWolf, weathertop)).toBe(true);
    });

    test('a ringwraith ally at a ringwraith site passes the MEWH §10 gate for a fallen-wizard', () => {
      expect(resourcePlayableAt(warWolf, weathertop, 'fallen-wizard')).toBe(true);
    });
  });

  describe('MEWH §10 cross-alignment site-tap (fallen-wizard)', () => {
    const pool = loadCardPool();
    const durinsAxe = pool['tw-212']; // hero (wizard) major item
    const zarakDum = pool['le-417'] as AnySiteCard; // ringwraith site, minor/major playable
    const himring = pool['tw-401'] as AnySiteCard; // hero (wizard) site, minor/major playable

    test('a hero item is barred at a ringwraith site for a fallen-wizard', () => {
      expect(resourcePlayableAt(durinsAxe, zarakDum, 'fallen-wizard')).toBe(false);
    });

    test('a hero item stays playable at a hero site for a fallen-wizard', () => {
      expect(resourcePlayableAt(durinsAxe, himring, 'fallen-wizard')).toBe(true);
    });

    test('without a player alignment the printed playable line alone decides', () => {
      expect(resourcePlayableAt(durinsAxe, zarakDum)).toBe(true);
    });
  });
});

describe('siteDangerFor', () => {
  const attacksNormally = (site: AnySiteCard): AnySiteCard =>
    ({ ...site, effects: [{ type: 'site-rule', rule: 'attacks-not-detainment', filter: { 'enemy.race': { $ne: 'ringwraith' } } }] }) as unknown as AnySiteCard;

  test('a haven is the only site a hero company pays nothing for', () => {
    expect(siteDangerFor(mockSite('haven'), Alignment.Wizard)).toBe(0);
    expect(siteDangerFor(mockSite('free-hold'), Alignment.Wizard)).toBe(1);
    expect(siteDangerFor(mockSite('border-hold'), Alignment.Wizard)).toBe(1);
    expect(siteDangerFor(mockSite('ruins-and-lairs'), Alignment.Wizard)).toBe(3);
    expect(siteDangerFor(mockSite('shadow-hold'), Alignment.Wizard)).toBe(5);
    expect(siteDangerFor(mockSite('dark-hold'), Alignment.Wizard)).toBe(7);
  });

  // An automatic-attack at a Shadow-hold or Dark-hold is detainment against a
  // minion company (CoE §3.II.2.R1/B1): it taps, never wounds.
  test.each([Alignment.Ringwraith, Alignment.Balrog])('%s: shadow-holds and dark-holds hold no danger', alignment => {
    expect(siteDangerFor(mockSite('shadow-hold'), alignment)).toBe(0);
    expect(siteDangerFor(mockSite('dark-hold'), alignment)).toBe(0);
    expect(siteDangerFor(mockSite('free-hold'), alignment)).toBe(1);
    expect(siteDangerFor(mockSite('ruins-and-lairs'), alignment)).toBe(3);
  });

  test('a site whose text makes its attacks normal charges a minion the hero weight (Moria)', () => {
    expect(siteDangerFor(attacksNormally(mockSite('shadow-hold', 'Moria')), Alignment.Ringwraith)).toBe(5);
    expect(siteDangerFor(attacksNormally(mockSite('dark-hold')), Alignment.Balrog)).toBe(7);
  });

  test('a fallen-wizard company is a hero company for detainment', () => {
    expect(siteDangerFor(mockSite('dark-hold'), Alignment.FallenWizard)).toBe(7);
  });

  test('an unknown site type counts 2 for anyone', () => {
    expect(siteDangerFor(mockSite('somewhere-new'), Alignment.Ringwraith)).toBe(2);
    expect(siteDangerFor(mockSite('somewhere-new'), undefined)).toBe(2);
  });
});
