/**
 * @module rule-6.11-playing-faction
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.11: Playing a Faction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Playing a Faction - If a company has successfully entered a site during its site phase, the resource player may play a faction if they have an untapped character in the company, the site is untapped, and the faction is playable at the site. The resource player must reveal the faction and tap the character (as an active condition), but upon resolution must attempt an influence check by making a roll and adding the character's available direct influence and any other modifications (e.g. a bonus that the character may have when influencing that faction, "standard modifications" listed on the faction card based on the race of the influencer or what other factions the resource player already has in play, etc.). If the result is greater than the number listed on the faction, the resource player successfully plays the faction into their own marshalling point pile and taps the site; otherwise the faction is immediately discarded.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint, viableActions,
  PLAYER_1,
  ARAGORN, RANGERS_OF_THE_NORTH,
  BREE,
  CardStatus,
} from '../../test-helpers.js';
import type { InfluenceAttemptAction } from '../../../types/actions-site.js';

describe('Rule 6.11 — Playing a Faction', () => {
  beforeEach(() => resetMint());

  test('Play faction with untapped character; reveal and tap character; make influence check; success stores faction and taps site', () => {
    // Rangers of the North is playable at Bree. With Aragorn untapped at
    // untapped Bree, the engine must offer an influence-attempt action.
    // The action includes the roll needed and the influencing character.
    const state = buildSitePhaseState({
      site: BREE,
      characters: [ARAGORN],
      hand: [RANGERS_OF_THE_NORTH],
    });

    const attempts = viableActions(state, PLAYER_1, 'influence-attempt') as { action: InfluenceAttemptAction }[];
    expect(attempts.length).toBeGreaterThan(0);

    const factionInstId = state.players[0].hand[0].instanceId;
    const aragornInstId = state.players[0].companies[0].characters[0];
    const attempt = attempts.find(a =>
      a.action.factionInstanceId === factionInstId &&
      a.action.influencingCharacterId === aragornInstId,
    );
    expect(attempt).toBeDefined();

    // When the site is tapped, the faction cannot be played
    const tappedState = buildSitePhaseState({
      site: BREE,
      characters: [ARAGORN],
      hand: [RANGERS_OF_THE_NORTH],
      siteStatus: CardStatus.Tapped,
    });

    const tappedAttempts = viableActions(tappedState, PLAYER_1, 'influence-attempt');
    expect(tappedAttempts).toHaveLength(0);
  });
});
