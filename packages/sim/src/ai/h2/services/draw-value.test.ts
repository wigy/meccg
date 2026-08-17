/**
 * @module ai/h2/services/draw-value.test
 *
 * The service predicts a draw count the engine will later compute from a
 * `GameState` it does not have, so the tests are about agreement with the
 * engine's rules rather than about arithmetic:
 *
 * - which *side* a modifier is collected from (an `own-companies` modifier on
 *   the opponent's table must not reach our companies, and an `any-company` one
 *   must);
 * - whether a modifier's `when` is honoured, using the two real cards that
 *   carry one (A Short Rest's path-length gate, In the Heart of his Realm's
 *   dark-region-and-not-a-minion gate);
 * - the `min` floor, which is what stops Smaug at Home reducing a one-draw site
 *   to nothing;
 * - and that a company which is not moving draws nothing extra, because a
 *   draw-modifier pays on a draw and there is no draw.
 *
 * The effect lists are copied from the card data rather than invented, because
 * the point being tested is that this service reads what the DSL actually says.
 */

import { describe, expect, test } from 'vitest';
import { CardStatus, RegionType } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, CompanyId, PlayerView } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { computeDrawValue } from './draw-value.js';
import type { SiteExposure } from './exposure.js';

/** A two-region wilderness site drawing two cards — the ordinary case. */
const SITE = 'site-wilderness';
/** Radagast (tw-178): "+1 resource draw per Wilderness in the site path". */
const RADAGAST = 'ch-radagast';
/** An ordinary character with nothing to say about draws. */
const PLAIN = 'ch-plain';
/** A Short Rest (td-95): an extra card per region short of four. */
const SHORT_REST = 'ev-short-rest';
/** Smaug at Home (td-71): every moving company draws one less, floor of one. */
const SMAUG_AT_HOME = 'ev-smaug-at-home';
/** In the Heart of his Realm (dm-67): one less on a dark path, hero players only. */
const HEART_OF_REALM = 'ev-heart-of-realm';
/**
 * An item granting a flat extra draw. No printed item carries a draw-modifier;
 * this exists to hold the service level with the engine's collector, which
 * reads a character's items whether or not the pool currently uses that.
 */
const DRAWING_ITEM = 'it-drawing';

const POOL: Readonly<Record<string, CardDefinition>> = {
  [SITE]: {
    cardType: 'hero-site',
    name: 'Wilderness Ruin',
    siteType: 'ruins-and-lairs',
    sitePath: [RegionType.Wilderness, RegionType.Wilderness],
    resourceDraws: 2,
  },
  [RADAGAST]: {
    cardType: 'hero-character',
    name: 'Radagast',
    effects: [{ type: 'draw-modifier', draw: 'resource', value: 'sitePath.wildernessCount', min: 0 }],
  },
  [PLAIN]: { cardType: 'hero-character', name: 'Halbarad', effects: [] },
  [SHORT_REST]: {
    cardType: 'hero-resource-event',
    name: 'A Short Rest',
    eventType: 'long',
    effects: [{
      type: 'draw-modifier',
      draw: 'resource',
      value: '4 - sitePath.regionCount',
      min: 0,
      when: {
        $and: [
          { movementType: { $in: ['region', 'starter'] } },
          { 'sitePath.regionCount': { $gt: 0 } },
          { 'sitePath.regionCount': { $lt: 4 } },
        ],
      },
    }],
  },
  [SMAUG_AT_HOME]: {
    cardType: 'hazard-event',
    name: 'Smaug at Home',
    effects: [{ type: 'draw-modifier', draw: 'resource', value: -1, min: 1, appliesTo: 'any-company' }],
  },
  [HEART_OF_REALM]: {
    cardType: 'hazard-event',
    name: 'In the Heart of his Realm',
    effects: [{
      type: 'draw-modifier',
      draw: 'resource',
      value: -1,
      min: 0,
      appliesTo: 'any-company',
      when: { $and: [{ 'sitePath.darkCount': { $gte: 1 } }, { 'player.minion': false }] },
    }],
  },
  [DRAWING_ITEM]: {
    cardType: 'hero-item',
    name: 'Notional Draw-stone',
    effects: [{ type: 'draw-modifier', draw: 'resource', value: 1, min: 0 }],
  },
} as unknown as Readonly<Record<string, CardDefinition>>;

/**
 * A view with one company of two characters, headed somewhere.
 *
 * `moving` is what distinguishes the two questions the service answers: a
 * company with a `destinationSite` draws on arrival, and one without draws
 * nothing however many modifiers are on the table.
 */
