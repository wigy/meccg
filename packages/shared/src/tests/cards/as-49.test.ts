/**
 * @module as-49.test
 *
 * Card test: Glamour of Surpassing Excellance (as-49)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 *
 * Card text:
 * "Playable on a company at a Border-hold [{B}] or Free-hold [{F}]. Make a
 *  roll for each hazard permanent-event on characters in the company. Discard
 *  each hazard whose roll is greater than the number normally needed to remove
 *  it as printed on the card (ignoring all modifiers and conditions). If no
 *  number is given, the permanent-event is discarded if its result is greater
 *  than 8. Cannot be included in a Fallen-wizard's deck."
 *
 * Effects:
 * 1. event-play-site: ["border-hold", "free-hold"] — card is only offered as
 *    a viable play-short-event action during the site phase at a Border-hold
 *    or Free-hold. Not offered at shadow-holds, ruins-and-lairs, etc.
 * 2. roll-remove-hazard-events: one glamour-hazard-roll pending resolution
 *    is enqueued per hazard permanent-event on characters in the active company.
 *    Roll > removalThreshold discards the hazard; roll ≤ threshold keeps it.
 *    Hazards without a removalNumber use a default threshold of 8.
 *
 * Engine support:
 * | # | Effect type                | Status | Notes                                             |
 * |---|----------------------------|--------|---------------------------------------------------|
 * | 1 | event-play-site            | OK     | site-type restriction on short-event plays        |
 * | 2 | roll-remove-hazard-events  | OK     | pending glamour-hazard-roll per hazard            |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint,
  PLAYER_1,
  ARAGORN,
  MINAS_TIRITH, MORIA,
  LURE_OF_THE_SENSES, ALONE_AND_UNADVISED,
  DOORS_OF_NIGHT,
  attachHazardToChar, getHazardsOn, handCardId,
  expectInDiscardPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  dispatch,
  HENNETH_ANNUN,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const GLAMOUR = 'as-49' as CardDefinitionId;

/**
 * as-49 Glamour of Surpassing Excellance:
 * - hero-resource-event short
 * - event-play-site: ["border-hold", "free-hold"]
 * - roll-remove-hazard-events: per-hazard 2d6 roll, discard if > removalThreshold
 *
 * MINAS_TIRITH = tw-412 (free-hold)
 * HENNETH_ANNUN = tw-400 (border-hold)
 * MORIA = tw-413 (shadow-hold) — not allowed
 * LURE_OF_THE_SENSES = tw-60, removalNumber: 6 → threshold 6
 * ALONE_AND_UNADVISED = as-24, removalNumber: 6 → threshold 6
 * DOORS_OF_NIGHT = tw-28, no removalNumber → threshold 8
 */

