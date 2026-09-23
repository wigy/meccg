/**
 * @module ba-32.test
 *
 * Card test: Show Things Unbidden (ba-32)
 * Type: hero-resource-event (short), wizard alignment
 * Effects: 3
 *   1. play-window — organization phase, end-of-org step
 *   2. play-target character — filter: target.name "Galadriel",
 *      target.status untapped, company.siteName "Lórien"; cost: tap character
 *   3. on-event self-enters-play → force-opponent-hazard-shuffle (count: 3)
 *
 * Card text: "Playable during the organization phase on Galadriel if
 *  untapped and at Lórien. Tap Galadriel. Opponent must choose and reveal
 *  to you 3 non-environment hazards from his hand and shuffle them into
 *  his play deck. If these are not available, opponent must reveal his
 *  hand to you and shuffle all non-environment hazards there into his
 *  play deck."
 *
 * "Non-environment hazard" = any hazard-creature, or a hazard-event
 * lacking the `environment` keyword (Doors of Night, Twilight, etc. are
 * excluded).
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                       |
 * |---|---------------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Playable only on untapped Galadriel at Lórien    | IMPLEMENTED | play-target filter (name/status/siteName)    |
 * | 2 | Tap Galadriel as a cost                          | IMPLEMENTED | play-target cost.tap "character"             |
 * | 3 | Opponent chooses 3 matching hazards, shuffles in | IMPLEMENTED | force-discard-card destination "play-deck"   |
 * | 4 | Fewer than 3 available → reveal hand, shuffle all| IMPLEMENTED | force-opponent-hazard-shuffle fallback branch |
 *
 * Playable: YES
 * Certified: 2026-09-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  GALADRIEL, GIMLI, CAVE_DRAKE, DOORS_OF_NIGHT,
  LORIEN, RIVENDELL, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, Phase,
  handCardId, findHandCardId, charIdAt,
  viableActions, dispatch,
} from '../test-helpers.js';
import { CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, ForceDiscardCardAction, PlayShortEventAction } from '../../index.js';

const SHOW_THINGS_UNBIDDEN = 'ba-32' as CardDefinitionId;
/** As-23 "A Lie in Your Eyes" — hazard-event, no `environment` keyword. */
const NON_ENV_HAZARD_A = 'as-23' as CardDefinitionId;
/** As-25 "Come at Need" — hazard-event, no `environment` keyword. */
const NON_ENV_HAZARD_B = 'as-25' as CardDefinitionId;

