/**
 * @module rule-10.16-fw-influence-alignment-match
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.16: Fallen-Wizard Influence Alignment Match
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] For a Fallen-wizard player to reveal a matching card as part of an influence attempt, the card must also match the alignment of the site where the influence attempt is declared.
 * [FALLEN-WIZARD] A matching manifestation may be revealed by a Fallen-wizard player as part of an influence attempt at a site where the influencing player cannot play cards that give marshalling points, but the revealed card cannot be played as the result of a successful influence attempt.
 */

import { describe, test } from 'vitest';

// This depends on rule 10.11's identical-card reveal mechanism, which does
// not yet gate on alignment at all (the `identicalInHand` lookups in
// `opponentInfluenceActions`, legal-actions/site.ts, match purely by card
// name, with no `player.alignment === 'fallen-wizard'` check comparable to
// `siteTapCrossAlignmentBlocked`'s resource-play guard). Implementing this
// means threading the same alignment-match logic through the influence-reveal
// path, plus a distinct "manifestation revealed but unplayable" carve-out —
// real engine work with no reachable card to test against in the meantime.
describe('Rule 10.16 — Fallen-Wizard Influence Alignment Match', () => {
  test.todo('[FALLEN-WIZARD] Revealed card must match site alignment; manifestation may be revealed at non-MP site but cannot be played');
});
