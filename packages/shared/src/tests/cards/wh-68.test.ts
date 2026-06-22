/**
 * @module wh-68.test
 *
 * Card test: The Fortress of Isen (wh-68)
 * Type: minion-resource-event (permanent) · alignment: stage · Stage resource
 *
 * Card text:
 *   "Unique. May not be a starting stage card. Playable if you are Alatar,
 *    Pallando, or Saruman. Playable on Isengard. Isengard is protected. Other
 *    Fallen-wizards may not use the Wizardhaven [{H}] card for Isengard. Cards
 *    that give marshalling points cannot be played at Isengard by your opponent
 *    in all cases. Discard this card when the site is discarded or returned to
 *    its location deck."
 *
 * ⚠️ NOT CERTIFIED. This card is a stage resource carrying the standard 3 stage
 * points (the only part of its behaviour the engine supports today). The bulk of
 * its printed text relies on mechanics the engine does not implement:
 *
 * | # | Rule                                                          | Status          |
 * |---|---------------------------------------------------------------|-----------------|
 * | 1 | Unique                                                        | OK (data flag)  |
 * | 2 | carries 3 stage points                                        | OK              |
 * | 3 | may not be a starting stage card                              | NOT IMPLEMENTED |
 * | 4 | playable only if you are Alatar/Pallando/Saruman              | NOT IMPLEMENTED |
 * | 5 | playable on Isengard (bound to the site)                      | NOT IMPLEMENTED |
 * | 6 | Isengard is protected                                         | NOT IMPLEMENTED |
 * | 7 | other Fallen-wizards may not Wizardhaven Isengard             | NOT IMPLEMENTED |
 * | 8 | opponent cannot play MP-giving cards at Isengard              | NOT IMPLEMENTED |
 * | 9 | discard when the site is discarded / returned to its deck     | NOT IMPLEMENTED |
 *
 * Rules 3–9 require new engine mechanics (a "site is protected" constraint that
 * shields a named site from opponent effects, a per-site opponent
 * marshalling-point-play block, a multiplayer "other Fallen-wizard may not
 * convert this site to a Wizardhaven" restriction, a starting-stage-deck
 * validation flag, and a self-discard hook tied to a *named site* leaving play
 * rather than to a company vacating a bound site). None of these exist today, so
 * the card MUST NOT be certified.
 *
 * The assertions below exercise only rule #2 (the implemented stage-points
 * derivation) with real reducer/derivation-driven checks — no tautological
 * data-shape assertions.
 *
 * Playable: PARTIALLY (stage points only) — NOT CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import {
  buildTestState, resetMint, dispatch, viableActions, pool, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  RIVENDELL, MINAS_TIRITH, ARAGORN,
} from '../test-helpers.js';

const FORTRESS_OF_ISEN = 'wh-68' as CardDefinitionId;

// A second stage card so a discard can be offered without dropping below 3
// (MEWH §2: you may not discard a stage resource if it would reduce your stage
// points below 3). The Fortress alone is worth 3, so it can never be discarded.
const STAGE_2 = 'test-stage-res-2' as CardDefinitionId;

function inPlay(defId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

/** Organization-phase state for a player of the given alignment with `cards` in play. */
function orgState(alignment: Alignment, cards: CardInPlay[]): GameState {
  return recomputeDerived(buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: cards,
      },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  }));
}

describe('The Fortress of Isen (wh-68) — stage points [NOT CERTIFIED]', () => {
  beforeEach(() => resetMint());

  test('contributes 3 stage points to a Fallen-wizard who has it in play', () => {
    const state = orgState(Alignment.FallenWizard, [inPlay(FORTRESS_OF_ISEN, 'p1-1000')]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(3);
  });

  test('stage points are not accrued by a non-Fallen-wizard player', () => {
    // Stage resources are a Fallen-wizard-only card type; the derivation stays 0
    // for any other alignment regardless of what sits in play.
    const state = orgState(Alignment.Wizard, [inPlay(FORTRESS_OF_ISEN, 'p1-1000')]);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
  });

  test('cannot be discarded as a stage resource because it would drop the total below 3', () => {
    // The Fortress alone is worth exactly 3; discarding it would leave 0 (< 3),
    // so the MEWH §2 discard action must not be offered for it.
    const state = orgState(Alignment.FallenWizard, [inPlay(FORTRESS_OF_ISEN, 'p1-1000')]);
    const actions = viableActions(state, PLAYER_1, 'discard-stage-resource');
    expect(actions).toHaveLength(0);
  });

  test('with another stage card present, the other card (not the Fortress) is the discardable one', () => {
    // Total 3 + 2 = 5. Discarding the 2-point card leaves 3 (allowed); discarding
    // the Fortress would leave 2 (< 3, not allowed). The Fortress must never be a
    // legal discard target while it is the player's only source of the minimum 3.
    const stageDef = {
      cardType: 'minion-resource-event', alignment: 'stage', id: STAGE_2,
      name: 'Test Stage Two', unique: false, eventType: 'permanent',
      marshallingPoints: 0, marshallingCategory: 'misc',
      effects: [{ type: 'stage-points', value: 2 }], text: 'Gives 2 stage points.',
    };
    // Register the helper stage card in the shared pool for this assertion.
    (pool as Record<string, unknown>)[STAGE_2 as string] = stageDef;
    try {
      const state = orgState(Alignment.FallenWizard, [inPlay(FORTRESS_OF_ISEN, 'p1-1000'), inPlay(STAGE_2, 'p1-1001')]);
      expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(5);

      const targets = viableActions(state, PLAYER_1, 'discard-stage-resource')
        .map(a => (a.action as { cardInstanceId: string }).cardInstanceId);
      expect(targets).toContain('p1-1001');     // the 2-point card → 5-2=3, allowed
      expect(targets).not.toContain('p1-1000'); // the Fortress → 5-3=2, not allowed

      // Discarding the other card leaves exactly the Fortress's 3 points.
      const after = dispatch(state, { type: 'discard-stage-resource', player: PLAYER_1, cardInstanceId: 'p1-1001' as CardInstanceId });
      expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(3);
      expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === 'p1-1000')).toBe(true);
    } finally {
      delete (pool as Record<string, unknown>)[STAGE_2 as string];
    }
  });
});
