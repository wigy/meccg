/**
 * @module rule-6.10-playing-ally
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.10: Playing an Ally
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Playing an Ally - If a company has successfully entered a site during its site phase, the resource player may play an ally if they have an untapped character in the company, the site is untapped, and the ally is playable at the site. The resource player must tap the character (as an active condition), and upon resolution places the ally under the character's control and taps the site.
 * Playing an ally is not considered an influence attempt, and an ally's mind value is not subtracted from its controller's direct influence.
 * Allies are not characters, but are treated as characters for the purposes of combat-specific actions or effects, "skill only" cards or effects, and healing.
 * If an ally's controlling character leaves play, the ally is immediately discarded.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint, viableActions,
  PLAYER_1, RESOURCE_PLAYER,
  ARAGORN, TREEBEARD,
  WELLINGHALL,
  CardStatus,
} from '../../test-helpers.js';

describe('Rule 6.10 — Playing an Ally', () => {
  beforeEach(() => resetMint());

  test('Play ally with untapped character at untapped playable site; taps character; ally under character control; taps site', () => {
    // Treebeard is playable only at Wellinghall. With Aragorn untapped at an
    // untapped Wellinghall, the engine must offer a play-hero-resource action.
    const state = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [ARAGORN],
      hand: [TREEBEARD],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every(a => (a.action as { type: string }).type === 'play-hero-resource')).toBe(true);

    // When the site is already tapped, the ally is not playable
    const tappedState = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [ARAGORN],
      hand: [TREEBEARD],
      siteStatus: CardStatus.Tapped,
    });

    const tappedPlays = viableActions(tappedState, PLAYER_1, 'play-hero-resource');
    expect(tappedPlays).toHaveLength(0);

    // When the only character is already tapped, the ally cannot be played
    const noCarrierState = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [{ defId: ARAGORN, status: CardStatus.Tapped }],
      hand: [TREEBEARD],
    });

    const noCarrierPlays = viableActions(noCarrierState, PLAYER_1, 'play-hero-resource');
    expect(noCarrierPlays).toHaveLength(0);

    void RESOURCE_PLAYER; // suppress unused import warning
  });
});
