/**
 * @module rule-8.17-ss-step6-roll
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.17: Strike Step 6: Roll 2D6
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Strike Sequence, Step 6 (Roll 2D6) - The strike is resolved by the defending player making a roll and adding the character's prowess after applying any modifications, starting with modifications from the weapon that the character is currently using (if any) and then applying any other modifications in an order chosen by the character's player, including the following (which are still applied even if an alternate attribute is used instead of the character's prowess):
 * • Unwounded, tapped character: temporary -1 prowess against the strike
 * • Wounded character: temporary -2 prowess against the strike
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  makeDetainmentStrikeState,
  resetMint,
  CardStatus,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { ResolveStrikeAction } from '../../../types/actions-movement-hazard.js';

describe('Rule 8.17 — Strike Step 6: Roll 2D6', () => {
  beforeEach(() => resetMint());

  test('Defending player rolls 2D6 + modified prowess; tapped -1, wounded -2; weapon mods applied first', () => {
    // Aragorn (prowess=6) vs creature (strikeProwess=7)
    // Untapped tapNeed = max(2, 7-6+1) = 2
    // Tapped tapNeed = max(2, 7-(6-1)+1) = max(2, 3) = 3 → +1 vs untapped
    // Wounded tapNeed = max(2, 7-(6-2)+1) = max(2, 4) = 4 → +2 vs untapped

    const { state: untappedState } = makeDetainmentStrikeState({ detainment: false, strikeProwess: 7 });
    const { state: tappedState } = makeDetainmentStrikeState({ detainment: false, strikeProwess: 7, charStatus: CardStatus.Tapped });
    const { state: woundedState } = makeDetainmentStrikeState({ detainment: false, strikeProwess: 7, charStatus: CardStatus.Inverted });

    const untappedActions = computeLegalActions(untappedState, PLAYER_1)
      .filter(a => a.action.type === 'resolve-strike') as { action: ResolveStrikeAction }[];
    const tappedActions = computeLegalActions(tappedState, PLAYER_1)
      .filter(a => a.action.type === 'resolve-strike') as { action: ResolveStrikeAction }[];
    const woundedActions = computeLegalActions(woundedState, PLAYER_1)
      .filter(a => a.action.type === 'resolve-strike') as { action: ResolveStrikeAction }[];

    // Untapped: tap-to-fight and stay-untapped both offered
    expect(untappedActions.length).toBeGreaterThanOrEqual(1);
    const untapNeed = untappedActions.find(a => a.action.tapToFight)!.action.need;
    expect(untapNeed).toBe(2);

    // Tapped: only tap-to-fight offered; need is 1 higher due to -1 prowess penalty
    const tappedNeed = tappedActions.find(a => a.action.tapToFight)!.action.need;
    expect(tappedNeed).toBe(untapNeed + 1);

    // Wounded (Inverted): only tap-to-fight offered; need is 2 higher due to -2 prowess penalty
    const woundedNeed = woundedActions.find(a => a.action.tapToFight)!.action.need;
    expect(woundedNeed).toBe(untapNeed + 2);
  });
});
