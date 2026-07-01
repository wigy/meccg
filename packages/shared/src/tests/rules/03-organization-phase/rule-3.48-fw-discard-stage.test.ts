/**
 * @module rule-3.48-fw-discard-stage
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.48: Fallen-Wizard Discard Stage Resource
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard resource player may discard one Stage resource from play at the end of their own organization phase, but only if doing so would not reduce the player's total stage points below three.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../test-helpers.js';
import {
  buildTestState, resetMint, addCardInPlay, recomputeDerived, dispatch, viableFor, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL, ISENGARD,
} from '../../test-helpers.js';
import type { DiscardStageResourceAction } from '../../../types/actions-organization.js';

// Two Fallen-wizard stage permanent-events. Single-test use → inline.
const FORTRESS_OF_THE_TOWERS = 'wh-69' as CardDefinitionId; // stage points 3
const DOUBLE_DEALING = 'wh-66' as CardDefinitionId; // stage points 1
// Total 4: discarding Double-dealing keeps 3 (allowed); discarding Fortress
// of the Towers would drop to 1 (blocked).

function fwStateWithStageResources() {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [],
        hand: [],
        siteDeck: [ISENGARD],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [],
      },
    ],
  });
  const withCards = addCardInPlay(addCardInPlay(built, 0, FORTRESS_OF_THE_TOWERS), 0, DOUBLE_DEALING);
  return recomputeDerived(withCards);
}

describe('Rule 3.48 — Fallen-Wizard Discard Stage Resource', () => {
  beforeEach(() => resetMint());

  test('[FALLEN-WIZARD] May discard a Stage resource when the remainder stays at or above 3', () => {
    const state = fwStateWithStageResources();
    expect(state.players[0].stagePoints).toBe(4);

    const doubleDealingInstId = state.players[0].cardsInPlay.find(c => c.definitionId === DOUBLE_DEALING)!.instanceId;
    const discards = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'discard-stage-resource') as { action: DiscardStageResourceAction }[];
    const target = discards.find(a => a.action.cardInstanceId === doubleDealingInstId);
    expect(target).toBeDefined();

    const after = dispatch(state, target!.action);
    expect(after.players[0].stagePoints).toBe(3);
    expect(after.players[0].cardsInPlay.some(c => c.instanceId === doubleDealingInstId)).toBe(false);
    expect(after.players[0].discardPile.some(c => c.instanceId === doubleDealingInstId)).toBe(true);
  });

  test('[FALLEN-WIZARD] Cannot discard a Stage resource that would drop total stage points below 3', () => {
    const state = fwStateWithStageResources();

    const fortressInstId = state.players[0].cardsInPlay.find(c => c.definitionId === FORTRESS_OF_THE_TOWERS)!.instanceId;
    const discards = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'discard-stage-resource') as { action: DiscardStageResourceAction }[];
    expect(discards.some(a => a.action.cardInstanceId === fortressInstId)).toBe(false);
  });

  test('[HERO] A non-Fallen-wizard player has no discard-stage-resource action', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [],
          hand: [],
          siteDeck: [ISENGARD],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
      recompute: true,
    });

    expect(viableFor(state, PLAYER_1).some(a => a.action.type === 'discard-stage-resource')).toBe(false);
  });
});
