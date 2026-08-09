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
  ELROND, LEGOLAS, ARAGORN, SARUMAN, THEODEN, GIMLI,
  MARVELS_TOLD, FOOLISH_WORDS, CAVE_DRAKE, STING,
  SUN, BARROW_WIGHT, ORC_PATROL, ASSASSIN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  handCardId, dispatch, makeMHState,
  addCardInPlay,
  runSimpleDraft,
  eotState,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  pool,
  buildAnUnexpectedOutpostMH,
  resolveChain,
  siteDeckInstId,
} from '../../test-helpers.js';
import type { AddCharacterToDeckAction, ArrangeDeckTopCardAction, CardDefinitionId, CardInstanceId, ChooseRevealedCardAction, DiscardCardAction, ExchangeSideboardAction, FetchFromPileAction, PlaceOnGuardAction, PlanMovementAction, PlayerView, PlayShortEventAction } from '../../../index.js';
import { Phase, SetupStep, buildInstanceLookup, describeAction, extractActionCardDefs, reduce } from '../../../index.js';

/** Lure of Expedience — hazard permanent-event attached to a character. Single-use in this file. */
const LURE_OF_EXPEDIENCE = 'le-122' as CardDefinitionId;

/** Revealed to all Watchers — hazard short-event that cycles the caster's hand (dm-85). */
const REVEALED_TO_ALL_WATCHERS = 'dm-85' as CardDefinitionId;

