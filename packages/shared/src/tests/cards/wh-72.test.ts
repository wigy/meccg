/**
 * @module wh-72.test
 *
 * Card test: Great Patron (wh-72)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event)
 *
 * Printed text:
 *   "Your characters and allies that normally give 2 or more marshalling points
 *    are each worth 2 marshalling points. Cannot be duplicated by a given
 *    player."
 *
 * Card shape (data):
 *   - alignment "stage", eventType "permanent"; the card itself is worth 0 MP
 *     (marshallingCategory "misc") and contributes 2 stage points.
 *   - effects:
 *     1. stage-points (value 2) — a "(2)" stage resource; summed into the
 *        Fallen-wizard controller's running stage-point total.
 *     2. fw-character-ally-mp (threshold 2, value 2) — the MEWH §4 exception:
 *        the player's characters/allies whose *printed* MP is at least 2 each
 *        score 2 MP instead of the flat §4 1-MP clamp. Cards printed below 2 keep
 *        their normal value.
 *     3. duplication-limit (scope "player", max 1) — "Cannot be duplicated by a
 *        given player".
 *
 * Background: MEWH §4 clamps every non-stage card a Fallen-wizard controls to a
 * flat 1 MP. Great Patron lifts that clamp for characters/allies normally worth
 * >= 2 MP, capping them at 2. These tests drive the recompute / legal-action
 * pipeline; the card shape itself is documented here rather than asserted.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions,
  attachAllyToChar, addCardInPlay, recomputeDerived,
  RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, SAM_GAMGEE, TREEBEARD,
  ISENGARD, RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

// ─── Local card-ID constants ───────────────────────────────────────────────
const GREAT_PATRON = 'wh-72'  as CardDefinitionId; // FW stage permanent-event
const GOLDBERRY    = 'tw-245' as CardDefinitionId; // hero ally, printed MP 1
// ARAGORN (tw-120): printed MP 3 | SAM_GAMGEE (tw-180): printed MP 1
// TREEBEARD (tw-353): ally, printed MP 2

describe('Great Patron (wh-72)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: characters worth >= 2 MP are each worth 2 (MEWH §4 exception) ───

  test('Fallen-wizard character normally worth >=2 MP scores 2 with Great Patron; a 1-MP character is unaffected', () => {
    // FW player with Aragorn (printed 3) and Sam (printed 1). Under MEWH §4 both
    // would clamp to 1. Great Patron lifts Aragorn to 2 (>= threshold) but leaves
    // Sam at 1 (below threshold).
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [ARAGORN, SAM_GAMGEE] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, GREAT_PATRON);
    state = recomputeDerived(state);

    // Aragorn 2 (capped) + Sam 1 (below threshold) = 3.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(3);
  });

  test('without Great Patron, the same Fallen-wizard characters fall under the §4 1-MP clamp (control)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [ARAGORN, SAM_GAMGEE] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    // Both clamped to 1 → character total 2.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(2);
  });

  // ─── Rule: allies worth >= 2 MP are each worth 2 ──────────────────────────

  test('Fallen-wizard ally normally worth >=2 MP scores 2 with Great Patron', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SAM_GAMGEE] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, SAM_GAMGEE, TREEBEARD); // ally, printed MP 2
    state = addCardInPlay(state, RESOURCE_PLAYER, GREAT_PATRON);
    state = recomputeDerived(state);

    // Treebeard lifted from §4 1-MP clamp to 2.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
    // Sam (1-MP character) unaffected.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(1);
  });

  test('without Great Patron, the same ally is clamped to 1 (control)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SAM_GAMGEE] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, SAM_GAMGEE, TREEBEARD);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
  });

  test('an ally normally worth 1 MP stays at 1 even with Great Patron (below threshold)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SAM_GAMGEE] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, SAM_GAMGEE, GOLDBERRY); // ally, printed MP 1
    state = addCardInPlay(state, RESOURCE_PLAYER, GREAT_PATRON);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
  });

  // ─── Rule: only the Fallen-wizard exception, not a generic cap ────────────

  test('a non-Fallen-wizard player is unaffected — characters score full printed MP', () => {
    // The override only lifts the MEWH §4 clamp; it never acts as a downward cap
    // for a hero player, who already scores printed MP.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, GREAT_PATRON);
    state = recomputeDerived(state);

    // Aragorn keeps his full printed 3 MP (no clamp, no cap).
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(3);
  });

  // ─── Rule: stage points ───────────────────────────────────────────────────

  test('Great Patron contributes 2 stage points to its Fallen-wizard controller', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SAM_GAMGEE] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, GREAT_PATRON);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  // ─── Rule: cannot be duplicated by a given player ─────────────────────────

  test('Great Patron is playable from hand when none is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SAM_GAMGEE] }],
          hand: [GREAT_PATRON],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const handId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(1);
  });

  test('a second Great Patron cannot be played by the same player (duplication-limit: player)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SAM_GAMGEE] }],
          hand: [GREAT_PATRON],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // One copy already in play for this player.
    state = addCardInPlay(state, RESOURCE_PLAYER, GREAT_PATRON);
    const handId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    // No viable play action for the hand copy.
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);

    // And the hand copy is reported not-playable with a duplication reason.
    const notPlayable = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(notPlayable).toBeDefined();
    expect(notPlayable?.viable).toBe(false);
    expect(notPlayable?.reason ?? '').toContain('duplicated');
  });
});
