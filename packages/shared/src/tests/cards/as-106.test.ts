/**
 * @module as-106.test
 *
 * Card test: The Under-roads (as-106)
 * Type: minion-resource-event (Long-event), alignment ringwraith, non-unique.
 * Marshalling Points: 0 (misc).
 *
 * Card text: "The roll required for minions to move between adjacent
 * Under-deeps sites is decreased by 3. Discards and prohibits the subsequent
 * play of The Way is Shut."
 *
 * Rule coverage:
 *
 * | # | Rule                                                          | Mechanism                                             |
 * |---|--------------------------------------------------------------|-------------------------------------------------------|
 * | 1 | Under-deeps movement roll for minions decreased by 3          | under-deeps-roll-modifier value:3 scope:minion-companies |
 * | 2 | Reduction applies only to minion (RW/Balrog) companies       | gated in mh-steps on isMinionOrBalrog(player)         |
 * | 3 | Multiple copies stack                                          | modifier summed across cardsInPlay                    |
 * | 4 | Playing it discards The Way is Shut already in play           | prohibit-card-play discard on resolveLongEvent        |
 * | 5 | While in play, The Way is Shut may not be (re)played          | prohibit-card-play play-lock in playHazardsActions    |
 *
 * The reduction is a game-wide environment collected from either player's
 * cardsInPlay; the required-roll comparison uses the same reduction trick as
 * the Balrog's built-in +3 (a decrease of the required roll floored at 0).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment,
  buildTestState, resetMint, makeMHState, addCardInPlay,
  reduce, playLongEventAndResolve,
  findHandCardId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase,
} from '../test-helpers.js';
import { MovementType } from '../../types/common.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../index.js';

const UNDER_ROADS = 'as-106' as CardDefinitionId;
const THE_WAY_IS_SHUT = 'dm-98' as CardDefinitionId;

const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // minion warrior, non-unique
const ARAGORN = 'tw-120' as CardDefinitionId;     // hero character

// Under-deeps sites (Balrog set, used purely as movement/keying fixtures).
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId; // ruins-and-lairs, under-deeps
const UNDER_VAULTS = 'ba-103' as CardDefinitionId;  // ruins-and-lairs, under-deeps; adjacent to Drowning-deeps (roll 8)

// Ordinary (non-Under-deeps) minion Ruins & Lairs for the prohibit test.
const ETTENMOORS = 'le-373' as CardDefinitionId;

/** Build a reveal-new-site M/H state with one moving company at Drowning-deeps → Under-vaults. */
function underDeepsMoveState(opts: {
  moverAlignment: Alignment;
  moverChar: CardDefinitionId;
  underRoadsOwner?: 0 | 1;
  underRoadsCopies?: number;
}) {
  const otherAlignment = opts.moverAlignment === Alignment.Ringwraith
    ? Alignment.Wizard
    : Alignment.Ringwraith;
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: opts.moverAlignment,
        companies: [{ site: DROWNING_DEEPS, characters: [opts.moverChar], destinationSite: UNDER_VAULTS }],
        hand: [],
        siteDeck: [],
      },
      { id: PLAYER_2, alignment: otherAlignment, companies: [], hand: [], siteDeck: [] },
    ],
  });
  const copies = opts.underRoadsCopies ?? 0;
  const owner = opts.underRoadsOwner ?? 0;
  for (let i = 0; i < copies; i++) state = addCardInPlay(state, owner, UNDER_ROADS);
  return { ...state, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
}

