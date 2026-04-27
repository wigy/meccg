/**
 * @module rule-6.12-playing-item
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.12: Playing an Item
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Playing an Item - If a company has successfully entered a site during its site phase, the resource player may play an item if they have an untapped character in the company, the site is untapped, and the type of item is playable at the site (i.e. minor, major, greater, or gold ring). The resource player must tap the character (as an active condition), and then upon resolution places the item under the character's control and taps the site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint, viableActions,
  dispatch, PLAYER_1, RESOURCE_PLAYER,
  BILBO, DAGGER_OF_WESTERNESSE,
  MORIA,
  companyIdAt, charIdAt, handCardId,
  expectCharStatus, expectCharItemCount,
  CardStatus,
} from '../../test-helpers.js';
import type { SitePhaseState } from '../../../index.js';

describe('Rule 6.12 — Playing an Item', () => {
  beforeEach(() => resetMint());

  test('Play item with untapped character at untapped site where item type is playable; taps character and site', () => {
    // Bilbo (untapped) at Moria (untapped, playable for minor items) holds a
    // Dagger of Westernesse in hand. After playing it, Bilbo must be tapped,
    // the site must be tapped, and the dagger must be under Bilbo's control.
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [BILBO],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThan(0);

    const after = dispatch(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: handCardId(state, RESOURCE_PLAYER),
      companyId: companyIdAt(state, RESOURCE_PLAYER),
      attachToCharacterId: charIdAt(state, RESOURCE_PLAYER),
    });

    // Character is tapped as active condition
    expectCharStatus(after, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
    // Item is placed under the character's control
    expectCharItemCount(after, RESOURCE_PLAYER, BILBO, 1);
    // Site is tapped upon resolution
    const afterPhase = after.phaseState as SitePhaseState;
    expect(afterPhase.resourcePlayed).toBe(true);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
  });
});
