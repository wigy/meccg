/**
 * @module le-223.test
 *
 * Card test: The Ring Leaves Its Mark (le-223)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0.
 *
 * Text:
 *   "Bring one Black Rider, Fell Rider, or Heralded Lord card from your
 *    sideboard or discard pile into your play deck and reshuffle. Alternatively,
 *    playable on your tapped Ringwraith. Make a roll—if the result is greater
 *    than 6, untap your Ringwraith. Cannot be included in a Balrog's deck."
 *
 * A dual-mode resource short-event; the player chooses one mode on play.
 *
 *   Mode 1 (fetch): retrieve one named Ringwraith mode card — Black Rider
 *   (le-170), Fell Rider (le-183), or Heralded Lord (le-190) — from the
 *   sideboard OR discard pile into the play deck (reshuffled). Modelled by a
 *   `move` (`select: target`, `from: [sideboard, discard]`, `to: deck`,
 *   `shuffleAfter`, `count: 1`) filtered to those three names. Emitted as a
 *   no-target play action; the reducer opens the shared fetch-from-pile
 *   sub-flow.
 *
 *   Mode 2 (roll to untap): "playable on your tapped Ringwraith." Modelled by a
 *   `play-target` (character, filter `target.isRevealedAvatar` + `target.status
 *   = tapped`) plus a self-enters-play `roll-then-apply` (threshold 7 = "greater
 *   than 6") whose `onSuccess` sets the target's status to untapped. Emitted as
 *   a play action carrying the avatar via `targetCharacterId`; the reducer rolls
 *   2d6 and untaps on success.
 *
 * Rule coverage:
 * | # | Rule                                                                       | Status      |
 * |---|----------------------------------------------------------------------------|-------------|
 * | 1 | Mode 1 offered (no target) when a mode card is in the sideboard             | IMPLEMENTED |
 * | 2 | Mode 1 offered when a mode card is in the discard pile                      | IMPLEMENTED |
 * | 3 | Mode 1 fetch only offers Black Rider / Fell Rider / Heralded Lord           | IMPLEMENTED |
 * | 4 | Playing mode 1 moves the mode card into the play deck and discards the event | IMPLEMENTED |
 * | 5 | Mode 2 offered on the player's own tapped Ringwraith avatar                 | IMPLEMENTED |
 * | 6 | Mode 2 not offered when the Ringwraith avatar is untapped                   | IMPLEMENTED |
 * | 7 | Mode 2 targets only the revealed avatar, not another tapped company char    | IMPLEMENTED |
 * | 8 | Mode 2 roll > 6 untaps the Ringwraith and discards the event                | IMPLEMENTED |
 * | 9 | Mode 2 roll ≤ 6 leaves the Ringwraith tapped and discards the event         | IMPLEMENTED |
 * | 10| Both modes offered when a mode card is in the pile and the avatar is tapped | IMPLEMENTED |
 * | 11| Not playable with no mode card in the pile and an untapped Ringwraith       | IMPLEMENTED |
 * | 12| Cannot be included in a Balrog's deck                                       | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, dispatchResult,
  viableActions, actionAs, findCharInstanceId, setCharStatus, expectCharStatus,
  expectInDiscardPile, pool, MINION_RESOURCES_30, HAZARD_CREATURES_12,
  MINAS_TIRITH,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { validateDeck } from '../../index.js';
import type {
  CardDefinitionId, GameState, DeckList,
  PlayShortEventAction, FetchFromPileAction,
} from '../../index.js';
import { Phase, CardStatus, Alignment } from '../../index.js';

const RING_LEAVES_MARK = 'le-223' as CardDefinitionId;
const KHAMUL = 'le-55' as CardDefinitionId;        // Ringwraith avatar (mind null)
const LUITPRAND = 'le-23' as CardDefinitionId;      // non-avatar minion man
const BLACK_RIDER = 'le-170' as CardDefinitionId;   // mode card
const FELL_RIDER = 'le-183' as CardDefinitionId;    // mode card
const HERALDED_LORD = 'le-190' as CardDefinitionId; // mode card
const BLACK_MACE = 'le-299' as CardDefinitionId;    // minion-resource-item (non-mode)
const VARIAG_CAMP = 'le-411' as CardDefinitionId;   // minion border-hold

/** A Ringwraith organization-phase state with configurable piles. */
function buildRingwraithOrg(p1: {
  characters?: CardDefinitionId[];
  sideboard?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: VARIAG_CAMP, characters: p1.characters ?? [KHAMUL] }],
        hand: [RING_LEAVES_MARK],
        sideboard: p1.sideboard ?? [],
        discardPile: p1.discardPile,
        playDeck: p1.playDeck,
        siteDeck: [VARIAG_CAMP],
      },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [] }],
        hand: [], siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

