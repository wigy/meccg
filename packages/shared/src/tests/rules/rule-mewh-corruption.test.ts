/**
 * MEWH §6 — Corruption checks for Fallen-wizards (and the base minion rule).
 *
 * Source: The White Hand Insert, "Corruption Checks" + CoE 7.1 / 7.1.F1.
 *
 * - "Corruption checks for a Fallen-wizard are handled as if he were a minion
 *   character. That is, if the roll ... is equal to a Fallen-wizard's corruption
 *   point total or one less, he is tapped instead of being discarded. He is not
 *   considered to fail."
 * - "Corruption checks for a Fallen-wizard's non-Orc and non-Troll character are
 *   handled as if the player were a Wizard." (i.e. hero rules — discarded.)
 * - CoE 7.1: "a minion character or Fallen-wizard avatar taps and the corruption
 *   check is considered successful." This base rule was previously unimplemented
 *   (minions were wrongly discarded), so a Ringwraith regression guards it.
 *
 * Exercised through the Free Council corruption-check dispatch path, mirroring
 * rule-10.01.
 */
import { describe, test, beforeEach } from 'vitest';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, FreeCouncilPhaseState } from '../../index.js';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH, MORIA,
  findCharInstanceId, charIdAt, expectCharInPlay, expectCharNotInPlay,
  expectCharStatus, expectInDiscardPile,
} from '../test-helpers.js';

const ALATAR_FW = 'wh-1' as CardDefinitionId; // Fallen-wizard avatar (mind null)
const ASTERNAK = 'le-1' as CardDefinitionId;  // minion-character, race Man

// CP 5 has to come from a real borne item: the resolver reads the checked
// character's corruption point total from live state, not from the snapshot
// stored in `pendingCheck`.
const IRON_CROWN_HERO = 'tw-496' as CardDefinitionId;    // hero item, CP 5
const IRON_CROWN_MINION = 'le-314' as CardDefinitionId;  // minion item, CP 5

/** Build a Free Council corruption-check state for `checkedId`, whose CP is 5. */
function fcCheck(base: ReturnType<typeof buildTestState>, checkedId: CardInstanceId, roll: number) {
  const pendingCheck = {
    characterId: checkedId,
    corruptionPoints: 5,
    corruptionModifier: 0,
    possessions: [] as CardInstanceId[],
    need: 6,
    explanation: 'CP 5, modifier 0',
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
  return dispatch({ ...base, cheatRollTotal: roll, phaseState: fcState }, { type: 'pass', player: PLAYER_1 });
}

describe('MEWH §6 — Fallen-wizard corruption checks', () => {
  beforeEach(() => resetMint());

  test('the Fallen-wizard avatar taps (not eliminated/discarded) on a soft-fail roll', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [{ defId: ALATAR_FW, items: [IRON_CROWN_HERO] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const alatarId = charIdAt(base, RESOURCE_PLAYER);
    const after = fcCheck(base, alatarId, 5); // 5 == CP → tap, success
    expectCharInPlay(after, RESOURCE_PLAYER, alatarId);
    expectCharStatus(after, RESOURCE_PLAYER, ALATAR_FW, CardStatus.Tapped);
  });

  test("a Fallen-wizard's non-Orc/Troll character is discarded (treated as a hero) on a soft-fail roll", () => {
    // Asternak is a minion-character Man; controlled by a Fallen-wizard he is
    // treated as a hero, so a roll of CP-1 discards him (not taps). The avatar
    // keeps the company non-empty.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [ALATAR_FW, { defId: ASTERNAK, items: [IRON_CROWN_HERO] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const asternakId = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    const after = fcCheck(base, asternakId, 4); // 4 == CP-1 → hero discard
    expectCharNotInPlay(after, RESOURCE_PLAYER, asternakId);
    expectInDiscardPile(after, RESOURCE_PLAYER, asternakId);
  });

  test('base rule: a minion character taps (not discarded) on a soft-fail roll', () => {
    // Regression for CoE 7.1: a Ringwraith player's minion character taps on a
    // roll of CP-1 and the check is considered successful.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: RIVENDELL, characters: [{ defId: ASTERNAK, items: [IRON_CROWN_MINION] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const asternakId = charIdAt(base, RESOURCE_PLAYER);
    const after = fcCheck(base, asternakId, 4); // 4 == CP-1 → minion tap, success
    expectCharInPlay(after, RESOURCE_PLAYER, asternakId);
    expectCharStatus(after, RESOURCE_PLAYER, ASTERNAK, CardStatus.Tapped);
  });
});
