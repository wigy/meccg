/**
 * @module rule-meas-hoard-item
 *
 * MEAS §2 — Hoard items may only be played at a site that contains a hoard.
 * Exercised here with an AS hoard item (Old Treasure, as-129) and minion
 * fixtures, per the package testing convention.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  buildMinionSitePhaseState, resetMint, viableActions,
  PLAYER_1,
} from '../test-helpers.js';

const OLD_TREASURE = 'as-129' as CardDefinitionId; // minion hoard item (minor)
const GORBAG = 'le-11' as CardDefinitionId;         // minion (orc) bearer
const SHELOBS_LAIR = 'le-402' as CardDefinitionId;  // shadow-hold WITH hoard
const ETTENMOORS = 'le-373' as CardDefinitionId;    // ruins-and-lairs, NO hoard

describe('MEAS §2 — Hoard item play-site gating (AS hoard item)', () => {
  beforeEach(() => resetMint());

  test('AS hoard item is playable at a hoard site', () => {
    const state = buildMinionSitePhaseState({
      site: SHELOBS_LAIR,
      characters: [GORBAG],
      hand: [OLD_TREASURE],
    });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBeGreaterThanOrEqual(1);
  });

  test('AS hoard item is NOT playable at a non-hoard site', () => {
    const state = buildMinionSitePhaseState({
      site: ETTENMOORS,
      characters: [GORBAG],
      hand: [OLD_TREASURE],
    });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });
});
