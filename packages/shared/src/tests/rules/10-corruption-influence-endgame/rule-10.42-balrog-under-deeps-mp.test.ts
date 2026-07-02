/**
 * @module rule-10.42-balrog-under-deeps-mp
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.42: Balrog Under-Deeps MP
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] Balrog players may include cards at Under-deeps sites when tallying their own marshalling points (both for the purpose of calling the end of the game and thereafter).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, Phase } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN,
} from '../../test-helpers.js';

// The Under-gates (dm-38): under-deeps, shadow-hold — see rule-meas-under-deeps-site.test.ts.
const THE_UNDER_GATES = 'dm-38' as CardDefinitionId;
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;
// Gorbag (le-11): minion character, marshallingPoints > 0.
const GORBAG = 'le-11' as CardDefinitionId;

describe('Rule 10.42 — Balrog Under-Deeps MP', () => {
  beforeEach(() => resetMint());

  test('[BALROG] Under-deeps company MPs count toward the callable total, unlike other alignments', () => {
    const balrogAtUnderDeeps = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GATES, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // Gorbag's character MPs are in the full tally...
    expect(balrogAtUnderDeeps.players[0].marshallingPoints.character).toBeGreaterThan(0);
    // ...and, unlike a Wizard/Ringwraith/Fallen-wizard player, also in the
    // callable total — a Balrog player is exempt from the Under-deeps exclusion.
    expect(balrogAtUnderDeeps.players[0].callableMarshallingPoints.character)
      .toBe(balrogAtUnderDeeps.players[0].marshallingPoints.character);
  });

  test('control: a non-Balrog (Ringwraith) player at the same Under-deeps site is still excluded', () => {
    const ringwraithAtUnderDeeps = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_UNDER_GATES, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    expect(ringwraithAtUnderDeeps.players[0].marshallingPoints.character).toBeGreaterThan(0);
    expect(ringwraithAtUnderDeeps.players[0].callableMarshallingPoints.character).toBe(0);
  });
});
