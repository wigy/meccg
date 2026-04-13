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
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, findCharInstanceId,
  dispatchResult, viableActions,
  Phase, companyIdAt,
} from '../../test-helpers.js';
import { RegionType, SiteType, CardStatus } from '../../../index.js';
import type { CombatState, CardInstanceId, DieRoll, TwoDiceSix } from '../../../index.js';

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

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const companyId = companyIdAt(state, 0);

    // Place Aragorn in wounded state so the body check applies +1
    const players = [...state.players];
    const p0 = { ...players[0] };
    p0.characters = {
      ...p0.characters,
      [aragornId as string]: { ...p0.characters[aragornId as string], status: CardStatus.Inverted },
    };
    players[0] = p0;

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    // Set up combat in body-check phase for the character
    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as CardInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: 'orc',
      strikeAssignments: [
        { characterId: aragornId, excessStrikes: 0, resolved: true, result: 'wounded', wasAlreadyWounded: true },
      ],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      detainment: false,
    };

    const readyState = { ...state, players, phaseState: mhState, combat };

    // Set a stale lastDiceRoll on the defending player (from a prior strike
    // roll) and a different stale roll on the attacking player — simulating
    // the exact scenario from the bug report.
    const staleDefRoll: TwoDiceSix = { die1: 2 as DieRoll, die2: 4 as DieRoll };
    const staleAtkRoll: TwoDiceSix = { die1: 2 as DieRoll, die2: 2 as DieRoll };
    const p0WithStaleRoll = { ...readyState.players[0], lastDiceRoll: staleDefRoll };
    const p1WithStaleRoll = { ...readyState.players[1], lastDiceRoll: staleAtkRoll };
    const stateWithStaleRolls = {
      ...readyState,
      players: [p0WithStaleRoll, p1WithStaleRoll] as const,
    };

    // Use cheatRollTotal to control the dice result
    const cheated = { ...stateWithStaleRolls, cheatRollTotal: 10 };

    // Get the body-check-roll action — only available to the attacking player
    const actions = viableActions(cheated, PLAYER_2, 'body-check-roll');
    expect(actions.length).toBe(1);

    const result = dispatchResult(cheated, actions[0].action);

    // The attacking player's (PLAYER_2, index 1) lastDiceRoll must be
    // updated to the body check roll, NOT the stale {2,2} value.
    const atkRoll = result.state.players[1].lastDiceRoll;
    expect(atkRoll).toBeDefined();
    expect(atkRoll!.die1 + atkRoll!.die2).toBe(10);

    // The defending player's lastDiceRoll should remain unchanged (stale
    // from the prior strike roll).
    const defRoll = result.state.players[0].lastDiceRoll;
    expect(defRoll).toEqual({ die1: 2, die2: 4 });

    // A dice-roll effect must be emitted with the body check values
    expect(result.effects).toBeDefined();
    const diceEffect = result.effects!.find(e => e.effect === 'dice-roll');
    expect(diceEffect).toBeDefined();
    expect(diceEffect!.die1 + diceEffect!.die2).toBe(10);
    expect(diceEffect!.label).toContain('Body check');
  });

  test.todo('Cannot respond to passive conditions from strike result, except dice-rolling actions');
});