describe('Glamour of Surpassing Excellance (as-49)', () => {
  beforeEach(() => resetMint());

  test('not offered as viable play at a shadow-hold', () => {
    const base = buildSitePhaseState({ site: MORIA, hand: [GLAMOUR] });
    const viablePlayActions = computeLegalActions(base, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-short-event');

    // No viable play-short-event should exist (card emits not-playable instead)
    expect(viablePlayActions).toHaveLength(0);
  });

  test('offered as viable play at a free-hold (Minas Tirith)', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, hand: [GLAMOUR] });
    const actions = computeLegalActions(base, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-short-event');

    const glamourAction = actions.find(
      a => (a.action as PlayShortEventAction).cardInstanceId === handCardId(base, RESOURCE_PLAYER),
    );
    expect(glamourAction).toBeDefined();
  });

  test('offered as viable play at a border-hold (Henneth Annûn)', () => {
    const base = buildSitePhaseState({ site: HENNETH_ANNUN, hand: [GLAMOUR] });
    const actions = computeLegalActions(base, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-short-event');

    const glamourAction = actions.find(
      a => (a.action as PlayShortEventAction).cardInstanceId === handCardId(base, RESOURCE_PLAYER),
    );
    expect(glamourAction).toBeDefined();
  });

  test('no pending resolutions when no hazard permanent-events on company', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, hand: [GLAMOUR] });
    const cardId = handCardId(base, RESOURCE_PLAYER);
    const action = computeLegalActions(base, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-short-event' &&
        (a.action).cardInstanceId === cardId);
    expect(action).toBeDefined();

    const afterPlay = dispatch(base, action!.action);
    const pending = afterPlay.pendingResolutions.filter(
      r => r.kind.type === 'glamour-hazard-roll',
    );
    expect(pending).toHaveLength(0);
  });

  test('one glamour-hazard-roll pending resolution per hazard permanent-event', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, hand: [GLAMOUR] });
    const withLure = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    const withBoth = attachHazardToChar(withLure, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED, HAZARD_PLAYER);

    const cardId = handCardId(withBoth, RESOURCE_PLAYER);
    const action = computeLegalActions(withBoth, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-short-event' &&
        (a.action).cardInstanceId === cardId);
    expect(action).toBeDefined();

    const afterPlay = dispatch(withBoth, action!.action);
    const pending = afterPlay.pendingResolutions.filter(
      r => r.kind.type === 'glamour-hazard-roll',
    );
    expect(pending).toHaveLength(2);
  });

  test('roll > removalThreshold discards the hazard (Lure of the Senses, threshold 6)', () => {
    // Lure of the Senses (tw-60) has removalNumber: 6, so threshold is 6.
    // A roll of 7 > 6, so the hazard is discarded.
    const base = buildSitePhaseState({ site: MINAS_TIRITH, hand: [GLAMOUR] });
    const withLure = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES, HAZARD_PLAYER);

    const cardId = handCardId(withLure, RESOURCE_PLAYER);
    const playAction = computeLegalActions(withLure, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-short-event' &&
        (a.action).cardInstanceId === cardId);
    expect(playAction).toBeDefined();

    const afterPlay = dispatch(withLure, playAction!.action);
    const pending = afterPlay.pendingResolutions.filter(r => r.kind.type === 'glamour-hazard-roll');
    expect(pending).toHaveLength(1);

    if (pending[0].kind.type === 'glamour-hazard-roll') {
      expect(pending[0].kind.removalThreshold).toBe(6);
    }

    // Roll 7 > 6 → discard
    const withCheatRoll = { ...afterPlay, cheatRollTotal: 7 };
    const rollActions = computeLegalActions(withCheatRoll, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'glamour-hazard-roll');
    expect(rollActions).toHaveLength(1);

    const afterRoll = dispatch(withCheatRoll, rollActions[0].action);
    expect(getHazardsOn(afterRoll, RESOURCE_PLAYER, ARAGORN)).toHaveLength(0);
    expectInDiscardPile(afterRoll, HAZARD_PLAYER, LURE_OF_THE_SENSES);
  });

  test('roll <= removalThreshold keeps the hazard attached (Lure of the Senses, threshold 6)', () => {
    // Roll 6 is NOT greater than 6, so the hazard stays.
    const base = buildSitePhaseState({ site: MINAS_TIRITH, hand: [GLAMOUR] });
    const withLure = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES, HAZARD_PLAYER);

    const cardId = handCardId(withLure, RESOURCE_PLAYER);
    const playAction = computeLegalActions(withLure, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-short-event' &&
        (a.action).cardInstanceId === cardId);
    expect(playAction).toBeDefined();

    const afterPlay = dispatch(withLure, playAction!.action);
    const withCheatRoll = { ...afterPlay, cheatRollTotal: 6 };
    const rollActions = computeLegalActions(withCheatRoll, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'glamour-hazard-roll');
    expect(rollActions).toHaveLength(1);

    const afterRoll = dispatch(withCheatRoll, rollActions[0].action);
    expect(getHazardsOn(afterRoll, RESOURCE_PLAYER, ARAGORN)).toHaveLength(1);
  });

  test('default threshold 8 used for hazards without removalNumber (Doors of Night)', () => {
    // Doors of Night (tw-28) is a hazard permanent-event with no removalNumber → threshold 8.
    const base = buildSitePhaseState({ site: MINAS_TIRITH, hand: [GLAMOUR] });
    // Doors of Night is typically an environment in cardsInPlay, but can be
    // attached to a character via the test helper to simulate the roll mechanic.
    const withDoors = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DOORS_OF_NIGHT, HAZARD_PLAYER);

    const cardId = handCardId(withDoors, RESOURCE_PLAYER);
    const playAction = computeLegalActions(withDoors, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-short-event' &&
        (a.action).cardInstanceId === cardId);
    expect(playAction).toBeDefined();

    const afterPlay = dispatch(withDoors, playAction!.action);
    const pending = afterPlay.pendingResolutions.filter(r => r.kind.type === 'glamour-hazard-roll');
    expect(pending).toHaveLength(1);

    if (pending[0].kind.type === 'glamour-hazard-roll') {
      expect(pending[0].kind.removalThreshold).toBe(8);
    }

    // Roll 9 > 8 → discard
    const withCheatRoll = { ...afterPlay, cheatRollTotal: 9 };
    const rollActions = computeLegalActions(withCheatRoll, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'glamour-hazard-roll');
    const afterRoll = dispatch(withCheatRoll, rollActions[0].action);
    expect(getHazardsOn(afterRoll, RESOURCE_PLAYER, ARAGORN)).toHaveLength(0);
  });

  test('roll 8 does not discard when default threshold 8 (roll must be strictly greater)', () => {
    const base = buildSitePhaseState({ site: MINAS_TIRITH, hand: [GLAMOUR] });
    const withDoors = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DOORS_OF_NIGHT, HAZARD_PLAYER);

    const cardId = handCardId(withDoors, RESOURCE_PLAYER);
    const playAction = computeLegalActions(withDoors, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-short-event' &&
        (a.action).cardInstanceId === cardId);
    expect(playAction).toBeDefined();

    const afterPlay = dispatch(withDoors, playAction!.action);
    const withCheatRoll = { ...afterPlay, cheatRollTotal: 8 };
    const rollActions = computeLegalActions(withCheatRoll, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'glamour-hazard-roll');
    const afterRoll = dispatch(withCheatRoll, rollActions[0].action);
    expect(getHazardsOn(afterRoll, RESOURCE_PLAYER, ARAGORN)).toHaveLength(1);
  });

  test('rolls proceed sequentially for multiple hazards', () => {
    // Two hazards on Aragorn: both are rolled for sequentially.
    const base = buildSitePhaseState({ site: MINAS_TIRITH, hand: [GLAMOUR] });
    const withLure = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    const withBoth = attachHazardToChar(withLure, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED, HAZARD_PLAYER);

    const cardId = handCardId(withBoth, RESOURCE_PLAYER);
    const playAction = computeLegalActions(withBoth, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-short-event' &&
        (a.action).cardInstanceId === cardId);
    expect(playAction).toBeDefined();

    const afterPlay = dispatch(withBoth, playAction!.action);
    expect(afterPlay.pendingResolutions.filter(r => r.kind.type === 'glamour-hazard-roll')).toHaveLength(2);

    // First roll (>6 → discard)
    const state1 = { ...afterPlay, cheatRollTotal: 7 };
    const roll1Actions = computeLegalActions(state1, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'glamour-hazard-roll');
    expect(roll1Actions).toHaveLength(1);
    const afterRoll1 = dispatch(state1, roll1Actions[0].action);
    expect(afterRoll1.pendingResolutions.filter(r => r.kind.type === 'glamour-hazard-roll')).toHaveLength(1);
    expect(getHazardsOn(afterRoll1, RESOURCE_PLAYER, ARAGORN)).toHaveLength(1);

    // Second roll (<=6 → keep)
    const state2 = { ...afterRoll1, cheatRollTotal: 6 };
    const roll2Actions = computeLegalActions(state2, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'glamour-hazard-roll');
    expect(roll2Actions).toHaveLength(1);
    const afterRoll2 = dispatch(state2, roll2Actions[0].action);
    expect(afterRoll2.pendingResolutions.filter(r => r.kind.type === 'glamour-hazard-roll')).toHaveLength(0);
    // One discarded, one kept
    expect(getHazardsOn(afterRoll2, RESOURCE_PLAYER, ARAGORN)).toHaveLength(1);
  });
});