describe('lastAction card defs — opponent toast naming', () => {
  beforeEach(() => resetMint());

  test('extractActionCardDefs resolves the played card for a short-event play', () => {
    // Marvels Told leaves the hand for the chain of effects and ends up in
    // the owner's discard pile once the chain resolves. The action carries
    // only the instance id, so without this helper the opponent's
    // describeAction cannot name the card in either state.
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
    const onChain = dispatch(before, action);

    // Right after the play the card rides an unresolved chain entry — it has
    // left the (redacted) hand and is not in any pile yet.
    expect(onChain.players[0].hand.map(c => c.instanceId)).not.toContain(marvelsId);
    expect(extractActionCardDefs(onChain, action)[marvelsId as string]).toBe(MARVELS_TOLD);

    const after = resolveChain(onChain);

    // Precondition that reproduces the bug: once the chain resolves the
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

describe('add-character-to-deck — opponent must not learn the shuffled character', () => {
  beforeEach(() => resetMint());

  /**
   * Regression for bug ad5ae57b20698ba1 (game moab9vqb-68zlad, seq ~14):
   * during character-deck-draft, the opponent's toast read the actual card
   * name of each character the active player shuffled into their face-down
   * play deck (e.g. "Add Frodo to play deck"). Per CoE rule 1.8, leftover
   * pool characters shuffled into the play deck must stay hidden — the
   * opponent may know the action was taken but not which character was
   * chosen. Under the generic visibility model the pool → playDeck move
   * is private-to-private, so the instance never enters
   * `state.revealedInstances` and `extractActionCardDefs` omits it.
   */
  test('extractActionCardDefs omits the shuffled character (pool → playDeck is private→private)', () => {
    let state = runSimpleDraft();
    if (state.phaseState.phase !== Phase.Setup) throw new Error('expected setup');

    if (state.phaseState.setupStep.step === SetupStep.ItemDraft) {
      const itemStep = state.phaseState.setupStep;
      const p1Char = state.players[0].companies[0].characters[0];
      const p2Char = state.players[1].companies[0].characters[0];
      for (const item of itemStep.itemDraftState[0].unassignedItems) {
        const r = reduce(state, {
          type: 'assign-starting-item',
          player: PLAYER_1,
          itemDefId: item.definitionId,
          characterInstanceId: p1Char,
        });
        if (r.error) throw new Error(r.error);
        state = r.state;
      }
      for (const item of itemStep.itemDraftState[1].unassignedItems) {
        const r = reduce(state, {
          type: 'assign-starting-item',
          player: PLAYER_2,
          itemDefId: item.definitionId,
          characterInstanceId: p2Char,
        });
        if (r.error) throw new Error(r.error);
        state = r.state;
      }
    }

    if (state.phaseState.phase !== Phase.Setup) throw new Error('expected setup');
    expect(state.phaseState.setupStep.step).toBe(SetupStep.CharacterDeckDraft);
    if (state.phaseState.setupStep.step !== SetupStep.CharacterDeckDraft) throw new Error('expected deck draft');

    const p1Pool = state.phaseState.setupStep.deckDraftState[0].remainingPool;
    expect(p1Pool.length).toBeGreaterThan(0);
    const charInstance = p1Pool[0];

    const action: AddCharacterToDeckAction = {
      type: 'add-character-to-deck',
      player: PLAYER_1,
      characterInstanceId: charInstance.instanceId,
    };
    const result = reduce(state, action);
    if (result.error) throw new Error(result.error);

    // The shuffled character's identity is absent from the broadcast map —
    // the character was never in a public pile (pool → playDeck are both
    // private to the opponent), so it never entered revealedInstances.
    const defs = extractActionCardDefs(result.state, action);
    expect(defs[charInstance.instanceId as string]).toBeUndefined();

    // describeAction therefore renders "a card" for the opponent's toast.
    const audienceLookup = (id: CardInstanceId) => defs[id as string];
    const audienceDesc = describeAction(action, pool, audienceLookup);
    expect(audienceDesc).toContain('a card');
    const realName = pool[charInstance.definitionId as string]?.name;
    if (realName) expect(audienceDesc).not.toContain(realName);
  });
});

describe('discard-card — opponent must not learn the discarded card', () => {
  beforeEach(() => resetMint());

  /**
   * Regression for bug f5dfb6071aa0e22e (game moab9vqb-68zlad, seq ~116):
   * during the reset-hand / end-of-turn discard steps, the opponent's
   * toast read the actual card name of the card the active player
   * discarded from hand (e.g. "Discard The Sun"). Hand → discardPile is
   * a private-to-private transition under the engine's visibility model
   * (projection.ts redacts the opponent's discardPile), so the instance
   * must never enter `state.revealedInstances` and `extractActionCardDefs`
   * must omit it — the opponent sees "a card" instead.
   */
  test('extractActionCardDefs omits the discarded card (hand → discardPile is private→private)', () => {
    // p1Deck is non-empty so rule 2.09 doesn't redirect the discard to the play deck
    const state = eotState({ p1Hand: [SUN], p1Deck: [BARROW_WIGHT] });
    const discardedId = handCardId(state, RESOURCE_PLAYER);

    const action: DiscardCardAction = {
      type: 'discard-card',
      player: PLAYER_1,
      cardInstanceId: discardedId,
    };
    const after = dispatch(state, action);

    // Precondition: the card moved from hand to the owner's private
    // discard pile, and was never in a public location.
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain(discardedId);
    expect(after.revealedInstances[discardedId]).toBeUndefined();

    // The action map broadcast to the opponent omits the card's identity.
    const defs = extractActionCardDefs(after, action);
    expect(defs[discardedId as string]).toBeUndefined();

    // describeAction with only the opponent's map renders "a card".
    const audienceLookup = (id: CardInstanceId) => defs[id as string];
    const audienceDesc = describeAction(action, pool, audienceLookup);
    expect(audienceDesc).toContain('a card');
    const realName = pool[SUN as string]?.name;
    if (realName) expect(audienceDesc).not.toContain(realName);
  });
});

describe('place-on-guard — resource player must not learn the placed card', () => {
  beforeEach(() => resetMint());

  /**
   * Regression for bug d03bbc7ba2d97e1f (game moab9vqb-68zlad, seq 274):
   * the hazard player places a card from hand face-down on-guard at the
   * active company's site. Per CoE rule 5.23 the card is placed face-down
   * (bluffing is allowed); the resource player only learns its identity
   * if and when it is later revealed. Hand → unrevealed onGuardCards is
   * a private-to-private transition under the engine's visibility model
   * (projection.ts:64 redacts the resource player's view of unrevealed
   * on-guards), so the instance must never enter `state.revealedInstances`
   * and `extractActionCardDefs` must omit it — the resource player's
   * toast renders "Place on-guard card a card" instead of leaking the
   * actual card name.
   */
  test('extractActionCardDefs omits the on-guard card (hand → unrevealed onGuardCards is private→private)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };
    const cardId = handCardId(state, HAZARD_PLAYER);

    const action: PlaceOnGuardAction = {
      type: 'place-on-guard',
      player: PLAYER_2,
      cardInstanceId: cardId,
    };
    const after = dispatch(state, action);

    // Precondition: the card moved from the hazard player's hand to the
    // active company's onGuardCards face-down (revealed: false), and was
    // never in a public location.
    const onGuard = after.players[0].companies[0].onGuardCards.find(c => c.instanceId === cardId);
    expect(onGuard?.revealed).toBe(false);
    expect(after.revealedInstances[cardId]).toBeUndefined();

    // The action map broadcast to the resource player omits the card's
    // identity.
    const defs = extractActionCardDefs(after, action);
    expect(defs[cardId as string]).toBeUndefined();

    // describeAction with only the resource-player audience map renders
    // "a card" — bluffing is preserved.
    const audienceLookup = (id: CardInstanceId) => defs[id as string];
    const audienceDesc = describeAction(action, pool, audienceLookup);
    expect(audienceDesc).toContain('a card');
    const realName = pool[BARROW_WIGHT as string]?.name;
    if (realName) expect(audienceDesc).not.toContain(realName);
  });
});

describe('fetch-from-pile — opponent must not learn which card was fetched', () => {
  beforeEach(() => resetMint());

  /**
   * Regression for bug 407123fe974320c9 (game movoby5r-12oj7e, seq 729):
   * when the hazard player used An Unexpected Outpost to fetch a card from
   * their discard pile, the opponent's action log showed the card's real
   * name ("Fetch Lure of Nature from discard-pile"). The card was in
   * `revealedInstances` because it had previously been played as a hazard,
   * so `extractActionCardDefs` included its identity in `lastActionCardDefs`.
   *
   * fetch-from-pile moves a card from a private pile (discard or sideboard)
   * into the private play deck — a private→private transition. The opponent
   * should see "Fetch a card from discard-pile" regardless of whether the
   * card's identity was ever previously revealed.
   */
  test('extractActionCardDefs omits the fetched card even when it was previously revealed', () => {
    const state = buildAnUnexpectedOutpostMH({ discardPile: [ORC_PATROL] });
    const outpostId = handCardId(state, HAZARD_PLAYER);
    const orcPatrolId = state.players[1].discardPile[0].instanceId;

    // Simulate the card having been played publicly before (e.g. as a hazard
    // on the resource player's character) — it was revealed and stayed in
    // revealedInstances even after moving to the private discard pile.
    const stateWithReveal: typeof state = {
      ...state,
      revealedInstances: { ...state.revealedInstances, [orcPatrolId as string]: ORC_PATROL },
    };

    const afterPlay = dispatch(stateWithReveal, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: outpostId,
      targetCompanyId: stateWithReveal.players[0].companies[0].id,
    });
    const afterChain = resolveChain(afterPlay);

    const fetchAction: FetchFromPileAction = {
      type: 'fetch-from-pile',
      player: PLAYER_2,
      cardInstanceId: orcPatrolId,
      source: 'discard-pile',
    };
    const afterFetch = dispatch(afterChain, fetchAction);

    // Precondition: the card is now in the private play deck and the instance
    // was in revealedInstances before the fetch.
    expect(afterFetch.players[1].playDeck.map(c => c.instanceId)).toContain(orcPatrolId);
    expect(afterFetch.revealedInstances[orcPatrolId]).toBe(ORC_PATROL);

    // The broadcast map must NOT name the fetched card — its destination is
    // the private play deck, so the opponent only learns "a card was fetched".
    const defs = extractActionCardDefs(afterFetch, fetchAction);
    expect(defs[orcPatrolId as string]).toBeUndefined();

    // describeAction with only the opponent's map renders "a card".
    const audienceLookup = (id: CardInstanceId) => defs[id as string];
    const audienceDesc = describeAction(fetchAction, pool, audienceLookup);
    expect(audienceDesc).toContain('a card');
    const realName = pool[ORC_PATROL as string]?.name;
    if (realName) expect(audienceDesc).not.toContain(realName);
  });
});

describe('exchange-sideboard — opponent must not learn which cards were swapped', () => {
  beforeEach(() => resetMint());

  /**
   * Regression for bug 165f571aad0c5f10 (game mpv5bx8n-3j9fua, seq 366):
   * during the deck-exhaustion sideboard exchange sub-flow, the opponent's
   * toast showed the actual card names of both the discarded card and the
   * sideboard card swapped in. Both the discard pile and the sideboard are
   * private to the opponent; even if either card was previously publicly
   * visible (and thus recorded in `state.revealedInstances`), broadcasting
   * those identities here would reveal exactly which cards the player chose to
   * exchange — private strategic information. `extractActionCardDefs` must
   * exclude both `discardCardInstanceId` and `sideboardCardInstanceId`.
   */
  test('extractActionCardDefs omits both cards even when previously revealed', () => {
    const base = eotState({ p2Hand: [], p2Deck: [BARROW_WIGHT] });

    // Provide p2 with one card in the discard pile and one in the sideboard.
    // We need instance IDs, so we inject them directly into the state.
    const discardCard = { instanceId: 'test-discard-1' as CardInstanceId, definitionId: ORC_PATROL };
    const sideboardCard = { instanceId: 'test-sideboard-1' as CardInstanceId, definitionId: ASSASSIN };

    const state: typeof base = {
      ...base,
      // Move into the reset-hand step (where exchange-sideboard is legal).
      phaseState: {
        phase: Phase.EndOfTurn,
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [true, false] as [boolean, boolean],
      },
      players: [
        base.players[0],
        {
          ...base.players[1],
          discardPile: [discardCard],
          sideboard: [sideboardCard],
          deckExhaustPending: true,
          deckExhaustExchangeCount: 0,
        },
      ] as unknown as typeof base.players,
      // Simulate both cards having been previously visible to the opponent.
      revealedInstances: {
        ...base.revealedInstances,
        [discardCard.instanceId as string]: discardCard.definitionId,
        [sideboardCard.instanceId as string]: sideboardCard.definitionId,
      },
    };

    const action: ExchangeSideboardAction = {
      type: 'exchange-sideboard',
      player: PLAYER_2,
      discardCardInstanceId: discardCard.instanceId,
      sideboardCardInstanceId: sideboardCard.instanceId,
    };
    const after = dispatch(state, action);

    // Both cards remain in revealedInstances (the map only grows).
    expect(after.revealedInstances[discardCard.instanceId]).toBe(ORC_PATROL);
    expect(after.revealedInstances[sideboardCard.instanceId]).toBe(ASSASSIN);

    // The broadcast map must NOT name either card — the opponent must only
    // learn that an exchange happened, not which cards were involved.
    const defs = extractActionCardDefs(after, action);
    expect(defs[discardCard.instanceId as string]).toBeUndefined();
    expect(defs[sideboardCard.instanceId as string]).toBeUndefined();

    // describeAction with only the opponent's map renders "a card" for both.
    const audienceLookup = (id: CardInstanceId) => defs[id as string];
    const audienceDesc = describeAction(action, pool, audienceLookup);
    const discardName = pool[ORC_PATROL as string]?.name;
    const sideboardName = pool[ASSASSIN as string]?.name;
    if (discardName) expect(audienceDesc).not.toContain(discardName);
    if (sideboardName) expect(audienceDesc).not.toContain(sideboardName);
  });
});

describe('arrange-deck-top-card — audience must not learn the face-down deck-top order', () => {
  beforeEach(() => resetMint());

  /**
   * Regression for bug 0aea1e91dc37e18f (game mrahfk9s-eaeybx, seq 279):
   * after playing Revealed to all Watchers (dm-85) the player revealed their
   * hand (correctly public) and then placed the non-hazard cards face-down on
   * top of their play deck "in any order you choose". Each
   * `arrange-deck-top-card` pick, however, broadcast the placed card's identity
   * in `lastActionCardDefs` — the cards were still in `revealedInstances` from
   * the hand reveal — so the opponent and every spectator saw the exact
   * face-down deck-top order in their toasts. Placing cards face-down means the
   * ordering is private; `extractActionCardDefs` must omit the card instance ID
   * so the audience sees only "Place a card … on top of the play deck".
   */
  test('extractActionCardDefs omits the arranged card even though the hand was revealed', () => {
    // dm-85 in P2's hand plus two non-hazard cards to set aside (Gimli, Sting)
    // and one kept hazard (Cave-drake); a deck to refill from.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [REVEALED_TO_ALL_WATCHERS, CAVE_DRAKE, GIMLI, STING],
          playDeck: [BARROW_WIGHT, ORC_PATROL, SUN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };

    const revealedId = state.players[1].hand.find(c => c.definitionId === REVEALED_TO_ALL_WATCHERS)!.instanceId;
    const gimliId = state.players[1].hand.find(c => c.definitionId === GIMLI)!.instanceId;
    const stingId = state.players[1].hand.find(c => c.definitionId === STING)!.instanceId;

    // Play the card and resolve the chain: the hand is revealed, Gimli and
    // Sting are set aside face-down on top of the deck, arrange-deck-top pends.
    const resolved = resolveChain(dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: revealedId,
      targetCompanyId: state.players[0].companies[0].id,
    }));

    // Precondition: both set-aside cards are in revealedInstances (the hand was
    // publicly revealed) yet now sit face-down on top of the private play deck.
    expect(resolved.revealedInstances[gimliId]).toBe(GIMLI);
    expect(resolved.revealedInstances[stingId]).toBe(STING);
    expect(resolved.players[1].playDeck.slice(0, 2).map(c => c.instanceId).sort())
      .toEqual([gimliId, stingId].sort());
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'arrange-deck-top')).toBe(true);

    // The player places Sting on top first.
    const arrangeAction: ArrangeDeckTopCardAction = {
      type: 'arrange-deck-top-card',
      player: PLAYER_2,
      cardInstanceId: stingId,
    };
    const after = dispatch(resolved, arrangeAction);

    // The broadcast map must NOT name the arranged card — its placement order
    // on the face-down deck is private, even though its identity is public.
    const defs = extractActionCardDefs(after, arrangeAction);
    expect(defs[stingId as string]).toBeUndefined();

    // describeAction with only the audience map renders "a card", hiding order.
    const audienceLookup = (id: CardInstanceId) => defs[id as string];
    const audienceDesc = describeAction(arrangeAction, pool, audienceLookup);
    expect(audienceDesc).toContain('a card');
    const realName = pool[STING as string]?.name;
    if (realName) expect(audienceDesc).not.toContain(realName);
  });
});

