/**
 * @module dm-75.test
 *
 * Card test: No Way Forward (dm-75)
 * Type: hazard-event (permanent, Environment)
 *
 * Card text:
 *   "Environment. The number of region cards that may be played by a moving
 *    company using region movement is reduced by one (by two if Doors of Night
 *    is in play) to a minimum of two. This card is effective during each
 *    player's organization phase. Discard when any play deck is exhausted.
 *    Cannot be duplicated."
 *
 * Effects:
 *   1. region-movement-limit reduce:1 reduceWithDoorsOfNight:2 min:2
 *      — game-wide region-movement reduction, floored at two regions
 *   2. on-event: play-deck-exhausted → discard-self
 *      — discard when any play deck is exhausted
 *   3. duplication-limit scope:game max:1 — cannot be duplicated
 *
 * | # | Effect                                          | Status | Notes                                   |
 * |---|-------------------------------------------------|--------|-----------------------------------------|
 * | 1 | region-movement-limit (1 / 2 w/ DoN, min 2)     | OK     | applyRegionMovementReduction            |
 * | 2 | on-event: play-deck-exhausted, discard-self     | OK     | completeDeckExhaust in reducer-utils    |
 * | 3 | duplication-limit (game, max 1)                 | OK     | movement-hazard.ts duplication check    |
 *
 * Geography (region distances from Rivendell, rules-style origin+destination
 * counting): Bree = 2, Moria = 3, Isengard = 4, Minas Tirith = 6. Base region
 * movement allows up to 4 regions.
 *
 * Playable: YES
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE, ISENGARD, DOORS_OF_NIGHT,
  buildTestState, resetMint,
  addCardInPlay,
  dispatch,
  HAZARD_PLAYER,
  expectInDiscardPile,
  SAPLING_OF_THE_WHITE_TREE,
  Phase,
  makeMHState,
  viableActions,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, EndOfTurnPhaseState, MovementHazardPhaseState } from '../../index.js';
import { CardStatus } from '../../index.js';

const NO_WAY_FORWARD = 'dm-75' as CardDefinitionId;

const noWayForwardInPlay: CardInPlay = {
  instanceId: 'nwf-1' as CardInstanceId,
  definitionId: NO_WAY_FORWARD,
  status: CardStatus.Untapped,
};

/** Org-phase state: P1 at Rivendell with destinations at 2/3/4/6 regions away. */
function orgState(): ReturnType<typeof buildTestState> {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [BREE, MORIA, ISENGARD, MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
}

describe('No Way Forward (dm-75)', () => {
  beforeEach(() => resetMint());

  // ---- Rule 1: region-movement reduction (org phase) ----

  test('at base (no environment), region movement reaches up to 4 regions', () => {
    const state = orgState();
    const reach = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'plan-movement')
      .map(ea => resolveInstanceId(state, (ea.action as { destinationSite: CardInstanceId }).destinationSite) as string);

    expect(reach).toContain(MORIA as string);     // 3 regions
    expect(reach).toContain(ISENGARD as string);  // 4 regions
    expect(reach).not.toContain(MINAS_TIRITH as string); // 6 regions — beyond base
  });

  test('No Way Forward reduces the limit by one — a 4-region plan is rejected', () => {
    const state = addCardInPlay(orgState(), HAZARD_PLAYER, NO_WAY_FORWARD);
    const reach = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'plan-movement')
      .map(ea => resolveInstanceId(state, (ea.action as { destinationSite: CardInstanceId }).destinationSite) as string);

    // Max region distance drops from 4 to 3.
    expect(reach).toContain(MORIA as string);        // 3 regions — still allowed
    expect(reach).not.toContain(ISENGARD as string); // 4 regions — now too far
  });

  test('with Doors of Night in play, the reduction is two', () => {
    const withNwf = addCardInPlay(orgState(), HAZARD_PLAYER, NO_WAY_FORWARD);
    const state = addCardInPlay(withNwf, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const reach = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'plan-movement')
      .map(ea => resolveInstanceId(state, (ea.action as { destinationSite: CardInstanceId }).destinationSite) as string);

    // Max region distance drops from 4 to 2.
    expect(reach).not.toContain(MORIA as string); // 3 regions — now too far
    expect(reach).toContain(BREE as string);      // 2 regions — the floor still allows it
  });

  test('the reduction never drops the limit below two (minimum of two)', () => {
    // Even with No Way Forward + Doors of Night (which would compute 4 - 2 = 2),
    // a two-region region-movement destination remains reachable.
    const withNwf = addCardInPlay(orgState(), HAZARD_PLAYER, NO_WAY_FORWARD);
    const state = addCardInPlay(withNwf, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const regionDestinations = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'plan-movement')
      .map(ea => resolveInstanceId(state, (ea.action as { destinationSite: CardInstanceId }).destinationSite) as string);

    // Bree (2 regions) is the only declarable destination at the floor.
    expect(regionDestinations).toContain(BREE as string);
    expect(regionDestinations).not.toContain(MORIA as string);
    expect(regionDestinations).not.toContain(ISENGARD as string);
    expect(regionDestinations).not.toContain(MINAS_TIRITH as string);
  });

  // ---- Rule 1: region-movement reduction (M/H phase select-company) ----

  test('M/H select-company computes the reduced max region distance', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const withEnv = addCardInPlay(base, HAZARD_PLAYER, NO_WAY_FORWARD);
    const ready = { ...withEnv, phaseState: makeMHState({ step: 'select-company', maxRegionDistance: 4 }) };
    const companyId = ready.players[0].companies[0].id;

    const after = dispatch(ready, { type: 'select-company', player: PLAYER_1, companyId });
    const phaseState = after.phaseState as MovementHazardPhaseState;

    // Base 4 reduced by one (no Doors of Night) → 3.
    expect(phaseState.maxRegionDistance).toBe(3);
  });

  // ---- Rule 2: discard when any play deck is exhausted ----

  test('discards when the active player deck exhausts during EOT', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [],
          discardPile: [SAPLING_OF_THE_WHITE_TREE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, HAZARD_PLAYER, NO_WAY_FORWARD);

    // Before the deck-exhaust completes, the environment is still in play.
    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NO_WAY_FORWARD)).toBe(true);

    // Completing the exhaust (pass through the exchange sub-flow) fires play-deck-exhausted.
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expectInDiscardPile(afterPass, HAZARD_PLAYER, NO_WAY_FORWARD);
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NO_WAY_FORWARD)).toBe(false);
  });

  // ---- Rule 3: cannot be duplicated ----

  test('cannot be duplicated — not playable while a copy is already in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [NO_WAY_FORWARD],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [noWayForwardInPlay],
        },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('is playable when no copy is already in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [NO_WAY_FORWARD],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions.length).toBeGreaterThan(0);
  });
});
