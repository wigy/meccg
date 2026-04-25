/**
 * @module le-107.test
 *
 * Card test: Covetous Thoughts (le-107)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 3 (play-target character filter:minion-character,
 *             duplication-limit scope:character max:1,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:6)
 *
 * "Corruption. Playable only on a minion. At the end of each of his turns,
 *  target minion makes a corruption check for each item his company bears that
 *  he does not bear. For each check, modify the roll by subtracting the
 *  corruption of that item. During his organization phase, the minion may tap
 *  to attempt to remove this card. Make a roll—if the result is greater than 5,
 *  discard this card. Cannot be duplicated on a given minion."
 *
 * Engine Support:
 * | # | Feature                                          | Status          | Notes                                          |
 * |---|--------------------------------------------------|-----------------|------------------------------------------------|
 * | 1 | Play from hand targeting minion character        | IMPLEMENTED     | play-target filter target.cardType             |
 * | 2 | Cannot target hero characters                    | IMPLEMENTED     | filter excludes hero-character cardType        |
 * | 3 | Cannot be duplicated on given minion             | IMPLEMENTED     | duplication-limit scope:character max:1        |
 * | 4 | End-of-turn per-item corruption checks           | NOT IMPLEMENTED | no end-of-turn on-event trigger in DSL         |
 * | 5 | Check modifier: subtract item corruption value   | NOT IMPLEMENTED | per-item modifier requires end-of-turn trigger |
 * | 6 | Tap to attempt removal (roll>5)                  | IMPLEMENTED     | grant-action remove-self-on-roll threshold:6   |
 *
 * Playable: PARTIALLY — end-of-turn per-item corruption check not in DSL.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus, dispatch, expectCharStatus, expectInDiscardPile,
  makeMHState,
  attachHazardToChar, charIdAt, setCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  ActivateGrantedAction,
  CardDefinitionId,
  PlayHazardAction,
} from '../../index.js';

const COVETOUS_THOUGHTS = 'le-107' as CardDefinitionId;

// Minion fixtures — declared locally per the card-ids.ts constants policy.
const GORBAG = 'le-11' as CardDefinitionId;     // minion-character, orc
const SHAGRAT = 'le-39' as CardDefinitionId;    // minion-character, orc
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion-site, haven
const ETTENMOORS = 'le-373' as CardDefinitionId;    // minion-site, ruins-and-lairs

describe('Covetous Thoughts (le-107)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: play-target filter — minion-character only ─────────────────

  test('can be played on a minion character', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [COVETOUS_THOUGHTS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');

    const gorbagId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    const targets = playActions.map(ea => (ea.action as PlayHazardAction).targetCharacterId);
    expect(targets).toContain(gorbagId);
  });

  test('cannot be played on a hero character', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [COVETOUS_THOUGHTS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');

    const legolasId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    const targets = playActions.map(ea => (ea.action as PlayHazardAction).targetCharacterId);
    expect(targets).not.toContain(legolasId);
  });

  // ── Effect 2: duplication-limit scope:character max:1 ─────────────────────

  test('cannot be duplicated on the same minion', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG, SHAGRAT] }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [COVETOUS_THOUGHTS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const withCT = attachHazardToChar(base, RESOURCE_PLAYER, GORBAG, COVETOUS_THOUGHTS);
    const mhState = { ...withCT, phaseState: makeMHState() };

    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');
    const targets = playActions.map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    const gorbagId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    const shagratId = charIdAt(mhState, RESOURCE_PLAYER, 0, 1);

    // Gorbag already has Covetous Thoughts — not a valid target
    expect(targets).not.toContain(gorbagId);
    // Shagrat is still valid
    expect(targets).toContain(shagratId);
  });

  // ── Effect 3: grant-action remove-self-on-roll (threshold 6) ──────────────

  test('untapped minion with Covetous Thoughts can activate removal during organization', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const withCT = attachHazardToChar(base, RESOURCE_PLAYER, GORBAG, COVETOUS_THOUGHTS);
    const actions = viableActions(withCT, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('remove-self-on-roll');
    expect(action.rollThreshold).toBe(6);
  });

  test('tapped minion cannot activate Covetous Thoughts removal', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const withCT = attachHazardToChar(base, RESOURCE_PLAYER, GORBAG, COVETOUS_THOUGHTS);
    const tapped = setCharStatus(withCT, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);

    const actions = viableActions(tapped, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(0);
  });

  test('successful removal roll (>5) discards Covetous Thoughts and taps the minion', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const withCT = attachHazardToChar(base, RESOURCE_PLAYER, GORBAG, COVETOUS_THOUGHTS);
    const cheated = { ...withCT, cheatRollTotal: 6 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const next = dispatch(cheated, actions[0].action);

    // Bearer should be tapped
    expectCharStatus(next, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);

    // Covetous Thoughts should be gone from character's hazards
    const gorbagId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[gorbagId as string].hazards).toHaveLength(0);

    // Covetous Thoughts should be in hazard player's discard pile
    expectInDiscardPile(next, HAZARD_PLAYER, COVETOUS_THOUGHTS);
  });

  test('failed removal roll (≤5) keeps Covetous Thoughts attached and taps the minion', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const withCT = attachHazardToChar(base, RESOURCE_PLAYER, GORBAG, COVETOUS_THOUGHTS);
    const cheated = { ...withCT, cheatRollTotal: 5 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const next = dispatch(cheated, actions[0].action);

    // Bearer should be tapped
    expectCharStatus(next, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);

    // Covetous Thoughts should still be attached
    const gorbagId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[gorbagId as string].hazards).toHaveLength(1);
    expect(next.players[0].characters[gorbagId as string].hazards[0].definitionId).toBe(COVETOUS_THOUGHTS);

    // Covetous Thoughts should NOT be in discard
    expect(next.players[1].discardPile.some(c => c.definitionId === COVETOUS_THOUGHTS)).toBe(false);
  });
});