describe('plan-movement — opponent must not learn the face-down destination site', () => {
  beforeEach(() => resetMint());

  /**
   * Regression for bug c36d325122304817 (game mskidoss-noauyv, seq 1595):
   * a Fallen-wizard's Wizardhaven site (e.g. Isengard, wh-56) had earlier
   * been a company's currentSite, which made its identity public and
   * recorded it in `revealedInstances` (append-only — see visibility.ts).
   * Once that company moved on and the site cycled back into the location
   * deck, selecting it again as a new company's `plan-movement` destination
   * broadcast its real identity in the opponent's toast ("Move company to
   * Isengard") via `lastActionCardDefs`, even though CoE rule 2.II.7
   * declares movement by placing the destination site card face-down —
   * the opponent must not learn it until it is revealed during the
   * company's Movement/Hazard sub-phase.
   */
  test('extractActionCardDefs omits the destination site even when it was previously revealed', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const destinationId = siteDeckInstId(base, 0, MORIA);

    // Simulate Moria having been a company's currentSite earlier in the
    // game (public knowledge recorded forever, per visibility.ts) before
    // cycling back into the location deck.
    const state: typeof base = {
      ...base,
      revealedInstances: { ...base.revealedInstances, [destinationId as string]: MORIA },
    };

    const action: PlanMovementAction = {
      type: 'plan-movement',
      player: PLAYER_1,
      companyId: state.players[0].companies[0].id,
      destinationSite: destinationId,
    };
    const after = dispatch(state, action);

    // Precondition: the site is still recorded as revealed (the map only
    // grows) even though it is now a secret, face-down planned destination.
    expect(after.revealedInstances[destinationId]).toBe(MORIA);

    // The broadcast map must NOT name the destination site — the opponent
    // only learns that movement was planned, not where to.
    const defs = extractActionCardDefs(after, action);
    expect(defs[destinationId as string]).toBeUndefined();

    // describeAction with only the opponent's map renders "a site".
    const audienceLookup = (id: CardInstanceId) => defs[id as string];
    const audienceDesc = describeAction(action, pool, audienceLookup);
    expect(audienceDesc).toContain('a card');
    const realName = pool[MORIA as string]?.name;
    if (realName) expect(audienceDesc).not.toContain(realName);
  });
});

