/**
 * @module rule-3.33-fw-stored-stage
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.33: Fallen-Wizard Stored Stage Resources
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] Stored Stage resources continue to give stage points, and may be discarded while stored if their player must discard a Stage resource.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  resetMint,
  viableActions,
  dispatch,
  resolveChain,
  handCardId,
  companyIdAt,
  buildFwStageCardsMHState,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId } from '../../../index.js';

// Keys of Orthanc (wh-88): the Fallen-wizard Stage *item*, worth 1 stage point.
// Being an item it is the only kind of Stage resource that can be stored at a
// haven, so it is the card this rule is about.
const KEYS_OF_ORTHANC = 'wh-88' as CardDefinitionId;
// Stage permanent-events, kept in play, making up the rest of the total.
const SHAMEFUL_DEEDS = 'wh-80' as CardDefinitionId;    // 4 stage points
const A_MERRIER_WORLD = 'wh-59' as CardDefinitionId;   // 2 stage points
// Echoes of the Song (wh-17) is the "must discard a Stage resource" effect:
// "If your opponent has more than one stage card and 4 or more stage points,
// he must discard one stage card of his choice."
const ECHOES_OF_THE_SONG = 'wh-17' as CardDefinitionId;

describe('Rule 3.33 — Fallen-Wizard Stored Stage Resources', () => {
  beforeEach(() => resetMint());

  test('[FALLEN-WIZARD] a stored Stage resource still contributes its stage points', () => {
    const state = buildFwStageCardsMHState({
      stageCardsInPlay: [A_MERRIER_WORLD],
      storedStageCards: [KEYS_OF_ORTHANC],
      hazardHand: [],
    });
    // The stored card really is out of play — it sits in the marshalling-point
    // pile, not in `cardsInPlay`.
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).toEqual([A_MERRIER_WORLD]);
    expect(state.players[RESOURCE_PLAYER].killPile.map(c => c.definitionId)).toEqual([KEYS_OF_ORTHANC]);
    // 2 (A Merrier World, in play) + 1 (Keys of Orthanc, stored) = 3.
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(3);
  });

  test('[FALLEN-WIZARD] a stored Stage resource counts as one of its player\'s stage cards', () => {
    // Echoes of the Song needs *more than one* stage card and 4+ stage points.
    // Shameful Deeds alone is 4 points but only one card; the stored Keys of
    // Orthanc supplies the second card (and a fifth point).
    const stored = buildFwStageCardsMHState({
      stageCardsInPlay: [SHAMEFUL_DEEDS],
      storedStageCards: [KEYS_OF_ORTHANC],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    expect(stored.players[RESOURCE_PLAYER].stagePoints).toBe(5);
    expect(viableActions(stored, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { optionId?: string }).optionId === 'discard-stage-card')).toBe(true);

    // Without the stored card the same board is one stage card short.
    const withoutStored = buildFwStageCardsMHState({
      stageCardsInPlay: [SHAMEFUL_DEEDS],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    expect(viableActions(withoutStored, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { optionId?: string }).optionId === 'discard-stage-card')).toBe(false);
  });

  test('[FALLEN-WIZARD] a stored Stage resource may be the one discarded when a Stage resource must be discarded', () => {
    const state = buildFwStageCardsMHState({
      stageCardsInPlay: [SHAMEFUL_DEEDS],
      storedStageCards: [KEYS_OF_ORTHANC],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    const storedId = state.players[RESOURCE_PLAYER].killPile[0].instanceId;

    const resolved = resolveChain(dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId(state, HAZARD_PLAYER),
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      optionId: 'discard-stage-card',
    }));

    // The stored card is offered to its owner alongside the in-play one.
    const choices = viableActions(resolved, PLAYER_1, 'force-discard-card')
      .map(a => (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
    expect(choices).toContain(storedId);

    const after = dispatch(resolved, { type: 'force-discard-card', player: PLAYER_1, cardInstanceId: storedId });

    // It leaves the marshalling-point pile for the discard pile, and its stage
    // point goes with it: 5 → 4.
    expect(after.players[RESOURCE_PLAYER].killPile.map(c => c.instanceId)).not.toContain(storedId);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(storedId);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(4);
  });
});
