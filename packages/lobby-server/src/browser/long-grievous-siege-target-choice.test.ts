/**
 * @module long-grievous-siege-target-choice.test
 *
 * Regression test for bug report da623bb875f5f7a6 (game mwb5c4p1-7go7xx,
 * seq 490 / 551): playing Long Grievous Siege (ba-40) never let the player
 * choose the target faction or the Border-hold placed "off to the side". The
 * engine offered one `play-permanent-event` action per (faction × eligible
 * Border-hold) pair — seven at seq 489 — but `findCardAction`'s generic loop
 * silently fired the first one.
 *
 * `findPermanentEventFactionTargetActions` now surfaces every candidate so
 * the hand renderer can show a choice menu, labelled by
 * `factionTargetChoiceLabel`.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findPermanentEventFactionTargetActions, factionTargetChoiceLabel } from './render-hand.js';

const SIEGE = 'p1-29' as CardInstanceId;
const ORCS_OF_ANGMAR = 'p1-22' as CardInstanceId;
const ICE_ORCS = 'p1-21' as CardInstanceId;
const BREE = 'p1-111' as CardInstanceId;
const DALE = 'p1-113' as CardInstanceId;

const NAMES: Record<string, string> = {
  [ORCS_OF_ANGMAR]: 'Orcs of Angmar', [ICE_ORCS]: 'Ice-orcs', [BREE]: 'Bree', [DALE]: 'Dale',
};
const nameOf = (id: CardInstanceId): string => NAMES[id as string] ?? (id as string);

/** The (faction, Border-hold) pairs the engine offered for the played copy. */
const siegeActions: GameAction[] = [
  [ORCS_OF_ANGMAR, BREE], [ICE_ORCS, BREE], [ICE_ORCS, DALE],
].map(([targetFactionInstanceId, besiegedSiteInstanceId]) => ({
  type: 'play-permanent-event',
  player: 'p1',
  cardInstanceId: SIEGE,
  targetFactionInstanceId,
  besiegedSiteInstanceId,
})) as GameAction[];

describe('Long Grievous Siege faction / Border-hold choice', () => {
  test('surfaces every faction × Border-hold option for the played card', () => {
    const other = { type: 'play-permanent-event', player: 'p1', cardInstanceId: 'p1-30', targetFactionInstanceId: ICE_ORCS, besiegedSiteInstanceId: DALE } as GameAction;
    const found = findPermanentEventFactionTargetActions(SIEGE, [...siegeActions, other]);
    expect(found).toEqual(siegeActions);
  });

  test('labels each option with the faction and the besieged Border-hold', () => {
    const labels = findPermanentEventFactionTargetActions(SIEGE, siegeActions).map(a => factionTargetChoiceLabel(a, nameOf));
    expect(labels).toEqual([
      'Orcs of Angmar — besiege Bree',
      'Ice-orcs — besiege Bree',
      'Ice-orcs — besiege Dale',
    ]);
  });

  test('returns empty when instanceId is null', () => {
    expect(findPermanentEventFactionTargetActions(null, siegeActions)).toHaveLength(0);
  });
});
