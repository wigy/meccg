/**
 * @module rule-10.51-mp-general-rules
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.51: MP General Rules
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Players do not receive marshalling points from hazards that they themselves play, and do not receive kill points from cards that they themselves played.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, addToPile, recomputeDerived, resetMint,
  PLAYER_1, PLAYER_2, Phase,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId } from '../../../index.js';

// Smaug (tw-90) is the canonical manifestation creature with 5 kill MPs.
const SMAUG = 'tw-90' as CardDefinitionId;

describe('Rule 10.51 — MP General Rules', () => {
  beforeEach(() => resetMint());

  test('No kill points from own cards: creature owned by self gives 0 kill MPs; owned by opponent gives full kill MPs', () => {
    // Scenario: P1 (hazard player) plays Smaug. Its instanceId is prefixed with 'p1-'
    // so ownerOf(instanceId) === PLAYER_1.
    //
    // Case A: Smaug ends up in P1's kill pile (P1 "owns" Smaug that they played).
    //         → P1 gets 0 kill MPs (they played the card).
    //
    // Case B: Smaug ends up in P2's kill pile (P2 defeated P1's Smaug).
    //         ownerOf('p1-...') = PLAYER_1 ≠ PLAYER_2 → P2 gets 5 kill MPs.

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // Case A: P1's own Smaug in P1's kill pile
    const smaugOwnedByP1 = { instanceId: `${PLAYER_1 as string}-smaug` as CardInstanceId, definitionId: SMAUG };
    const caseA = recomputeDerived(addToPile(base, 0, 'killPile', smaugOwnedByP1));
    expect(caseA.players[0].marshallingPoints.kill).toBe(0);

    // Case B: P1's Smaug in P2's kill pile (P2 defeated it)
    const smaugOwnerIsP1 = { instanceId: `${PLAYER_1 as string}-smaug2` as CardInstanceId, definitionId: SMAUG };
    const caseB = recomputeDerived(addToPile(base, 1, 'killPile', smaugOwnerIsP1));
    expect(caseB.players[1].marshallingPoints.kill).toBe(5);
  });
});
