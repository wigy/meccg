/**
 * @module wh-61.test
 *
 * Card test: A Strident Spawn (wh-61)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event)
 *
 * Printed text:
 *   "Unique. Playable if you are Pallando or Saruman and have 6 or more stage
 *    points and a protected Wizardhaven [{H}]. Each of your Half-orcs requires
 *    one less point of influence to control. During your organization phase, you
 *    may take one Half-orc character from your discard pile to your hand. You may
 *    play Half-orc characters at your Wizardhavens [{H}], even if your
 *    Fallen-wizard is not there or Bad Company is not in play. Cannot be
 *    duplicated by a given player."
 *
 * Card shape (data):
 *   - alignment "stage", eventType "permanent"; marshallingCategory "misc".
 *   - effects:
 *     1. stage-points (value 4) — a "(4)" stage resource; summed into the
 *        Fallen-wizard controller's running stage-point total.
 *     2. duplication-limit (scope "player", max 1) — "Cannot be duplicated by a
 *        given player".
 *
 * ── CERTIFICATION STATUS: NOT CERTIFIED ────────────────────────────────────
 * Four of the card's six printed rules require engine systems that do not yet
 * exist, so the card is NOT certified. The implemented rules below are covered
 * with real assertions; the unimplemented rules are listed here (no engine
 * support, no DSL effect type to express them faithfully):
 *
 *   - "Playable if you are Pallando or Saruman and have 6 or more stage points
 *     and a protected Wizardhaven" — the `play-condition` `requires:
 *     'player-state'` context exposes only `{ player: { alignment,
 *     hasRingwraithInPlay }, opponent: { alignment } }`. It cannot read the
 *     revealed avatar's *name* (Pallando/Saruman), the player's stage-point
 *     total, or whether a protected Wizardhaven exists.
 *   - "Each of your Half-orcs requires one less point of influence to control"
 *     — no per-race reduction of a character's influence-to-control (mind) cost.
 *     `stat-modifier`/`mind` modifies a single bearer, not every Half-orc the
 *     player controls.
 *   - "During your organization phase, you may take one Half-orc character from
 *     your discard pile to your hand" — no emission path for an
 *     organization-phase discard→hand fetch granted by a permanent-event (the
 *     existing fetch grant-actions are tap-cost item/character abilities in the
 *     end-of-turn or site phases).
 *   - "You may play Half-orc characters at your Wizardhavens even if your
 *     Fallen-wizard is not there or Bad Company is not in play" — the underlying
 *     Bad-Company / FW-presence restriction on playing Orc/Troll/Half-orc
 *     characters is not modeled, and there is no playability-override effect to
 *     lift it.
 *
 * The closely related card Bad Company (wh-63), which carries the same
 * Orc/Troll-play override mechanic, is likewise uncertified.
 *
 * These tests drive the recompute / legal-action pipeline for the implemented
 * rules; the card shape itself is documented here rather than asserted.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions,
  addCardInPlay, recomputeDerived,
  RESOURCE_PLAYER,
  LEGOLAS, SAM_GAMGEE,
  ISENGARD, RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

// ─── Local card-ID constants ───────────────────────────────────────────────
const STRIDENT_SPAWN = 'wh-61' as CardDefinitionId; // FW stage permanent-event

describe('A Strident Spawn (wh-61)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: stage points ───────────────────────────────────────────────────

  test('A Strident Spawn contributes 4 stage points to its Fallen-wizard controller', () => {
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
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(4);
  });

  // ─── Rule: cannot be duplicated by a given player ─────────────────────────

  test('A Strident Spawn is playable from hand when none is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SAM_GAMGEE] }],
          hand: [STRIDENT_SPAWN],
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

  test('a second A Strident Spawn cannot be played by the same player (duplication-limit: player)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SAM_GAMGEE] }],
          hand: [STRIDENT_SPAWN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // One copy already in play for this player.
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    const handId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    // No viable play action for the hand copy.
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);

    // And the hand copy is reported not-playable because a copy is already in
    // play (the card is unique; the player-scope duplication-limit applies too).
    const notPlayable = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(notPlayable).toBeDefined();
    expect(notPlayable?.viable).toBe(false);
    expect(notPlayable?.reason ?? '').toContain('already in play');
  });
});
