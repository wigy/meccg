/**
 * @module wh-7.test
 *
 * Card test: Pallando (wh-7)
 * Type: hero-character (Fallen-wizard avatar)
 *
 * Printed text:
 *   "Unique. Can use spirit-magic. Your Man, Dwarf, Elf, Dúnadan, Hobbit, Orc,
 *    and Troll factions are each worth 2 marshalling points. You may keep one
 *    more card than normal in your hand."
 *
 * Card shape (data):
 *   - Fallen-wizard avatar; `race: 'fallen-wizard'`; `skills` includes
 *     `spirit-magic` ("Can use spirit-magic").
 *   - effects:
 *     1. faction-mp-override — while Pallando is in play, the player's Man,
 *        Dwarf, Elf, Dúnadan, Hobbit, Orc and Troll factions are each worth 2
 *        marshalling points, replacing both their printed MP and the MEWH §4
 *        flat-1 Fallen-wizard clamp. (Carried by the character, so the override
 *        collection must scan the player's in-play characters, not just
 *        `cardsInPlay`.)
 *     2. hand-size-modifier (+1) — "You may keep one more card than normal in
 *        your hand."
 *
 * These tests drive the recompute / hand-size pipeline; the card shape is
 * documented above rather than asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  addCardInPlay, recomputeDerived,
  ISENGARD, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { HAND_SIZE } from '../../constants.js';
import { resolveHandSize } from '../../engine/effects/index.js';

// ─── Local card-ID constants ───────────────────────────────────────────────
const PALLANDO_FW = 'wh-7' as CardDefinitionId; // the card under test
const SARUMAN_FW  = 'wh-9' as CardDefinitionId; // a different FW avatar (no faction override)

// One unique faction per named race (printed MP in parentheses). The MEWH §4
// clamp would reduce each to a flat 1 MP for a Fallen-wizard; Pallando's rule
// re-values every one of these to 2.
const MEN_OF_DALE    = 'td-138' as CardDefinitionId; // man    (2)
const PETTY_DWARVES  = 'as-61'  as CardDefinitionId; // dwarf  (2)
const WOOD_ELVES     = 'tw-367' as CardDefinitionId; // elf    (3)
const RANGERS_NORTH  = 'tw-311' as CardDefinitionId; // dúnadan(3)
const HOBBITS        = 'tw-258' as CardDefinitionId; // hobbit (1)
const ORCS_OF_MORIA  = 'le-278' as CardDefinitionId; // orc    (3)
const BLACK_TROLLS   = 'le-262' as CardDefinitionId; // troll  (1)
// A faction whose race is NOT in Pallando's list — stays FW-clamped.
const GREAT_EAGLES   = 'tw-344' as CardDefinitionId; // eagle  (3)

/** A Fallen-wizard (player 0) at Isengard with `avatar`, plus an idle opponent. */
function fwState(avatar: CardDefinitionId) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: [avatar] }],
        hand: [],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
    ],
  });
}

describe('Pallando (wh-7)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: Man/Dwarf/Elf/Dúnadan/Hobbit/Orc/Troll factions worth 2 MP ─────

  test('each named-race faction is re-valued to 2 MP while Pallando is in play', () => {
    // Seven factions, one per named race. Without Pallando each would be
    // FW-clamped to 1 (total 7); with Pallando each is 2 (total 14).
    let state = fwState(PALLANDO_FW);
    for (const f of [MEN_OF_DALE, PETTY_DWARVES, WOOD_ELVES, RANGERS_NORTH, HOBBITS, ORCS_OF_MORIA, BLACK_TROLLS]) {
      state = addCardInPlay(state, RESOURCE_PLAYER, f);
    }
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(14);
  });

  test('a single high-MP faction (Wood-elves, printed 3) is overridden DOWN to 2', () => {
    // Confirms the override replaces the printed value and the §4 clamp both:
    // 3 (printed) → 2 (override), not 1 (clamp).
    let state = fwState(PALLANDO_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, WOOD_ELVES);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  test('a faction of an unlisted race (Great Eagles / eagle) is NOT overridden', () => {
    // Eagle is not one of Pallando's named races → the override rule does not
    // match, so the faction scores normally: FW §4 clamp → 1, not 2.
    let state = fwState(PALLANDO_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, GREAT_EAGLES);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  test('control: without Pallando the same named-race faction is FW-clamped to 1', () => {
    // Saruman (a Fallen-wizard avatar with no faction-MP override) controls the
    // Man faction: MEWH §4 clamps it to 1, proving the re-valuation comes from
    // Pallando's character-carried effect specifically.
    let state = fwState(SARUMAN_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, MEN_OF_DALE);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  // ─── Rule: keep one more card than normal in hand ────────────────────────

  test('hand size is one larger than normal while Pallando is in play', () => {
    const state = fwState(PALLANDO_FW);

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
    // The opponent (no Pallando) keeps the base hand size.
    expect(resolveHandSize(state, 1)).toBe(HAND_SIZE);
  });

  test('control: without Pallando the hand size is the base size', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE);
  });
});
