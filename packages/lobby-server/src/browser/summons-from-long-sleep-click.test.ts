/**
 * @module summons-from-long-sleep-click.test
 *
 * Regression test for bug report 1d452f3f0db6495d (game muvo838p-dw4rho):
 * "Cant get it to function when i play" for Summons from Long Sleep (as-39).
 *
 * The engine offered `reserve-creature` (with Itangast and Sea Serpent in hand,
 * seq 303) and would offer `play-reserved-creature` once a creature was
 * reserved, but no UI surface handled either action type — the in-play card had
 * no click handler and the hand renderer ignored `reserve-creature`, so the
 * card could be played but never used. `findSummonsFromLongSleepActions` now
 * resolves the slot actions for the board card so the renderer can wire a
 * click handler; this test asserts that resolution and the menu labels.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardDefinition, CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { findSummonsFromLongSleepActions, summonsFromLongSleepActionLabel } from './company-block.js';

const SUMMONS = 'p1-52' as CardInstanceId; // as-39, the card in play
const OTHER_SUMMONS = 'p1-53' as CardInstanceId;
const ITANGAST = 'p1-38' as CardInstanceId; // td-36, in hand
const ITANGAST_DEF = 'td-36' as CardDefinitionId;

const reserve: GameAction = {
  type: 'reserve-creature',
  player: 'p1',
  cardInstanceId: ITANGAST,
  sourceCardInstanceId: SUMMONS,
} as GameAction;

const playReserved: GameAction = {
  type: 'play-reserved-creature',
  player: 'p1',
  sourceCardInstanceId: SUMMONS,
  targetCompanyId: 'company-p2-2',
  keyedBy: { method: 'region-type', value: 'wilderness' },
} as GameAction;

const pool = { [ITANGAST_DEF]: { name: 'Itangast' } as CardDefinition };
const lookup = (id: CardInstanceId) => (id === ITANGAST ? ITANGAST_DEF : undefined);

describe('findSummonsFromLongSleepActions surfaces Summons from Long Sleep on the board', () => {
  test('returns reserve and play-reserved actions keyed to the in-play card', () => {
    expect(findSummonsFromLongSleepActions([reserve, playReserved], SUMMONS)).toEqual([reserve, playReserved]);
  });

  test('returns nothing for a different in-play card', () => {
    expect(findSummonsFromLongSleepActions([reserve, playReserved], OTHER_SUMMONS)).toEqual([]);
    expect(findSummonsFromLongSleepActions([], SUMMONS)).toEqual([]);
  });

  test('labels name the reserved creature and the keying', () => {
    const [r, p] = findSummonsFromLongSleepActions([reserve, playReserved], SUMMONS);
    expect(summonsFromLongSleepActionLabel(r, pool, lookup)).toBe('Reserve Itangast');
    expect(summonsFromLongSleepActionLabel(p, pool, lookup)).toBe('Play reserved creature (keyed by region-type: wilderness)');
  });
});