/** All viable play-short-event actions for The Ring Leaves Its Mark. */
function playActions(state: GameState): PlayShortEventAction[] {
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => actionAs<PlayShortEventAction>(ea.action));
}

/** Mode 1 (fetch) actions: no character target. */
function fetchActions(state: GameState): PlayShortEventAction[] {
  return playActions(state).filter(a => a.targetCharacterId === undefined);
}

/** Mode 2 (roll-to-untap) actions: carry the Ringwraith as targetCharacterId. */
function untapActions(state: GameState): PlayShortEventAction[] {
  return playActions(state).filter(a => a.targetCharacterId !== undefined);
}

describe('The Ring Leaves Its Mark (le-223)', () => {
  beforeEach(() => resetMint());

  // ─── Mode 1: fetch a mode card into the play deck ────────────────────────────

  test('mode 1 is offered (no target) when a mode card is in the sideboard', () => {
    const state = buildRingwraithOrg({ sideboard: [BLACK_RIDER] });
    const fetches = fetchActions(state);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].targetCharacterId).toBeUndefined();
  });

  test('mode 1 is offered when a mode card is in the discard pile', () => {
    const state = buildRingwraithOrg({ discardPile: [FELL_RIDER] });
    expect(fetchActions(state)).toHaveLength(1);
  });

  test('mode 1 is NOT offered when the pile holds only non-mode cards (and no tapped Ringwraith)', () => {
    // A non-mode minion resource in the sideboard does not enable the fetch, and
    // the untapped Ringwraith avatar cannot pay mode 2 → the card is not playable.
    const state = buildRingwraithOrg({ sideboard: [BLACK_MACE] });
    expect(playActions(state)).toHaveLength(0);
  });

  test('mode 1 fetch only offers Black Rider / Fell Rider / Heralded Lord', () => {
    const state = buildRingwraithOrg({
      sideboard: [BLACK_RIDER, HERALDED_LORD, BLACK_MACE, LUITPRAND],
      discardPile: [FELL_RIDER],
      playDeck: [VARIAG_CAMP],
    });
    const afterPlay = dispatch(state, fetchActions(state)[0]);
    const offers = viableActions(afterPlay, PLAYER_1, 'fetch-from-pile')
      .map(ea => actionAs<FetchFromPileAction>(ea.action));

    const fetchedDefs = offers.map(o => {
      const src = o.source === 'sideboard'
        ? afterPlay.players[RESOURCE_PLAYER].sideboard
        : afterPlay.players[RESOURCE_PLAYER].discardPile;
      return src.find(c => c.instanceId === o.cardInstanceId)?.definitionId;
    });
    // Three mode cards across both piles; Black Mace and Luitprand excluded.
    expect(fetchedDefs.filter(Boolean).sort()).toEqual([BLACK_RIDER, FELL_RIDER, HERALDED_LORD].sort());
  });

  test('playing mode 1 moves the chosen mode card into the play deck and discards the event', () => {
    const state = buildRingwraithOrg({ sideboard: [BLACK_RIDER], playDeck: [VARIAG_CAMP] });
    const eventInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const riderInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const deckBefore = state.players[RESOURCE_PLAYER].playDeck.length;

    const afterPlay = dispatch(state, fetchActions(state)[0]);
    // A single count-1 fetch-to-deck sub-flow is open.
    expect(afterPlay.pendingEffects).toHaveLength(1);
    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: riderInst, source: 'sideboard',
    });

    // Black Rider now in the play deck; sideboard emptied; sub-flow cleared.
    expect(afterFetch.players[RESOURCE_PLAYER].playDeck.length).toBe(deckBefore + 1);
    expect(afterFetch.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toContain(riderInst);
    expect(afterFetch.players[RESOURCE_PLAYER].sideboard).toHaveLength(0);
    expect(afterFetch.pendingEffects).toHaveLength(0);
    // The event itself lands in the discard pile.
    expectInDiscardPile(afterFetch, RESOURCE_PLAYER, eventInst);
  });

  // ─── Mode 2: roll to untap the Ringwraith ────────────────────────────────────

  test('mode 2 is offered on the player\'s own tapped Ringwraith avatar', () => {
    const untapped = buildRingwraithOrg({});
    const state = setCharStatus(untapped, RESOURCE_PLAYER, KHAMUL, CardStatus.Tapped);
    const khamulId = findCharInstanceId(state, RESOURCE_PLAYER, KHAMUL);

    const untaps = untapActions(state);
    expect(untaps).toHaveLength(1);
    expect(untaps[0].targetCharacterId).toBe(khamulId);
  });

  test('mode 2 is NOT offered when the Ringwraith avatar is untapped', () => {
    // Untapped avatar, no mode card in the pile → no playable mode at all.
    const state = buildRingwraithOrg({});
    expect(untapActions(state)).toHaveLength(0);
    expect(playActions(state)).toHaveLength(0);
  });

  test('mode 2 targets only the revealed avatar, not another tapped company character', () => {
    const base = buildRingwraithOrg({ characters: [KHAMUL, LUITPRAND] });
    let state = setCharStatus(base, RESOURCE_PLAYER, KHAMUL, CardStatus.Tapped);
    state = setCharStatus(state, RESOURCE_PLAYER, LUITPRAND, CardStatus.Tapped);
    const khamulId = findCharInstanceId(state, RESOURCE_PLAYER, KHAMUL);
    const luitId = findCharInstanceId(state, RESOURCE_PLAYER, LUITPRAND);

    const untaps = untapActions(state);
    expect(untaps).toHaveLength(1);
    expect(untaps[0].targetCharacterId).toBe(khamulId);
    expect(untaps.some(a => a.targetCharacterId === luitId)).toBe(false);
  });

  test('mode 2 roll greater than 6 untaps the Ringwraith and discards the event', () => {
    const base = buildRingwraithOrg({});
    const state = setCharStatus(base, RESOURCE_PLAYER, KHAMUL, CardStatus.Tapped);
    const eventInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const action = untapActions(state)[0];

    // Force a roll of 7 (> 6) via cheatRollTotal.
    const result = dispatchResult({ ...state, cheatRollTotal: 7 }, action);
    const next = result.state;

    expectCharStatus(next, RESOURCE_PLAYER, KHAMUL, CardStatus.Untapped);
    expectInDiscardPile(next, RESOURCE_PLAYER, eventInst);
    expect(next.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    // The roll is surfaced to clients as a dice-roll effect.
    expect(result.effects?.some(e => e.effect === 'dice-roll')).toBe(true);
  });

  test('mode 2 roll of 6 or less leaves the Ringwraith tapped and discards the event', () => {
    const base = buildRingwraithOrg({});
    const state = setCharStatus(base, RESOURCE_PLAYER, KHAMUL, CardStatus.Tapped);
    const eventInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const action = untapActions(state)[0];

    // Force a roll of 6 (not > 6) — the Ringwraith stays tapped.
    const next = dispatch({ ...state, cheatRollTotal: 6 }, action);

    expectCharStatus(next, RESOURCE_PLAYER, KHAMUL, CardStatus.Tapped);
    expectInDiscardPile(next, RESOURCE_PLAYER, eventInst);
  });

  // ─── Dual-mode availability ──────────────────────────────────────────────────

  test('both modes are offered when a mode card is in the pile and the avatar is tapped', () => {
    const base = buildRingwraithOrg({ sideboard: [BLACK_RIDER] });
    const state = setCharStatus(base, RESOURCE_PLAYER, KHAMUL, CardStatus.Tapped);
    expect(fetchActions(state)).toHaveLength(1);
    expect(untapActions(state)).toHaveLength(1);
  });

  test('not playable with an untapped Ringwraith and no mode card in the pile', () => {
    const state = buildRingwraithOrg({ sideboard: [BLACK_MACE], discardPile: [LUITPRAND] });
    expect(playActions(state)).toHaveLength(0);
  });

  // ─── Cannot be included in a Balrog's deck ───────────────────────────────────

  test('a Balrog deck containing The Ring Leaves Its Mark is rejected by deck validation', () => {
    const deck: DeckList = {
      id: 'test-balrog-ring-leaves-mark',
      name: 'Balrog Ring Leaves Its Mark',
      alignment: 'balrog',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [{ name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...MINION_RESOURCES_30, { name: 'The Ring Leaves Its Mark', card: RING_LEAVES_MARK, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === RING_LEAVES_MARK)).toBe(true);
  });
});
