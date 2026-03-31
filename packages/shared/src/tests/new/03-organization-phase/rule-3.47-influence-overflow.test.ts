/**
 * @module rule-3.47-influence-overflow
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.47: Influence Overflow at End of Org Phase
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If the total mind of a player's non-follower characters exceeds that player's general influence, the characters remain under that player's control until the end of that player's organization phase, at which point the player must immediately discard enough non-avatar characters so that their maximum general influence is not exceeded (which does not count as organizing). Those characters must first include any non-avatar characters that were brought into play this turn, and characters played this turn are returned to the player's hand instead of being discarded for this purpose. Then any non-avatar character must be discarded if it is not being controlled by general influence or direct influence (i.e. because it was removed from control of direct influence between organization phases). Finally that player may choose which other non-avatar characters to discard until their maximum general influence is no longer exceeded.
 */

import { describe, test } from 'vitest';

describe('Rule 3.47 — Influence Overflow at End of Org Phase', () => {
  test.todo('If GI exceeded at end of org phase, must discard characters; new characters first, then uncontrolled, then player choice');
});
