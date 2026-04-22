/**
 * @module last-action-card-defs
 *
 * Engine mechanics — card identities attached to a broadcast
 * {@link StateMessage}'s `lastAction`.
 *
 * Regression for bug 0e6e061ca06457e7 (game mo8vm8nd-zh71f8, seq 135):
 * a hazard player watched the opponent play Marvels Told as a short event
 * but the toast / log line read "Play short-event a card …". The cause:
 * the card moves hand → chain → owner discard in a single state
 * transition, and the opponent's view redacts both the hand and the
 * face-down discard pile (CoE glossary "discard pile"). With neither the
 * pre-action nor post-action view lookup holding the instance→definition
 * mapping, `describeAction` fell back to "a card".
 *
 * The fix ships the action-referenced card definitions alongside the
 * broadcast `lastAction`, resolved from the authoritative state. The
 * client merges this map ahead of its view lookup when naming the
 * opponent's action. This file pins the server-side helper.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ELROND, LEGOLAS,
  MARVELS_TOLD, FOOLISH_WORDS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  handCardId, dispatch,
  addCardInPlay,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  pool,
} from '../../test-helpers.js';
import type { CardInstanceId, PlayShortEventAction } from '../../../index.js';
import { Phase, describeAction, extractActionCardDefs } from '../../../index.js';

describe('lastAction card defs — opponent toast naming', () => {
  beforeEach(() => resetMint());

  test('extractActionCardDefs resolves the played card for a short-event play', () => {
    // Marvels Told is played from hand and sent straight to the owner's
    // discard pile in the same state transition. The action carries only
    // the instance id, so without this helper the opponent's describeAction
    // cannot name the card.
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const before = addCardInPlay(base, HAZARD_PLAYER, FOOLISH_WORDS);

    const marvelsId = handCardId(before, RESOURCE_PLAYER);
    const foolishWordsId = before.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(before.players[0].characters)[0] as unknown as CardInstanceId;

    const action: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    };
    const after = dispatch(before, action);

    // Precondition that reproduces the bug: after the transition the
    // played card is in the owner's discard pile, which the opponent's
    // projection redacts. A lookup built from the post-action projection
    // alone cannot map marvelsId → MARVELS_TOLD.
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain(marvelsId);

    const defs = extractActionCardDefs(after, action);
    expect(defs[marvelsId as string]).toBe(MARVELS_TOLD);
    // The discard target is also named in the action and should resolve
    // to its current (discarded) definition.
    expect(defs[foolishWordsId as string]).toBe(FOOLISH_WORDS);
    // The scout is a character in play and resolves too.
    expect(defs[elrondId as string]).toBe(ELROND);
  });

  test('describeAction with merged lookup names Marvels Told in the opponent toast', () => {
    // End-to-end check of the fix: with only the view-level lookup the
    // card appears as "a card"; layering the action-referenced defs on
    // top produces the card name.
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const before = addCardInPlay(base, HAZARD_PLAYER, FOOLISH_WORDS);

    const marvelsId = handCardId(before, RESOURCE_PLAYER);
    const foolishWordsId = before.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(before.players[0].characters)[0] as unknown as CardInstanceId;

    const action: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    };
    const after = dispatch(before, action);

    // Simulate the opponent's view lookup: the played card is invisible
    // (hand or face-down discard), so it returns undefined.
    const viewLookup = (id: CardInstanceId): typeof MARVELS_TOLD | undefined =>
      id === elrondId ? ELROND : undefined;
    const bare = describeAction(action, pool, viewLookup);
    expect(bare).toContain('a card');
    expect(bare).not.toContain('Marvels Told');

    // Merge the server-supplied action defs ahead of the view lookup.
    const defs = extractActionCardDefs(after, action);
    const mergedLookup = (id: CardInstanceId) => defs[id as string] ?? viewLookup(id);
    const named = describeAction(action, pool, mergedLookup);
    expect(named).toContain('Marvels Told');
  });
});
