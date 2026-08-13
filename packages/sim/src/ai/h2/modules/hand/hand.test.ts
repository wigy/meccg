/**
 * @module ai/h2/modules/hand/hand.test
 *
 * The module's job is to price what leaves and enters the hand. So the tests
 * check that reaching into a sideboard is charged for what it actually costs —
 * the avatar's tap on one side, half the hazard limit on the other — and, the
 * property that matters most because its absence is what the horizon test
 * caught, that two different cards get two different prices.
 */

import { describe, test, expect } from 'vitest';
import type { GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { collectTunables } from '../../core/rationale.js';
import { computeStanding } from '../../services/standing.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { handModule } from './hand.js';

/** The avatar-tap access of CoE 2.II.6, in both destinations. */
const TO_DECK = {
  type: 'start-sideboard-to-deck', characterInstanceId: 'avatar',
} as unknown as GameAction;
const TO_DISCARD = {
  type: 'start-sideboard-to-discard', characterInstanceId: 'avatar',
} as unknown as GameAction;
/** The hazard player's untap access of CoE 2.I, which taps nobody. */
const HAZARD_TO_DECK = { type: 'start-hazard-sideboard-to-deck' } as unknown as GameAction;

/** Three cards that a real price has to separate, for the discard tests. */
const HAND = [
  { instanceId: 'c-faction', definitionId: 'faction' },
  { instanceId: 'c-capped', definitionId: 'capped' },
  { instanceId: 'c-blank', definitionId: 'blank' },
];

/**
 * A pool spanning the three cases: points in a source with room, points in a
 * source already at the diversity cap, and no points at all.
 */
const POOL = {
  faction: {
    cardType: 'hero-resource-faction', name: 'Faction', marshallingPoints: 2, marshallingCategory: 'faction',
  },
  capped: {
    cardType: 'hero-resource-item', name: 'Capped Item', marshallingPoints: 4, marshallingCategory: 'item',
  },
  blank: { cardType: 'hero-resource-item', name: 'Blank', marshallingPoints: 0 },
  creature: {
    cardType: 'hazard-creature', name: 'Orc-warband', strikes: 2, prowess: 8, body: 9,
    killMarshallingPoints: 1,
  },
} as unknown as ModuleContext['cardPool'];

/** The avatar the resource-side access taps, untapped and holding no followers. */
const AVATAR = {
  instanceId: 'avatar',
  definitionId: 'blank',
  status: 'untapped',
  effectiveStats: { prowess: 5, body: 8, mind: 4, corruptionPoints: 0, directInfluence: 0 },
  items: [],
  allies: [],
  followers: [],
  hazards: [],
};

/** A context with a deck and a sideboard built from the named definitions. */
function contextWith(deck: number, sideboard: number, sideboardOf = 'faction'): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3 }),
      hand: HAND,
      playDeck: new Array(deck).fill({ instanceId: 'x', definitionId: 'unknown' }),
      sideboard: new Array(sideboard).fill(0)
        .map((_, i) => ({ instanceId: `y${i}`, definitionId: sideboardOf })),
      characters: { avatar: AVATAR },
      companies: [{ id: 'company-p1-0', characters: ['avatar'] }],
      cardsInPlay: [],
      generalInfluence: 20,
      generalInfluenceUsed: 0,
    },
    opponent: {
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3 }),
      characters: {},
      cardsInPlay: [],
      companies: [],
      hand: [],
      discardPile: [],
      killPile: [],
      outOfPlayPile: [],
    },
    turnNumber: 20,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [TO_DECK, TO_DISCARD],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

describe('reaching into the sideboard', () => {
  test('charges the avatar tap the action names, rather than nothing at all', () => {
    // It used to score zero on the grounds that no marshalling point moves.
    // True, and beside the point: CoE 2.II.6 taps the avatar, and that tap is
    // the whole cost of the access.
    const evaluation = handModule.evaluate(TO_DECK, contextWith(40, 12))!;
    const text = JSON.stringify(evaluation.rationale);
    expect(text).toContain('taps the avatar');
    expect(text).toContain('flat tempo');
  });

  test('a sideboard of better cards is worth more to reach into', () => {
    const worthless = handModule.evaluate(TO_DECK, contextWith(40, 12, 'blank'))!;
    const valuable = handModule.evaluate(TO_DECK, contextWith(40, 12, 'faction'))!;
    expect(valuable.expectedTsd).toBeGreaterThan(worthless.expectedTsd);
  });

  test('a card landing in the discard is worth less than one landing in the deck', () => {
    // The discount is the distance from playable: the deck has to be drawn from,
    // the discard has to become the deck first.
    const toDeck = handModule.evaluate(TO_DECK, contextWith(40, 12))!;
    const toDiscard = handModule.evaluate(TO_DISCARD, contextWith(40, 12))!;
    expect(toDiscard.expectedTsd).toBeLessThan(toDeck.expectedTsd);
    expect(toDeck.outcomes[0].label).toContain('play deck');
    expect(toDiscard.outcomes[0].label).toContain('discard pile');
  });

  test('each seat reaches only its own half of the sideboard', () => {
    // The untap access fetches hazards, the avatar tap fetches resources and
    // characters. A sideboard of creatures is worth nothing to the resource
    // player, and one of factions nothing to the hazard player.
    const creatures = contextWith(40, 12, 'creature');
    const resources = contextWith(40, 12, 'faction');
    expect(JSON.stringify(handModule.evaluate(TO_DECK, creatures)!.rationale))
      .toContain('nothing this variant may take');
    expect(JSON.stringify(handModule.evaluate(HAZARD_TO_DECK, resources)!.rationale))
      .toContain('nothing this variant may take');
  });

  test('the hazard seat is charged in hazard limit, not in taps', () => {
    // It taps nobody — the price is that `snapshotHazardLimit` halves the
    // coming limit for every company.
    const text = JSON.stringify(handModule.evaluate(HAZARD_TO_DECK, contextWith(40, 12, 'creature'))!.rationale);
    expect(text).toContain('hazard limit');
    expect(text).not.toContain('taps the avatar');
  });

  test('names the discount that priced the distance', () => {
    const evaluation = handModule.evaluate(TO_DECK, contextWith(40, 12))!;
    expect(collectTunables(evaluation.rationale).has('potentialDiscount')).toBe(true);
  });

  test('declines an action that is not its own', () => {
    const other = { type: 'pass' } as unknown as GameAction;
    expect(handModule.evaluate(other, contextWith(40, 12))).toBeNull();
  });
});