function buildState(opts: {
  galadrielStatus?: CardStatus;
  galadrielSite?: CardDefinitionId;
  opponentHand: CardDefinitionId[];
  opponentPlayDeck?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: opts.galadrielSite ?? LORIEN,
          characters: [{ defId: GALADRIEL, status: opts.galadrielStatus ?? CardStatus.Untapped }],
        }],
        hand: [SHOW_THINGS_UNBIDDEN],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [] }],
        hand: opts.opponentHand,
        playDeck: opts.opponentPlayDeck ?? [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

function playOnGaladriel(state: GameState): GameState {
  const cardInstance = handCardId(state, RESOURCE_PLAYER);
  const galadrielId = charIdAt(state, RESOURCE_PLAYER);
  const play = viableActions(state, PLAYER_1, 'play-short-event')
    .find(a => (a.action as PlayShortEventAction).cardInstanceId === cardInstance);
  expect(play).toBeDefined();
  expect((play!.action as PlayShortEventAction).targetScoutInstanceId).toBe(galadrielId);
  return dispatch(state, play!.action);
}

describe('Show Things Unbidden (ba-32)', () => {
  beforeEach(() => resetMint());

  test('is playable on untapped Galadriel at Lórien', () => {
    const state = buildState({ opponentHand: [] });
    const cardInstance = handCardId(state, RESOURCE_PLAYER);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .map(a => a.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardInstance);
    expect(plays).toHaveLength(1);
  });

  test('is not playable when Galadriel is tapped', () => {
    const state = buildState({ galadrielStatus: CardStatus.Tapped, opponentHand: [] });
    const cardInstance = handCardId(state, RESOURCE_PLAYER);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .map(a => a.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardInstance);
    expect(plays).toHaveLength(0);
  });

  test('is not playable when Galadriel is not at Lórien', () => {
    const state = buildState({ galadrielSite: MORIA, opponentHand: [] });
    const cardInstance = handCardId(state, RESOURCE_PLAYER);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .map(a => a.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardInstance);
    expect(plays).toHaveLength(0);
  });

  test('taps Galadriel and discards the played card from hand', () => {
    const state = buildState({ opponentHand: [] });
    const galadrielId = charIdAt(state, RESOURCE_PLAYER);

    const after = playOnGaladriel(state);

    expect(after.players[RESOURCE_PLAYER].characters[galadrielId].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === SHOW_THINGS_UNBIDDEN)).toBe(false);
  });

  test('with ≥3 non-environment hazards available, opponent must choose 3 to shuffle into their play deck', () => {
    const state = buildState({
      opponentHand: [CAVE_DRAKE, NON_ENV_HAZARD_A, NON_ENV_HAZARD_B, DOORS_OF_NIGHT, GIMLI],
      opponentPlayDeck: [MORIA],
    });
    const drakeId = findHandCardId(state, HAZARD_PLAYER, CAVE_DRAKE);
    const hazardAId = findHandCardId(state, HAZARD_PLAYER, NON_ENV_HAZARD_A);
    const hazardBId = findHandCardId(state, HAZARD_PLAYER, NON_ENV_HAZARD_B);
    const doorsId = findHandCardId(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const gimliId = findHandCardId(state, HAZARD_PLAYER, GIMLI);

    const after = playOnGaladriel(state);

    // No immediate reveal-all — the opponent gets to choose among matches.
    expect(after.revealedInstances[doorsId]).toBeUndefined();
    expect(after.revealedInstances[gimliId]).toBeUndefined();

    const pending = after.pendingResolutions.find(r => r.kind.type === 'force-discard-card');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_2);
    const kind = pending!.kind as {
      candidateInstanceIds: readonly CardInstanceId[];
      remaining?: number;
      destination?: string;
    };
    expect(kind.remaining).toBe(3);
    expect(kind.destination).toBe('play-deck');
    expect(kind.candidateInstanceIds).toContain(drakeId);
    expect(kind.candidateInstanceIds).toContain(hazardAId);
    expect(kind.candidateInstanceIds).toContain(hazardBId);
    expect(kind.candidateInstanceIds).not.toContain(doorsId);
    expect(kind.candidateInstanceIds).not.toContain(gimliId);

    // The opponent is offered exactly the 3 matching candidates.
    const choices = viableActions(after, PLAYER_2, 'force-discard-card')
      .map(a => (a.action as ForceDiscardCardAction).cardInstanceId);
    expect(choices.sort()).toEqual([drakeId, hazardAId, hazardBId].sort());

    // Resolve all three picks.
    let current = after;
    for (const [i, id] of [drakeId, hazardAId, hazardBId].entries()) {
      const action = viableActions(current, PLAYER_2, 'force-discard-card')
        .map(a => a.action as ForceDiscardCardAction)
        .find(a => a.cardInstanceId === id);
      expect(action).toBeDefined();
      current = dispatch(current, action!);
      const stillPending = current.pendingResolutions.find(r => r.kind.type === 'force-discard-card');
      if (i < 2) {
        expect(stillPending).toBeDefined();
        expect((stillPending!.kind as { remaining?: number }).remaining).toBe(2 - i);
      } else {
        expect(stillPending).toBeUndefined();
      }
    }

    // All three chosen cards are shuffled into the play deck, not discarded.
    expect(current.players[HAZARD_PLAYER].hand.some(c => c.instanceId === drakeId)).toBe(false);
    expect(current.players[HAZARD_PLAYER].hand.some(c => c.instanceId === hazardAId)).toBe(false);
    expect(current.players[HAZARD_PLAYER].hand.some(c => c.instanceId === hazardBId)).toBe(false);
    expect(current.players[HAZARD_PLAYER].playDeck.some(c => c.instanceId === drakeId)).toBe(true);
    expect(current.players[HAZARD_PLAYER].playDeck.some(c => c.instanceId === hazardAId)).toBe(true);
    expect(current.players[HAZARD_PLAYER].playDeck.some(c => c.instanceId === hazardBId)).toBe(true);
    expect(current.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === drakeId)).toBe(false);
    expect(current.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === hazardAId)).toBe(false);
    expect(current.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === hazardBId)).toBe(false);

    // The environment hazard and the non-hazard card are untouched.
    expect(current.players[HAZARD_PLAYER].hand.some(c => c.instanceId === doorsId)).toBe(true);
    expect(current.players[HAZARD_PLAYER].hand.some(c => c.instanceId === gimliId)).toBe(true);
  });

  test('with fewer than 3 available, opponent reveals hand and shuffles all matching hazards', () => {
    const state = buildState({
      opponentHand: [CAVE_DRAKE, NON_ENV_HAZARD_A, DOORS_OF_NIGHT, GIMLI],
      opponentPlayDeck: [MORIA],
    });
    const drakeId = findHandCardId(state, HAZARD_PLAYER, CAVE_DRAKE);
    const hazardAId = findHandCardId(state, HAZARD_PLAYER, NON_ENV_HAZARD_A);
    const doorsId = findHandCardId(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const gimliId = findHandCardId(state, HAZARD_PLAYER, GIMLI);
    const deckSizeBefore = state.players[HAZARD_PLAYER].playDeck.length;

    const after = playOnGaladriel(state);

    // No choice offered — deterministic once the hand is fixed.
    expect(after.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(false);

    // The opponent's entire hand is revealed, including the non-matching cards.
    expect(after.revealedInstances[drakeId]).toBe(CAVE_DRAKE);
    expect(after.revealedInstances[hazardAId]).toBe(NON_ENV_HAZARD_A);
    expect(after.revealedInstances[doorsId]).toBe(DOORS_OF_NIGHT);
    expect(after.revealedInstances[gimliId]).toBe(GIMLI);

    // Both matching hazards moved to the play deck; the rest stay in hand.
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.instanceId === drakeId)).toBe(false);
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.instanceId === hazardAId)).toBe(false);
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.instanceId === doorsId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.instanceId === gimliId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].playDeck).toHaveLength(deckSizeBefore + 2);
    expect(after.players[HAZARD_PLAYER].playDeck.some(c => c.instanceId === drakeId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].playDeck.some(c => c.instanceId === hazardAId)).toBe(true);
  });

  test('with zero non-environment hazards available, opponent still reveals hand but nothing shuffles', () => {
    const state = buildState({
      opponentHand: [DOORS_OF_NIGHT, GIMLI],
      opponentPlayDeck: [MORIA],
    });
    const doorsId = findHandCardId(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const gimliId = findHandCardId(state, HAZARD_PLAYER, GIMLI);
    const deckSizeBefore = state.players[HAZARD_PLAYER].playDeck.length;

    const after = playOnGaladriel(state);

    expect(after.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(false);
    expect(after.revealedInstances[doorsId]).toBe(DOORS_OF_NIGHT);
    expect(after.revealedInstances[gimliId]).toBe(GIMLI);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(2);
    expect(after.players[HAZARD_PLAYER].playDeck).toHaveLength(deckSizeBefore);
  });
});
