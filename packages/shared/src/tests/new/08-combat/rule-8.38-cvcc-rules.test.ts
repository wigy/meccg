/**
 * @module rule-8.38-cvcc-rules
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.38: Company vs Company Combat
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Company vs. Company Combat (CvCC) is considered a single attack with one strike for each member of the attacking company. During the attack, the attacking player can only play resources that affect a strike during a strike sequence; the defending (hazard) player may take resource/character actions even though it is not that player's turn, but only if the action has an effect that would cancel the attack OR that would affect a strike during a strike sequence. Strikes are assigned by the defending player assigning strikes to their own untapped characters, then the attacking player assigning strikes from their own remaining untapped characters, then the defending player assigning strikes to any of their own remaining characters.
 */

import { describe, test } from 'vitest';

describe('Rule 8.38 — Company vs Company Combat', () => {
  test.todo('CvCC: one strike per attacker; special strike assignment order; both players roll; attacking player limited to strike resources');
});
