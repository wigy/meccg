/**
 * @module wh-99.test
 *
 * Card test: Give Welcome to the Unexpected (wh-99)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event), alignment "stage"
 *
 * Printed text:
 *   "Unique. Gandalf specific. Place this card on Gandalf if he is in play. If on
 *    Gandalf, your unique non-character cards normally worth 1 marshalling point
 *    are each worth 2 marshalling points."
 *
 * Card shape (data):
 *   - alignment "stage", eventType "permanent"; worth 0 MP (misc) and 2 stage
 *     points. Keyword `gandalf-specific` (playable only while the player's avatar
 *     is Gandalf; enforced generically via `wizardSpecificName`).
 *   - effects:
 *     1. stage-points (value 2).
 *     2. play-target `character` filter `{ target.name: "Gandalf" }` — the card
 *        attaches to Gandalf's `items` ("place this card on Gandalf").
 *     3. noncharacter-mp-override — `when { card.unique: true, card.normalMp: 1 }`,
 *        `value: 2`. Re-values every unique non-character card the player controls
 *        whose printed MP is 1 (items, allies, factions, misc permanent-events)
 *        to 2, overriding both the printed value and the MEWH §4 flat-1-MP clamp.
 *
 * Background: MEWH §4 clamps every non-stage card a Fallen-wizard controls to a
 * flat 1 MP. Give Welcome to the Unexpected lifts a filtered subset — unique
 * non-character cards printed at exactly 1 MP — to 2. These tests drive the
 * recompute / play pipeline; the card shape is documented here, not asserted.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  viableActions,
  attachItemToChar, attachAllyToChar, addCardToHand, recomputeDerived,
  playPermanentEventAndResolve, findCharInstanceId, findHandCardId, getCharacter,
  makePlayDeck,
  ARAGORN, LEGOLAS,
  ISENGARD, RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const GIVE_WELCOME  = 'wh-99' as CardDefinitionId; // FW stage permanent-event under test
const GANDALF_FW    = 'wh-4'  as CardDefinitionId; // the Fallen-wizard avatar it's specific to
const SARUMAN       = 'wh-9'  as CardDefinitionId; // a *different* FW avatar (negative control)
const BOOK_MAZARBUL = 'tw-201' as CardDefinitionId; // unique hero item, printed MP 1 → boosted to 2
const FAIR_GOLD_RING = 'tw-231' as CardDefinitionId; // NON-unique hero item, printed MP 1 → unaffected
const GLAMDRING     = 'tw-244' as CardDefinitionId; // unique hero item, printed MP 2 → unaffected
const GOLDBERRY     = 'tw-245' as CardDefinitionId; // unique hero ally, printed MP 1 → boosted to 2

/** Fallen-wizard (player 0) at Isengard with Gandalf + Aragorn, plus an idle
 *  Wizard opponent. `avatar` lets a negative control swap in a different FW. */
function gandalfFwState(avatar: CardDefinitionId = GANDALF_FW): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: [avatar, ARAGORN, LEGOLAS] }],
        hand: [],
        siteDeck: [MORIA],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [],
        siteDeck: [RIVENDELL],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

