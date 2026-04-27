/**
 * @module rule-8.13-ss-step2-excess-strikes
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.13: Strike Step 2: Allocating Excess Strikes
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Strike Sequence, Step 2 (Allocating Excess Strikes) - The player who is not being attacked may allocate any not-yet-allocated excess strikes of the attack as temporary -1 modifications to the prowess of the character facing the strike. If the strike being resolved is the last strike to be resolved from the attack, all not-yet-allocated excess strikes must be applied.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  makeDetainmentStrikeState,
  resetMint,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { ResolveStrikeAction } from '../../../types/actions-movement-hazard.js';

describe('Rule 8.13 — Strike Step 2: Allocating Excess Strikes', () => {
  beforeEach(() => resetMint());

  test('Non-defending player allocates excess strikes as -1 prowess; must allocate all if last strike', () => {
    // Aragorn (prowess=6) vs creature (strikeProwess=7).
    // No excess: tapNeed = max(2, 7-6+1) = 2
    // 2 excess: effective prowess = 6-2 = 4, tapNeed = max(2, 7-4+1) = 4 → +2 vs no-excess

    const { state: baseState } = makeDetainmentStrikeState({ detainment: false, strikeProwess: 7 });

    const stateWithExcess = {
      ...baseState,
      combat: {
        ...baseState.combat!,
        strikeAssignments: [
          { ...baseState.combat!.strikeAssignments[0], excessStrikes: 2 },
        ],
      },
    };

    const baseNeed = (computeLegalActions(baseState, PLAYER_1)
      .filter(a => a.action.type === 'resolve-strike') as { action: ResolveStrikeAction }[])
      .find(a => a.action.tapToFight)!.action.need;

    const excessNeed = (computeLegalActions(stateWithExcess, PLAYER_1)
      .filter(a => a.action.type === 'resolve-strike') as { action: ResolveStrikeAction }[])
      .find(a => a.action.tapToFight)!.action.need;

    expect(excessNeed).toBe(baseNeed + 2);
  });
});
