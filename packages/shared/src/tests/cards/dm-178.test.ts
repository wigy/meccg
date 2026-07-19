/**
 * @module dm-178.test
 *
 * Card test: Mistress Lobelia (dm-178)
 * Type: hero-resource-ally (unique, prowess 0, body 9, 1 ally MP,
 * playable at Bag End or Bree)
 *
 * "Unique. Manifestation of Lobelia Sackville-Baggins. May only be played at
 *  Bag End or Bree. Discard this card if her company moves to any site other
 *  than Bree, Old Forest, The White Towers, or a site in The Shire. Tap
 *  Mistress Lobelia to search your discard pile or play deck for any one item,
 *  ally, or faction playable at her current site. Place the resource in your
 *  hand and reshuffle your play deck."
 *
 * Rules tested:
 * 1. Playability — "May only be played at Bag End or Bree": offered at both
 *    named sites, refused everywhere else.
 * 2. Manifestation of Lobelia Sackville-Baggins (dm-28): g.man.1 blocks the
 *    ally's play while the agent Lobelia is in play.
 * 3. Discard-on-move — her company is discarded whenever it completes a move
 *    to a site outside {Bree, Old Forest, The White Towers, region The Shire};
 *    she survives a move to any allowed site.
 * 4. Tap ability — tap Mistress Lobelia (the ally) to fetch one item/ally/
 *    faction playable at her current site from the discard pile OR the play
 *    deck into hand, reshuffling the deck when it was searched.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  ARAGORN, LEGOLAS,
  BREE, RIVENDELL, LORIEN, MINAS_TIRITH,
  RANGERS_OF_THE_NORTH,
  buildTestState, buildSitePhaseState, resetMint,
  viableActions, nonViableOfType, dispatch, findCharInstanceId,
  attachAllyToChar, getCharacter, makeAgent, makeMHState, makePlayDeck,
  assertEveryInstanceReachable, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId, GameState } from '../../index.js';
import { computeLegalActions, BAG_END, OLD_FOREST, THE_WHITE_TOWERS_HERO } from '../../index.js';

const MISTRESS_LOBELIA = 'dm-178' as CardDefinitionId;
const LOBELIA_SB = 'dm-28' as CardDefinitionId;      // the agent manifestation
const WOOD_ELVES = 'tw-367' as CardDefinitionId;     // faction NOT playable at Bree

const FETCH_ACTION = 'lobelia-fetch-playable';

/** Attach an untapped Mistress Lobelia to a character and tap it. */
function tapAlly(state: GameState, charDefId: CardDefinitionId): GameState {
  const charId = findCharInstanceId(state, RESOURCE_PLAYER, charDefId);
  const char = state.players[0].characters[charId];
  const allies = char.allies.map(a => a.definitionId === MISTRESS_LOBELIA ? { ...a, status: CardStatus.Tapped } : a);
  const p0 = { ...state.players[0], characters: { ...state.players[0].characters, [charId as string]: { ...char, allies } } };
  return { ...state, players: [p0, state.players[1]] as typeof state.players };
}

