/**
 * @module rule-10.13-influence-success-play
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.13: Playing Card After Successful Influence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If an influence attempt is successful after an identical card was revealed from the resource player's hand, that player may immediately play the identical card with the influencing character (without tapping the site and without another influence check required) if there are no other restrictions that would prohibit the play of the card. If the identical card is a character, it can only be played under general or direct influence with enough available influence to control the character, but playability restrictions on the character card itself are not applied (i.e. a Hobbit may be played in this way). If an influence attempt fails after an identical card was revealed, the identical card is discarded.
 */

import { describe, test } from 'vitest';

// Rule 10.11's reveal variant records `revealedCardInstanceId` on the
// declared action, but the influence-attempt resolver (reducer-site.ts,
// ~line 2085) never reads it back on success: a successful attempt just
// brings the target under control/into play, and a failed one discards the
// revealed card is not specially handled either. Offering the immediate
// "play the revealed card via the influencing character, no site tap, no
// second roll" follow-up needs a new pending-resolution step wired into
// that success path — a real feature, not something a test alone can
// surface, and it depends on rule 10.11's own item-targeting gap above for
// full coverage.
describe('Rule 10.13 — Playing Card After Successful Influence', () => {
  test.todo('After successful influence with revealed card, may play identical card with influencing character; character playability rules relaxed');
});
