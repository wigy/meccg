/**
 * @module dm-79.test
 *
 * Card test: Pierced by Many Wounds (dm-79)
 * Type: hazard-event (short), non-unique
 *
 * Card text:
 *   "Playable on an attack with more strikes than defending characters
 *    before strikes are assigned; does not count against the hazard limit.
 *    The first excess strike assigned to each character gives a -4
 *    modification to his prowess instead of -1. Cannot be duplicated on a
 *    given attack."
 *
 * Effects:
 *   1. play-flag: no-hazard-limit — the play never consumes a hazard slot.
 *   2. modify-attack (fromHand, player "attacker", firstExcessStrikePenalty: 4)
 *      gated `when` attack.strikesTotal $gt defender.companySize ("more
 *      strikes than defending characters").
 *   3. duplication-limit — scope "attack", max 1.
 *
 * Engine support:
 * | # | Rule                                                    | Status      | Notes                                                       |
 * |---|----------------------------------------------------------|-------------|--------------------------------------------------------------|
 * | 1 | Playable only when strikes > defending characters       | IMPLEMENTED | `when`: attack.strikesTotal $gt defender.companySize          |
 * | 2 | Playable before strikes are assigned                    | IMPLEMENTED | `modifyAttackActions` gates on empty `strikeAssignments`      |
 * | 3 | Does not count against the hazard limit                 | IMPLEMENTED | `play-flag: no-hazard-limit`                                  |
 * | 4 | Attacker-only play                                      | IMPLEMENTED | `player: "attacker"` gate                                     |
 * | 5 | First excess strike per character: -4 instead of -1     | IMPLEMENTED | `CombatState.firstExcessStrikePenalty`, `excessStrikePenalty` |
 * | 6 | Further excess strikes on same character stay at -1     | IMPLEMENTED | `excessStrikePenalty` formula: penalty + (N - 1)              |
 * | 7 | Cannot be duplicated on a given attack                  | IMPLEMENTED | `duplication-limit` scope `attack`                            |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch, reduce, nonViableOfType, executeAction,
  makeCancelWindowCombat, makeMHState, findCharInstanceId,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, CardStatus, Race, RegionType, SiteType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState, ModifyAttackAction, ResolveStrikeAction } from '../../index.js';

const PIERCED_BY_MANY_WOUNDS = 'dm-79' as CardDefinitionId;

/** Base two-Wizard state with the hazard player (PLAYER_2) holding the given hand. */
function baseWithHazardHand(
  hand: CardDefinitionId[],
  companyCharacters: CardDefinitionId[] = [ARAGORN],
  resourceHand: CardDefinitionId[] = [],
): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: companyCharacters }],
        hand: resourceHand,
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand,
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Pierced by Many Wounds (dm-79)', () => {
  beforeEach(() => resetMint());

  // ─── Playability gate ───────────────────────────────────────────────────

  test('attacker can play it when the attack has more strikes than defending characters', () => {
    const base = baseWithHazardHand([PIERCED_BY_MANY_WOUNDS]); // 1 defending character
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: Race.Orc,
      strikesTotal: 2, // 2 strikes > 1 defending character
      strikeProwess: 10,
    });

    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(1);
    const act = actions[0].action as ModifyAttackAction;
    expect(act.player).toBe(PLAYER_2);
    expect(act.cardInstanceId).toBe(combat.players[HAZARD_PLAYER].hand[0].instanceId);
  });

  test('NOT playable when strikes do not exceed the number of defending characters', () => {
    const base = baseWithHazardHand([PIERCED_BY_MANY_WOUNDS], [ARAGORN, LEGOLAS]); // 2 defending characters
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: Race.Orc,
      strikesTotal: 2, // 2 strikes == 2 defending characters, not "more than"
      strikeProwess: 10,
    });

    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(0);
  });

  test('defender cannot play it (attacker-only effect)', () => {
    const base = baseWithHazardHand([], [ARAGORN], [PIERCED_BY_MANY_WOUNDS]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: Race.Orc,
      strikesTotal: 2,
      strikeProwess: 10,
    });

    const actions = viableActions(combat, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(0);
  });

  test('does not count against the hazard limit (offered even at cap)', () => {
    const base = baseWithHazardHand([PIERCED_BY_MANY_WOUNDS]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: Race.Orc,
      strikesTotal: 2,
      strikeProwess: 10,
    });
    const atCap: GameState = {
      ...combat,
      phaseState: {
        ...(combat.phaseState as import('../../index.js').MovementHazardPhaseState),
        hazardsPlayedThisCompany: 5,
        hazardLimitAtReveal: 2,
      },
    };
    const actions = viableActions(atCap, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(1);
  });

  test('NOT playable once strikes are already being assigned', () => {
    const base = baseWithHazardHand([PIERCED_BY_MANY_WOUNDS]);
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: Race.Orc,
      strikesTotal: 2,
      strikeProwess: 10,
    });
    const aragornId = findCharInstanceId(combat0, RESOURCE_PLAYER, ARAGORN);
    const assigned = reduce(combat0, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(assigned.error).toBeUndefined();

    const actions = viableActions(assigned.state, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(0);
  });

  test('NOT playable as an open hazard during the movement/hazard phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PIERCED_BY_MANY_WOUNDS], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = {
      ...base,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        destinationSiteType: SiteType.RuinsAndLairs,
      }),
    };
    const pbmwInst = state.players[HAZARD_PLAYER].hand[0].instanceId;

    const viable = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === pbmwInst);
    expect(viable).toHaveLength(0);

    const gated = nonViableOfType(computeLegalActions(state, PLAYER_2), 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === pbmwInst);
    expect(gated).toHaveLength(1);
  });

  // ─── The effect: overrides the first excess strike's penalty ────────────

  test('playing it sets firstExcessStrikePenalty and discards the card', () => {
    const base = baseWithHazardHand([PIERCED_BY_MANY_WOUNDS]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: Race.Orc,
      strikesTotal: 2,
      strikeProwess: 10,
    });

    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.firstExcessStrikePenalty).toBe(4);
    // Attack's own prowess/strikes/body are unaffected — only the excess-strike formula changes.
    expect(after.combat!.strikeProwess).toBe(10);
    expect(after.combat!.strikesTotal).toBe(2);

    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(
      after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === PIERCED_BY_MANY_WOUNDS),
    ).toBe(true);
  });

  // ─── Duplication limit (scope: attack) ──────────────────────────────────

  test('cannot be duplicated on a given attack', () => {
    const base = baseWithHazardHand([PIERCED_BY_MANY_WOUNDS, PIERCED_BY_MANY_WOUNDS]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: Race.Orc,
      strikesTotal: 2,
      strikeProwess: 10,
    });

    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(2);

    const first = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, first);

    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(1);
    expect(viableActions(after, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  // ─── Excess-strike penalty formula ───────────────────────────────────────

  test('first excess strike costs -4 instead of -1 (need preview)', () => {
    const base = baseWithHazardHand([]);
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: Race.Orc,
      strikesTotal: 2,
      strikeProwess: 10,
    });
    const aragornId = findCharInstanceId(combat0, RESOURCE_PLAYER, ARAGORN);

    const baseline: GameState = {
      ...combat0,
      combat: {
        ...combat0.combat!,
        strikeAssignments: [{ characterId: aragornId, excessStrikes: 1, resolved: false }],
        phase: 'resolve-strike',
        assignmentPhase: 'done',
      },
    };
    const overridden: GameState = {
      ...baseline,
      combat: { ...baseline.combat!, firstExcessStrikePenalty: 4 },
    };

    const baseNeed = (viableActions(baseline, PLAYER_1, 'resolve-strike')
      .map(a => a.action as ResolveStrikeAction))
      .find(a => a.tapToFight)!.need;
    const overriddenNeed = (viableActions(overridden, PLAYER_1, 'resolve-strike')
      .map(a => a.action as ResolveStrikeAction))
      .find(a => a.tapToFight)!.need;

    // -1 penalty vs -4 penalty: the harsher prowess drop raises the needed roll by 3.
    expect(overriddenNeed).toBe(baseNeed + 3);
  });

  test('a second excess strike on the same character still only costs -1 more', () => {
    const base = baseWithHazardHand([]);
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: Race.Orc,
      strikesTotal: 3,
      strikeProwess: 10,
    });
    const aragornId = findCharInstanceId(combat0, RESOURCE_PLAYER, ARAGORN);

    const oneExcess: GameState = {
      ...combat0,
      combat: {
        ...combat0.combat!,
        firstExcessStrikePenalty: 4,
        strikeAssignments: [{ characterId: aragornId, excessStrikes: 1, resolved: false }],
        phase: 'resolve-strike',
        assignmentPhase: 'done',
      },
    };
    const twoExcess: GameState = {
      ...oneExcess,
      combat: {
        ...oneExcess.combat!,
        strikeAssignments: [{ characterId: aragornId, excessStrikes: 2, resolved: false }],
      },
    };

    const oneExcessNeed = (viableActions(oneExcess, PLAYER_1, 'resolve-strike')
      .map(a => a.action as ResolveStrikeAction))
      .find(a => a.tapToFight)!.need;
    const twoExcessNeed = (viableActions(twoExcess, PLAYER_1, 'resolve-strike')
      .map(a => a.action as ResolveStrikeAction))
      .find(a => a.tapToFight)!.need;

    // First excess strike: -4. Second excess strike: an additional -1 (not another -4).
    expect(twoExcessNeed).toBe(oneExcessNeed + 1);
  });

  test('end-to-end: a roll that would parry a normal excess strike instead wounds under the -4 penalty', () => {
    // Aragorn (prowess 6) alone faces a 2-strike attack (strikeProwess 10) —
    // both strikes land on him: one normal, one excess.
    const base = baseWithHazardHand([PIERCED_BY_MANY_WOUNDS]);
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'creature',
      creatureRace: Race.Orc,
      strikesTotal: 2,
      strikeProwess: 10,
    });

    const playAction = viableActions(combat0, PLAYER_2, 'modify-attack')[0].action;
    const buffed = dispatch(combat0, playAction);
    expect(buffed.combat!.firstExcessStrikePenalty).toBe(4);

    const aragornId = findCharInstanceId(buffed, RESOURCE_PLAYER, ARAGORN);
    let r = reduce(buffed, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(r.error).toBeUndefined();
    r = reduce(r.state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(r.error).toBeUndefined();
    expect(r.state.combat!.strikeAssignments).toHaveLength(1);
    expect(r.state.combat!.strikeAssignments[0].excessStrikes).toBe(1);
    expect(r.state.combat!.phase).toBe('resolve-strike');

    // Roll total 7: with the normal -1 excess penalty, prowess would be 6-1=5,
    // giving 7+5=12 > 10 (defended). With the -4 override, prowess is 6-4=2,
    // giving 7+2=9 < 10 (wounded).
    const resolved = executeAction(r.state, PLAYER_1, 'resolve-strike', 7, true);
    const aragorn = resolved.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.status).toBe(CardStatus.Inverted);
  });
});
