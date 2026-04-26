/**
 * @module le-107.test
 *
 * Card test: Covetous Thoughts (le-107)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 4 (play-target character filter:minion-character,
 *             duplication-limit scope:character max:1,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:6,
 *             on-event end-of-turn force-check-per-others-item)
 *
 * "Corruption. Playable only on a minion. At the end of each of his turns,
 *  target minion makes a corruption check for each item his company bears that
 *  he does not bear. For each check, modify the roll by subtracting the
 *  corruption of that item. During his organization phase, the minion may tap
 *  to attempt to remove this card. Make a roll—if the result is greater than 5,
 *  discard this card. Cannot be duplicated on a given minion."
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                          |
 * |---|--------------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Play from hand targeting minion character        | IMPLEMENTED | play-target filter target.cardType             |
 * | 2 | Cannot target hero characters                    | IMPLEMENTED | filter excludes hero-character cardType        |
 * | 3 | Cannot be duplicated on given minion             | IMPLEMENTED | duplication-limit scope:character max:1        |
 * | 4 | End-of-turn per-item corruption checks           | IMPLEMENTED | on-event end-of-turn force-check-per-others-item |
 * | 5 | Check modifier: subtract item corruption value   | IMPLEMENTED | modifier = -item.corruptionPoints per check    |
 * | 6 | Tap to attempt removal (roll>5)                  | IMPLEMENTED | grant-action remove-self-on-roll threshold:6   |
 *
 * Playable: YES
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
  buildSitePhaseState, attachItemToChar,
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
const RED_BOOK = 'le-339' as CardDefinitionId;      // minion item, corruptionPoints: 2
const SABLE_SHIELD = 'le-341' as CardDefinitionId;  // minion item, corruptionPoints: 0

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

  test('untapped minion with Covetous Thoughts gets both standard (tap) and no-tap (−3) removal variants', () => {
    // Rule 10.08: untapped bearer gets the standard tap variant AND the no-tap -3 variant.
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
    expect(actions.length).toBe(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)?.action as ActivateGrantedAction;
    expect(standardAction.actionId).toBe('remove-self-on-roll');
    expect(standardAction.rollThreshold).toBe(6);
  });

  test('tapped minion can still activate Covetous Thoughts removal via no-tap variant (−3 to roll, rule 10.08)', () => {
    // Rule 10.08: a tapped character may still attempt to remove a corruption
    // card by taking −3 to the roll instead of tapping.
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
    expect(actions.length).toBe(1);
    expect((actions[0].action as ActivateGrantedAction).noTap).toBe(true);
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
    expect(actions.length).toBe(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

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
    expect(actions.length).toBe(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

    // Bearer should be tapped
    expectCharStatus(next, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);

    // Covetous Thoughts should still be attached
    const gorbagId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[gorbagId as string].hazards).toHaveLength(1);
    expect(next.players[0].characters[gorbagId as string].hazards[0].definitionId).toBe(COVETOUS_THOUGHTS);

    // Covetous Thoughts should NOT be in discard
    expect(next.players[1].discardPile.some(c => c.definitionId === COVETOUS_THOUGHTS)).toBe(false);
  });

  // ── Effect 4: on-event end-of-turn — per-item corruption checks ───────────

  test('end-of-turn: enqueues one corruption check per company item that bearer does not bear', () => {
    // Gorbag bears Covetous Thoughts; Shagrat bears Red Book of Westmarch (cp 2).
    // When the site phase ends, one corruption check fires for Gorbag with
    // modifier -2 (subtracting the corruption of Shagrat's item).
    const base = buildSitePhaseState({
      site: DOL_GULDUR,
      characters: [GORBAG, SHAGRAT],
    });
    const withCT = attachHazardToChar(base, RESOURCE_PLAYER, GORBAG, COVETOUS_THOUGHTS);
    const withItem = attachItemToChar(withCT, RESOURCE_PLAYER, SHAGRAT, RED_BOOK);

    const next = dispatch(withItem, { type: 'pass', player: PLAYER_1 });

    expect(next.phaseState.phase).toBe(Phase.EndOfTurn);
    const pending = next.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    const check = pending[0].kind as { type: 'corruption-check'; modifier: number };
    expect(check.modifier).toBe(-2);
  });

  test('end-of-turn: enqueues one check per item — two items produce two checks', () => {
    // Shagrat bears two items (Red Book cp 2 + Sable Shield cp 0).
    // Gorbag must make two checks: one with modifier -2, one with modifier 0.
    const base = buildSitePhaseState({
      site: DOL_GULDUR,
      characters: [GORBAG, SHAGRAT],
    });
    const withCT = attachHazardToChar(base, RESOURCE_PLAYER, GORBAG, COVETOUS_THOUGHTS);
    const withItem1 = attachItemToChar(withCT, RESOURCE_PLAYER, SHAGRAT, RED_BOOK);
    const withItem2 = attachItemToChar(withItem1, RESOURCE_PLAYER, SHAGRAT, SABLE_SHIELD);

    const next = dispatch(withItem2, { type: 'pass', player: PLAYER_1 });

    expect(next.phaseState.phase).toBe(Phase.EndOfTurn);
    const pending = next.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(2);
    const modifiers = pending.map(r => (r.kind as { modifier: number }).modifier).sort();
    expect(modifiers).toEqual([-2, 0]);
  });

  test('end-of-turn: bearer own items do not trigger checks', () => {
    // Gorbag bears Covetous Thoughts AND an item. His own item is excluded.
    // No other characters have items, so no checks should fire.
    const base = buildSitePhaseState({
      site: DOL_GULDUR,
      characters: [GORBAG, SHAGRAT],
    });
    const withCT = attachHazardToChar(base, RESOURCE_PLAYER, GORBAG, COVETOUS_THOUGHTS);
    const withOwnItem = attachItemToChar(withCT, RESOURCE_PLAYER, GORBAG, RED_BOOK);

    const next = dispatch(withOwnItem, { type: 'pass', player: PLAYER_1 });

    expect(next.phaseState.phase).toBe(Phase.EndOfTurn);
    const pending = next.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(0);
  });

  test('end-of-turn: no checks when company has no items other than bearer', () => {
    // Gorbag and Shagrat in same company, neither has items (besides Covetous Thoughts hazard).
    const base = buildSitePhaseState({
      site: DOL_GULDUR,
      characters: [GORBAG, SHAGRAT],
    });
    const withCT = attachHazardToChar(base, RESOURCE_PLAYER, GORBAG, COVETOUS_THOUGHTS);

    const next = dispatch(withCT, { type: 'pass', player: PLAYER_1 });

    expect(next.phaseState.phase).toBe(Phase.EndOfTurn);
    const pending = next.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(0);
  });
});
