/**
 * @module wh-18.test
 *
 * Card test: Flotsam and Jetsam (wh-18)
 * Type: hazard-event, permanent. Non-unique.
 *
 * Card text:
 *   "If a player has 15 or fewer cards in his play deck (20 or fewer if a
 *    Fallen-wizard), all effects are automatically canceled which allow him to
 *    search through or look at any portion of his play deck or discard pile
 *    outside of the normal sequence of play. Discard when any play deck is
 *    exhausted. Cannot be duplicated."
 *
 * Effects: 3
 *   1. `cancel-deck-search` — `affects: "all"` (every player, whatever his
 *      alignment) gated by a `when` over the acting player's own context
 *      `{ player: { alignment, playDeckSize } }`: a non-Fallen-wizard at 15 or
 *      fewer cards, a Fallen-wizard at 20 or fewer. The gate is re-evaluated
 *      per search, so a player falls under the cancel the moment his deck
 *      crosses the threshold.
 *   2. `on-event play-deck-exhausted` → self-discard `move`
 *   3. `duplication-limit` — scope `game`, max 1
 *
 * Unlike its two siblings — Lady of the Golden Wood (as-13, `affects:
 * "minion"`) and Bane of the Ithil-stone (tw-13, `affects: "non-minion"`) —
 * this card picks its victims by deck size rather than by alignment, so hero,
 * Fallen-wizard and minion players are all equally exposed once their deck
 * runs low. Alignment enters only through the higher Fallen-wizard threshold.
 *
 * Rule coverage:
 * | # | Rule                                                            | Status      |
 * |---|-----------------------------------------------------------------|-------------|
 * | 1 | Playable as a hazard permanent-event; stays in play              | IMPLEMENTED |
 * | 2 | Hero player at 15 cards: his deck/discard search is canceled     | IMPLEMENTED |
 * | 3 | Hero player at 16 cards: his search is untouched                 | IMPLEMENTED |
 * | 4 | Fallen-wizard at 20 cards: his search is canceled                | IMPLEMENTED |
 * | 5 | Fallen-wizard at 21 cards: his search is untouched               | IMPLEMENTED |
 * | 6 | Minion player at 15 cards: his search is canceled too            | IMPLEMENTED |
 * | 7 | Minion player at 16 cards: his search is untouched               | IMPLEMENTED |
 * | 8 | Only play-deck / discard-pile access is cut; sideboard survives   | IMPLEMENTED |
 * | 9 | Applies to the card's own controller as well as his opponent     | IMPLEMENTED |
 * |10 | Discard when any play deck is exhausted                          | IMPLEMENTED |
 * |11 | Cannot be duplicated                                             | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, SARUMAN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE,
  RANGERS_OF_THE_NORTH, DAGGER_OF_WESTERNESSE, SMOKE_RINGS,
  buildTestState, resetMint, makeMHState, makePlayDeck,
  addCardInPlay, attachAllyToChar,
  handCardId, findCharInstanceId,
  viableActions, dispatch, reduce, resolveChain, playHazardAndResolve,
  P1_COMPANY, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, CardStatus } from '../../index.js';
import type {
  ActivateGrantedAction, CardDefinitionId, CardInPlay, CardInstanceId,
  EndOfTurnPhaseState, GameState,
} from '../../index.js';

const FLOTSAM = 'wh-18' as CardDefinitionId;

// Search fixtures.
const MISTRESS_LOBELIA = 'dm-178' as CardDefinitionId;   // hero ally: discard+deck tutor
const LOBELIA_FETCH = 'lobelia-fetch-playable';
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;    // filler discard-pile card
const AKHORAHIL = 'le-51' as CardDefinitionId;           // Ringwraith avatar
const AKHORAHIL_UNLEASHED = 'le-162' as CardDefinitionId; // minion deck+discard tutor
const DEEPER_SHADOW = 'le-179' as CardDefinitionId;      // minion magic card (fetch target)

// Minion sites.
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;

/** A play deck of exactly `n` cards, drawn from the shared fixture deck. */
const deckOf = (n: number): CardDefinitionId[] => {
  const base = makePlayDeck();
  const out: CardDefinitionId[] = [];
  while (out.length < n) out.push(base[out.length % base.length]);
  return out;
};

