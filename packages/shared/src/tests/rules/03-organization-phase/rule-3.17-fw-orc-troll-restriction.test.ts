/**
 * @module rule-3.17-fw-orc-troll-restriction
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.17: Fallen-Wizard Orc/Troll Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player cannot play Orc or Troll characters unless they have a Stage resource in play that specifically allows them to play Orc or Troll characters.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../test-helpers.js';
import {
  buildTestState, resetMint, addCardInPlay, recomputeDerived,
  viablePlayCharacterActions,
  Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL,
} from '../../test-helpers.js';

// Orc Captain (le-31): race Orc, mind 5, non-avatar, non-unique.
// Single-test use → inline.
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
// Bad Company (wh-63): FW Stage resource permanent-event that grants
// "allow-character-play" for Orc/Troll characters.
const BAD_COMPANY = 'wh-63' as CardDefinitionId;

describe('Rule 3.17 — Fallen-Wizard Orc/Troll Restriction', () => {
  beforeEach(() => resetMint());

  test('[FALLEN-WIZARD] Cannot play an Orc character without a Stage resource allowing it', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          hand: [ORC_CAPTAIN],
          siteDeck: [RIVENDELL],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
  });

  test('[FALLEN-WIZARD] May play an Orc character with Bad Company in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          hand: [ORC_CAPTAIN],
          siteDeck: [RIVENDELL],
          companies: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
    });
    const state = recomputeDerived(addCardInPlay(built, 0, BAD_COMPANY));

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBeGreaterThan(0);
  });
});
