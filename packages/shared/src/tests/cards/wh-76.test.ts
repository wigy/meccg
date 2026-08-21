/**
 * @module wh-76.test
 *
 * Card test: Legacy of Smiths (wh-76)
 * Type: minion-resource-event (Fallen-wizard stage resource permanent-event),
 *       alignment "stage".
 *
 * Printed text:
 *   "Playable if you have more than 6 stage points. Your non-ring items are each
 *    worth full marshalling points. Cannot be duplicated by a given player."
 *
 * Card shape (data):
 *   - Stage resource permanent-event (`alignment: 'stage'`, `eventType:
 *     'permanent'`); worth 0 MP (misc) and contributes 4 stage points.
 *   - effects:
 *     1. stage-points (value 4) — its own stage-point contribution.
 *     2. play-condition player-state — "Playable if you have more than 6 stage
 *        points" (`player.stagePoints > 6`), gating the play-permanent-event
 *        legal action.
 *     3. fw-mp-full (cards: items) — filter `$not keywords $includes "ring"` (player-wide,
 *        NOT company-restricted). Lifts the MEWH §4 1-MP clamp to full printed
 *        MP for every non-ring item the Fallen-wizard controls.
 *     4. duplication-limit (scope player, max 1) — "Cannot be duplicated by a
 *        given player".
 *
 * Background: MEWH §4 clamps every non-stage card a Fallen-wizard controls to a
 * flat 1 MP. Legacy of Smiths exempts the player's non-ring items so they score
 * full printed MP again; ring items (`ring` keyword) stay clamped. These tests
 * drive the recompute / legal-action pipeline; the card shape is documented here
 * rather than asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions,
  attachItemToChar, addCardInPlay, recomputeDerived,
  makePlayDeck,
  RESOURCE_PLAYER,
  ARAGORN,
  ISENGARD, RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const LEGACY_OF_SMITHS = 'wh-76'  as CardDefinitionId; // the card under test
const PALLANDO_FW      = 'wh-7'   as CardDefinitionId; // a Fallen-wizard avatar (no MP-exemption effects of its own)
const WEAPON_ITEM      = 'tw-244' as CardDefinitionId; // Glamdring: non-ring weapon, printed MP 2
const RING_ITEM        = 'tw-271' as CardDefinitionId; // Magic Ring of Courage: ring, printed MP 3

/** A Fallen-wizard (player 0) at Isengard with Pallando + Aragorn, idle opponent. */
function fwState() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: [PALLANDO_FW, ARAGORN] }],
        hand: [],
        siteDeck: [MORIA],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [] }],
        hand: [],
        siteDeck: [LORIEN],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

describe('Legacy of Smiths (wh-76)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: non-ring items are worth full marshalling points ────────────────

  test('a non-ring item scores full printed MP (2) while Legacy of Smiths is in play', () => {
    // MEWH §4 would clamp Glamdring (printed 2) to 1; Legacy of Smiths exempts
    // it because it carries no `ring` keyword.
    let state = fwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, WEAPON_ITEM);
    state = addCardInPlay(state, RESOURCE_PLAYER, LEGACY_OF_SMITHS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });

  test('control: without Legacy of Smiths the same non-ring item is §4-clamped to 1', () => {
    let state = fwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, WEAPON_ITEM);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  // ─── Rule: ring items are NOT exempted (stay clamped) ──────────────────────

  test('a ring item stays clamped to 1 even with Legacy of Smiths (filter excludes rings)', () => {
    // Magic Ring of Courage (printed 3, `ring` keyword) is not a "non-ring item",
    // so it remains under the §4 1-MP clamp.
    let state = fwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, RING_ITEM);
    state = addCardInPlay(state, RESOURCE_PLAYER, LEGACY_OF_SMITHS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  test('mixed: only the non-ring item is exempted (weapon 2 + ring clamped 1 = 3)', () => {
    let state = fwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, WEAPON_ITEM); // non-ring, → 2
    state = attachItemToChar(state, RESOURCE_PLAYER, PALLANDO_FW, RING_ITEM); // ring, → 1
    state = addCardInPlay(state, RESOURCE_PLAYER, LEGACY_OF_SMITHS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(3);
  });

  // ─── Rule: only a Fallen-wizard is affected ────────────────────────────────

  test('a non-Fallen-wizard player scores printed MP normally (exemption is a no-op)', () => {
    // A Wizard already scores full printed MP; the §4 exemption must never act as
    // a cap and the stage card is inert for a non-FW player.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, WEAPON_ITEM); // 2
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, RING_ITEM);   // 3
    state = addCardInPlay(state, RESOURCE_PLAYER, LEGACY_OF_SMITHS);
    state = recomputeDerived(state);

    // Hero scores full printed MP for both: 2 + 3 = 5.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(5);
  });

  // ─── Rule: stage points (4) while in play ──────────────────────────────────

  test('Legacy of Smiths contributes 4 stage points to its Fallen-wizard controller', () => {
    let state = fwState();
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    state = addCardInPlay(state, RESOURCE_PLAYER, LEGACY_OF_SMITHS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(4);
  });

  // ─── Rule: playable only with MORE than 6 stage points ─────────────────────

  test('play-permanent-event offered when the FW has more than 6 stage points', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 7,
          companies: [{ site: ISENGARD, characters: [PALLANDO_FW] }],
          hand: [LEGACY_OF_SMITHS],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(1);
  });

  test('play-permanent-event NOT offered at exactly 6 stage points (needs MORE than 6)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 6,
          companies: [{ site: ISENGARD, characters: [PALLANDO_FW] }],
          hand: [LEGACY_OF_SMITHS],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule: cannot be duplicated by a given player ──────────────────────────

  test('a second copy is not playable while one is already in play (player duplication limit)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 7,
          companies: [{ site: ISENGARD, characters: [PALLANDO_FW] }],
          hand: [LEGACY_OF_SMITHS],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // One copy already in play for this player.
    state = addCardInPlay(state, RESOURCE_PLAYER, LEGACY_OF_SMITHS);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(0);
  });
});