describe('Mistress Lobelia (dm-178)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable only at Bag End or Bree ──────────────────────────────

  test('playable at Bree', () => {
    const state = buildSitePhaseState({ characters: [ARAGORN], site: BREE, hand: [MISTRESS_LOBELIA] });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId: string }).cardInstanceId
        === state.players[0].hand.find(c => c.definitionId === MISTRESS_LOBELIA)!.instanceId);
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('playable at Bag End', () => {
    const state = buildSitePhaseState({ characters: [ARAGORN], site: BAG_END, hand: [MISTRESS_LOBELIA] });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId: string }).cardInstanceId
        === state.players[0].hand.find(c => c.definitionId === MISTRESS_LOBELIA)!.instanceId);
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at any other site (Rivendell)', () => {
    const state = buildSitePhaseState({ characters: [ARAGORN], site: RIVENDELL, hand: [MISTRESS_LOBELIA] });
    const lobeliaInst = state.players[0].hand.find(c => c.definitionId === MISTRESS_LOBELIA)!.instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId: string }).cardInstanceId === lobeliaInst);
    expect(plays).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(state, PLAYER_1), 'not-playable')
      .find(a => (a.action as { cardInstanceId: string }).cardInstanceId === lobeliaInst);
    expect(blocked?.reason).toContain('not playable');
  });

  // ─── Rule 2: manifestation of Lobelia Sackville-Baggins (g.man.1) ──────────

  test('cannot be played while the agent Lobelia Sackville-Baggins is in play (g.man.1)', () => {
    const base = buildSitePhaseState({ characters: [ARAGORN], site: BREE, hand: [MISTRESS_LOBELIA] });
    // Put the agent manifestation (dm-28) into the opponent's agents — g.man.1
    // applies across players and across card kinds (ally vs agent).
    const withAgent: GameState = {
      ...base,
      players: [base.players[0], { ...base.players[1], agents: [makeAgent(LOBELIA_SB)] }] as typeof base.players,
    };
    const lobeliaInst = withAgent.players[0].hand.find(c => c.definitionId === MISTRESS_LOBELIA)!.instanceId;

    const plays = viableActions(withAgent, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId: string }).cardInstanceId === lobeliaInst);
    expect(plays).toHaveLength(0);

    const blocked = nonViableOfType(computeLegalActions(withAgent, PLAYER_1), 'not-playable')
      .find(a => (a.action as { cardInstanceId: string }).cardInstanceId === lobeliaInst);
    expect(blocked?.reason).toContain('manifestation');
  });

  // ─── Rule 3: discard-on-move ───────────────────────────────────────────────

  /** Build a MovementHazard fixture: Lobelia's company at Bree, moving to `destination`. */
  function movingState(destination: CardDefinitionId): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [destination], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, MISTRESS_LOBELIA);
    const destCard = withAlly.players[0].siteDeck[0];
    const p0 = {
      ...withAlly.players[0],
      companies: [{
        ...withAlly.players[0].companies[0],
        destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
      }],
    };
    return {
      ...withAlly,
      players: [p0, withAlly.players[1]] as typeof withAlly.players,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };
  }

  /** Drive the company's movement to completion (both players pass through step 8). */
  function completeMove(state: GameState): GameState {
    const afterResource = dispatch(state, { type: 'pass', player: PLAYER_1 });
    return dispatch(afterResource, { type: 'pass', player: PLAYER_2 });
  }

  test('discarded when her company moves to a disallowed site (Rivendell)', () => {
    const state = movingState(RIVENDELL);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).allies.some(a => a.definitionId === MISTRESS_LOBELIA)).toBe(true);

    const after = completeMove(state);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].allies.some(a => a.definitionId === MISTRESS_LOBELIA)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MISTRESS_LOBELIA)).toBe(true);
    assertEveryInstanceReachable(after);
  });

  test('NOT discarded when her company moves to Old Forest (allowed by name)', () => {
    const state = movingState(OLD_FOREST);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const after = completeMove(state);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].allies.some(a => a.definitionId === MISTRESS_LOBELIA)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MISTRESS_LOBELIA)).toBe(false);
  });

  test('NOT discarded when her company moves to The White Towers (allowed by name)', () => {
    const state = movingState(THE_WHITE_TOWERS_HERO);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const after = completeMove(state);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].allies.some(a => a.definitionId === MISTRESS_LOBELIA)).toBe(true);
  });

  test('NOT discarded when her company moves to a site in The Shire (Bag End, region match)', () => {
    const state = movingState(BAG_END);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const after = completeMove(state);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].allies.some(a => a.definitionId === MISTRESS_LOBELIA)).toBe(true);
  });

  // ─── Rule 4: tap to fetch a playable item/ally/faction ─────────────────────

  /** Organization-phase fixture: Lobelia on Aragorn at Bree, with configurable piles. */
  function tapFixture(opts: { discard?: CardDefinitionId[]; deck?: CardDefinitionId[] }): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
          discardPile: opts.discard ?? [],
          playDeck: opts.deck ?? makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    return attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, MISTRESS_LOBELIA);
  }

  const fetchActionsOf = (state: GameState) =>
    viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === FETCH_ACTION);

  test('the tap ability is offered while the ally is untapped', () => {
    const state = tapFixture({ discard: [RANGERS_OF_THE_NORTH] });
    expect(fetchActionsOf(state)).toHaveLength(1);
  });

  test('the tap ability is NOT offered while the ally is already tapped', () => {
    const state = tapAlly(tapFixture({ discard: [RANGERS_OF_THE_NORTH] }), ARAGORN);
    expect(fetchActionsOf(state)).toHaveLength(0);
  });

  test('activation taps the ally and enqueues a to-hand fetch searching discard AND deck, gated on the current site', () => {
    const state = tapFixture({ discard: [RANGERS_OF_THE_NORTH] });
    const activate = fetchActionsOf(state)[0];
    const after = dispatch(state, activate.action);

    // Cost paid: the ally itself is tapped (not the bearer).
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const ally = after.players[0].characters[aragornId].allies.find(a => a.definitionId === MISTRESS_LOBELIA)!;
    expect(ally.status).toBe(CardStatus.Tapped);
    expect(after.players[0].characters[aragornId].status).toBe(CardStatus.Untapped);

    // The pending fetch targets the hand, keys on Bree, and searches both piles.
    expect(after.pendingEffects).toHaveLength(1);
    const effect = (after.pendingEffects[0] as { effect: { type: string; to?: string; playableAtSite?: string; source?: string[] } }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.to).toBe('hand');
    expect(effect.playableAtSite).toBe(BREE);
    expect(effect.source).toEqual(['discard-pile', 'deck']);
  });

  test('only cards playable at the current site are offered; fetching from the discard brings it to hand', () => {
    // Rangers of the North is playable at Bree; Wood-elves (Thranduil's Halls) is not.
    const state = tapFixture({ discard: [RANGERS_OF_THE_NORTH, WOOD_ELVES] });
    const after = dispatch(state, fetchActionsOf(state)[0].action);

    const fetchActions = computeLegalActions(after, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    const rangersInst = after.players[0].discardPile.find(c => c.definitionId === RANGERS_OF_THE_NORTH)!;
    expect((fetchActions[0].action as { cardInstanceId: string }).cardInstanceId).toBe(rangersInst.instanceId as unknown as string);

    const afterFetch = dispatch(after, fetchActions[0].action);
    expect(afterFetch.players[0].hand.some(c => c.definitionId === RANGERS_OF_THE_NORTH)).toBe(true);
    expect(afterFetch.players[0].discardPile.some(c => c.definitionId === RANGERS_OF_THE_NORTH)).toBe(false);
    expect(afterFetch.pendingEffects).toHaveLength(0);
    assertEveryInstanceReachable(afterFetch);
  });

  test('the ability can search the play deck: a playable card is drawn to hand and the deck reshuffled', () => {
    // Rangers of the North sits in the play deck (not the discard); the search
    // must find it there and, on fetch, move it to hand and reshuffle the deck.
    const state = tapFixture({ deck: [RANGERS_OF_THE_NORTH, ...makePlayDeck()] });
    const after = dispatch(state, fetchActionsOf(state)[0].action);

    const fetchActions = computeLegalActions(after, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile'
        && (ea.action as { source?: string }).source === 'deck');
    expect(fetchActions.length).toBeGreaterThanOrEqual(1);
    const rangersInst = after.players[0].playDeck.find(c => c.definitionId === RANGERS_OF_THE_NORTH)!;
    const pick = fetchActions.find(a => (a.action as { cardInstanceId: string }).cardInstanceId === rangersInst.instanceId as unknown as string)!;
    expect(pick).toBeDefined();

    const afterFetch = dispatch(after, pick.action);
    expect(afterFetch.players[0].hand.some(c => c.definitionId === RANGERS_OF_THE_NORTH)).toBe(true);
    expect(afterFetch.players[0].playDeck.some(c => c.definitionId === RANGERS_OF_THE_NORTH)).toBe(false);
    assertEveryInstanceReachable(afterFetch);
  });
});
