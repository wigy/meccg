/**
 * @module as-128.test
 *
 * Card test: Necklace of Girion (as-128)
 * Type: minion-resource-item (special, hoard), alignment ringwraith, unique.
 * Marshalling Points: 3. Corruption Points: 3.
 *
 * Card text: "Unique. Playable at The Lonely Mountain. Bearer receives +3
 * direct influence against Men and Man factions. If bearer is at a
 * Border-hold [{B}] during the site phase, he can make a corruption check,
 * and, if successful, discard this item to play up to 3 non-unique minor
 * and/or major items with his company. Characters need not tap to receive
 * these items."
 *
 * Rule coverage (playability only):
 *
 * | # | Rule                               | Mechanism                                         |
 * |---|------------------------------------|---------------------------------------------------|
 * | 1 | Playable at The Lonely Mountain    | `item-play-site` `sites: ["The Lonely Mountain"]` |
 *
 * A "special" hoard item has no minor/major/greater tier, so the site's
 * `playableResources` list must not gate it — its own `item-play-site`
 * restriction is its whole playability (bug report, game mvg6f6j1-z94oej).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, buildSitePhaseState, viableActions,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const NECKLACE_OF_GIRION = 'as-128' as CardDefinitionId;
const THE_MOUTH = 'le-24' as CardDefinitionId;               // minion man
const LONELY_MOUNTAIN_MINION = 'le-387' as CardDefinitionId; // hoard, ruins-and-lairs
const CAVES_OF_ULUND = 'le-360' as CardDefinitionId;         // hoard, not The Lonely Mountain

describe('Necklace of Girion (as-128)', () => {
  beforeEach(() => resetMint());

  test('playable at The Lonely Mountain during the site phase', () => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith,
      site: LONELY_MOUNTAIN_MINION,
      characters: [THE_MOUTH],
      hand: [NECKLACE_OF_GIRION],
    });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('NOT playable at another hoard site (Caves of Ûlund)', () => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith,
      site: CAVES_OF_ULUND,
      characters: [THE_MOUTH],
      hand: [NECKLACE_OF_GIRION],
    });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });
});