function view(options: {
  readonly characters?: readonly string[];
  readonly ourTable?: readonly string[];
  readonly theirTable?: readonly string[];
  readonly moving?: boolean;
  readonly moved?: boolean;
  readonly alignment?: string;
} = {}): PlayerView {
  const definitionIds = options.characters ?? [PLAIN];
  const characters: Record<string, unknown> = {};
  definitionIds.forEach((definitionId, index) => {
    characters[`c-${index}`] = {
      instanceId: `c-${index}`,
      definitionId,
      status: CardStatus.Untapped,
      items: [],
      allies: [],
      hazards: [],
    };
  });
  return {
    self: {
      alignment: options.alignment ?? 'hero',
      characters,
      companies: [{
        id: 'co-1',
        characters: definitionIds.map((_, index) => `c-${index}`),
        currentSite: { instanceId: 'here', definitionId: SITE },
        destinationSite: (options.moving ?? true) ? { instanceId: 'there', definitionId: SITE } : null,
        moved: options.moved ?? false,
      }],
      cardsInPlay: (options.ourTable ?? []).map((definitionId, index) => ({
        instanceId: `ours-${index}`, definitionId,
      })),
      hand: [],
      playDeck: [],
      discardPile: [],
    },
    opponent: {
      cardsInPlay: (options.theirTable ?? []).map((definitionId, index) => ({
        instanceId: `theirs-${index}`, definitionId,
      })),
      hand: [],
      discardPile: [],
      companies: [],
      characters: {},
    },
    phaseState: { phase: 'long-event' },
    activeConstraints: [],
    turnNumber: 3,
  } as unknown as PlayerView;
}

/** The destination as `exposure` reads it: two wilderness regions, two draws. */
const DESTINATION: SiteExposure = {
  name: 'Wilderness Ruin',
  siteType: 'ruins-and-lairs',
  sitePath: [RegionType.Wilderness, RegionType.Wilderness],
  pathLength: 2,
  resourceDraws: 2,
} as unknown as SiteExposure;

/** A dark two-region path, for the one modifier that reads region *types*. */
const DARK_DESTINATION: SiteExposure = {
  name: 'Dark Ruin',
  siteType: 'dark-hold',
  sitePath: [RegionType.Dark, RegionType.Dark],
  pathLength: 2,
  resourceDraws: 2,
} as unknown as SiteExposure;

/** The effect list of a card in hand, as `extraFrom` is handed one. */
const effectsOf = (definitionId: string): readonly unknown[] =>
  (POOL[definitionId] as unknown as { effects: readonly unknown[] }).effects;

describe('the printed number, when nothing changes it', () => {
  test('is what the company draws', () => {
    const draws = computeDrawValue(view(), POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DESTINATION)).toBe(2);
  });

  test('and a company the view does not hold falls back to it rather than throwing', () => {
    const draws = computeDrawValue(view(), POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-missing' as CompanyId, DESTINATION)).toBe(2);
  });
});

describe('a modifier carried by the company', () => {
  test("Radagast adds one card per Wilderness in the path, so a two-Wilderness route draws four", () => {
    const draws = computeDrawValue(view({ characters: [PLAIN, RADAGAST] }), POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DESTINATION)).toBe(4);
  });

  test('and adds nothing on a path with no Wilderness at all', () => {
    const draws = computeDrawValue(view({ characters: [PLAIN, RADAGAST] }), POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DARK_DESTINATION)).toBe(2);
  });
});

describe('a modifier on the table', () => {
  test('A Short Rest adds a card for each region short of four', () => {
    const draws = computeDrawValue(view({ ourTable: [SHORT_REST] }), POOL, DEFAULT_TUNABLES);
    // Two regions crossed, so `4 - 2` extra on top of the printed two.
    expect(draws.drawsAt('co-1' as CompanyId, DESTINATION)).toBe(4);
  });

  test('and nothing at all on a path of four regions or more, which is its own gate', () => {
    const draws = computeDrawValue(view({ ourTable: [SHORT_REST] }), POOL, DEFAULT_TUNABLES);
    const longPath = {
      ...DESTINATION,
      sitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
      pathLength: 4,
    } as unknown as SiteExposure;
    expect(draws.drawsAt('co-1' as CompanyId, longPath)).toBe(2);
  });
});

describe('which side a modifier is read from', () => {
  test("an `any-company` modifier on the opponent's table reduces our draws", () => {
    const draws = computeDrawValue(view({ theirTable: [SMAUG_AT_HOME] }), POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DESTINATION)).toBe(1);
  });

  test('but its `min` floor holds, so a one-draw site still draws one', () => {
    const draws = computeDrawValue(view({ theirTable: [SMAUG_AT_HOME] }), POOL, DEFAULT_TUNABLES);
    const thin = { ...DESTINATION, resourceDraws: 1 } as unknown as SiteExposure;
    expect(draws.drawsAt('co-1' as CompanyId, thin)).toBe(1);
  });

  test("an own-companies modifier on the opponent's table never reaches us", () => {
    // A Short Rest defaults to `own-companies`. Theirs must not add to our
    // draws, which is the whole reason the engine has the `appliesTo` opt-in.
    const draws = computeDrawValue(view({ theirTable: [SHORT_REST] }), POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DESTINATION)).toBe(2);
  });
});

