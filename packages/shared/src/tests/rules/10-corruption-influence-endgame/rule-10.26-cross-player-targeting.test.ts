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

// The default-deny half is architecturally guaranteed: `play-target` legal-
// action generation for resource cards only ever scans the playing player's
// own companies/characters unless a card explicitly opts into cross-player
// targeting (e.g. opponent-influence-attempt has its own dedicated action
// type and code path entirely, rather than reusing generic play-target).
// This is exercised implicitly by every own-side play-target test in the
// suite. "Opponent cards count as in-play for an active condition" and "a
// region must be in a site path in play to be targeted" don't have a
// dedicated generic check to isolate from the specific cards that already
// rely on them.
describe('Rule 10.26 — Cross-Player Targeting', () => {
  test.todo('Cannot target opponent resources/characters with own resources; opponent cards may count as in play for active conditions');
});