function declareUnderDeeps(state: ReturnType<typeof underDeepsMoveState>): MovementHazardPhaseState {
  const result = reduce(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
  expect(result.error).toBeUndefined();
  return result.state.phaseState as MovementHazardPhaseState;
}

describe('The Under-roads (as-106)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: minion Under-deeps roll decreased by 3 ───────────────────────

  test('with The Under-roads in play, a minion company Under-deeps roll drops by 3 (8 → 5)', () => {
    const state = underDeepsMoveState({
      moverAlignment: Alignment.Ringwraith,
      moverChar: ORC_CAPTAIN,
      underRoadsOwner: RESOURCE_PLAYER,
      underRoadsCopies: 1,
    });
    const mhState = declareUnderDeeps(state);
    expect(mhState.step).toBe('under-deeps-roll');
    expect(mhState.underDeepsRollRequired).toBe(5);
  });

  test('negative control: without The Under-roads, the required roll is unmodified (8)', () => {
    const state = underDeepsMoveState({
      moverAlignment: Alignment.Ringwraith,
      moverChar: ORC_CAPTAIN,
      underRoadsCopies: 0,
    });
    const mhState = declareUnderDeeps(state);
    expect(mhState.underDeepsRollRequired).toBe(8);
  });

  // ─── Rule 2: reduction applies only to minion (Ringwraith) companies ──────

  test('a hero company gains NO reduction even with The Under-roads in play (roll stays 8)', () => {
    const state = underDeepsMoveState({
      moverAlignment: Alignment.Wizard,
      moverChar: ARAGORN,
      underRoadsOwner: HAZARD_PLAYER, // the minion opponent has it in play
      underRoadsCopies: 1,
    });
    const mhState = declareUnderDeeps(state);
    expect(mhState.underDeepsRollRequired).toBe(8);
  });

  test('the Balrog player is a minion too: The Under-roads lowers their roll by 3', () => {
    // Regression: the minion-companies gate tested only Ringwraith alignment,
    // so the Balrog player — the alignment that does the most Under-deeps
    // movement — never received the -3.
    const withoutRoads = underDeepsMoveState({
      moverAlignment: Alignment.Balrog,
      moverChar: ORC_CAPTAIN,
      underRoadsCopies: 0,
    });
    const baseline = declareUnderDeeps(withoutRoads).underDeepsRollRequired!;

    const withRoads = underDeepsMoveState({
      moverAlignment: Alignment.Balrog,
      moverChar: ORC_CAPTAIN,
      underRoadsOwner: RESOURCE_PLAYER,
      underRoadsCopies: 1,
    });
    expect(declareUnderDeeps(withRoads).underDeepsRollRequired).toBe(Math.max(0, baseline - 3));
  });

  // ─── Rule 3: multiple copies stack ────────────────────────────────────────

  test('two copies of The Under-roads stack: minion roll drops by 6 (8 → 2)', () => {
    const state = underDeepsMoveState({
      moverAlignment: Alignment.Ringwraith,
      moverChar: ORC_CAPTAIN,
      underRoadsOwner: RESOURCE_PLAYER,
      underRoadsCopies: 2,
    });
    const mhState = declareUnderDeeps(state);
    expect(mhState.underDeepsRollRequired).toBe(2);
  });

  // ─── Rule 4: playing it discards The Way is Shut already in play ──────────

  test('playing The Under-roads discards an in-play The Way is Shut to its owner', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [], hand: [UNDER_ROADS], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    // The opposing hazard player has The Way is Shut in play.
    state = addCardInPlay(state, HAZARD_PLAYER, THE_WAY_IS_SHUT);

    const underRoadsId = findHandCardId(state, RESOURCE_PLAYER, UNDER_ROADS);
    const after = playLongEventAndResolve(state, PLAYER_1, underRoadsId);

    // The Under-roads entered play for the minion player.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === UNDER_ROADS)).toBe(true);
    // The Way is Shut left play and is now in its owner's (P2's) discard pile.
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === THE_WAY_IS_SHUT)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === THE_WAY_IS_SHUT)).toBe(true);
  });

  // ─── Rule 5: while The Under-roads is in play, The Way is Shut is prohibited ───

  function whoShutMHState(underRoadsCopies: number) {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [THE_WAY_IS_SHUT], siteDeck: [] },
      ],
    });
    for (let i = 0; i < underRoadsCopies; i++) state = addCardInPlay(state, RESOURCE_PLAYER, UNDER_ROADS);
    return { ...state, phaseState: makeMHState() };
  }

  test('with The Under-roads in play, the hazard player may NOT play The Way is Shut', () => {
    const state = whoShutMHState(1);
    const shutId = findHandCardId(state, HAZARD_PLAYER, THE_WAY_IS_SHUT);
    const actions = computeLegalActions(state, PLAYER_2).filter(
      ea => ea.action.type === 'play-hazard'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (shutId as string),
    );
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every(ea => !ea.viable)).toBe(true);
  });

  test('negative control: without The Under-roads, The Way is Shut is playable', () => {
    const state = whoShutMHState(0);
    const shutId = findHandCardId(state, HAZARD_PLAYER, THE_WAY_IS_SHUT);
    const viable = computeLegalActions(state, PLAYER_2).filter(
      ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (shutId as string),
    );
    expect(viable.length).toBeGreaterThan(0);
  });
});
