/**
 * @module ai/h2/modules/events/events.test
 *
 * The module reads a card's declared effects and prices the families it
 * recognises, so the tests are about the boundary: a recognised family is
 * scored from what the card says, and an unrecognised one is *declined* rather
 * than charged for the card it would spend.
 *
 * That second property is the one worth guarding. Charging for the card and
 * crediting nothing would make H2 refuse to play any event in the game, which
 * is worse than having no opinion — and it is exactly the trap the on-guard
 * pricing fell into until the rules were checked.
 *
 * The counterpart is the third group below: two cases where the module can
 * *prove* the play achieves nothing — a card that declares no effect at all,
 * and a removal with nothing in play to remove — and refusing is then an
 * opinion rather than a guess. The line between "cannot read it" and "there is
 * nothing to read" is the whole of this file's difficulty.
 */

import { describe, expect, test } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { GameAction, PlayerView } from '@meccg/shared';
import type { ModuleContext } from '../../core/types.js';
import { DEFAULT_TUNABLES } from '../../core/tunables.js';
import { computeStanding } from '../../services/standing.js';
import { loadScenario, scenarioView } from '../../scenario-store.js';
import { testMarshallingPoints, testWinProbModel } from '../../test-support.js';
import { eventsModule } from './events.js';

/** A recovery event: brings a card back from the discard pile. */
const RECOVERY = 'ev-recovery';
/** An event whose effect this module has no family for. */
const OPAQUE = 'ev-opaque';
/** An event that declares only how it may be played — Twilight's shape. */
const INERT = 'ev-inert';
/** An event that discards a hazard event from play — Marvels Told's shape. */
const REMOVAL = 'ev-removal';
/** A hazard long-event, the thing a removal is actually aimed at. */
const LONG_HAZARD = 'hz-long';
/** A corrupting hazard *attached to a character* — a different thing entirely. */
const ATTACHED_HAZARD = 'hz-attached';
/**
 * A corruption hazard-event attached to a character — Lure of Nature's real
 * shape (`cardType: hazard-event`, unlike {@link ATTACHED_HAZARD}'s
 * `hazard-creature`), so it actually matches a removal's `cardType:
 * hazard-event` filter and reaches {@link findInPlay}'s attached branch.
 */
const ATTACHED_EVENT = 'hz-attached-event';

/** A Short Rest (td-95): a resource *long* event, the family nobody owned. */
const SHORT_REST = 'ev-short-rest';
/** Dark Tryst (as-80): "draw three cards and remove this card from the game". */
const DARK_TRYST = 'ev-dark-tryst';
/** A site two wilderness regions out, drawing two cards on arrival. */
const SITE = 'site-two-regions';

const POOL = {
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
  [DARK_TRYST]: {
    cardType: 'minion-resource-event',
    name: 'Dark Tryst',
    effects: [{ type: 'draw-cards', count: 3, removeFromGame: true }],
  },
  [SITE]: {
    cardType: 'hero-site',
    name: 'Wilderness Ruin',
    siteType: 'ruins-and-lairs',
    sitePath: ['wilderness', 'wilderness'],
    resourceDraws: 2,
  },
  [RECOVERY]: {
    cardType: 'hero-resource-event',
    name: 'Smoke Rings',
    effects: [{ type: 'move', select: 'target', from: ['sideboard', 'discard'], to: 'deck', count: 1 }],
  },
  [OPAQUE]: {
    cardType: 'hero-resource-event',
    name: 'Stealth',
    effects: [
      { type: 'play-window', phase: 'organization' },
      { type: 'on-event', event: 'something-specific' },
    ],
  },
  [INERT]: {
    cardType: 'hazard-event',
    name: 'Twilight',
    keywords: ['environment'],
    effects: [
      { type: 'play-flag', flag: 'playable-as-resource' },
      { type: 'play-flag', flag: 'no-hazard-limit' },
    ],
  },
  [REMOVAL]: {
    cardType: 'hero-resource-event',
    name: 'Marvels Told',
    effects: [
      { type: 'play-target', target: 'character', cost: { tap: 'character' } },
      {
        type: 'move',
        select: 'target',
        from: 'in-play',
        to: 'discard',
        filter: { $and: [{ cardType: 'hazard-event' }, { eventType: { $in: ['permanent', 'long'] } }] },
      },
    ],
  },
  [LONG_HAZARD]: { cardType: 'hazard-event', name: 'Minions Stir', eventType: 'long', effects: [] },
  [ATTACHED_HAZARD]: {
    cardType: 'hazard-creature',
    name: 'Lure of Nature',
    effects: [{ type: 'stat-modifier', stat: 'corruption-points', value: 5 }],
  },
  [ATTACHED_EVENT]: {
    cardType: 'hazard-event',
    name: 'Lure of Nature',
    eventType: 'permanent',
    effects: [{ type: 'stat-modifier', stat: 'corruption-points', value: 5 }],
  },
} as unknown as ModuleContext['cardPool'];

