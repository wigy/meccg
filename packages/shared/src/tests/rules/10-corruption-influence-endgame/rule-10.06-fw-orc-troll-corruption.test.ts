/**
 * @module rule-10.06-fw-orc-troll-corruption
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.06: Fallen-Wizard Orc/Troll Corruption
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player treats their Orc and/or Troll characters as minion characters when determining the results of a corruption check.
 */

import { describe, test, beforeEach, expect } from 'vitest';
import { Alignment, CardStatus } from '../../../index.js';
import type { CardDefinitionId, CardInstanceId, FreeCouncilPhaseState } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH, MORIA,
  findCharInstanceId, expectCharInPlay, expectCharStatus,
} from '../../test-helpers.js';

const ALATAR_FW = 'wh-1' as CardDefinitionId; // Fallen-wizard avatar (filler, keeps company non-empty)
const GORBAG = 'le-11' as CardDefinitionId;    // minion Orc character
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId; // minion item, CP 4

describe('Rule 10.06 — Fallen-Wizard Orc/Troll Corruption', () => {
  beforeEach(() => resetMint());

  test('[FALLEN-WIZARD] an Orc character taps (does not fail) on a roll of CP-1', () => {
    // A Fallen-wizard's Orc is treated as a minion: a roll equal to or one less
    // than its CP taps it and the check is considered successful, instead of
    // discarding it the way a hero character would be.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [ALATAR_FW, { defId: GORBAG, items: [LEAST_OF_GOLD_RINGS] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const gorbagId = findCharInstanceId(base, RESOURCE_PLAYER, GORBAG);
    // The resolver reads CP from live state: Gorbag bears the ring (CP 4).
    expect(base.players[RESOURCE_PLAYER].characters[gorbagId].effectiveStats.corruptionPoints).toBe(4);

    const pendingCheck = {
      characterId: gorbagId,
      corruptionPoints: 4,
      corruptionModifier: 0,
      possessions: [] as CardInstanceId[],
      need: 5,
      explanation: 'CP 4, modifier 0',
      supportCount: 0,
    };
    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck,
    };

    // Roll 3 == CP-1 → minion tap (success): the Orc stays in play, now tapped.
    const after = dispatch({ ...base, cheatRollTotal: 3, phaseState: fcState }, { type: 'pass', player: PLAYER_1 });
    expectCharInPlay(after, RESOURCE_PLAYER, gorbagId);
    expectCharStatus(after, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);
  });
});
