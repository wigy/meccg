/**
 * @module rule-8.43-attack-log-and-roll-breakdown
 *
 * CoE Rules — Section 8: Combat
 * Public combat information: attack modifications and strike-roll terms.
 *
 * Source: docs/coe-rules.md
 */

/*
 * RULING:
 *
 * Every card played or activated in combat is public, as is the arithmetic of
 * a strike roll (Strike Sequence, Step 6: the defender's roll plus the
 * character's prowess after modifications, compared against the strike's
 * prowess). The engine therefore records each change made to an attack in
 * `combat.attackLog` (starting with a `'base'` snapshot), announces chain-less
 * changes to both players, attaches a term-by-term breakdown to every strike
 * roll and body check, and computes the pre-roll "need N+" with the same
 * calculation the roll uses.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO,
  ORC_PATROL, GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, makeMHState, makeDoubleWildernessMHState,
  playCreatureHazardAndResolve,
  CardStatus,
  handCardId, companyIdAt, dispatch, dispatchResult, findCharInstanceId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import { RegionType, SiteType, describeRollBreakdown, describeAttackLogEntry, stripCardMarkers } from '../../../index.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId, DiceRollEffect, ResolveStrikeAction, TextNotificationEffect } from '../../../index.js';

const DARK_QUARRELS_2 = 'tw-208' as CardDefinitionId;
const OLD_MAN_WILLOW = 'tw-70' as CardDefinitionId;
const DOUBLE_WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };

describe('Rule 8.43 — attack log and roll breakdown', () => {
  beforeEach(() => resetMint());

  test('Dark Quarrels halving strikes is logged with its source and announced to both players', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [DARK_QUARRELS_2], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hithaeglir'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, handCardId(stateAtMH, HAZARD_PLAYER), companyIdAt(stateAtMH, RESOURCE_PLAYER),
      { method: 'region-type', value: 'wilderness' },
    );

    // Combat start records the base snapshot: Orc-patrol, 3 strikes.
    expect(combatState.combat!.attackLog).toEqual([
      { kind: 'base', strikes: 3, prowess: combatState.combat!.strikeProwess, body: combatState.combat!.creatureBody },
    ]);

    const quarrelsId = handCardId(combatState, RESOURCE_PLAYER);
    const halve = viableActions(combatState, PLAYER_1, 'halve-strikes')[0].action;
    const result = dispatchResult(combatState, halve);
    const log = result.state.combat!.attackLog!;
    expect(log).toHaveLength(2);
    expect(log[0].kind).toBe('base');
    expect(log[1]).toEqual({
      kind: 'strikes',
      sourceInstanceId: quarrelsId,
      sourceDefinitionId: DARK_QUARRELS_2,
      playedBy: PLAYER_1,
      before: 3,
      after: 2,
      note: 'halved',
    });

    const notes = (result.effects ?? []).filter((e): e is TextNotificationEffect => e.effect === 'text-notification');
    expect(notes.map(n => stripCardMarkers(n.message))).toContain(
      `${result.state.players[RESOURCE_PLAYER].name} played Dark Quarrels: strikes 3 → 2 (halved)`,
    );
    expect(stripCardMarkers(describeAttackLogEntry(log[0], result.state.cardPool))).toBe(
      `Attack: 3 strikes, ${combatState.combat!.strikeProwess} prowess`,
    );
  });

  test('"need N+" includes the creature\'s per-defender bonus (Old Man Willow vs a Hobbit) and matches the roll', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [OLD_MAN_WILLOW], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...built, phaseState: makeDoubleWildernessMHState() };
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), DOUBLE_WILDERNESS_KEYING,
    );
    const frodoId = findCharInstanceId(afterChain, RESOURCE_PLAYER, FRODO);
    const assigned = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: frodoId });
    expect(assigned.combat!.phase).toBe('resolve-strike');

    // Frodo prowess 1 vs Willow 13 +2 against Hobbits = 15 → need 15+.
    const tap = viableActions(assigned, PLAYER_1, 'resolve-strike')
      .map(a => a.action as ResolveStrikeAction)
      .find(a => a.tapToFight)!;
    expect(tap.need).toBe(15);

    const result = dispatchResult({ ...assigned, cheatRollTotal: 12 }, tap);
    const roll = (result.effects ?? []).find((e): e is DiceRollEffect => e.effect === 'dice-roll')!;
    expect(roll.breakdown).toBeDefined();
    const bd = roll.breakdown!;
    const charSum = bd.character.reduce((s, t) => s + t.value, 0);
    const oppSum = bd.opponent.reduce((s, t) => s + t.value, 0);
    expect(charSum).toBe(1);
    expect(roll.total).toBe(roll.die1 + roll.die2 + charSum);
    expect(roll.total).toBe(13);
    expect(bd.opponent).toEqual([{ label: 'prowess', value: 13 }, { label: 'vs hobbit', value: 2 }]);
    expect(oppSum).toBe(15);
    expect(bd.need).toBe(tap.need);
    expect(bd.outcome).toBe('wounded');
    expect(describeRollBreakdown(roll)).toContain('= 13 vs 15');

    // The resulting body check carries its own breakdown (Frodo's body 9).
    expect(result.state.combat!.bodyCheckTarget).toBe('character');
    const bodyAction = viableActions(result.state, PLAYER_2, 'body-check-roll')[0].action;
    const bodyResult = dispatchResult({ ...result.state, cheatRollTotal: 5 }, bodyAction);
    const bodyRoll = (bodyResult.effects ?? []).find((e): e is DiceRollEffect => e.effect === 'dice-roll')!;
    expect(bodyRoll.breakdown!.opponent).toEqual([{ label: 'body', value: 9 }]);
    expect(bodyRoll.total).toBe(5);
    expect(bodyRoll.breakdown!.outcome).toBe('wounded');
  });

  test('strike roll breakdown lists the tapped penalty and sums to the roll total', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [OLD_MAN_WILLOW], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...built, phaseState: makeDoubleWildernessMHState() };
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), DOUBLE_WILDERNESS_KEYING,
    );
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const assigned = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const action = viableActions(assigned, PLAYER_1, 'resolve-strike')[0].action as ResolveStrikeAction;

    const result = dispatchResult({ ...assigned, cheatRollTotal: 7 }, action);
    const roll = (result.effects ?? []).find((e): e is DiceRollEffect => e.effect === 'dice-roll')!;
    const bd = roll.breakdown!;
    expect(bd.character).toContainEqual({ label: 'tapped', value: -1 });
    const charSum = bd.character.reduce((s, t) => s + t.value, 0);
    expect(roll.total).toBe(7 + charSum);
    // The pre-roll need agrees with the breakdown's own need.
    expect(bd.need).toBe(action.need);
  });
});
