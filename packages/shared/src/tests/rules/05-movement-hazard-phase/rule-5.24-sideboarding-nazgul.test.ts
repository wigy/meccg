/**
 * @module rule-5.24-sideboarding-nazgul
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.24: Sideboarding with a Nazgûl
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Sideboarding with a Nazgûl - As an action during a movement/hazard phase, the hazard player may tap and discard a Nazgûl permanent-event that they control to either:
 * • bring up to five hazards from the hazard player's sideboard to their discard pile.
 * • if the hazard player's play deck has at least five cards, bring one hazard from their sideboard directly into their play deck and then shuffle.
 * The types of the cards must be revealed to confirm that they are hazards, but the actual card names don't need to be revealed. The normal effect of tapping the Nazgûl does not apply, and the Nazgûl is discarded upon declaration without turning into a short-event. Tapping and discarding a Nazgûl in this way counts as one against the hazard limit.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, addCardInPlay, dispatch, makeMHState, viableActions, Phase, CardStatus,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN,
  ASSASSIN, EYE_OF_SAURON, ORC_WARBAND,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';
import type { SideboardWithNazgulAction, FetchHazardFromSideboardAction } from '../../../index.js';

// Witch-king of Angmar (tw-113): a Nazgûl hazard permanent-event.
// Single-test use → inline.
const WITCH_KING_OF_ANGMAR = 'tw-113' as CardDefinitionId;

function baseState(playDeckSize: number) {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [],
        sideboard: [ASSASSIN, EYE_OF_SAURON],
        playDeck: Array(playDeckSize).fill(ORC_WARBAND) as CardDefinitionId[],
      },
    ],
  });
  return addCardInPlay(built, 1, WITCH_KING_OF_ANGMAR);
}

describe('Rule 5.24 — Sideboarding with a Nazgûl', () => {
  beforeEach(() => resetMint());

  test('Both sub-options are offered for an untapped Nazgûl when the play deck has at least 5 cards', () => {
    const built = baseState(5);
    const state = { ...built, phaseState: makeMHState() };
    const nazgulInstId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WITCH_KING_OF_ANGMAR)!.instanceId;

    const actions = viableActions(state, PLAYER_2, 'sideboard-with-nazgul') as { action: SideboardWithNazgulAction }[];
    expect(actions.some(a => a.action.cardInstanceId === nazgulInstId && a.action.destination === 'discard')).toBe(true);
    expect(actions.some(a => a.action.cardInstanceId === nazgulInstId && a.action.destination === 'deck')).toBe(true);
  });

  test('The "to deck" sub-option is not offered when the play deck has fewer than 5 cards', () => {
    const built = baseState(4);
    const state = { ...built, phaseState: makeMHState() };

    const actions = viableActions(state, PLAYER_2, 'sideboard-with-nazgul') as { action: SideboardWithNazgulAction }[];
    expect(actions.some(a => a.action.destination === 'discard')).toBe(true);
    expect(actions.some(a => a.action.destination === 'deck')).toBe(false);
  });

  test('Discarding to sideboard: tapping and discarding the Nazgûl counts against the hazard limit and does not turn into a short-event', () => {
    const built = baseState(5);
    const state = { ...built, phaseState: makeMHState() };
    const nazgulInstId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WITCH_KING_OF_ANGMAR)!.instanceId;

    const after = dispatch(state, { type: 'sideboard-with-nazgul', player: PLAYER_2, cardInstanceId: nazgulInstId, destination: 'discard' });

    // Discarded outright — not converted to a short-event or left in play.
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === nazgulInstId)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === nazgulInstId)).toBe(true);
    expect(after.combat).toBeNull();
    expect(after.chain).toBeNull();
    // Counts as one against the hazard limit.
    const mh = after.phaseState as ReturnType<typeof makeMHState>;
    expect(mh.hazardsPlayedThisCompany).toBe(1);
  });

  test('Discarding to sideboard: may fetch up to five hazards to the discard pile, then pass exits the sub-flow and normal play-hazards actions resume', () => {
    const built = baseState(0);
    const state = { ...built, phaseState: makeMHState() };
    const nazgulInstId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WITCH_KING_OF_ANGMAR)!.instanceId;

    const afterTap = dispatch(state, { type: 'sideboard-with-nazgul', player: PLAYER_2, cardInstanceId: nazgulInstId, destination: 'discard' });

    // Only fetch actions (and no pass yet, since 0 fetched) are offered.
    const fetchable = viableActions(afterTap, PLAYER_2, 'fetch-hazard-from-sideboard') as { action: FetchHazardFromSideboardAction }[];
    expect(fetchable).toHaveLength(2);
    expect(viableActions(afterTap, PLAYER_2, 'pass')).toHaveLength(0);
    expect(viableActions(afterTap, PLAYER_2, 'play-hazard')).toHaveLength(0);

    // Fetch both sideboarded hazards to the discard pile.
    let current = afterTap;
    for (const fetch of fetchable) {
      current = dispatch(current, fetch.action);
    }
    expect(current.players[HAZARD_PLAYER].sideboard).toHaveLength(0);
    expect(current.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ASSASSIN)).toBe(true);
    expect(current.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === EYE_OF_SAURON)).toBe(true);

    // Pass exits the sub-flow (does not end the hazard player's play-hazards turn).
    const passAction = viableActions(current, PLAYER_2, 'pass')[0];
    const afterPass = dispatch(current, passAction.action);
    const mhAfter = afterPass.phaseState as ReturnType<typeof makeMHState>;
    expect(mhAfter.nazgulSideboardDestination).toBeNull();
    expect(afterPass.phaseState.phase).toBe(Phase.MovementHazard);
  });

  test('Bringing a hazard to the play deck: fetches exactly one card, shuffles it in, and auto-exits the sub-flow', () => {
    const built = baseState(5);
    const state = { ...built, phaseState: makeMHState() };
    const nazgulInstId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WITCH_KING_OF_ANGMAR)!.instanceId;

    const afterTap = dispatch(state, { type: 'sideboard-with-nazgul', player: PLAYER_2, cardInstanceId: nazgulInstId, destination: 'deck' });
    const fetchable = viableActions(afterTap, PLAYER_2, 'fetch-hazard-from-sideboard') as { action: FetchHazardFromSideboardAction }[];
    expect(fetchable).toHaveLength(2);

    const after = dispatch(afterTap, fetchable[0].action);

    const fetchedDefId = (fetchable[0].action).sideboardCardInstanceId;
    expect(after.players[HAZARD_PLAYER].sideboard.some(c => c.instanceId === fetchedDefId)).toBe(false);
    expect(after.players[HAZARD_PLAYER].playDeck).toHaveLength(6);
    // Sub-flow auto-exits after exactly one card — back to normal play-hazards.
    const mhAfter = after.phaseState as ReturnType<typeof makeMHState>;
    expect(mhAfter.nazgulSideboardDestination).toBeNull();
    expect(viableActions(after, PLAYER_2, 'fetch-hazard-from-sideboard')).toHaveLength(0);
  });

  test('A tapped Nazgûl cannot be sideboarded', () => {
    const built = baseState(5);
    const nazgulInstId = built.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WITCH_KING_OF_ANGMAR)!.instanceId;
    const tapped = {
      ...built,
      players: built.players.map((p, i) => i !== HAZARD_PLAYER ? p : {
        ...p,
        cardsInPlay: p.cardsInPlay.map(c => c.instanceId === nazgulInstId ? { ...c, status: CardStatus.Tapped } : c),
      }) as unknown as typeof built.players,
    };
    const state = { ...tapped, phaseState: makeMHState() };

    const actions = viableActions(state, PLAYER_2, 'sideboard-with-nazgul') as { action: SideboardWithNazgulAction }[];
    expect(actions.some(a => a.action.cardInstanceId === nazgulInstId)).toBe(false);
  });
});
