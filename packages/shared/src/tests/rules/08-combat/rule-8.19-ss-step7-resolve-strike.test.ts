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

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RESOURCE_PLAYER,
  makeDetainmentStrikeState,
  executeAction,
  resetMint,
  CardStatus,
} from '../../test-helpers.js';

describe('Rule 8.19 — Strike Step 7: Resolve the Strike', () => {
  beforeEach(() => resetMint());

  test('Compare roll to strike prowess: greater = fail (tap, body check on strike), less = succeed (wound, body check on character), equal = ineffectual (tap)', () => {
    // Aragorn prowess=6, strikeProwess=10.
    // roll+prowess compared to strikeProwess:
    // roll=5: total=11 > 10 → strike fails (character taps, body check vs creature)
    // roll=3: total=9  < 10 → strike succeeds (character wounded, body check vs character)
    // roll=4: total=10 = 10 → ineffectual (character taps, no body check)

    // Case 1: roll > strikeProwess → strike fails, character taps, body check queued vs creature
    const { state: failState, characterId } = makeDetainmentStrikeState({
      detainment: false,
      strikeProwess: 10,
      creatureBody: 5,
    });
    const afterFail = executeAction(failState, PLAYER_1, 'resolve-strike', 5, true);
    expect(afterFail.combat?.phase).toBe('body-check');
    expect(afterFail.combat?.bodyCheckTarget).toBe('creature');
    const charAfterFail = afterFail.players[RESOURCE_PLAYER].characters[characterId as string];
    expect(charAfterFail?.status).toBe(CardStatus.Tapped);

    // Case 2: roll < strikeProwess → character wounded, body check queued vs character
    const { state: woundState } = makeDetainmentStrikeState({
      detainment: false,
      strikeProwess: 10,
      creatureBody: 5,
    });
    const afterWound = executeAction(woundState, PLAYER_1, 'resolve-strike', 3, true);
    expect(afterWound.combat?.phase).toBe('body-check');
    expect(afterWound.combat?.bodyCheckTarget).toBe('character');

    // Case 3: roll = strikeProwess → ineffectual (tap, no wound, no body check vs character)
    // creatureBody=null → no creature body check, so combat finalizes immediately
    const { state: tieState, characterId: tieCharId } = makeDetainmentStrikeState({
      detainment: false,
      strikeProwess: 10,
      creatureBody: null,
    });
    const afterTie = executeAction(tieState, PLAYER_1, 'resolve-strike', 4, true);
    expect(afterTie.combat).toBeNull();
    const charAfterTie = afterTie.players[RESOURCE_PLAYER].characters[tieCharId as string];
    expect(charAfterTie?.status).toBe(CardStatus.Tapped);
  });
});
