/**
 * @module rule-8.19-ss-step7-resolve-strike
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.19: Strike Step 7: Resolve the Strike
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Strike Sequence, Step 7 (Resolve the Strike) - The result of the character's modified roll is compared to the strike's modified prowess:
 * • If the character's modified roll is greater than the modified strike, the strike fails. The character facing the strike is tapped (unless a -3 modification was applied in Step 3), any passive condition actions of the strike failing are resolved immediately in an order chosen by the defending player, and then the defending player initiates a body check against the strike as the first declared action in a chain of effects that follows. The strike is defeated if that body check fails; if the strike doesn't have any body, it is automatically defeated without a body check.
 * • If the character's modified roll is less than the modified strike, the strike is successful. The defending character is immediately wounded (which is considered synonymous with the strike succeeding), any passive condition actions of the strike succeeding are resolved immediately in an order chosen by the defending player, and then the hazard player initiates a body check against the character as the first declared action in a chain of effects that follows.
 * • If the character's modified roll is equal to the modified strike, the strike is ineffectual (i.e. the strike is not defeated). The character facing the strike is tapped (unless a -3 modification was applied in Step 3).
 */

import { describe, test } from 'vitest';

describe('Rule 8.19 — Strike Step 7: Resolve the Strike', () => {
  test.todo('Compare roll to strike prowess: greater = fail (tap, body check on strike), less = succeed (wound, body check on character), equal = ineffectual (tap)');
});
