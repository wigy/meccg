/**
 * @module dm-157.test
 *
 * Card test: Secret Ways (dm-157)
 * Type: hero-resource-event (Long-event), alignment wizard, non-unique.
 * Marshalling Points: 0 (misc).
 *
 * Card text: "The roll required to move between adjacent Under-deeps sites is
 * decreased by 4. Cannot be duplicated."
 *
 * Rule coverage:
 *
 * | # | Rule                                                          | Mechanism                                            |
 * |---|--------------------------------------------------------------|-------------------------------------------------------|
 * | 1 | Under-deeps movement roll decreased by 4                     | under-deeps-roll-modifier value:4 scope:all-companies |
 * | 2 | Reduction applies to hero companies                          | scope:all-companies applies regardless of alignment    |
 * | 3 | Reduction applies to minion companies too (unlike as-106)    | scope:all-companies has no alignment gate              |
 * | 4 | Multiple copies stack                                        | modifier summed across cardsInPlay                     |
 * | 5 | Cannot be duplicated                                         | duplication-limit scope:game max:1                     |
 *
 * The reduction is a game-wide environment collected from either player's
 * cardsInPlay; the required-roll comparison uses the same reduction trick as
 * the Balrog's built-in +3 (a decrease of the required roll floored at 0).
 * Unlike The Under-roads (as-106), which only helps Ringwraith-minion
 * companies, Secret Ways' text names no side, so it helps every company.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment,
  buildTestState, resetMint, makeMHState, addCardInPlay,
  reduce,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus, viableActions,
  ARAGORN,
} from '../test-helpers.js';
import { MovementType } from '../../types/common.js';
import type { CardDefinitionId, MovementHazardPhaseState, CardInPlay, CardInstanceId } from '../../index.js';

const SECRET_WAYS = 'dm-157' as CardDefinitionId;

const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // minion warrior, non-unique

// Under-deeps sites (Balrog set, used purely as movement/keying fixtures).
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId; // ruins-and-lairs, under-deeps
const UNDER_VAULTS = 'ba-103' as CardDefinitionId;  // ruins-and-lairs, under-deeps; adjacent to Drowning-deeps (roll 8)

/** Build a reveal-new-site M/H state with one moving company at Drowning-deeps → Under-vaults. */
function underDeepsMoveState(opts: {
  moverAlignment: Alignment;
  moverChar: CardDefinitionId;
  secretWaysOwner?: 0 | 1;
  secretWaysCopies?: number;
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
  const copies = opts.secretWaysCopies ?? 0;
  const owner = opts.secretWaysOwner ?? 0;
  for (let i = 0; i < copies; i++) state = addCardInPlay(state, owner, SECRET_WAYS);
  return { ...state, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
}

function declareUnderDeeps(state: ReturnType<typeof underDeepsMoveState>): MovementHazardPhaseState {
  const result = reduce(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.UnderDeeps });
  expect(result.error).toBeUndefined();
  return result.state.phaseState as MovementHazardPhaseState;
}

describe('Secret Ways (dm-157)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1 & 2: hero Under-deeps roll decreased by 4 ──────────────────────

  test('with Secret Ways in play, a hero company Under-deeps roll drops by 4 (8 → 4)', () => {
    const state = underDeepsMoveState({
      moverAlignment: Alignment.Wizard,
      moverChar: ARAGORN,
      secretWaysOwner: RESOURCE_PLAYER,
      secretWaysCopies: 1,
    });
    const mhState = declareUnderDeeps(state);
    expect(mhState.step).toBe('under-deeps-roll');
    expect(mhState.underDeepsRollRequired).toBe(4);
  });

  test('negative control: without Secret Ways, the required roll is unmodified (8)', () => {
    const state = underDeepsMoveState({
      moverAlignment: Alignment.Wizard,
      moverChar: ARAGORN,
      secretWaysCopies: 0,
    });
    const mhState = declareUnderDeeps(state);
    expect(mhState.underDeepsRollRequired).toBe(8);
  });

  // ─── Rule 3: reduction also applies to minion companies (unlike as-106) ────

  test('a minion company also gains the reduction, even with the opponent owning Secret Ways (roll 8 → 4)', () => {
    const state = underDeepsMoveState({
      moverAlignment: Alignment.Ringwraith,
      moverChar: ORC_CAPTAIN,
      secretWaysOwner: HAZARD_PLAYER, // the hero opponent has it in play
      secretWaysCopies: 1,
    });
    const mhState = declareUnderDeeps(state);
    expect(mhState.underDeepsRollRequired).toBe(4);
  });

  // ─── Rule 4: multiple copies stack ──────────────────────────────────────────

  test('two copies of Secret Ways stack: roll drops by 8 to 0 — Under-deeps move auto-succeeds, no roll step', () => {
    const state = underDeepsMoveState({
      moverAlignment: Alignment.Wizard,
      moverChar: ARAGORN,
      secretWaysOwner: RESOURCE_PLAYER,
      secretWaysCopies: 2,
    });
    const mhState = declareUnderDeeps(state);
    // Required roll floored to 0: the under-deeps-roll step is skipped entirely
    // (mirrors the "roll not required" auto-advance path in mh-steps.ts).
    expect(mhState.step).not.toBe('under-deeps-roll');
    expect(mhState.underDeepsRollRequired).toBeUndefined();
  });

  // ─── Rule 5: Cannot be duplicated ───────────────────────────────────────────

  test('cannot be duplicated — second copy blocked when one is already in play (same player)', () => {
    const inPlay: CardInPlay = {
      instanceId: 'sw-pre' as CardInstanceId,
      definitionId: SECRET_WAYS,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          companies: [],
          hand: [SECRET_WAYS],
          siteDeck: [],
          cardsInPlay: [inPlay],
        },
        {
          id: PLAYER_2,
          companies: [],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-long-event');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated — second copy blocked when opponent has one in play', () => {
    const inPlay: CardInPlay = {
      instanceId: 'sw-opp' as CardInstanceId,
      definitionId: SECRET_WAYS,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          companies: [],
          hand: [SECRET_WAYS],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [],
          hand: [],
          siteDeck: [],
          cardsInPlay: [inPlay],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-long-event');
    expect(actions).toHaveLength(0);
  });

  test('playable when no copy is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          companies: [],
          hand: [SECRET_WAYS],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-long-event');
    expect(actions).toHaveLength(1);
  });
});