/** A context holding both events in hand. */
function context(): ModuleContext {
  const view = {
    self: {
      id: 'p1',
      marshallingPoints: testMarshallingPoints({ character: 3, item: 3 }),
      hand: [
        { instanceId: 'c-recovery', definitionId: RECOVERY },
        { instanceId: 'c-opaque', definitionId: OPAQUE },
        { instanceId: 'c-inert', definitionId: INERT },
        { instanceId: 'c-removal', definitionId: REMOVAL },
        { instanceId: 'c-short-rest', definitionId: SHORT_REST },
        { instanceId: 'c-dark-tryst', definitionId: DARK_TRYST },
      ],
      playDeck: [],
      sideboard: [],
      discardPile: [],
      characters: {},
      companies: [],
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
    turnNumber: 12,
  } as unknown as PlayerView;
  return {
    view,
    cardPool: POOL,
    legalActions: [],
    tunables: DEFAULT_TUNABLES,
    standing: computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES),
  };
}

/** Playing one of the two events in hand. */
const play = (instanceId: string): GameAction =>
  ({ type: 'play-short-event', player: 'p1', cardInstanceId: instanceId } as unknown as GameAction);

/**
 * Playing a removal event with the specific in-play target the engine's
 * legal-action generator already chose for this action — the one-action-per-
 * target shape Marvels Told, Voices of Malice, Ancient Secrets and The Cock
 * Crows all use.
 */
const playDiscarding = (instanceId: string, discardTargetInstanceId: string): GameAction =>
  ({
    type: 'play-short-event', player: 'p1', cardInstanceId: instanceId, discardTargetInstanceId,
  } as unknown as GameAction);

/** Playing a resource long event, which is a different action type entirely. */
const playLong = (instanceId: string): GameAction =>
  ({ type: 'play-long-event', player: 'p1', cardInstanceId: instanceId } as unknown as GameAction);

/** A context whose one company is two wilderness regions from its destination. */
function movingContext(): ModuleContext {
  const moving = context();
  (moving.view.self as unknown as { characters: Record<string, unknown> }).characters = {
    'ch-1': {
      instanceId: 'ch-1', definitionId: 'ch-1-def', status: 'untapped',
      items: [], allies: [], hazards: [], followers: [],
    },
  };
  (moving.view.self as unknown as { companies: unknown[] }).companies = [{
    id: 'co-1',
    characters: ['ch-1'],
    currentSite: { instanceId: 'here', definitionId: SITE },
    destinationSite: { instanceId: 'there', definitionId: SITE },
    moved: false,
  }];
  return moving;
}

describe('a family it recognises', () => {
  test('a card recovered is worth what a draw is worth, and says it is a floor', () => {
    const evaluation = eventsModule.evaluate(play('c-recovery'), context())!;
    expect(evaluation).not.toBeNull();
    const text = JSON.stringify(evaluation.rationale);
    expect(text).toContain('back to deck');
    // Priced as a floor, because the card is chosen rather than drawn.
    expect(text).toContain('a floor');
  });

  test('the card it spends is charged at the shadow price', () => {
    const evaluation = eventsModule.evaluate(play('c-recovery'), context())!;
    expect(JSON.stringify(evaluation.rationale)).toContain('the card it spends');
  });
});

