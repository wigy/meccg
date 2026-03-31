/**
 * @module rule-10.26-cross-player-targeting
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.26: Cross-Player Targeting
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A player cannot target their opponent's resources or characters with their own resources (unless the targeting effect specifies otherwise), but an opponent's resource or character may count as being "in play" for an active condition of a player's own resource.
 * A region must be "in play" (i.e. in a site path of a company or site in play) to be targeted.
 * A hero resource event cannot target nor affect a minion resource or site, and a minion resource event cannot target nor affect a hero resource or site.
 */

import { describe, test } from 'vitest';

describe('Rule 10.26 — Cross-Player Targeting', () => {
  test.todo('Cannot target opponent resources/characters with own resources; opponent cards may count as in play for active conditions');
});
