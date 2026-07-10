/**
 * @module dm-46.test
 *
 * Card test: Aware of their Ways (dm-46)
 * Type: hazard-event (short), non-unique
 * Effects: 1
 *   1. reveal-remove-from-discard — count 4
 *
 * Card text: "Opponent reveals four cards at random from his discard pile. You
 *  may choose a non-unique one and remove it from play. Opponent discards the
 *  other three."
 *
 * When the hazard player plays this short-event, it resolves on the chain and
 * reveals a random subset (up to four) of the **opponent's** (resource player's)
 * discard pile to the card-player. Among the revealed cards, the non-unique ones
 * (sites treated as unique per the French errata) may be picked: the card-player
 * may choose exactly one to remove from the game (moved to the owner's
 * out-of-play pile) or decline. The un-chosen revealed cards stay in the discard
 * pile.
 *
 * Engine Support:
 * | # | Feature                                             | Status      | Notes                                        |
 * |---|-----------------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Play from hand as an untargeted hazard short        | IMPLEMENTED | generic play-hazards fallthrough             |
 * | 2 | Reveal up to 4 random opponent discard cards        | IMPLEMENTED | shuffle(pile) → revealInstances (up to 4)    |
 * | 3 | Offer only non-unique revealed cards for removal    | IMPLEMENTED | reveal-remove-from-discard pending           |
 * | 4 | Unique cards / sites are never removable            | IMPLEMENTED | unique !== true && !isSiteCard filter        |
 * | 5 | Remove chosen card from play (out-of-play pile)     | IMPLEMENTED | discard → outOfPlayPile on resolution        |
 * | 6 | "You may" — declining removes nothing               | IMPLEMENTED | pass path on the pending resolution          |
 * | 7 | Un-chosen revealed cards stay in the discard pile   | IMPLEMENTED | only the chosen instance leaves discard      |
 * | 8 | Empty discard pile → the event fizzles              | IMPLEMENTED | no pending enqueued                          |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI, BILBO,
  STING, CRAM, HORN_OF_ANOR, CAVE_DRAKE, ORC_WARBAND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint, makeMHState,
  viableActions, viableFor, dispatch, resolveChain,
  findHandCardId, assertEveryInstanceReachable,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const AWARE = 'dm-46' as CardDefinitionId;

/** Instance id of the (first) card matching `defId` in the resource player's discard pile. */
function discardId(state: GameState, defId: CardDefinitionId): CardInstanceId {
  const card = state.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === defId);
  expect(card).toBeDefined();
  return card!.instanceId;
}

/**
 * Build an M/H state with PLAYER_1 (resource) active at Moria and PLAYER_2
 * (hazard) holding Aware of their Ways. `resourceDiscard` seeds the resource
 * player's discard pile (the pile the card reveals from).
 */
function buildAware(resourceDiscard: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        discardPile: resourceDiscard,
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [AWARE],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...base, phaseState: makeMHState() };
}

/** Play Aware of their Ways (by the hazard player) and resolve the chain. */
function playAware(state: GameState): GameState {
  const cardId = findHandCardId(state, HAZARD_PLAYER, AWARE);
  const play = viableActions(state, PLAYER_2, 'play-hazard')
    .find(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === cardId);
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!.action));
}

/** The pending reveal-remove-from-discard resolution, if any. */
function removePending(state: GameState) {
  return state.pendingResolutions.find(r => r.kind.type === 'reveal-remove-from-discard');
}

/** The instance ids offered for removal by the pending resolution (empty if none). */
function removableIds(state: GameState): CardInstanceId[] {
  const pending = removePending(state);
  if (!pending || pending.kind.type !== 'reveal-remove-from-discard') return [];
  return [...pending.kind.removableInstanceIds];
}

