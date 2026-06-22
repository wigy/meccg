/**
 * @module wh-117.test
 *
 * Card test: The Forge-master (wh-117)
 * Type: minion-resource-event (permanent), alignment "stage" (Fallen-wizard)
 * Keywords: saruman-specific
 *
 * Card text:
 *   "Unique. Saruman specific. Playable on a non-Hobbit sage character or a
 *    Man. +1 to his direct influence. The character requires 2 points of
 *    influence to control and may only be controlled by general influence or
 *    Saruman. If at a Wizardhaven [{H}] during your organization phase, you may
 *    tap this character to place a non-unique weapon/armor/shield/helmet minor
 *    item with any character at The Forge-master's site. The recipient need not
 *    tap to receive this item, and the item may be taken from your discard pile,
 *    sideboard, or hand."
 *
 * ⚠️ NOT CERTIFIED. This card describes two mechanics the engine does not
 * implement:
 *
 *   1. Control restriction — "requires 2 points of influence to control and may
 *      only be controlled by general influence or Saruman." There is no
 *      control-source restriction system in the engine; nothing constrains
 *      *which* influence source may control a character, and there is no effect
 *      type to express it.
 *   2. The item-placement tap ability — tap the host to place a non-unique
 *      weapon/armor/shield/helmet minor item (from the discard pile, sideboard,
 *      OR hand) onto any character at The Forge-master's site, with the
 *      recipient not tapping. No grant-action fetches an item from those zones
 *      and places it on a character; the only sideboard mechanic is the avatar's
 *      general organization-phase sideboard access.
 *
 * Additionally, the `stage-points` effect is only summed over `cardsInPlay`
 * (recompute-derived.ts); a character-attached stage card lives in the host's
 * `items`, so its 2 stage points are not currently tallied. That is an
 * engine-wide gap for character-attached stage resources, not specific to this
 * card.
 *
 * Effects table:
 * | # | Effect                                  | Status          | Notes                              |
 * |---|-----------------------------------------|-----------------|------------------------------------|
 * | 1 | stage-points value 2                    | PARTIAL         | not tallied when attached to a char|
 * | 2 | play-target character (non-Hobbit sage  | OK              | eligibility honored per-candidate  |
 * |   |   OR Man)                               |                 |                                    |
 * | 3 | stat-modifier direct-influence +1       | OK              | resolved on the bearer             |
 * | - | control restriction (2 inf / general or | NOT IMPLEMENTED | no control-source rule in engine   |
 * |   |   Saruman)                              |                 |                                    |
 * | - | tap to place w/a/s/h minor item from    | NOT IMPLEMENTED | no fetch-and-place grant-action    |
 * |   |   discard/sideboard/hand, no recipient  |                 |                                    |
 * |   |   tap                                   |                 |                                    |
 *
 * Playable: PARTIALLY (NOT CERTIFIED)
 *
 * The tests below exercise only the two fully-supported rules (play-target
 * eligibility and the +1 direct influence). The unimplemented mechanics are
 * recorded as `test.todo` so the spec stays honest.
 *
 * Fixtures:
 *   THE_FORGE_MASTER (wh-117)  — the card under test
 *   SARUMAN_FW (wh-9)          — Saruman, the Fallen-wizard avatar
 *   ISENGARD (wh-56)           — Wizardhaven (Fallen-wizard haven)
 *   WACHO (tw-187)             — Man, scout/sage  → eligible (Man and non-Hobbit sage)
 *   CELEBORN (tw-136)          — Elf, warrior/sage → eligible (non-Hobbit sage)
 *   EOWYN (tw-147)             — Man, warrior/scout → eligible (Man)
 *   BILBO (tw-131)             — Hobbit, scout/sage → NOT eligible (Hobbit)
 *   BOFUR (tw-132)             — Dwarf, warrior     → NOT eligible (not Man, not sage)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, MORIA, RIVENDELL,
  viableActions, findCharInstanceId, getCharacter,
  attachItemToChar, recomputeDerived,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayPermanentEventAction } from '../../index.js';
import { Alignment } from '../../index.js';

const THE_FORGE_MASTER = 'wh-117' as CardDefinitionId;
const SARUMAN_FW = 'wh-9' as CardDefinitionId;
const ISENGARD = 'wh-56' as CardDefinitionId;

// Eligible by the play-target filter
const WACHO = 'tw-187' as CardDefinitionId;    // Man, scout/sage
const CELEBORN = 'tw-136' as CardDefinitionId; // Elf, warrior/sage
const EOWYN = 'tw-147' as CardDefinitionId;    // Man, warrior/scout

// Ineligible
const BILBO = 'tw-131' as CardDefinitionId;    // Hobbit, scout/sage
const BOFUR = 'tw-132' as CardDefinitionId;    // Dwarf, warrior

describe('The Forge-master (wh-117)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: play-target — non-Hobbit sage OR Man ────────────────────────────

  test('offered only on non-Hobbit sages and Men', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [WACHO, CELEBORN, EOWYN, BILBO, BOFUR] }],
          hand: [THE_FORGE_MASTER],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [GANDALF] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = new Set(
      actions.map(a => (a.action as PlayPermanentEventAction).targetCharacterId),
    );

    // Eligible: Wacho (Man+sage), Celeborn (non-Hobbit sage), Éowyn (Man)
    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, WACHO))).toBe(true);
    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, CELEBORN))).toBe(true);
    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, EOWYN))).toBe(true);

    // Ineligible: Bilbo (Hobbit, even though a sage), Bofur (Dwarf warrior)
    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, BILBO))).toBe(false);
    expect(targetIds.has(findCharInstanceId(state, RESOURCE_PLAYER, BOFUR))).toBe(false);

    // Exactly the three eligible characters are offered.
    expect(actions).toHaveLength(3);
  });

  test('a Hobbit sage is never an eligible target', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [BILBO] }],
          hand: [THE_FORGE_MASTER],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [GANDALF] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('a non-sage non-Man (Dwarf warrior) is never an eligible target', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [BOFUR] }],
          hand: [THE_FORGE_MASTER],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [GANDALF] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ─── Rule: +1 to his direct influence ──────────────────────────────────────

  test('grants +1 direct influence to the host character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW, WACHO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [GANDALF] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const baseDI = getCharacter(base, RESOURCE_PLAYER, WACHO).effectiveStats.directInfluence;

    const withCard = recomputeDerived(
      attachItemToChar(base, RESOURCE_PLAYER, WACHO, THE_FORGE_MASTER),
    );
    const boostedDI = getCharacter(withCard, RESOURCE_PLAYER, WACHO).effectiveStats.directInfluence;

    expect(boostedDI).toBe(baseDI + 1);
  });

  // ─── Unimplemented mechanics (NOT CERTIFIED) ───────────────────────────────

  // "The character requires 2 points of influence to control and may only be
  // controlled by general influence or Saruman." No control-source restriction
  // exists in the engine.
  test.todo('control restriction: only general influence or Saruman may control the host');

  // "If at a Wizardhaven [{H}] during your organization phase, you may tap this
  // character to place a non-unique weapon/armor/shield/helmet minor item with
  // any character at The Forge-master's site ... taken from your discard pile,
  // sideboard, or hand; recipient need not tap." No fetch-and-place grant-action.
  test.todo('tap to place a w/a/s/h minor item from discard/sideboard/hand onto any character at the site');

  // The `stage-points` effect is only summed over cardsInPlay, so a
  // character-attached stage card's 2 points are not tallied today.
  test.todo('stage-points are tallied while the card is attached to a character');
});
