/**
 * @module rule-9.11-short-event-duplication
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.11: Short-Event Cannot Be Duplicated
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Short-events that "cannot be duplicated" cannot be played if a card of the same name is currently having an effect on the entity specified by the short-event. If no entity is specified (i.e. the short-event is affecting the game generally), they cannot be played if a card of the same name is having an effect on the game.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../../index.js';
import { Phase, Race } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint,
  ARAGORN, LEGOLAS, MORIA, MINAS_TIRITH, LORIEN, RIVENDELL,
  viableActions, dispatch, makeCancelWindowCombat,
} from '../../test-helpers.js';

/** The Old Thrush (tw-346) — short event, cannot be duplicated on a given attack. */
const THE_OLD_THRUSH = 'tw-346' as CardDefinitionId;
/** Tom (tw-103) — troll, prowess 13, non-Nazgûl. */
const TOM_TUMA = 'tw-103' as CardDefinitionId;

describe('Rule 9.11 — Short-Event Cannot Be Duplicated', () => {
  beforeEach(() => resetMint());

  test('second copy of cannot-duplicate short event is blocked once first is having effect', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_OLD_THRUSH, THE_OLD_THRUSH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, {
      creatureDefId: TOM_TUMA,
      creatureRace: Race.Troll,
      strikeProwess: 13,
    });

    // Both copies viable before first is played.
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(2);

    // Play the first copy.
    const after = dispatch(state, viableActions(state, PLAYER_1, 'modify-attack')[0].action);

    // Second copy is now blocked — duplication limit reached.
    expect(viableActions(after, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });
});
