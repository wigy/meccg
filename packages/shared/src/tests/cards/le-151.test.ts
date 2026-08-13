/**
 * @module le-151.test
 *
 * Card test: Wrath of the West (le-151)
 * Type: hazard-event (short), alignment neutral, non-unique.
 *
 * Effects: 1
 *   1. on-event self-enters-play → cancel-chain-entry (select: target,
 *      filter: minion resource short-event, threshold: 7 — "greater than 6")
 *
 * Text:
 *   "Playable on a minion resource short-event declared earlier in the same
 *    chain of effects. Make a roll—if the result is greater than 6, the
 *    event is canceled and discarded."
 *
 * Engine Support:
 * | # | Feature                                                        | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Cancel a chain entry matched by a generic filter condition     | IMPLEMENTED |
 * | 2 | Filter on target cardType/eventType (any minion resource short)| IMPLEMENTED |
 * | 3 | Cancel gated on a 2d6 roll (threshold 7 = "greater than 6")    | IMPLEMENTED |
 * | 4 | Failed roll leaves the target unaffected (discarded normally)  | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2,
  ORC_PATROL, CONCEALMENT, ARAGORN,
  MORIA, MINAS_TIRITH, RIVENDELL, LORIEN,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
  findHandCardId,
  viableActionsForHandCard, firstAction,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, CancelAttackAction } from '../../index.js';
import { Alignment, Phase, RegionType, SiteType } from '../../index.js';

const WRATH_OF_THE_WEST = 'le-151' as CardDefinitionId;
const ORC_QUARRELS = 'le-216' as CardDefinitionId;   // minion resource short-event: cancels an Orc attack

// Minion fixtures for the minion company (referenced only here).
const LAGDUF = 'le-18' as CardDefinitionId;          // warrior, orc
const OSTISEN = 'le-36' as CardDefinitionId;         // scout, man
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;   // shadow-hold

// M/H phase state shared by every test: two Wilderness regions in the
// resolved path so Orc Patrol can be keyed, Moria as the destination.
const MH_PATH = {
  activeCompanyIndex: 0,
  resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
  resolvedSitePathNames: ['Hithaeglir', 'Eryn Vorn'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Moria',
} as const;

describe('Wrath of the West (le-151)', () => {
  beforeEach(() => resetMint());

  test('cancels a minion resource short-event on the chain on a roll greater than 6', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL, WRATH_OF_THE_WEST], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const wrathId = findHandCardId(stateAtMH, HAZARD_PLAYER, WRATH_OF_THE_WEST);
    const orcQuarrelsId = findHandCardId(stateAtMH, RESOURCE_PLAYER, ORC_QUARRELS);
    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );
    expect(combatState.combat).not.toBeNull();

    // The minion player declares Orc Quarrels (minion resource short-event)
    // to cancel the Orc attack — chain opens, hazard player gets priority.
    const cancelAction = firstAction<CancelAttackAction>(combatState, PLAYER_1, 'cancel-attack');
    const afterQuarrels = dispatch(combatState, cancelAction);
    expect(afterQuarrels.chain).not.toBeNull();
    expect(afterQuarrels.chain!.priority).toBe(PLAYER_2);

    // Wrath of the West is a viable chain response targeting the Orc Quarrels
    // chain entry.
    const wrathPlays = viableActionsForHandCard(afterQuarrels, PLAYER_2, 'play-short-event', HAZARD_PLAYER, WRATH_OF_THE_WEST)
      .map(ea => ea.action as PlayShortEventAction);
    expect(wrathPlays).toHaveLength(1);
    const quarrelsEntry = afterQuarrels.chain!.entries.find(e => e.card?.definitionId === ORC_QUARRELS)!;
    expect(wrathPlays[0].targetInstanceId).toBe(quarrelsEntry.card!.instanceId);

    const afterWrath = dispatch(afterQuarrels, wrathPlays[0]);
    expect(afterWrath.chain!.entries).toHaveLength(2);

    // Force a roll of 7 (> 6): Wrath of the West succeeds — Orc Quarrels is
    // negated, so the attack survives.
    const resolved = resolveChain({ ...afterWrath, cheatRollTotal: 7 });
    expect(resolved.chain).toBeNull();
    expect(resolved.combat).not.toBeNull();

    // The roll is surfaced to clients as a dice-roll effect somewhere along
    // the chain resolution.
    // Both spent event cards land in their owners' discard piles — Wrath of
    // the West carries no `removeFromGame` flag, unlike Ire of the East.
    expectInDiscardPile(resolved, RESOURCE_PLAYER, orcQuarrelsId);
    expectInDiscardPile(resolved, HAZARD_PLAYER, wrathId);
  });

  test('roll of 6 or less fails — the minion short-event resolves normally', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL, WRATH_OF_THE_WEST], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcQuarrelsId = findHandCardId(stateAtMH, RESOURCE_PLAYER, ORC_QUARRELS);
    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelAction = firstAction<CancelAttackAction>(combatState, PLAYER_1, 'cancel-attack');
    const afterQuarrels = dispatch(combatState, cancelAction);

    const wrathPlays = viableActionsForHandCard(afterQuarrels, PLAYER_2, 'play-short-event', HAZARD_PLAYER, WRATH_OF_THE_WEST)
      .map(ea => ea.action as PlayShortEventAction);
    const afterWrath = dispatch(afterQuarrels, wrathPlays[0]);

    // Force a roll of 6 (not > 6): Wrath of the West fails — Orc Quarrels is
    // NOT negated, so it resolves and cancels the attack as normal.
    const resolved = resolveChain({ ...afterWrath, cheatRollTotal: 6 });
    expect(resolved.chain).toBeNull();
    expect(resolved.combat).toBeNull();

    expectInDiscardPile(resolved, RESOURCE_PLAYER, orcQuarrelsId);
  });

  test('not offered against a hero short-event', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [OSTISEN] }], hand: [ORC_PATROL, WRATH_OF_THE_WEST], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelAction = firstAction<CancelAttackAction>(combatState, PLAYER_1, 'cancel-attack');
    const afterConceal = dispatch(combatState, cancelAction);
    expect(afterConceal.chain).not.toBeNull();

    // Concealment is a hero short-event, not a minion resource short-event —
    // Wrath of the West has no valid target.
    expect(viableActionsForHandCard(afterConceal, PLAYER_2, 'play-short-event', HAZARD_PLAYER, WRATH_OF_THE_WEST))
      .toHaveLength(0);
  });

  test('not offered while no chain is live', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL, WRATH_OF_THE_WEST], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Combat is active but no chain is open — Wrath of the West targets only
    // entries "earlier in the same chain of effects".
    expect(combatState.chain).toBeNull();
    expect(viableActionsForHandCard(combatState, PLAYER_2, 'play-short-event', HAZARD_PLAYER, WRATH_OF_THE_WEST))
      .toHaveLength(0);
  });

  test('control: without Wrath of the West, the minion short-event resolves and cancels the attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelAction = firstAction<CancelAttackAction>(combatState, PLAYER_1, 'cancel-attack');
    const resolved = resolveChain(dispatch(combatState, cancelAction));

    // With no interruption, Orc Quarrels cancels the attack.
    expect(resolved.chain).toBeNull();
    expect(resolved.combat).toBeNull();
  });
});
