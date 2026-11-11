/**
 * @module armory-store-from-hand-click.test
 *
 * Regression test for bug report 010267f5dffd059c (game mwbd6txx-er06z7, seq
 * 318, turn 9 organization): "Armory — doesn't work". The player had two
 * Armories (dm-116) in play and Black Arrow (tw-494) and Shield of
 * Iron-bound Ash (tw-327) — both minor items — in hand. The engine offered
 * `store-item-in-cache` for each item/Armory pair, but the browser hand
 * renderer never looked for that action type, so the minor items rendered
 * dimmed as unplayable and could not be placed under Armory.
 *
 * `findItemCacheStoreActions` / `itemCacheStoreChoices` (used by
 * `render-hand.ts`'s per-card dispatch) now surface those actions so clicking
 * the item opens a "Place under Armory" menu.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, GameAction, StoreItemInCacheAction } from '@meccg/shared';
import { findItemCacheStoreActions, itemCacheStoreChoices } from './render-hand.js';

const pool = loadCardPool();

const ARMORY = 'dm-116' as CardDefinitionId;
const ARMORY_A = 'p1-5' as CardInstanceId;
const ARMORY_B = 'p1-6' as CardInstanceId;
const BLACK_ARROW = 'p1-7' as CardInstanceId;
const SHIELD = 'p1-10' as CardInstanceId;

const store = (item: CardInstanceId, host: CardInstanceId): StoreItemInCacheAction =>
  ({ type: 'store-item-in-cache', player: 'p1', itemInstanceId: item, hostInstanceId: host }) as StoreItemInCacheAction;

const legalActions: GameAction[] = [
  store(BLACK_ARROW, ARMORY_A),
  store(SHIELD, ARMORY_A),
  store(BLACK_ARROW, ARMORY_B),
  store(SHIELD, ARMORY_B),
  { type: 'pass', player: 'p1' } as GameAction,
];

const lookup = (id: CardInstanceId): CardDefinitionId | undefined =>
  id === ARMORY_A || id === ARMORY_B ? ARMORY : undefined;

describe('Armory (dm-116) store-from-hand click', () => {
  test('surfaces one store action per Armory for the clicked hand item', () => {
    expect(findItemCacheStoreActions(BLACK_ARROW, legalActions)).toEqual([legalActions[0], legalActions[2]]);
    expect(findItemCacheStoreActions(SHIELD, legalActions)).toEqual([legalActions[1], legalActions[3]]);
  });

  test('returns nothing when instanceId is null', () => {
    expect(findItemCacheStoreActions(null, legalActions)).toEqual([]);
  });

  test('menu names the host, numbering duplicates', () => {
    const choices = itemCacheStoreChoices(findItemCacheStoreActions(BLACK_ARROW, legalActions), lookup, pool);
    expect(choices.map(c => c.label)).toEqual(['Place under Armory #1', 'Place under Armory #2']);
    expect(choices.map(c => c.action)).toEqual([legalActions[0], legalActions[2]]);
  });

  test('single host is labelled without a number', () => {
    const choices = itemCacheStoreChoices([store(SHIELD, ARMORY_A)], lookup, pool);
    expect(choices.map(c => c.label)).toEqual(['Place under Armory']);
  });
});