describe('a resource long event', () => {
  test('is scored at all, which it was not: no evaluator in the codebase owned the action', () => {
    // The regression this guards is total rather than numerical. `play-long-event`
    // was absent from every module's `ownedActionTypes` *and* from Heuristics 1's
    // switch, so the ranking on a long-event decision held one candidate — the
    // baseline's `pass`, at zero — and both agents passed the phase in every
    // game either had ever played.
    expect(eventsModule.ownedActionTypes).toContain('play-long-event');
    expect(eventsModule.evaluate(playLong('c-short-rest'), movingContext())).not.toBeNull();
  });

  test('A Short Rest is worth the cards it adds to the company that is moving', () => {
    // Two regions crossed, so `4 - 2` extra cards on top of the printed two —
    // which beats the one card the play spends, so the module prefers it to
    // passing. That preference is the whole point: the card exists to multiply
    // a turn's draws and was previously unplayable by construction.
    const evaluation = eventsModule.evaluate(playLong('c-short-rest'), movingContext())!;
    expect(evaluation.expectedTsd).toBeGreaterThan(0);
    const text = JSON.stringify(evaluation.rationale);
    expect(text).toContain('2 extra card(s)');
    expect(text).toContain('1 moving company');
  });

  test('and worth nothing on a turn where no company moves, which is a fact not a discount', () => {
    // A draw-modifier pays on a company that draws. With nothing moving there
    // is no draw to modify, so the play spends a card for nothing and the
    // module says so rather than declining.
    const evaluation = eventsModule.evaluate(playLong('c-short-rest'), context())!;
    expect(evaluation.expectedTsd).toBeLessThan(0);
    expect(JSON.stringify(evaluation.rationale)).toContain('nothing is moving this turn');
  });
});

describe('a card that draws straight off the deck', () => {
  test('Dark Tryst is worth the three cards it draws', () => {
    const deep = context();
    (deep.view.self as unknown as { playDeck: unknown[] }).playDeck =
      Array.from({ length: 20 }, (_, i) => ({ instanceId: `d-${i}`, definitionId: 'unknown' }));
    const evaluation = eventsModule.evaluate(play('c-dark-tryst'), deep)!;
    expect(evaluation).not.toBeNull();
    expect(evaluation.expectedTsd).toBeGreaterThan(0);
    expect(JSON.stringify(evaluation.rationale)).toContain('3 card(s) drawn');
  });

  test('and only what the deck can actually supply', () => {
    // The draw stops at exhaustion, and the deck's size is the one thing about
    // it the view reports honestly. A card promising three from a deck of one
    // must not be priced at three.
    const shallow = context();
    (shallow.view.self as unknown as { playDeck: unknown[] }).playDeck = [
      { instanceId: 'd-0', definitionId: 'unknown' },
    ];
    const evaluation = eventsModule.evaluate(play('c-dark-tryst'), shallow)!;
    expect(JSON.stringify(evaluation.rationale)).toContain('the deck holds only that many');
  });
});

describe('a family it does not', () => {
  test('is declined, not charged', () => {
    // The property that keeps H2 able to play events at all: an effect this
    // module cannot read leaves the decision uncovered rather than scored at
    // "costs a card, achieves nothing".
    expect(eventsModule.evaluate(play('c-opaque'), context())).toBeNull();
  });

  test('and so is an action naming a card that is not in hand', () => {
    expect(eventsModule.evaluate(play('not-held'), context())).toBeNull();
  });
});