describe('Flotsam and Jetsam (wh-18)', () => {
  beforeEach(() => resetMint());

  // ─── #1: playable as a hazard permanent-event ─────────────────────────────

  test('P2 may play it during the M/H play-hazards step; it enters play and stays', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FLOTSAM], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState() };

    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(1);

    const flotsamId = handCardId(state, HAZARD_PLAYER);
    const after = playHazardAndResolve(state, PLAYER_2, flotsamId, P1_COMPANY);

    expect(after.chain).toBeNull();
    expect(after.players[1].hand).toHaveLength(0);
    expect(after.players[1].cardsInPlay.map(c => c.instanceId)).toContain(flotsamId);
  });

  // ─── #11: cannot be duplicated ────────────────────────────────────────────

  test('a second copy is unplayable while one is already in play', () => {
    const inPlay: CardInPlay = {
      instanceId: 'flotsam-1' as CardInstanceId,
      definitionId: FLOTSAM,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [FLOTSAM], siteDeck: [MINAS_TIRITH], cardsInPlay: [inPlay],
        },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState() };

    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── #2/#3/#4/#5/#9: the deck-size gate, hero and Fallen-wizard ───────────

  /**
   * P1 (alignment `align`, `deckSize` cards left) has Mistress Lobelia — a
   * deck+discard tutor — on his avatar at Bree. Flotsam and Jetsam sits in
   * `flotsamOwner`'s cardsInPlay (default: the opponent's).
   */
  const lobeliaState = (opts: {
    align?: Alignment;
    deckSize: number;
    withFlotsam?: boolean;
    flotsamOwner?: 0 | 1;
  }): GameState => {
    const leader = opts.align === Alignment.FallenWizard ? SARUMAN : ARAGORN;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          ...(opts.align ? { alignment: opts.align } : {}),
          companies: [{ site: BREE, characters: [leader] }],
          hand: [], siteDeck: [RIVENDELL],
          discardPile: [RANGERS_OF_THE_NORTH],
          playDeck: deckOf(opts.deckSize),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, leader, MISTRESS_LOBELIA);
    return opts.withFlotsam === false
      ? withAlly
      : addCardInPlay(withAlly, opts.flotsamOwner ?? HAZARD_PLAYER, FLOTSAM);
  };

  const lobeliaFetchAction = (state: GameState) =>
    viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === LOBELIA_FETCH);

  test('control: with no Flotsam in play the hero tutor opens a deck+discard fetch', () => {
    const state = lobeliaState({ deckSize: 15, withFlotsam: false });
    const after = dispatch(state, lobeliaFetchAction(state)[0].action);

    expect(after.pendingEffects).toHaveLength(1);
    const effect = (after.pendingEffects[0] as { effect: { source?: readonly string[] } }).effect;
    expect(effect.source).toEqual(['discard-pile', 'deck']);
  });

  test('a hero player with 15 cards left has the whole tutor canceled', () => {
    const state = lobeliaState({ deckSize: 15 });
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

  test('a hero player with 16 cards left is above the threshold and searches freely', () => {
    const state = lobeliaState({ deckSize: 16 });
    const after = dispatch(state, lobeliaFetchAction(state)[0].action);

    expect(after.pendingEffects).toHaveLength(1);
    const effect = (after.pendingEffects[0] as { effect: { source?: readonly string[] } }).effect;
    expect(effect.source).toEqual(['discard-pile', 'deck']);
  });

  test('a Fallen-wizard gets the higher threshold: 20 cards left is still canceled', () => {
    const state = lobeliaState({ align: Alignment.FallenWizard, deckSize: 20 });
    const result = reduce(state, lobeliaFetchAction(state)[0].action);

    expect(result.error).toBeDefined();
    expect(result.state.pendingEffects).toHaveLength(0);
  });

  test('a Fallen-wizard with 21 cards left searches freely', () => {
    const state = lobeliaState({ align: Alignment.FallenWizard, deckSize: 21 });
    const after = dispatch(state, lobeliaFetchAction(state)[0].action);

    expect(after.pendingEffects).toHaveLength(1);
    const effect = (after.pendingEffects[0] as { effect: { source?: readonly string[] } }).effect;
    expect(effect.source).toEqual(['discard-pile', 'deck']);
  });

  test('a hero player does NOT get the Fallen-wizard threshold at 20 cards', () => {
    // 20 would trip the Fallen-wizard branch, but this player is a Wizard, so
    // only the 15-card branch can apply — and it does not match at 20.
    const state = lobeliaState({ deckSize: 20 });
    const after = dispatch(state, lobeliaFetchAction(state)[0].action);
    expect(after.pendingEffects).toHaveLength(1);
  });

  // ─── #9: the controller's own searches are canceled too ───────────────────

  test('the cancel hits the searching player even when he owns the card himself', () => {
    const state = lobeliaState({ deckSize: 15, flotsamOwner: RESOURCE_PLAYER });
    const result = reduce(state, lobeliaFetchAction(state)[0].action);

    expect(result.error).toBeDefined();
    expect(result.state.pendingEffects).toHaveLength(0);
  });

  // ─── #8: sideboard access survives ────────────────────────────────────────

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
          playDeck: deckOf(15),
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, FLOTSAM);
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

  // ─── #6/#7: a minion player is hit exactly like everyone else ─────────────

  /** Ringwraith P1 with Akhôrahil Unleashed (a deck+discard tutor) in hand. */
  const minionTutorState = (deckSize: number, withFlotsam: boolean): GameState => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [AKHORAHIL] }],
          hand: [AKHORAHIL_UNLEASHED],
          playDeck: deckOf(deckSize),
          discardPile: [DEEPER_SHADOW],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    return withFlotsam ? addCardInPlay(base, HAZARD_PLAYER, FLOTSAM) : base;
  };

  test('a minion player with 15 cards left has his tutor canceled as well', () => {
    const state = minionTutorState(15, true);
    const akhId = findCharInstanceId(state, RESOURCE_PLAYER, AKHORAHIL);
    const eventId = handCardId(state, RESOURCE_PLAYER);

    const after = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1, cardInstanceId: eventId,
      targetCharacterId: akhId,
    }));

    expect(after.pendingEffects).toHaveLength(0);
  });

  test('a minion player with 16 cards left keeps both piles', () => {
    const state = minionTutorState(16, true);
    const akhId = findCharInstanceId(state, RESOURCE_PLAYER, AKHORAHIL);
    const eventId = handCardId(state, RESOURCE_PLAYER);

    const after = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1, cardInstanceId: eventId,
      targetCharacterId: akhId,
    }));

    expect(after.pendingEffects).toHaveLength(1);
    const effect = after.pendingEffects[0].effect as { source: readonly string[] };
    expect(effect.source).toContain('deck');
    expect(effect.source).toContain('discard-pile');
  });

  // ─── #10: discard when any play deck is exhausted ─────────────────────────

  /** End-of-turn reset-hand state with Flotsam in P2's (hazard) cardsInPlay. */
  const exhaustState = (exhaustingPlayer: 0 | 1): GameState => {
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
    const resetHandState: GameState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: (exhaustingPlayer === 0 ? [false, true] : [true, false]) as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    return addCardInPlay(resetHandState, HAZARD_PLAYER, FLOTSAM);
  };

  test('discarded when the opponent\'s play deck exhausts', () => {
    const state = exhaustState(0);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_1 });
    // Still in play until the exhaust sub-flow completes.
    expect(afterExhaust.players[1].cardsInPlay.some(c => c.definitionId === FLOTSAM)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[1].cardsInPlay.some(c => c.definitionId === FLOTSAM)).toBe(false);
    expect(afterPass.players[1].discardPile.some(c => c.definitionId === FLOTSAM)).toBe(true);
  });

  test('discarded when its own controller\'s play deck exhausts', () => {
    const state = exhaustState(1);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[1].cardsInPlay.some(c => c.definitionId === FLOTSAM)).toBe(false);
    // Own deck exhausting: CRF 22 "Exhausted" shuffles the discard into the new play deck.
    expect(afterPass.players[1].discardPile.some(c => c.definitionId === FLOTSAM)).toBe(false);
    expect(afterPass.players[1].playDeck.some(c => c.definitionId === FLOTSAM)).toBe(true);
  });

  test('once discarded on exhaustion the cancel is gone: the tutor works again', () => {
    const state = lobeliaState({ deckSize: 15 });
    // Empty P2's deck and drive the end-of-turn exhaustion sub-flow so the
    // permanent event discards itself, then re-check the same tutor.
    const eot: GameState = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], playDeck: [], discardPile: [{ instanceId: 'sr-1' as CardInstanceId, definitionId: STRANGE_RATIONS }] },
      ] as unknown as typeof state.players,
      phaseState: {
        phase: Phase.EndOfTurn,
        step: 'reset-hand',
        discardDone: [true, true],
        resetHandDone: [true, false],
      } as EndOfTurnPhaseState,
    };
    const afterPass = dispatch(
      dispatch(eot, { type: 'deck-exhaust', player: PLAYER_2 }),
      { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[1].cardsInPlay.some(c => c.definitionId === FLOTSAM)).toBe(false);

    const backInOrg: GameState = { ...afterPass, phaseState: state.phaseState };
    const after = dispatch(backInOrg, lobeliaFetchAction(backInOrg)[0].action);
    expect(after.pendingEffects).toHaveLength(1);
  });
});
