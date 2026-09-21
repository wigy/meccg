/**
 * @module td-182.test
 *
 * Card test: Ireful Flames (td-182)
 * Type: hazard-event, permanent. Non-unique.
 *
 * Card text:
 *   "Affects the following sites: The Lonely Mountain, Irerock, Zarak Dûm,
 *    and Gold Hill. For any item to be played at one of these sites, its
 *    player must remove an item in his hand from play that would itself be
 *    playable at the site. Cannot be revealed as an on-guard card. Discard
 *    Ireful Flames when any play deck is exhausted."
 *
 * Effects: 2
 *   1. `site-item-removal-cost` — `siteNames` [The Lonely Mountain, Irerock,
 *      Zarak Dûm, Gold Hill]. Playing an item at a matching site requires
 *      removing another hand item (whose subtype the site itself lists as
 *      playable) from play — the out-of-play pile, not the discard pile.
 *   2. `on-event play-deck-exhausted` → self-discard `move`.
 *
 * "Cannot be revealed as an on-guard card" is not a separate effect: the
 * card declares no `on-guard-reveal` trigger and its `site-item-removal-cost`
 * effect does not affect automatic-attacks, so neither on-guard reveal
 * pathway (`legal-actions/chain.ts`'s `onGuardRevealChainActions`,
 * `legal-actions/pending.ts`'s `onGuardWindowActions`, or
 * `legal-actions/site.ts`'s `revealOnGuardAttacksActions`) ever offers a
 * `reveal-on-guard` action for it — bluff placement (any hand card is
 * eligible) stays legal, matching the card's own text precisely.
 *
 * Rule coverage:
 * | # | Rule                                                            | Status      |
 * |---|------------------------------------------------------------------|-------------|
 * | 1 | Playable as a hazard permanent-event; stays in play              | IMPLEMENTED |
 * | 2 | May be placed on-guard as a bluff, like any hazard card          | IMPLEMENTED |
 * | 3 | Never offered for on-guard reveal                                | IMPLEMENTED |
 * | 4 | Item play at an affected site requires removing another eligible | IMPLEMENTED |
 * |   | hand item from play                                              |             |
 * | 5 | With no eligible hand item, the item is not playable at all      | IMPLEMENTED |
 * | 6 | The removed item goes to the out-of-play pile, not discard       | IMPLEMENTED |
 * | 7 | The removal-cost candidate must itself be playable at the site   | IMPLEMENTED |
 * |   | (site's own `playableResources` tier)                            |             |
 * | 8 | Sites not named by the card are unaffected                       | IMPLEMENTED |
 * | 9 | Discard whenever a play deck is exhausted                        | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MINAS_TIRITH, MORIA,
  DAGGER_OF_WESTERNESSE, GLAMDRING, SCROLL_OF_ISILDUR,
  buildTestState, resetMint, makeMHState,
  addCardInPlay, findCharInstanceId,
  buildSitePhaseState, buildSitePhaseTwoPlayer, placeOnGuard, makeSitePhase,
  viableActions, dispatch, reduce, playHazardAndResolve, handCardId,
  P1_COMPANY, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type {
  CardDefinitionId, EndOfTurnPhaseState, GameState, PlayHeroResourceAction,
} from '../../index.js';

const IREFUL_FLAMES = 'td-182' as CardDefinitionId;
const GOLD_HILL = 'as-148' as CardDefinitionId;      // named site — minor/major/greater/gold-ring
const ZARAK_DUM = 'td-181' as CardDefinitionId;      // named site — minor/major only

describe('Ireful Flames (td-182)', () => {
  beforeEach(() => resetMint());

  // ─── #1: playable as a hazard permanent-event ─────────────────────────────

  test('P2 may play it during the M/H play-hazards step; it enters play and stays', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [IREFUL_FLAMES], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState() };

    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(1);

    const cardId = handCardId(state, HAZARD_PLAYER);
    const after = playHazardAndResolve(state, PLAYER_2, cardId, P1_COMPANY);

    expect(after.chain).toBeNull();
    expect(after.players[1].hand).toHaveLength(0);
    expect(after.players[1].cardsInPlay.map(c => c.instanceId)).toContain(cardId);
  });

  // ─── #2/#3: on-guard bluff placement is legal, reveal never is ────────────

  test('may be placed on-guard as a bluff, like any hazard card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [IREFUL_FLAMES], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState() };

    expect(viableActions(state, PLAYER_2, 'place-on-guard').length).toBeGreaterThan(0);
  });

  test('an on-guard copy is never offered for reveal at a site with an automatic-attack', () => {
    const base = buildSitePhaseTwoPlayer({ site: GOLD_HILL, heroChars: [ARAGORN] });
    const { state: withOG } = placeOnGuard(base, RESOURCE_PLAYER, 0, IREFUL_FLAMES);
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const revealActions = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    expect(revealActions).toHaveLength(0);
    // Only pass is offered — the card sits on-guard, unrevealable.
    expect(viableActions(testState, PLAYER_2, 'pass').length).toBeGreaterThan(0);
  });

  // ─── #4-#6: item-play removal cost at a named site (Gold Hill) ────────────

  /** Site-phase state at Gold Hill with Ireful Flames in the hazard player's cardsInPlay. */
  function goldHillWithFlames(hand: CardDefinitionId[]): GameState {
    const base = buildSitePhaseState({ site: GOLD_HILL, characters: [ARAGORN], hand });
    return addCardInPlay(base, HAZARD_PLAYER, IREFUL_FLAMES);
  }

  test('with only one item in hand, the item is not playable (no eligible cost candidate)', () => {
    const state = goldHillWithFlames([DAGGER_OF_WESTERNESSE]);
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('with a second eligible item in hand, playing the first offers a costRemoveInstanceId action', () => {
    const state = goldHillWithFlames([DAGGER_OF_WESTERNESSE, GLAMDRING]);
    const daggerId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DAGGER_OF_WESTERNESSE)!.instanceId;
    const glamdringId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === GLAMDRING)!.instanceId;

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === daggerId);
    expect(actions).toHaveLength(1);
    expect(actions[0].costRemoveInstanceId).toBe(glamdringId);
  });

  test('paying the cost attaches the played item and removes the cost item from play (not discard)', () => {
    const state = goldHillWithFlames([DAGGER_OF_WESTERNESSE, GLAMDRING]);
    const glamdringId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === GLAMDRING)!.instanceId;
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const action = viableActions(state, PLAYER_1, 'play-hero-resource')[0].action as PlayHeroResourceAction;
    const after = dispatch(state, action);

    // The dagger is attached to Aragorn.
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].items.some(i => i.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    // Glamdring is gone from hand...
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === glamdringId)).toBe(false);
    // ...never discarded...
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === glamdringId)).toBe(false);
    // ...but removed from play entirely.
    const outOfPlay = after.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === glamdringId);
    expect(outOfPlay).toBeDefined();
    expect(outOfPlay!.removedFromGame).toBe(true);
  });

  test('rejects a play-hero-resource action that omits a valid cost card', () => {
    const state = goldHillWithFlames([DAGGER_OF_WESTERNESSE, GLAMDRING]);
    const daggerId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DAGGER_OF_WESTERNESSE)!.instanceId;
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const result = reduce(state, {
      type: 'play-hero-resource', player: PLAYER_1, cardInstanceId: daggerId,
      companyId: state.players[RESOURCE_PLAYER].companies[0].id, attachToCharacterId: aragornId,
    });
    expect(result.error).toBeDefined();
    expect(result.state.players[RESOURCE_PLAYER].characters[aragornId].items.some(i => i.definitionId === DAGGER_OF_WESTERNESSE)).toBe(false);
  });

  // ─── #7: the cost candidate must itself be playable at the site's tier ───

  test('at Zarak Dûm (minor/major only), a greater item in hand does not qualify as the cost', () => {
    // Zarak Dûm only lists minor/major as playableResources, so the Scroll of
    // Isildur (greater) is not "itself... playable at the site" and cannot
    // pay the removal cost — only Dagger itself is in hand, so no valid
    // *other* candidate exists at all.
    const base = buildSitePhaseState({ site: ZARAK_DUM, characters: [ARAGORN], hand: [DAGGER_OF_WESTERNESSE, SCROLL_OF_ISILDUR] });
    const state = addCardInPlay(base, HAZARD_PLAYER, IREFUL_FLAMES);

    const daggerId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DAGGER_OF_WESTERNESSE)!.instanceId;
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === daggerId);
    expect(actions).toHaveLength(0);
  });

  test('at Zarak Dûm, a second minor/major item does qualify as the cost', () => {
    const base = buildSitePhaseState({ site: ZARAK_DUM, characters: [ARAGORN], hand: [DAGGER_OF_WESTERNESSE, GLAMDRING] });
    const state = addCardInPlay(base, HAZARD_PLAYER, IREFUL_FLAMES);

    const daggerId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DAGGER_OF_WESTERNESSE)!.instanceId;
    const glamdringId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === GLAMDRING)!.instanceId;
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === daggerId);
    expect(actions).toHaveLength(1);
    expect(actions[0].costRemoveInstanceId).toBe(glamdringId);
  });

  // ─── #8: a site not named by the card is unaffected ──────────────────────

  test('at Moria (not named by the card), items are playable with no removal cost', () => {
    const base = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [DAGGER_OF_WESTERNESSE] });
    const state = addCardInPlay(base, HAZARD_PLAYER, IREFUL_FLAMES);

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].costRemoveInstanceId).toBeUndefined();
  });

  // ─── #9: discard whenever a play deck is exhausted ────────────────────────

  function exhaustState(exhaustingPlayer: 0 | 1): GameState {
    const emptyDeckSide = {
      playDeck: [] as CardDefinitionId[],
      discardPile: [DAGGER_OF_WESTERNESSE],
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
          companies: [{ site: MORIA, characters: [LEGOLAS] }],
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
    return addCardInPlay(resetHandState, HAZARD_PLAYER, IREFUL_FLAMES);
  }

  test('discarded when the opponent\'s play deck exhausts', () => {
    const state = exhaustState(0);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[1].cardsInPlay.some(c => c.definitionId === IREFUL_FLAMES)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[1].cardsInPlay.some(c => c.definitionId === IREFUL_FLAMES)).toBe(false);
    expect(afterPass.players[1].discardPile.some(c => c.definitionId === IREFUL_FLAMES)).toBe(true);
  });

  test('discarded when its own controller\'s play deck exhausts', () => {
    const state = exhaustState(1);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[1].cardsInPlay.some(c => c.definitionId === IREFUL_FLAMES)).toBe(false);
    expect(afterPass.players[1].discardPile.some(c => c.definitionId === IREFUL_FLAMES)).toBe(false);
    expect(afterPass.players[1].playDeck.some(c => c.definitionId === IREFUL_FLAMES)).toBe(true);
  });
});