describe('the end-of-turn hand', () => {
  const context = contextWith(40, 12);
  const discardFaction = { type: 'discard-card', cardInstanceId: 'c-faction' } as unknown as GameAction;
  const discardCapped = { type: 'discard-card', cardInstanceId: 'c-capped' } as unknown as GameAction;
  const discardBlank = { type: 'discard-card', cardInstanceId: 'c-blank' } as unknown as GameAction;
  const draw = { type: 'draw-cards' } as unknown as GameAction;

  test('drawing gains the draw value', () => {
    expect(handModule.evaluate(draw, context)!.expectedTsd)
      .toBeCloseTo(DEFAULT_TUNABLES.resourceDrawValue, 9);
  });

  test('two different cards are two different prices', () => {
    // The property whose absence the horizon test caught: with every discard
    // scored identically the module had no opinion to be right or wrong about.
    const faction = handModule.evaluate(discardFaction, context)!;
    const blank = handModule.evaluate(discardBlank, context)!;
    expect(faction.expectedTsd).toBeLessThan(blank.expectedTsd);
    expect(faction.utility).toBeLessThan(blank.utility);
  });

  test('a capped source is worth keeping when the rest of the hand un-caps it', () => {
    // The fixture is the case exactly: 3 item MP on the board, a 4 MP item and
    // a 2 MP faction in hand. Priced against *today's* standing the item is
    // capped and worth nothing, so it ranked below a blank card and the agent
    // threw it — 20 times against a human's 3, over the recorded corpus.
    //
    // Priced against the standing this hand would create, the faction landing
    // beside it is what lifts the half-total cap, and the item is worth
    // keeping again. That is not a softening of CoE 10.3; it is 10.3 applied
    // to the total the player is actually playing toward.
    const capped = handModule.evaluate(discardCapped, context)!;
    const blank = handModule.evaluate(discardBlank, context)!;
    expect(capped.expectedTsd).toBeLessThan(blank.expectedTsd);
  });

  test('a source that stays capped however the hand plays is still worth nothing', () => {
    // The half of §10.3 that was always right, and the half the projection
    // must not throw away: with nothing else to play, the item source cannot
    // get out from under the cap, and the points are worth no more to hold
    // than a card with none.
    const alone = contextWith(40, 12);
    const view = alone.view as unknown as { self: { hand: unknown[] } };
    view.self.hand = [
      { instanceId: 'c-capped', definitionId: 'capped' },
      { instanceId: 'c-blank', definitionId: 'blank' },
    ];
    // Equal *worth*, and no longer an equal number: the hand carries a total
    // order now, so two cards the valuation cannot separate are still separated
    // by a tie-break narrower than any real difference. What this test pins is
    // that the valuation itself draws no distinction — the gap between them
    // must stay inside that tie-break.
    const capped = handModule.evaluate(discardCapped, alone)!;
    const blank = handModule.evaluate(discardBlank, alone)!;
    expect(Math.abs(capped.expectedTsd - blank.expectedTsd))
      .toBeLessThanOrEqual(DEFAULT_TUNABLES.heldTieBreakSpan + 1e-9);
  });

  test('points that would actually score are worth more than either', () => {
    expect(handModule.evaluate(discardFaction, context)!.expectedTsd)
      .toBeLessThan(handModule.evaluate(discardBlank, context)!.expectedTsd);
  });

  test('says which card it is throwing and why', () => {
    const evaluation = handModule.evaluate(discardFaction, context)!;
    expect(evaluation.outcomes[0].label).toContain('Faction');
    expect(evaluation.outcomes[0].label).toContain('faction MP');
  });

  test('reports the hand and deck the price was computed from', () => {
    const text = JSON.stringify(handModule.evaluate(discardFaction, contextWith(31, 4))!.rationale);
    expect(text).toContain('31');
  });
});