describe('a card that will do nothing', () => {
  test('one whose whole effect list says how it may be played is refused, not declined', () => {
    // Twilight: two `play-flag`s and no effect at all. Its printed text cancels
    // an environment card; the DSL does not say so, and the engine plays what
    // the DSL declares. Spending a card for nothing is worse than passing, and
    // that is an opinion the module can defend rather than a guess.
    const evaluation = eventsModule.evaluate(play('c-inert'), context())!;
    expect(evaluation).not.toBeNull();
    expect(evaluation.expectedTsd).toBeLessThan(0);
    expect(JSON.stringify(evaluation.rationale)).toContain('declares no effect');
  });

  test('an unfamiliar effect type still counts as an effect, so the card is declined', () => {
    // The conservative half of the rule: only the listed declaration types are
    // treated as saying nothing happens. Anything else — including a type this
    // module has never seen — makes it decline rather than call the card inert.
    expect(eventsModule.evaluate(play('c-opaque'), context())).toBeNull();
  });

  test('a removal with nothing in play to remove is refused', () => {
    // Every short event in the pool that discards something from play targets a
    // hazard event in play. With none in play the card resolves for nothing.
    expect(eventsModule.evaluate(play('c-removal'), context())!.expectedTsd).toBeLessThan(0);
  });

  test('and the same removal is declined once there is something it could reach', () => {
    // With a target, what the card is worth is what *that* card was doing —
    // which is the thing this module cannot price, so it says nothing.
    const withTarget = context();
    (withTarget.view.opponent as unknown as { cardsInPlay: unknown[] }).cardsInPlay = [
      { instanceId: 'in-play-1', definitionId: LONG_HAZARD },
    ];
    expect(eventsModule.evaluate(play('c-removal'), withTarget)).toBeNull();
  });

  test('a removal named at a hazard attached to the opponent\'s own character is refused, not credited', () => {
    // Regression: The Cock Crows was played by the AI targeting a corruption
    // card (Lure of Nature) attached to the *opponent's* character. Discarding
    // it relieves the opponent, not us — the engine correctly still offers
    // both players' attached hazards as legal targets (the legal-action
    // generator is not scoped to one side), but the module that used to
    // price "the best reachable card" board-wide, blind to which target this
    // specific action names, credited the action as if it helped us. It must
    // instead recognise that this named target sits on the opponent's side
    // and price it at zero, so the game's action-selection prefers passing
    // over spending a card to help the opponent.
    const opponentCorrupted = context();
    (opponentCorrupted.view.opponent as { characters: Record<string, unknown> }).characters = {
      victim: {
        instanceId: 'victim',
        definitionId: 'victim-def',
        effectiveStats: { corruptionPoints: 5 },
        items: [], allies: [], followers: [],
        hazards: [{ instanceId: 'h1', definitionId: ATTACHED_EVENT }],
      },
    };
    const evaluation = eventsModule.evaluate(playDiscarding('c-removal', 'h1'), opponentCorrupted)!;
    expect(evaluation).not.toBeNull();
    expect(evaluation.expectedTsd).toBeLessThan(0);
    expect(JSON.stringify(evaluation.rationale)).toContain('we do not control');
  });

  test('a removal is never priced as corruption relief on our own characters', () => {
    // The branch this replaced read the same `move from in-play to discard` and
    // credited the corruption of an attached hazard on one of our characters —
    // a different effect, on a different target, that no card in this family
    // has. A corrupted character of ours must not make the card look good.
    const corrupted = context();
    (corrupted.view.self as { characters: Record<string, unknown> }).characters = {
      bearer: {
        instanceId: 'bearer',
        definitionId: 'bearer-def',
        effectiveStats: { corruptionPoints: 5 },
        items: [], allies: [], followers: [],
        hazards: [{ instanceId: 'h1', definitionId: ATTACHED_HAZARD }],
      },
    };
    expect(eventsModule.evaluate(play('c-removal'), corrupted)!.expectedTsd).toBeLessThan(0);
  });
});

describe('discarding something that was making every attack worse', () => {
  /**
   * A real position with our own companies, Orcs in their discard and a hazard
   * event on the board — the only shape in which a removal has anything this
   * module can price.
   */
  function removalPosition(inPlay?: string) {
    const scenario = loadScenario('organization/replanned-movement');
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const definitionOf = (name: string) => Object.keys(cardPool).find(id =>
      (cardPool[id] as unknown as { name?: string }).name === name)!;
    (view.opponent as unknown as { discardPile: unknown[] }).discardPile = [
      { instanceId: 'shown-1', definitionId: definitionOf('Orc-warband') },
      { instanceId: 'shown-2', definitionId: definitionOf('Orc-guard') },
      { instanceId: 'shown-3', definitionId: definitionOf('Orc-watch') },
    ];
    (view.opponent as unknown as { cardsInPlay: unknown[] }).cardsInPlay = inPlay
      ? [{ instanceId: 'staged', definitionId: definitionOf(inPlay) }]
      : [];
    (view.self.hand as unknown as { definitionId: string }[])[0].definitionId =
      definitionOf('Marvels Told');
    const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
    return {
      held: view.self.hand[0],
      context: {
        view, cardPool, legalActions: [], tunables: DEFAULT_TUNABLES, standing,
      } as ModuleContext,
    };
  }

  test('is worth the harm it stops', () => {
    // Minions Stir gives every Orc coming at our companies +1 strike and +1
    // prowess. Taking it off the board is worth exactly the harm that stops,
    // which `defence` already computes from the other direction.
    const { held, context } = removalPosition('Minions Stir');
    const evaluation = eventsModule.evaluate(play(held.instanceId), context)!;
    expect(evaluation).not.toBeNull();
    const text = JSON.stringify(evaluation.rationale);
    expect(text).toContain('Minions Stir');
    expect(text).toContain('back to their printed numbers');
  });

  test('and says the play achieves nothing when the filter reaches nothing', () => {
    // Doors of Night carries the environment keyword, which this card's filter
    // excludes, so there is nothing reachable at all — and the module says the
    // play achieves nothing rather than inventing a value for it.
    const { held, context } = removalPosition('Doors of Night');
    const evaluation = eventsModule.evaluate(play(held.instanceId), context)!;
    expect(evaluation.expectedTsd).toBeLessThan(0);
  });
});