describe('Marvels Told discard-target naming — lookup must cover character-attached hazards', () => {
  /**
   * Regression for bug d06bedbd3fa71d6d (game mqi3vh2z-32ok2s, seq ~1090):
   * the hand renderer's Marvels Told disambiguation tooltip read
   * "Tap Saruman, discard ? (on Theoden)" instead of naming the discard
   * target, Lure of Expedience. The discard target was a hazard the opponent
   * had attached to the active player's character. The browser resolved its
   * name through a cached instance lookup that was only ever refreshed when
   * the debug panel rendered, so during normal play it lagged the live view —
   * the freshly-attached hazard was absent and its name fell back to the
   * placeholder ("?"). The fix rebuilds the lookup from the current view in
   * `renderHand`. This test pins the underlying contract: a lookup built via
   * {@link buildInstanceLookup} from a view that holds the hazard on a
   * character resolves the discard-target name, and a stale lookup that misses
   * it degrades to the "a card" placeholder.
   */
  test('buildInstanceLookup resolves a hazard attached to a character; a stale lookup does not', () => {
    const sageId = 'p1-inst-saruman' as CardInstanceId;
    const bearerId = 'p1-inst-theoden' as CardInstanceId;
    const marvelsId = 'p1-inst-marvels' as CardInstanceId;
    const lureId = 'p2-inst-lure' as CardInstanceId;

    // Minimal active-player view: Saruman (the sage) and Theoden share a
    // company; the opponent's Lure of Expedience is attached to Theoden.
    const emptyPiles = {
      hand: [], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
      sideboard: [], killPile: [], outOfPlayPile: [], cardsInPlay: [], companies: [], agents: [],
    };
    const view = {
      self: {
        ...emptyPiles,
        hand: [{ instanceId: marvelsId, definitionId: MARVELS_TOLD }],
        characters: {
          [sageId as string]: { instanceId: sageId, definitionId: SARUMAN, items: [], allies: [], hazards: [] },
          [bearerId as string]: {
            instanceId: bearerId, definitionId: THEODEN, items: [], allies: [],
            hazards: [{ instanceId: lureId, definitionId: LURE_OF_EXPEDIENCE }],
          },
        },
      },
      opponent: { ...emptyPiles, characters: {} },
      chain: null,
      phaseState: { phase: Phase.MovementHazard },
    } as unknown as PlayerView;

    const lookup = buildInstanceLookup(view);
    // The contract the fix relies on: the character-attached hazard is in the lookup.
    expect(lookup(lureId)).toBe(LURE_OF_EXPEDIENCE);

    const action: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: sageId,
      discardTargetInstanceId: lureId,
    };

    // Fresh lookup (rebuilt from the current view, as the hand renderer now
    // does): both the tapped sage and the discard target are named.
    const named = describeAction(action, pool, lookup);
    expect(named).toContain('Saruman');
    expect(named).toContain('Lure of Expedience');

    // Stale lookup predating the Lure attachment (the pre-fix bug): the
    // discard-target name degrades to the "a card" placeholder ("?" in the UI).
    const staleLookup = (id: CardInstanceId) => (id === lureId ? undefined : lookup(id));
    const stale = describeAction(action, pool, staleLookup);
    expect(stale).toContain('a card');
    expect(stale).not.toContain('Lure of Expedience');
  });
});