describe("a modifier's condition", () => {
  test('In the Heart of his Realm costs a hero player a card on a dark path', () => {
    const draws = computeDrawValue(view({ theirTable: [HEART_OF_REALM] }), POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DARK_DESTINATION)).toBe(1);
  });

  test('and costs nothing on a path with no dark region', () => {
    const draws = computeDrawValue(view({ theirTable: [HEART_OF_REALM] }), POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DESTINATION)).toBe(2);
  });

  test('and nothing to a minion player, whom the card exempts', () => {
    const context = view({ theirTable: [HEART_OF_REALM], alignment: 'minion' });
    const draws = computeDrawValue(context, POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DARK_DESTINATION)).toBe(2);
  });
});

describe('what playing a card would add', () => {
  test('A Short Rest is worth the cards it adds to the company that is moving', () => {
    const draws = computeDrawValue(view(), POOL, DEFAULT_TUNABLES);
    expect(draws.extraFrom(effectsOf(SHORT_REST))).toBe(2);
  });

  test('and nothing when no company is moving, because nothing will draw', () => {
    const draws = computeDrawValue(view({ moving: false }), POOL, DEFAULT_TUNABLES);
    expect(draws.movingCompanies()).toHaveLength(0);
    expect(draws.extraFrom(effectsOf(SHORT_REST))).toBe(0);
  });

  test('and nothing for a company that has already moved and already drawn', () => {
    const draws = computeDrawValue(view({ moved: true }), POOL, DEFAULT_TUNABLES);
    expect(draws.extraFrom(effectsOf(SHORT_REST))).toBe(0);
  });

  test('and nothing for a card that declares no draw-modifier at all', () => {
    const draws = computeDrawValue(view(), POOL, DEFAULT_TUNABLES);
    expect(draws.extraFrom(effectsOf(PLAIN))).toBe(0);
  });

  test('measured against the table as it stands, not against a bare site', () => {
    // With one A Short Rest already down the company draws four, and what a
    // second copy adds is measured from there. The number is the *difference*
    // rather than the modifier's own value, which is what will keep it honest
    // once a modifier meets a `min` floor another card has already reached.
    const draws = computeDrawValue(view({ ourTable: [SHORT_REST] }), POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DESTINATION)).toBe(4);
    expect(draws.drawsAt('co-1' as CompanyId, DESTINATION, effectsOf(SHORT_REST))).toBe(6);
    expect(draws.extraFrom(effectsOf(SHORT_REST))).toBe(2);
  });

  test('and floored where a reduction already in play has bottomed the count out', () => {
    // Smaug at Home holds the count at one. A card that would take another
    // away is worth nothing, and `extraFrom` says so because it subtracts two
    // counts rather than reading the modifier's value.
    const draws = computeDrawValue(view({ theirTable: [SMAUG_AT_HOME] }), POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DESTINATION)).toBe(1);
    expect(draws.extraFrom(effectsOf(SMAUG_AT_HOME))).toBe(0);
  });
});

describe('the price of a card', () => {
  test('is the tunable, so every consumer quotes the same number', () => {
    const draws = computeDrawValue(view(), POOL, DEFAULT_TUNABLES);
    expect(draws.perCard).toBe(DEFAULT_TUNABLES.resourceDrawValue);
  });

  test('and is never below what the worst card in hand is worth to keep', () => {
    // The invariant behind the shipped value rather than the value itself. A
    // draw hands over a card in hand, and `provisionalCardPrice` is what `hand`
    // charges itself to discard a card whose use it cannot model at all — so a
    // draw worth less than that says two cards are worth less than one. At 0.35
    // against 1.00 it did: cycling always lost to hoarding, A Short Rest adding
    // two cards lost to the one card it spent, and a two-draw site contributed
    // 0.35 to a route against the 12.0 of an item already in hand.
    expect(DEFAULT_TUNABLES.resourceDrawValue)
      .toBeGreaterThanOrEqual(DEFAULT_TUNABLES.provisionalCardPrice);
  });
});

describe('the characters a company is carrying', () => {
  test('contribute through their items too, as the engine collector does', () => {
    // No printed item carries a draw-modifier today; the engine's
    // `collectCharacterEffects` reads items regardless, and the parity is worth
    // holding so the day one is printed this service does not have to be found
    // and fixed a second time.
    const withItem = view({ characters: [PLAIN] });
    (withItem.self.characters['c-0' as CardInstanceId] as unknown as {
      items: unknown[];
    }).items = [{ instanceId: 'i-1', definitionId: DRAWING_ITEM }];
    const draws = computeDrawValue(withItem, POOL, DEFAULT_TUNABLES);
    expect(draws.drawsAt('co-1' as CompanyId, DESTINATION)).toBe(3);
  });
});
