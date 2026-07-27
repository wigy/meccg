/**
 * @module rule-9.09-short-events
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.09: Short-Events
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Short-events can only be played if they would have an immediate effect on the game other than the play of the card itself, and then are immediately discarded after they resolve.
 * Effects of short-events last for as long as specified on the card or for as long as the effect would be legal and "in effect," but never longer than the end of the turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../../index.js';
import { Phase, Race } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint,
  ARAGORN, LEGOLAS, MORIA, MINAS_TIRITH, LORIEN, RIVENDELL,
  RESOURCE_PLAYER,
  viableActions, dispatch, makeCancelWindowCombat,
  expectInDiscardPile,
} from '../../test-helpers.js';

/** The Old Thrush (tw-346) — short event, discarded after resolving. */
const THE_OLD_THRUSH = 'tw-346' as CardDefinitionId;
/** Tom (tw-103) — troll, prowess 13, satisfies Old Thrush's play condition. */
const TOM_TUMA = 'tw-103' as CardDefinitionId;

describe('Rule 9.09 — Short-Events', () => {
  beforeEach(() => resetMint());

  test('Short event is discarded from hand after it resolves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_OLD_THRUSH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, {
      creatureDefId: TOM_TUMA,
      creatureRace: Race.Troll,
      strikeProwess: 13,
    });

    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(1);

    const after = dispatch(state, viableActions(state, PLAYER_1, 'modify-attack')[0].action);

    // Card is gone from hand.
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    // Card is in discard pile — short events are discarded after resolving.
    expectInDiscardPile(after, RESOURCE_PLAYER, THE_OLD_THRUSH);
  });
});
