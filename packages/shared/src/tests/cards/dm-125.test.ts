/**
 * @module dm-125.test
 *
 * Card test: Enduring Tales (dm-125)
 * Type: hero-resource-event
 * Subtype: Long-event
 *
 * Text: "When any player discards a card from his hand, he may discard it to
 * the top of his play deck (and always face down) instead of to his discard
 * pile."
 *
 * Effects: 1
 *   1. `hand-discard-recycle-option` — a bare, game-wide passive marker. While
 *      a copy sits in either player's `cardsInPlay`, every hand→discard-pile
 *      transition — regardless of which of the engine's many independent
 *      code paths caused it (voluntary end-of-turn discard, forced hand-size
 *      reduction, a forced discard, a cost payment, etc.) — is detected
 *      reactively as a prev/next diff after the reducer step
 *      (`hand-discard-recycle-trigger.ts`, mirroring Pale Dream-maker's
 *      dm-78 corruption trigger) and offers the discarding player a
 *      `hand-discard-recycle-offer` pending resolution: move the card that
 *      just landed in their discard pile to the top of their play deck
 *      instead (`recycle-hand-discard`), or leave it discarded (`pass`).
 *
 * Engine Support:
 * | # | Rule                                                    | Status      | Notes                                     |
 * |---|----------------------------------------------------------|-------------|--------------------------------------------|
 * | 1 | No effect on a normal hand discard when not in play      | IMPLEMENTED | baseline test below                        |
 * | 2 | Owner's own hand discard offers the recycle choice       | IMPLEMENTED | `hand-discard-recycle-trigger.ts`           |
 * | 3 | Accepting moves the card to the top of the play deck     | IMPLEMENTED | `applyHandDiscardRecycleOfferResolution`    |
 * | 4 | Declining (pass) leaves the card in the discard pile     | IMPLEMENTED | `guardResolutionOrPass`                     |
 * | 5 | "Any player" — applies even when the OTHER player's hand | IMPLEMENTED | game-wide `cardsInPlay` scan, not owner-    |
 * |   | discards and the card belongs to the opponent            |             | gated (contrast le-51 magic-discard-to-deck)|
 * | 6 | Only a genuine discard triggers the offer — playing a    | IMPLEMENTED | diff requires landing in `discardPile`,     |
 * |   | card from hand into play does not                        |             | not merely leaving `hand`                   |
 *
 * Playable: YES — every rule is implemented in the engine and exercised by
 * assertions below.
 *
 * Fixtures:
 *   ENDURING_TALES (dm-125) — this card (hero resource long-event, non-unique)
 *   ARAGORN, LEGOLAS         — filler characters (hand-size padding)
 *   RIVENDELL, LORIEN, MORIA, MINAS_TIRITH — sites
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableActions, addCardInPlay, phaseStateAs,
  Phase, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, EndOfTurnPhaseState, GameState } from '../../index.js';

const ENDURING_TALES = 'dm-125' as CardDefinitionId;

/** A 9-card hand of filler characters — one over the base hand size of 8, forcing exactly one reset-hand discard. */
function fillerHand(): CardDefinitionId[] {
  return Array.from({ length: 9 }, () => LEGOLAS);
}

/** Build a reset-hand end-of-turn state for PLAYER_1, optionally with Enduring Tales in cardsInPlay. */
function buildResetHandState(opts: { taeOwner?: 0 | 1 }): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.EndOfTurn,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: fillerHand(), siteDeck: [MORIA], playDeck: [LEGOLAS] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  const withCard = opts.taeOwner === undefined ? base : addCardInPlay(base, opts.taeOwner, ENDURING_TALES);
  const eotState = phaseStateAs<EndOfTurnPhaseState>(withCard);
  return {
    ...withCard,
    phaseState: { ...eotState, step: 'reset-hand', discardDone: [true, true] },
  };
}