describe('deck-arranging action labels — imperative, no raw player code', () => {
  /**
   * Regression for bug d3d376794cfc8a4e (game mr9jvlnw-2ldyce, seq 119):
   * after playing Revealed to all Watchers (dm-85), the player was offered
   * one `arrange-deck-top-card` action per set-aside card, but the button
   * text read "p1 places Noble Steed next on top of their play deck" — the
   * raw player id "p1" leaked into the label and the phrasing did not match
   * the imperative voice every other action the player clicks uses ("Draft
   * …", "Play …", "Move …"). Its sibling `choose-revealed-card` (Eyes of
   * Mandos, dm-126) had the identical defect. Both labels are the acting
   * player's own choice, so they should read as an imperative instruction
   * with no player code.
   */
  test('arrange-deck-top-card reads as an imperative naming the card, without the player code', () => {
    const cardId = 'p1-18' as CardInstanceId;
    const lookup = (id: CardInstanceId) => (id === cardId ? MARVELS_TOLD : undefined);
    const action: ArrangeDeckTopCardAction = {
      type: 'arrange-deck-top-card',
      player: PLAYER_1,
      cardInstanceId: cardId,
    };
    const label = describeAction(action, pool, lookup);
    // Imperative voice, the card named, ending in the player's own deck.
    expect(label.startsWith('Place ')).toBe(true);
    expect(label).toContain('Marvels Told');
    expect(label).toContain('next on top of your play deck');
    // The raw player id must not leak into the button text (the pre-fix
    // label read "p1 places … their play deck").
    expect(label).not.toContain('p1');
    expect(label).not.toContain('their play deck');
    // And the card is named, not shown as "a card".
    expect(label).not.toContain('a card');
  });

  test('choose-revealed-card reads as an imperative naming the card, without the player code', () => {
    const cardId = 'p1-27' as CardInstanceId;
    const lookup = (id: CardInstanceId) => (id === cardId ? MARVELS_TOLD : undefined);
    const action: ChooseRevealedCardAction = {
      type: 'choose-revealed-card',
      player: PLAYER_1,
      cardInstanceId: cardId,
    };
    const label = describeAction(action, pool, lookup);
    expect(label.startsWith('Take revealed card ')).toBe(true);
    expect(label).toContain('Marvels Told');
    expect(label).toContain('shuffle the rest back into the play deck');
    expect(label).not.toContain('p1');
    expect(label).not.toContain('a card');
  });
});
