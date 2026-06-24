/**
 * @module rule-3.09-fw-avatar-play
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.09: Fallen-Wizard Avatar Play
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard avatar can only be played at the avatar's home site.
 * [FALLEN-WIZARD] Whenever a Fallen-wizard avatar is played, its player's general influence immediately becomes the number in the white hand on the left side of the avatar card for as long as the avatar is in play.
 * [FALLEN-WIZARD] When a Fallen-wizard player plays a Fallen-wizard avatar, any of their opponent's Stage resource permanent-events in play that are specific to that avatar are immediately discarded.
 */

import { describe, test, expect } from 'vitest';
import {
  buildTestState,
  effectiveGeneralInfluence,
  Phase,
  Alignment,
  PLAYER_1,
  PLAYER_2,
  ISENGARD,
  ARAGORN,
  RIVENDELL,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';

// Fallen-wizard avatars carry their general influence as the white-hand value
// printed on the card (data field `generalInfluence`). Single-test use → inline.
const SARUMAN_FW = 'wh-9' as CardDefinitionId; // home Isengard, white-hand GI 15
const ALATAR_FW = 'wh-1' as CardDefinitionId; //  white-hand GI 17
const RADAGAST_FW = 'wh-8' as CardDefinitionId; // white-hand GI 22

/** Build a state with a single Fallen-wizard company holding `chars` at Isengard. */
function fwState(chars: CardDefinitionId[]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: chars }],
        hand: [],
        siteDeck: [ISENGARD],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Rule 3.09 — Fallen-Wizard Avatar Play', () => {
  describe('[FALLEN-WIZARD] avatar fixes general influence to its white-hand value while in play', () => {
    test('Saruman in play → GI pool is 15 (not the default 20)', () => {
      const state = fwState([SARUMAN_FW]);
      expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(15);
    });

    test('different avatars carry different white-hand values (Alatar 17, Radagast 22)', () => {
      expect(effectiveGeneralInfluence(fwState([ALATAR_FW]), PLAYER_1)).toBe(17);
      expect(effectiveGeneralInfluence(fwState([RADAGAST_FW]), PLAYER_1)).toBe(22);
    });

    test('before the avatar is revealed, the Fallen-wizard has the default 20', () => {
      // A Fallen-wizard company without its avatar in play (pre-reveal) keeps
      // the standard pool. CRF-22: "Prior to that, his general influence is 20."
      const state = fwState([ARAGORN]); // non-avatar character only
      expect(effectiveGeneralInfluence(state, PLAYER_1)).toBe(20);
    });

    test('the white-hand value reduces how much mind can be controlled under GI', () => {
      // Saruman (GI 15) + Aragorn II (mind 9) under general influence: 9 of 15
      // used, 6 free — versus 11 free if the pool were the default 20.
      const state = fwState([SARUMAN_FW, ARAGORN]);
      const free = effectiveGeneralInfluence(state, PLAYER_1) - state.players[0].generalInfluenceUsed;
      expect(state.players[0].generalInfluenceUsed).toBe(9);
      expect(free).toBe(6);
    });
  });

  test.todo('[FALLEN-WIZARD] Avatar can only be played at its home site');
  test.todo('[FALLEN-WIZARD] Playing the avatar discards opponent Stage resources specific to that avatar');
});