describe('Enduring Tales (dm-125)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: baseline — no effect without the card in play ─────────────────

  test('baseline: a forced hand-size discard goes straight to the discard pile with no offer', () => {
    const state = buildResetHandState({});
    const discardActions = viableActions(state, PLAYER_1, 'discard-card');
    expect(discardActions.length).toBeGreaterThan(0);
    const discardedId = (discardActions[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId;

    const next = dispatch(state, discardActions[0].action);

    expect(next.pendingResolutions.filter(r => r.kind.type === 'hand-discard-recycle-offer')).toHaveLength(0);
    expect(next.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(discardedId);
  });

  // ─── Rule 2: owner's own discard offers the recycle choice ─────────────────

  test('with Enduring Tales in play, a hand-size discard offers to recycle the card instead', () => {
    const state = buildResetHandState({ taeOwner: 0 });
    const discardActions = viableActions(state, PLAYER_1, 'discard-card');
    const discardedId = (discardActions[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId;

    const next = dispatch(state, discardActions[0].action);

    const offers = next.pendingResolutions.filter(r => r.kind.type === 'hand-discard-recycle-offer' && r.actor === PLAYER_1);
    expect(offers).toHaveLength(1);
    if (offers[0].kind.type !== 'hand-discard-recycle-offer') return;
    expect(offers[0].kind.instanceId).toBe(discardedId);
    expect(offers[0].kind.sourceName).toBe('Enduring Tales');
    // The card already sits in the discard pile while the offer is pending.
    expect(next.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(discardedId);
  });

  // ─── Rule 3: accepting moves the card to the top of the play deck ─────────

  test('accepting the offer moves the card from the discard pile to the top of the play deck', () => {
    const state = buildResetHandState({ taeOwner: 0 });
    const discardActions = viableActions(state, PLAYER_1, 'discard-card');
    const discardedId = (discardActions[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId;
    const offered = dispatch(state, discardActions[0].action);

    const accepted = dispatch(offered, { type: 'recycle-hand-discard', player: PLAYER_1, cardInstanceId: discardedId });

    expect(accepted.pendingResolutions.filter(r => r.kind.type === 'hand-discard-recycle-offer')).toHaveLength(0);
    expect(accepted.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).not.toContain(discardedId);
    expect(accepted.players[RESOURCE_PLAYER].playDeck[0].instanceId).toBe(discardedId);
  });

  // ─── Rule 4: declining leaves the card discarded ───────────────────────────

  test('declining (pass) leaves the card in the discard pile', () => {
    const state = buildResetHandState({ taeOwner: 0 });
    const discardActions = viableActions(state, PLAYER_1, 'discard-card');
    const discardedId = (discardActions[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId;
    const offered = dispatch(state, discardActions[0].action);

    const declined = dispatch(offered, { type: 'pass', player: PLAYER_1 });

    expect(declined.pendingResolutions.filter(r => r.kind.type === 'hand-discard-recycle-offer')).toHaveLength(0);
    expect(declined.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(discardedId);
    expect(declined.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).not.toContain(discardedId);
  });

  // ─── Rule 5: "any player" — applies even when owned by the opponent ────────

  test('the offer still applies when Enduring Tales belongs to the OTHER player', () => {
    // Enduring Tales sits in player 2's play area; player 1 is the one
    // discarding. The card text says "any player", not "you" — it is a
    // game-wide passive, unlike le-51's owner-only magic-discard-to-deck.
    const state = buildResetHandState({ taeOwner: 1 });
    const discardActions = viableActions(state, PLAYER_1, 'discard-card');
    const discardedId = (discardActions[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId;

    const next = dispatch(state, discardActions[0].action);

    const offers = next.pendingResolutions.filter(r => r.kind.type === 'hand-discard-recycle-offer' && r.actor === PLAYER_1);
    expect(offers).toHaveLength(1);
    if (offers[0].kind.type !== 'hand-discard-recycle-offer') return;
    expect(offers[0].kind.instanceId).toBe(discardedId);
  });

  // ─── Rule 6: playing a card from hand is not a discard ─────────────────────

  test('playing a long-event from hand into play does NOT offer the recycle choice', () => {
    // A second, non-unique copy of Enduring Tales is played from hand during
    // the long-event phase while another copy already sits in cardsInPlay.
    // The played copy leaves the hand for `cardsInPlay`, never touching the
    // discard pile, so no offer should be enqueued.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [ENDURING_TALES], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withMarker = addCardInPlay(base, 0, ENDURING_TALES);

    const playActions = viableActions(withMarker, PLAYER_1, 'play-long-event');
    expect(playActions).toHaveLength(1);
    let next = dispatch(withMarker, playActions[0].action);
    for (let i = 0; i < 10 && next.chain !== null; i++) {
      const pass = viableActions(next, next.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      next = dispatch(next, pass[0].action);
    }

    expect(next.pendingResolutions.filter(r => r.kind.type === 'hand-discard-recycle-offer')).toHaveLength(0);
    expect(next.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expect(next.players[RESOURCE_PLAYER].cardsInPlay.filter(c => c.definitionId === ENDURING_TALES)).toHaveLength(2);
    expect(next.players[RESOURCE_PLAYER].discardPile).toHaveLength(0);
  });
});
