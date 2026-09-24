/**
 * @module ai/h2/services/deck-reach.test
 *
 * The deck's points, as `travel` sees them: what is left to draw is the deck
 * list minus everything the owner can see, and a site's coverage is how much of
 * the remaining marshalling-point value is one movement away from it.
 *
 * The position is the turn-14 organization scenario: Alatar and Elrond at
 * Mount Gundabad, holding Rangers of the North (Bree) and Gollum (Goblin-gate
 * or Moria). Mount Gundabad is one move from both; Lórien is one move from
 * Moria but five regions from Bree.
 */

import { describe, expect, test } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { computeLegalActions } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import type { ModuleContext } from '../core/types.js';
import { loadScenario, scenarioView } from '../scenario-store.js';
import { testWinProbModel } from '../test-support.js';
import { travelModule } from '../modules/travel/travel.js';
import { computeStanding } from './standing.js';
import { computeDeckReach, unseenDeckCards } from './deck-reach.js';

const RANGERS_OF_THE_NORTH = 'tw-311';
const GOLLUM = 'tw-246';
const BREE = 'tw-378';
const LORIEN = 'tw-408';

const scenario = loadScenario('organization/turn14-company-planning');
const view = scenarioView(scenario);
const cardPool = loadCardPool();
const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
const handIds = view.self.hand.map(c => c.definitionId as string);

describe('what is left to draw', () => {
  test('is the deck list minus the copies the owner can see', () => {
    // Two copies listed, one in hand: one is still face down.
    const unseen = unseenDeckCards(view, {
      playDeck: [...handIds, RANGERS_OF_THE_NORTH],
      draftPool: [],
    });
    expect(unseen).toEqual([RANGERS_OF_THE_NORTH]);
  });

  test('counts toward the points still to play, marked as still in the deck', () => {
    const reach = computeDeckReach(view, cardPool, standing, {
      playDeck: [...handIds, RANGERS_OF_THE_NORTH],
      draftPool: [],
    });
    expect(reach.cards.filter(c => c.definitionId === RANGERS_OF_THE_NORTH).map(c => c.where))
      .toEqual(['hand', 'deck']);
  });
});

describe('coverage', () => {
  test('a site one move from every scoring site covers everything; one far from Bree does not', () => {
    const reach = computeDeckReach(view, cardPool, standing, undefined);
    expect(reach.cards.map(c => c.definitionId).sort()).toEqual([GOLLUM, RANGERS_OF_THE_NORTH].sort());
    expect(reach.coverage(BREE)).toBe(1);
    expect(reach.coverage(LORIEN)).toBeGreaterThan(0);
    expect(reach.coverage(LORIEN)).toBeLessThan(1);
  });
});

describe('travel, once the deck is known', () => {
  const actions = computeLegalActions(scenario.state, scenario.actingPlayer)
    .filter(legal => legal.viable)
    .map(legal => legal.action);
  const context: ModuleContext = {
    view,
    cardPool,
    legalActions: actions,
    tunables: DEFAULT_TUNABLES,
    standing,
  };
  const toLorien = actions.find(a => a.type === 'plan-movement' && view.self.siteDeck.some(
    s => s.instanceId === (a as unknown as { destinationSite: string }).destinationSite
      && (s.definitionId as string) === LORIEN,
  )) as GameAction;

  test('charges a move out of reach of the unseen points more than the same move blind', () => {
    // Mount Gundabad is one move from both Bree and Moria; Lórien is one move
    // from Moria only. With two more Bree cards known to be in the deck, most
    // of what is left to play is out of reach from Lórien, and going there is
    // worth less than the hand alone suggested.
    const blind = travelModule.evaluate(toLorien, context)!.expectedTsd;
    const informed = travelModule.evaluate(toLorien, {
      ...context,
      ownDeck: { playDeck: [...handIds, RANGERS_OF_THE_NORTH, RANGERS_OF_THE_NORTH], draftPool: [] },
    })!.expectedTsd;
    expect(informed).toBeLessThan(blind);
  });

  test('credits nothing for a move that keeps every point in reach', () => {
    const toBree = actions.find(a => a.type === 'plan-movement' && view.self.siteDeck.some(
      s => s.instanceId === (a as unknown as { destinationSite: string }).destinationSite
        && (s.definitionId as string) === BREE,
    )) as GameAction;
    // Both Mount Gundabad and Bree are one move from everything, so knowing
    // the deck changes nothing about the trip.
    const blind = travelModule.evaluate(toBree, context)!.expectedTsd;
    const informed = travelModule.evaluate(toBree, {
      ...context,
      ownDeck: { playDeck: [...handIds, RANGERS_OF_THE_NORTH], draftPool: [] },
    })!.expectedTsd;
    expect(informed).toBe(blind);
  });
});