describe('Give Welcome to the Unexpected (wh-99)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: unique non-character card worth 1 → worth 2 (item path) ──────────

  test('a unique item printed at 1 MP scores 2 while the card is on Gandalf', () => {
    let state = gandalfFwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, BOOK_MAZARBUL);
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GIVE_WELCOME); // "on Gandalf"
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });

  test('without the card, the same unique item falls under the §4 1-MP clamp (control)', () => {
    let state = gandalfFwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, BOOK_MAZARBUL);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  // ─── Rule: only *unique* cards are boosted ─────────────────────────────────

  test('a NON-unique item printed at 1 MP stays at 1 even with the card on Gandalf', () => {
    let state = gandalfFwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, FAIR_GOLD_RING); // not unique
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GIVE_WELCOME);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  // ─── Rule: only cards *normally worth 1* are boosted ───────────────────────

  test('a unique item printed at 2 MP is unaffected (clamped to 1, not boosted)', () => {
    let state = gandalfFwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, GLAMDRING); // unique, printed 2
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GIVE_WELCOME);
    state = recomputeDerived(state);

    // normalMp is 2, so the { card.normalMp: 1 } filter never matches; the §4
    // clamp still applies → 1.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  // ─── Rule: applies to unique non-character allies too ──────────────────────

  test('a unique ally printed at 1 MP scores 2 while the card is on Gandalf', () => {
    let state = gandalfFwState();
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, GOLDBERRY); // unique ally, printed 1
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GIVE_WELCOME);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(2);
  });

  test('without the card, the same unique ally is clamped to 1 (control)', () => {
    let state = gandalfFwState();
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.ally).toBe(1);
  });

  // ─── Rule: "non-character" — characters are never boosted ──────────────────

  test('characters are never re-valued: the character MP total is identical with and without the card', () => {
    // The company holds unique characters (Aragorn, Legolas); the override
    // targets only *non-character* cards, so placing it must not change the
    // character MP total whatsoever. (The absolute value is set by Gandalf wh-4's
    // own full-MP-for-characters ability; what matters here is that wh-99 leaves
    // it untouched.)
    const without = recomputeDerived(gandalfFwState());
    let withCard = attachItemToChar(gandalfFwState(), RESOURCE_PLAYER, GANDALF_FW, GIVE_WELCOME);
    withCard = recomputeDerived(withCard);

    expect(withCard.players[RESOURCE_PLAYER].marshallingPoints.character)
      .toBe(without.players[RESOURCE_PLAYER].marshallingPoints.character);
  });

  // ─── Rule: Place this card on Gandalf (full play flow) ─────────────────────

  test('playing the card places it on Gandalf, yields 2 stage points, and boosts a unique 1-MP item', () => {
    const base = gandalfFwState();
    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    let state = addCardToHand(base, RESOURCE_PLAYER, GIVE_WELCOME);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, GIVE_WELCOME);

    state = playPermanentEventAndResolve(state, PLAYER_1, cardId, gandalfId);

    // Attached to Gandalf's items and contributing its 2 stage points.
    expect(getCharacter(state, RESOURCE_PLAYER, GANDALF_FW).items.some(i => i.definitionId === GIVE_WELCOME)).toBe(true);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(2);

    // With the card in play on Gandalf, a unique 1-MP item now scores 2.
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, BOOK_MAZARBUL);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });

  // ─── Rule: placed only on Gandalf (target restriction) ─────────────────────

  test('the play is offered only on the Gandalf character, never on a company-mate', () => {
    const state = addCardToHand(gandalfFwState(), RESOURCE_PLAYER, GIVE_WELCOME);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    expect(targetIds).toContain(gandalfId);
    expect(targetIds).not.toContain(aragornId);
    expect(actions).toHaveLength(1); // exactly Gandalf
  });

  // ─── Rule: Gandalf specific (playability) ──────────────────────────────────

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    const state = addCardToHand(gandalfFwState(SARUMAN), RESOURCE_PLAYER, GIVE_WELCOME);

    const handId = findHandCardId(state, RESOURCE_PLAYER, GIVE_WELCOME);
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(notPlayable?.reason ?? '').toContain('Gandalf');
  });

  // ─── Rule: Unique (only one copy in play) ──────────────────────────────────

  test('a second copy cannot be played while one is already on Gandalf (unique)', () => {
    const base = gandalfFwState();
    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF_FW);
    let state = addCardToHand(base, RESOURCE_PLAYER, GIVE_WELCOME);
    const firstId = findHandCardId(state, RESOURCE_PLAYER, GIVE_WELCOME);
    state = playPermanentEventAndResolve(state, PLAYER_1, firstId, gandalfId);

    state = addCardToHand(state, RESOURCE_PLAYER, GIVE_WELCOME);
    const secondId = findHandCardId(state, RESOURCE_PLAYER, GIVE_WELCOME);
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === secondId);
    expect(playable).toHaveLength(0);
  });
});