describe('Aware of their Ways (dm-46)', () => {
  beforeEach(() => resetMint());

  test('reveals the opponent discard pile and offers only the non-unique cards for removal', () => {
    // Pile of 4 (≤ count): all revealed regardless of RNG. 3 non-unique + Sting (unique).
    const state = buildAware([CRAM, HORN_OF_ANOR, CAVE_DRAKE, STING]);
    const cramId = discardId(state, CRAM);
    const hornId = discardId(state, HORN_OF_ANOR);
    const caveId = discardId(state, CAVE_DRAKE);
    const stingId = discardId(state, STING);

    const resolved = playAware(state);

    // All four revealed to the card-player.
    for (const id of [cramId, hornId, caveId, stingId]) {
      expect(resolved.revealedInstances[id]).toBeDefined();
    }

    // A removal choice is offered to the hazard player, listing only the 3
    // non-unique cards (Sting, being unique, is not removable).
    const pending = removePending(resolved);
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_2);
    const removable = removableIds(resolved);
    expect(new Set(removable)).toEqual(new Set([cramId, hornId, caveId]));

    // Legal actions: one remove per non-unique card, plus a pass ("You may").
    const removeChoices = viableActions(resolved, PLAYER_2, 'remove-revealed-card')
      .map(a => (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
    expect(new Set(removeChoices)).toEqual(new Set([cramId, hornId, caveId]));
    expect(viableActions(resolved, PLAYER_2, 'pass')).toHaveLength(1);
    // Sting is never offered.
    expect(removeChoices).not.toContain(stingId);
    // The opponent (resource player) waits while the choice is pending.
    expect(viableFor(resolved, PLAYER_1)).toHaveLength(0);

    assertEveryInstanceReachable(resolved);
  });

  test('removing a chosen card sends it out of play; the other three stay in the discard pile', () => {
    const state = buildAware([CRAM, HORN_OF_ANOR, CAVE_DRAKE, STING]);
    const cramId = discardId(state, CRAM);
    const hornId = discardId(state, HORN_OF_ANOR);
    const caveId = discardId(state, CAVE_DRAKE);
    const stingId = discardId(state, STING);

    const resolved = playAware(state);
    const done = dispatch(resolved, { type: 'remove-revealed-card', player: PLAYER_2, cardInstanceId: hornId });

    // The choice is consumed.
    expect(removePending(done)).toBeUndefined();

    const owner = done.players[RESOURCE_PLAYER];
    // The chosen card is removed from the game (out-of-play), not the discard.
    expect(owner.outOfPlayPile.map(c => c.instanceId)).toContain(hornId);
    expect(owner.discardPile.map(c => c.instanceId)).not.toContain(hornId);
    // The other three (including the untouchable unique Sting) remain in discard.
    const discardIds = owner.discardPile.map(c => c.instanceId);
    for (const id of [cramId, caveId, stingId]) expect(discardIds).toContain(id);

    assertEveryInstanceReachable(done);
  });

  test('the card-player may decline ("You may"); passing removes nothing', () => {
    const state = buildAware([CRAM, HORN_OF_ANOR, CAVE_DRAKE, STING]);
    const cramId = discardId(state, CRAM);
    const hornId = discardId(state, HORN_OF_ANOR);
    const caveId = discardId(state, CAVE_DRAKE);
    const stingId = discardId(state, STING);

    const resolved = playAware(state);
    const done = dispatch(resolved, { type: 'pass', player: PLAYER_2 });

    expect(removePending(done)).toBeUndefined();
    const owner = done.players[RESOURCE_PLAYER];
    // Nothing removed — all four still in the discard pile, out-of-play empty.
    expect(owner.outOfPlayPile).toHaveLength(0);
    const discardIds = owner.discardPile.map(c => c.instanceId);
    for (const id of [cramId, hornId, caveId, stingId]) expect(discardIds).toContain(id);

    assertEveryInstanceReachable(done);
  });

  test('when every revealed card is unique or a site, no removal is offered', () => {
    // Gimli, Bilbo, Sting (all unique) + Rivendell (a site, treated as unique).
    const state = buildAware([GIMLI, BILBO, STING, RIVENDELL]);
    const resolved = playAware(state);

    // The whole pile is revealed but nothing is removable → no pending choice.
    expect(removePending(resolved)).toBeUndefined();
    // The discard pile is untouched.
    expect(resolved.players[RESOURCE_PLAYER].discardPile).toHaveLength(4);
    expect(resolved.players[RESOURCE_PLAYER].outOfPlayPile).toHaveLength(0);

    assertEveryInstanceReachable(resolved);
  });

  test('a site card among the revealed cards is never removable', () => {
    // One removable non-unique (Cram) alongside a site (Rivendell) and unique Sting.
    const state = buildAware([CRAM, RIVENDELL, STING]);
    const cramId = discardId(state, CRAM);

    const resolved = playAware(state);
    const pending = removePending(resolved);
    expect(pending).toBeDefined();
    const removable = removableIds(resolved);
    // Only Cram is removable — the site and the unique are excluded.
    expect(removable).toEqual([cramId]);

    assertEveryInstanceReachable(resolved);
  });

  test('with more than four cards, exactly four are revealed at random', () => {
    // Six non-unique cards; the effect reveals a random subset of four.
    const state = buildAware([CRAM, HORN_OF_ANOR, CAVE_DRAKE, ORC_WARBAND, CRAM, HORN_OF_ANOR]);
    const pileIds = new Set(state.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId as string));

    const resolved = playAware(state);

    // Exactly four of the pile's cards were revealed to the card-player.
    const revealedFromPile = Object.keys(resolved.revealedInstances).filter(id => pileIds.has(id));
    expect(revealedFromPile).toHaveLength(4);

    // All four (non-unique) revealed cards are offered for removal, and each is a
    // distinct card that was actually in the pile.
    const pending = removePending(resolved);
    expect(pending).toBeDefined();
    const removable = removableIds(resolved);
    expect(removable).toHaveLength(4);
    expect(new Set(removable).size).toBe(4);
    for (const id of removable) expect(pileIds.has(id as string)).toBe(true);

    assertEveryInstanceReachable(resolved);
  });

  test('an empty discard pile makes the event fizzle with no choice', () => {
    const state = buildAware([]);
    const resolved = playAware(state);

    expect(removePending(resolved)).toBeUndefined();
    expect(resolved.players[RESOURCE_PLAYER].outOfPlayPile).toHaveLength(0);
    // The event card itself lands in the hazard player's discard pile.
    expect(resolved.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === AWARE)).toBe(true);

    assertEveryInstanceReachable(resolved);
  });
});
