/**
 * @module rule-8.28-body-check
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.28: Body Check
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The declaration of a body check initiates a chain of effects during which actions can only be declared if they would directly affect the body check (i.e. either affecting the roll or the body of the entity making the body check). To resolve a body check, the player who doesn't control the entity makes a roll and applies any modifications, including a +1 modification to the roll if the entity was already wounded before failing a strike that led to the body check. If the modified roll is higher than the entity's body, the entity fails the body check.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  CAVE_DRAKE, SUN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, setCharStatus,
  makeShadowMHState, makeBodyCheckCombat, findCharInstanceId,
  dispatchResult, viableActions, viableActionTypes,
  Phase, companyIdAt, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import { CardStatus } from '../../../index.js';
import type { DieRoll, TwoDiceSix, CardInstanceId } from '../../../index.js';

describe('Rule 8.28 — Body Check', () => {
  beforeEach(() => resetMint());

  test('body-check-roll sets lastDiceRoll on the attacking player and emits dice-roll effect', () => {
    // Set up a state where Aragorn has been wounded by a strike (body check
    // against the character is pending). The attacking player (PLAYER_2)
    // rolls the body check.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    // Place Aragorn in wounded state so the body check applies +1.
    // Then set stale `lastDiceRoll` values on both players (defender from a
    // prior strike roll, attacker from an earlier roll) — simulating the
    // exact scenario from the bug report. `cheatRollTotal: 10` forces the
    // body-check roll deterministically.
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    const staleDefRoll: TwoDiceSix = { die1: 2 as DieRoll, die2: 4 as DieRoll };
    const staleAtkRoll: TwoDiceSix = { die1: 2 as DieRoll, die2: 2 as DieRoll };
    const cheated = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: aragornId, wasAlreadyWounded: true }),
      players: [
        { ...woundedState.players[0], lastDiceRoll: staleDefRoll },
        { ...woundedState.players[1], lastDiceRoll: staleAtkRoll },
      ] as unknown as typeof woundedState.players,
      cheatRollTotal: 10,
    };

    // Get the body-check-roll action — only available to the attacking player
    const actions = viableActions(cheated, PLAYER_2, 'body-check-roll');
    expect(actions.length).toBe(1);

    const result = dispatchResult(cheated, actions[0].action);

    // The attacking player's (PLAYER_2, index 1) lastDiceRoll must be
    // updated to the body check roll, NOT the stale {2,2} value.
    const atkRoll = result.state.players[HAZARD_PLAYER].lastDiceRoll;
    expect(atkRoll).toBeDefined();
    expect(atkRoll!.die1 + atkRoll!.die2).toBe(10);

    // The defending player's lastDiceRoll should remain unchanged (stale
    // from the prior strike roll).
    const defRoll = result.state.players[RESOURCE_PLAYER].lastDiceRoll;
    expect(defRoll).toEqual({ die1: 2, die2: 4 });

    // A dice-roll effect must be emitted with the body check values
    expect(result.effects).toBeDefined();
    const diceEffect = result.effects!.find(e => e.effect === 'dice-roll');
    expect(diceEffect).toBeDefined();
    expect(diceEffect!.die1 + diceEffect!.die2).toBe(10);
    expect(diceEffect!.label).toContain('Body check');
  });

  test('body-check that finalizes combat still emits a text-notification describing the outcome', () => {
    // Regression for the "Body check" bug report (game mqzhpuzp-hvmzds, seq
    // 214): a character body check that defeats the last pending strike ends
    // combat. The clients used to derive the wounded/eliminated outcome by
    // diffing `view.combat`, but once combat finalizes `view.combat` is null,
    // so the outcome line silently vanished from the text log. The engine now
    // broadcasts the outcome as a `text-notification` effect.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    // Single pending strike → the body check finalizes combat. A low forced
    // roll (4) is at or below Aragorn's body, so the character survives.
    const cheated = {
      ...state,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: aragornId }),
      cheatRollTotal: 4,
    };

    const actions = viableActions(cheated, PLAYER_2, 'body-check-roll');
    expect(actions.length).toBe(1);

    const result = dispatchResult(cheated, actions[0].action);

    // The body check ended combat — this is the scenario where the old
    // client-side outcome derivation broke.
    expect(result.state.combat).toBeNull();

    // The raw roll is still broadcast as a dice-roll effect…
    expect(result.effects!.some(e => e.effect === 'dice-roll')).toBe(true);

    // …and the outcome is now broadcast as a text-notification so every
    // client's text log records the actual result.
    const note = result.effects!.find(e => e.effect === 'text-notification');
    expect(note).toBeDefined();
    if (note!.effect === 'text-notification') {
      expect(note!.message).toContain('survives the body check');
      expect(note!.message).toContain('rolled 4');
    }
  });

  test('Body-check chain admits only the body-check-roll — unrelated cards in hand are not playable', () => {
    // While a body check is pending, the only declarable action is the
    // dice roll itself (per rule 8.28). Even though both players hold
    // arbitrary cards in hand (Cave-drake hazard creature, Sun resource
    // long-event), neither produces a viable play action: no chain is
    // open, and the engine offers only the body-check-roll to the
    // non-controlling player.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const ready = {
      ...state,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: aragornId }),
    };

    // The body check declaration does not open a chain of effects in the
    // shared chain machinery — actions are restricted at the legal-actions
    // layer instead.
    expect(ready.chain).toBeNull();

    // The attacker (rolling player) only sees the body-check-roll action.
    expect(viableActionTypes(ready, PLAYER_2)).toEqual(['body-check-roll']);

    // The defender has no playable response — hand cards are not offered.
    const defTypes = viableActionTypes(ready, PLAYER_1);
    expect(defTypes).not.toContain('play-hazard');
    expect(defTypes).not.toContain('play-long-event');
    expect(defTypes).not.toContain('play-short-event');
  });

  test('a defeated creature\'s body check is rolled by the defender, not the creature\'s own controller', () => {
    // Regression for the "Body check" bug report (game ms6gbt8d-5na91m, seq
    // 1035): an on-guard creature's detainment strike was parried by the
    // defending character, so a body check against the creature (bodyCheckTarget
    // 'creature') followed. The creature is controlled by the attacking
    // (hazard) player, so per CoE 3.I.1 ("the player who doesn't control the
    // entity makes a roll") the *defending* player must roll — not the
    // creature's own controller, as the engine previously offered.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const ready = {
      ...state,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({
        companyId,
        characterId: aragornId,
        bodyCheckTarget: 'creature',
        result: 'success', // Aragorn parried the on-guard creature's strike
        creatureBody: 8,
        detainment: true,
        attackSource: { type: 'on-guard-creature', cardInstanceId: 'creature-1' as CardInstanceId },
      }),
    };

    // The defending player (who doesn't control the creature) rolls.
    expect(viableActionTypes(ready, PLAYER_1)).toEqual(['body-check-roll']);
    // The creature's own controller (the attacking player) has nothing to declare.
    expect(viableActions(ready, PLAYER_2, 'body-check-roll')).toHaveLength(0);
  });
});
