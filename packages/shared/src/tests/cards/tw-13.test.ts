/**
 * @module tw-13.test
 *
 * Card test: Bane of the Ithil-stone (tw-13)
 * Type: hazard-event, permanent. Non-unique.
 *
 * Card text:
 *   "Corruption points for Palantíri are doubled. Automatically cancels any
 *    effect that causes a player to search through or look at any portion of a
 *    play deck or a discard pile outside of the normal sequence of play.
 *    Discard Bane of the Ithil-stone whenever a play deck is exhausted. This
 *    card has no effect on a minion player. Cannot be duplicated."
 *
 * Effects: 4
 *   1. `in-play-item-modifier` — `itemFilter { item.keywords $includes palantir }`,
 *      `bearerFilter { bearer.minion: false }`, `corruptionMultiplier: 2`
 *   2. `cancel-deck-search` — `affects: "non-minion"` (the mirror of Lady of the
 *      Golden Wood as-13, which is `affects: "minion"`)
 *   3. `on-event play-deck-exhausted` → self-discard `move`
 *   4. `duplication-limit` — scope `game`, max 1
 *
 * "This card has no effect on a minion player" is not modelled as a play
 * restriction: the card may legally be played into any game, it simply skips
 * Ringwraith and Balrog players (both are minion players — MEBA). That is
 * encoded once per rule, via the `bearerFilter` on the corruption doubling and
 * via `affects: "non-minion"` on the search cancel.
 *
 * Rule coverage:
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Playable as a hazard permanent-event; stays in play            | IMPLEMENTED |
 * | 2 | Corruption points for Palantíri are doubled                    | IMPLEMENTED |
 * | 3 | Non-Palantír items are untouched                               | IMPLEMENTED |
 * | 4 | Doubling reaches both players' (non-minion) Palantíri          | IMPLEMENTED |
 * | 5 | No effect on a minion player — corruption not doubled          | IMPLEMENTED |
 * | 6 | Cancels a non-minion player's play-deck / discard-pile search  | IMPLEMENTED |
 * | 7 | Sideboard access survives the cancel                           | IMPLEMENTED |
 * | 8 | No effect on a minion player — his searches are NOT canceled   | IMPLEMENTED |
 * | 9 | Discard whenever a play deck is exhausted                      | IMPLEMENTED |
 * |10 | Cannot be duplicated                                           | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE,
  RANGERS_OF_THE_NORTH, PALANTIR_OF_ORTHANC, DAGGER_OF_WESTERNESSE, SMOKE_RINGS,
  buildTestState, resetMint, makeMHState, makePlayDeck,
  addCardInPlay, attachItemToChar, attachAllyToChar,
  charIdAt, handCardId, findCharInstanceId,
  viableActions, dispatch, reduce, resolveChain, playHazardAndResolve,
  P1_COMPANY, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { Phase, Alignment, CardStatus } from '../../index.js';
import type {
  ActivateGrantedAction, CardDefinitionId, CardInPlay, CardInstanceId,
  EndOfTurnPhaseState, GameState,
} from '../../index.js';

const BANE = 'tw-13' as CardDefinitionId;

// Palantíri (shared: PALANTIR_OF_ORTHANC tw-300, printed corruption 2) and a
// control item (shared: DAGGER_OF_WESTERNESSE tw-206, printed corruption 1).
const PALANTIR_OF_ELOSTIRION = 'tw-298' as CardDefinitionId;   // hero, palantír, cp 2
const PALANTIR_MINAS_TIRITH_LE = 'le-333' as CardDefinitionId; // minion, palantír, cp 3

// Search fixtures (shared: SMOKE_RINGS dm-159, a sideboard+discard fetch).
const MISTRESS_LOBELIA = 'dm-178' as CardDefinitionId;   // hero ally: discard+deck tutor
const LOBELIA_FETCH = 'lobelia-fetch-playable';
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;    // filler discard-pile card
const AKHORAHIL = 'le-51' as CardDefinitionId;           // Ringwraith avatar
const AKHORAHIL_UNLEASHED = 'le-162' as CardDefinitionId; // minion deck+discard tutor
const DEEPER_SHADOW = 'le-179' as CardDefinitionId;      // minion magic card (fetch target)

// Minion sites.
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;

describe('Bane of the Ithil-stone (tw-13)', () => {
  beforeEach(() => resetMint());

  // ─── #1: playable as a hazard permanent-event ─────────────────────────────

  test('P2 may play it during the M/H play-hazards step; it enters play and stays', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BANE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState() };

    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(1);

    const baneId = handCardId(state, HAZARD_PLAYER);
    const after = playHazardAndResolve(state, PLAYER_2, baneId, P1_COMPANY);

    expect(after.chain).toBeNull();
    expect(after.players[1].hand).toHaveLength(0);
    expect(after.players[1].cardsInPlay.map(c => c.instanceId)).toContain(baneId);
  });

  // ─── #10: cannot be duplicated ────────────────────────────────────────────

  test('a second copy is unplayable while one is already in play', () => {
    const baneInPlay: CardInPlay = {
      instanceId: 'bane-1' as CardInstanceId,
      definitionId: BANE,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BANE], siteDeck: [MINAS_TIRITH], cardsInPlay: [baneInPlay],
        },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState() };

    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── #2/#3/#4/#5: corruption points for Palantíri are doubled ─────────────

  /** Organization-phase fixture: hero P1 vs hero P2 (both non-minion). */
  function heroVsHero(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
  }

  test('a hero bearer\'s Palantír corruption doubles from 2 to 4', () => {
    const base = heroVsHero();
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    const withPalantir = recomputeDerived(
      attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PALANTIR_OF_ORTHANC));
    expect(withPalantir.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(2);

    const withBane = recomputeDerived(addCardInPlay(withPalantir, HAZARD_PLAYER, BANE));
    expect(withBane.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(4);
  });

  test('two Palantíri on one bearer are each doubled (2 + 2 → 8)', () => {
    const base = heroVsHero();
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    const withTwo = attachItemToChar(
      attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PALANTIR_OF_ORTHANC),
      RESOURCE_PLAYER, ARAGORN, PALANTIR_OF_ELOSTIRION);
    expect(recomputeDerived(withTwo).players[RESOURCE_PLAYER].characters[aragornId]
      .effectiveStats.corruptionPoints).toBe(4);

    const withBane = recomputeDerived(addCardInPlay(withTwo, HAZARD_PLAYER, BANE));
    expect(withBane.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(8);
  });

  test('a non-Palantír item is untouched (Dagger of Westernesse stays at 1)', () => {
    const base = heroVsHero();
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const withBane = recomputeDerived(addCardInPlay(withItem, HAZARD_PLAYER, BANE));
    expect(withBane.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(1);
  });

  test('the doubling also hits the Bane owner\'s own hero Palantír', () => {
    const base = heroVsHero();
    const legolasId = charIdAt(base, HAZARD_PLAYER);

    const withPalantir = attachItemToChar(base, HAZARD_PLAYER, LEGOLAS, PALANTIR_OF_ORTHANC);
    const withBane = recomputeDerived(addCardInPlay(withPalantir, HAZARD_PLAYER, BANE));
    expect(withBane.players[HAZARD_PLAYER].characters[legolasId].effectiveStats.corruptionPoints).toBe(4);
  });

  test('no effect on a minion player: his Palantír keeps its printed corruption', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [AKHORAHIL] }],
          hand: [], siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const akhId = charIdAt(base, RESOURCE_PLAYER);

    const withPalantir = recomputeDerived(
      attachItemToChar(base, RESOURCE_PLAYER, AKHORAHIL, PALANTIR_MINAS_TIRITH_LE));
    expect(withPalantir.players[RESOURCE_PLAYER].characters[akhId].effectiveStats.corruptionPoints).toBe(3);

    const withBane = recomputeDerived(addCardInPlay(withPalantir, HAZARD_PLAYER, BANE));
    expect(withBane.players[RESOURCE_PLAYER].characters[akhId].effectiveStats.corruptionPoints).toBe(3);
  });

  test('the doubling ends when the Bane leaves play', () => {
    const base = heroVsHero();
    const aragornId = charIdAt(base, RESOURCE_PLAYER);

    const withBane = recomputeDerived(addCardInPlay(
      attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PALANTIR_OF_ORTHANC), HAZARD_PLAYER, BANE));
    expect(withBane.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(4);

    const p2 = withBane.players[HAZARD_PLAYER];
    const bane = p2.cardsInPlay.find(c => c.definitionId === BANE);
    if (!bane) throw new Error('tw-13 not in P2 cardsInPlay');
    const without = recomputeDerived({
      ...withBane,
      players: [
        withBane.players[0],
        {
          ...p2,
          cardsInPlay: p2.cardsInPlay.filter(c => c.instanceId !== bane.instanceId),
          discardPile: [...p2.discardPile, { instanceId: bane.instanceId, definitionId: bane.definitionId }],
        },
      ] as unknown as typeof withBane.players,
    });
    expect(without.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(2);
  });

  // ─── #6: cancels a non-minion player's deck / discard search ──────────────

  /** Hero P1 at Bree with Mistress Lobelia (a discard+deck tutor) on Aragorn. */
  function lobeliaState(withBane: boolean): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [], siteDeck: [RIVENDELL],
          discardPile: [RANGERS_OF_THE_NORTH],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, MISTRESS_LOBELIA);
    return withBane ? addCardInPlay(withAlly, HAZARD_PLAYER, BANE) : withAlly;
  }

  const lobeliaFetchAction = (state: GameState) =>
    viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === LOBELIA_FETCH);

  test('control: without the Bane, the hero tutor opens a deck+discard fetch', () => {
    const state = lobeliaState(false);
    const after = dispatch(state, lobeliaFetchAction(state)[0].action);

    expect(after.pendingEffects).toHaveLength(1);
    const effect = (after.pendingEffects[0] as { effect: { source?: readonly string[] } }).effect;
    expect(effect.source).toEqual(['discard-pile', 'deck']);
  });

  test('the same hero tutor is canceled outright while the Bane is in play', () => {
    const state = lobeliaState(true);
    const activate = lobeliaFetchAction(state)[0];
    const result = reduce(state, activate.action);

    // Every source of the search is a play deck / discard pile → nothing is
    // left to search, so the ability cannot resolve and no fetch is enqueued.
    expect(result.error).toBeDefined();
    expect(result.state.pendingEffects).toHaveLength(0);
    const aragornId = findCharInstanceId(result.state, RESOURCE_PLAYER, ARAGORN);
    const ally = result.state.players[0].characters[aragornId].allies
      .find(a => a.definitionId === MISTRESS_LOBELIA);
    expect(ally?.status).toBe(CardStatus.Untapped);
  });

  // ─── #7: sideboard access survives ────────────────────────────────────────

  test('Smoke Rings loses only its discard-pile arm; the sideboard arm survives', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [SMOKE_RINGS],
          discardPile: [STRANGE_RATIONS],
          sideboard: [DAGGER_OF_WESTERNESSE],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, BANE);
    const eventId = handCardId(state, RESOURCE_PLAYER);

    const after = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1, cardInstanceId: eventId,
    }));

    expect(after.pendingEffects).toHaveLength(1);
    const effect = after.pendingEffects[0].effect as { type: string; source: readonly string[] };
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.source).toContain('sideboard');
    expect(effect.source).not.toContain('discard-pile');
  });

  // ─── #8: a minion player's searches are NOT canceled ──────────────────────

  test('no effect on a minion player: his deck+discard tutor still offers both piles', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [AKHORAHIL] }],
          hand: [AKHORAHIL_UNLEASHED],
          playDeck: [DEEPER_SHADOW],
          discardPile: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, BANE);
    const akhId = findCharInstanceId(state, RESOURCE_PLAYER, AKHORAHIL);
    const eventId = handCardId(state, RESOURCE_PLAYER);

    const after = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1, cardInstanceId: eventId,
      targetCharacterId: akhId,
    }));

    expect(after.pendingEffects).toHaveLength(1);
    const effect = after.pendingEffects[0].effect as { type: string; source: readonly string[] };
    expect(effect.source).toContain('deck');
    expect(effect.source).toContain('discard-pile');
  });

  // ─── #9: discard whenever a play deck is exhausted ────────────────────────

  /** End-of-turn reset-hand state with the Bane in P2's (hazard) cardsInPlay. */
  function exhaustState(exhaustingPlayer: 0 | 1): GameState {
    const emptyDeckSide = {
      playDeck: [] as CardDefinitionId[],
      discardPile: [STRANGE_RATIONS],
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [], siteDeck: [MINAS_TIRITH],
          ...(exhaustingPlayer === 0 ? emptyDeckSide : {}),
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [], siteDeck: [MINAS_TIRITH],
          ...(exhaustingPlayer === 1 ? emptyDeckSide : {}),
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: (exhaustingPlayer === 0 ? [false, true] : [true, false]) as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    return addCardInPlay(resetHandState, HAZARD_PLAYER, BANE);
  }

  test('discarded when the opponent\'s play deck exhausts', () => {
    const state = exhaustState(0);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_1 });
    // Still in play until the exhaust sub-flow completes.
    expect(afterExhaust.players[1].cardsInPlay.some(c => c.definitionId === BANE)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[1].cardsInPlay.some(c => c.definitionId === BANE)).toBe(false);
    expect(afterPass.players[1].discardPile.some(c => c.definitionId === BANE)).toBe(true);
  });

  test('discarded when its own controller\'s play deck exhausts', () => {
    const state = exhaustState(1);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[1].cardsInPlay.some(c => c.definitionId === BANE)).toBe(false);
    // Own deck exhausting: CRF 22 "Exhausted" shuffles the discard into the new play deck.
    expect(afterPass.players[1].discardPile.some(c => c.definitionId === BANE)).toBe(false);
    expect(afterPass.players[1].playDeck.some(c => c.definitionId === BANE)).toBe(true);
  });

  // ─── the doubling is gone once the Bane is discarded on exhaustion ────────

  test('after the exhaustion discard the Palantír corruption is back to printed', () => {
    const base = exhaustState(0);
    const withPalantir = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PALANTIR_OF_ORTHANC);
    const aragornId = charIdAt(withPalantir, RESOURCE_PLAYER);
    expect(recomputeDerived(withPalantir).players[RESOURCE_PLAYER]
      .characters[aragornId].effectiveStats.corruptionPoints).toBe(4);

    const afterPass = dispatch(
      dispatch(withPalantir, { type: 'deck-exhaust', player: PLAYER_1 }),
      { type: 'pass', player: PLAYER_1 });
    expect(recomputeDerived(afterPass).players[RESOURCE_PLAYER]
      .characters[aragornId].effectiveStats.corruptionPoints).toBe(2);
  });
});
