/**
 * @module wh-100.test
 *
 * Card test: Grey Embassy (wh-100)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event), alignment "stage"
 *
 * Printed text:
 *   "Unique. Gandalf specific. Place this card on Gandalf if he is in play. If on
 *    Gandalf, your unique hero factions normally worth 2 or fewer marshalling
 *    points are each worth 2 marshalling points. If on Gandalf, your unique hero
 *    factions normally worth 3 or more marshalling points are each worth 3
 *    marshalling points."
 *
 * Card shape (data):
 *   - alignment "stage", eventType "permanent"; worth 0 MP (misc) and 3 stage
 *     points. Keyword `gandalf-specific` (playable only while the player's avatar
 *     is Gandalf; enforced generically via `wizardSpecificName`).
 *   - effects:
 *     1. stage-points (value 3).
 *     2. play-target `character` filter `{ target.name: "Gandalf" }` — the card
 *        attaches to Gandalf's `items` ("place this card on Gandalf").
 *     3. noncharacter-mp-override — `when { card.unique: true,
 *        card.cardType: "hero-resource-faction", card.normalMp: { $lte: 2 } }`,
 *        `value: 2`.
 *     4. noncharacter-mp-override — `when { card.unique: true,
 *        card.cardType: "hero-resource-faction", card.normalMp: { $gte: 3 } }`,
 *        `value: 3`.
 *
 * Background: MEWH §4 clamps every non-stage card a Fallen-wizard controls to a
 * flat 1 MP, factions included. Grey Embassy re-values a filtered subset — the
 * player's *unique hero factions* — to a floor/ceiling of 2 / 3: a faction
 * normally worth ≤2 becomes 2, one normally worth ≥3 becomes 3 (the two
 * thresholds partition every faction). The `cardType: "hero-resource-faction"`
 * filter keeps the override off non-faction cards (items, allies), which is what
 * distinguishes it from Give Welcome to the Unexpected (wh-99). These tests
 * drive the recompute / play pipeline; the card shape is documented here, not
 * asserted.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  viableActions,
  addCardInPlay, attachItemToChar, addCardToHand, recomputeDerived,
  playPermanentEventAndResolve, findCharInstanceId, findHandCardId, getCharacter,
  makePlayDeck,
  ARAGORN, LEGOLAS,
  ISENGARD, RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const GREY_EMBASSY = 'wh-100' as CardDefinitionId; // FW stage permanent-event under test
const GANDALF_FW   = 'wh-4'   as CardDefinitionId; // the Fallen-wizard avatar it's specific to
const SARUMAN      = 'wh-9'   as CardDefinitionId; // a *different* FW avatar (negative control)

// Unique hero factions across the two thresholds.
const HILLMEN        = 'tw-257' as CardDefinitionId; // unique, printed 1  → boosted to 2 ($lte 2)
const BEORNINGS      = 'tw-197' as CardDefinitionId; // unique, printed 2  → stays 2      ($lte 2)
const RIDERS_ROHAN   = 'tw-317' as CardDefinitionId; // unique, printed 3  → stays 3      ($gte 3)
const EASTERLINGS    = 'tw-222' as CardDefinitionId; // unique, printed 4  → reduced to 3 ($gte 3)
const ARMY_OF_DEAD   = 'tw-193' as CardDefinitionId; // unique, printed 6  → reduced to 3 ($gte 3)
// A NON-unique hero faction — the "unique" qualifier keeps it FW-clamped to 1.
const PANOPLY_WINGS  = 'wh-37'  as CardDefinitionId; // non-unique, printed 1
// A unique hero *item* printed at 1 MP — NOT a faction, so untouched (cardType filter).
const BOOK_MAZARBUL  = 'tw-201' as CardDefinitionId; // unique item, printed 1

/** Fallen-wizard (player 0) at Isengard with Gandalf + companions, plus an idle
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

describe('Grey Embassy (wh-100)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: unique hero faction worth ≤2 → worth 2 ──────────────────────────

  test('a unique faction printed at 1 MP scores 2 while the card is on Gandalf', () => {
    let state = gandalfFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, HILLMEN);
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GREY_EMBASSY); // "on Gandalf"
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  test('a unique faction printed at exactly 2 MP still scores 2', () => {
    let state = gandalfFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, BEORNINGS);
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GREY_EMBASSY);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  test('control: without the card a unique 1-MP faction falls under the §4 1-MP clamp', () => {
    let state = gandalfFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, HILLMEN);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  // ─── Rule: unique hero faction worth ≥3 → worth 3 ──────────────────────────

  test('a unique faction printed at exactly 3 MP still scores 3', () => {
    let state = gandalfFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, RIDERS_ROHAN);
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GREY_EMBASSY);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(3);
  });

  test('a unique faction printed at 4 MP is reduced to 3', () => {
    let state = gandalfFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, EASTERLINGS);
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GREY_EMBASSY);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(3);
  });

  test('a unique faction printed at 6 MP is reduced to 3', () => {
    let state = gandalfFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, ARMY_OF_DEAD);
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GREY_EMBASSY);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(3);
  });

  test('control: without the card a unique 4-MP faction is §4-clamped to 1', () => {
    let state = gandalfFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, EASTERLINGS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  // ─── Rule: a whole mixed board sums correctly under both thresholds ─────────

  test('a mixed board sums to the per-faction floor/ceiling values', () => {
    // Hillmen(1)→2, Beornings(2)→2, Riders(3)→3, Easterlings(4)→3, Army(6)→3
    // = 2 + 2 + 3 + 3 + 3 = 13.
    let state = gandalfFwState();
    for (const f of [HILLMEN, BEORNINGS, RIDERS_ROHAN, EASTERLINGS, ARMY_OF_DEAD]) {
      state = addCardInPlay(state, RESOURCE_PLAYER, f);
    }
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GREY_EMBASSY);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(13);
  });

  // ─── Rule: only *unique* factions are re-valued ────────────────────────────

  test('a NON-unique 1-MP faction stays clamped to 1 even with the card on Gandalf', () => {
    let state = gandalfFwState();
    state = addCardInPlay(state, RESOURCE_PLAYER, PANOPLY_WINGS); // non-unique
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GREY_EMBASSY);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  // ─── Rule: only *factions* — a non-faction card is never touched ───────────

  test('a unique 1-MP hero item is not boosted (cardType filter targets factions only)', () => {
    let state = gandalfFwState();
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, BOOK_MAZARBUL); // unique item, printed 1
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF_FW, GREY_EMBASSY);
    state = recomputeDerived(state);

    // The item is unique and printed at 1 MP, but it is not a hero faction, so
    // the override never matches → it stays under the §4 clamp at 1.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
  });

  // ─── Rule: "hero factions" — characters are never re-valued ────────────────

  test('characters are never re-valued: the character MP total is identical with and without the card', () => {
    const without = recomputeDerived(gandalfFwState());
    let withCard = attachItemToChar(gandalfFwState(), RESOURCE_PLAYER, GANDALF_FW, GREY_EMBASSY);
    withCard = recomputeDerived(withCard);

    expect(withCard.players[RESOURCE_PLAYER].marshallingPoints.character)
      .toBe(without.players[RESOURCE_PLAYER].marshallingPoints.character);
  });

  // ─── Rule: Place this card on Gandalf (full play flow) ─────────────────────

  test('playing the card places it on Gandalf, yields 3 stage points, and re-values factions', () => {
    const base = gandalfFwState();
    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    let state = addCardToHand(base, RESOURCE_PLAYER, GREY_EMBASSY);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, GREY_EMBASSY);

    state = playPermanentEventAndResolve(state, PLAYER_1, cardId, gandalfId);

    // Attached to Gandalf's items and contributing its 3 stage points.
    expect(getCharacter(state, RESOURCE_PLAYER, GANDALF_FW).items.some(i => i.definitionId === GREY_EMBASSY)).toBe(true);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(3);

    // With the card on Gandalf, a 1-MP faction scores 2 and a 4-MP faction 3.
    state = addCardInPlay(state, RESOURCE_PLAYER, HILLMEN);
    state = addCardInPlay(state, RESOURCE_PLAYER, EASTERLINGS);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(5);
  });

  // ─── Rule: placed only on Gandalf (target restriction) ─────────────────────

  test('the play is offered only on the Gandalf character, never on a company-mate', () => {
    const state = addCardToHand(gandalfFwState(), RESOURCE_PLAYER, GREY_EMBASSY);
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
    const state = addCardToHand(gandalfFwState(SARUMAN), RESOURCE_PLAYER, GREY_EMBASSY);

    const handId = findHandCardId(state, RESOURCE_PLAYER, GREY_EMBASSY);
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
    let state = addCardToHand(base, RESOURCE_PLAYER, GREY_EMBASSY);
    const firstId = findHandCardId(state, RESOURCE_PLAYER, GREY_EMBASSY);
    state = playPermanentEventAndResolve(state, PLAYER_1, firstId, gandalfId);

    state = addCardToHand(state, RESOURCE_PLAYER, GREY_EMBASSY);
    const secondId = findHandCardId(state, RESOURCE_PLAYER, GREY_EMBASSY);
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === secondId);
    expect(playable).toHaveLength(0);
  });
});
