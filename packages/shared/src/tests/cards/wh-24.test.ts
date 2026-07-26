/**
 * @module wh-24.test
 *
 * Card test: Ire of the East (wh-24)
 * Type: hazard-event (short)
 * Effects: 2
 *   1. on-event self-enters-play → cancel-chain-entry (select: target,
 *      filter: minion short-event declared by a fallen-wizard player,
 *      removeFromGame: true)
 *   2. play-flag no-hazard-limit
 *
 * Text:
 *   "Targets and cancels one minion short-event played by a Fallen-wizard
 *    earlier in the same chain of effects. This card can be played at any
 *    time and does not count against the hazard limit. Remove this card
 *    from the game."
 *
 * Engine Support:
 * | # | Feature                                                        | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Cancel a chain entry matched by a generic filter condition     | IMPLEMENTED |
 * | 2 | Filter on target cardType/eventType + declarer alignment       | IMPLEMENTED |
 * | 3 | Playable as a chain response at any time (no hazard limit)     | IMPLEMENTED |
 * | 4 | Spent card removed from the game (discard → out-of-play pile)  | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ORC_PATROL, CONCEALMENT, ARAGORN,
  MORIA, MINAS_TIRITH, RIVENDELL, LORIEN,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
  findHandCardId, expectNotInHand,
  viableActionsForHandCard, firstAction,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, CancelAttackAction } from '../../index.js';
import { Alignment, RegionType, SiteType } from '../../index.js';

const IRE_OF_THE_EAST = 'wh-24' as CardDefinitionId;
const ORC_QUARRELS = 'le-216' as CardDefinitionId;   // minion short-event: cancels an Orc attack

// Minion fixtures for the fallen-wizard's company (referenced only here).
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

describe('Ire of the East (wh-24)', () => {
  beforeEach(() => resetMint());

  test('cancels a fallen-wizard minion short-event on the chain; removed from game, no hazard-limit cost', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL, IRE_OF_THE_EAST], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const ireId = findHandCardId(stateAtMH, HAZARD_PLAYER, IRE_OF_THE_EAST);
    const orcQuarrelsId = findHandCardId(stateAtMH, RESOURCE_PLAYER, ORC_QUARRELS);
    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );
    expect(combatState.combat).not.toBeNull();

    // Fallen-wizard declares Orc Quarrels (minion short-event) to cancel the
    // Orc attack — chain opens, hazard player gets priority.
    const cancelAction = firstAction<CancelAttackAction>(combatState, PLAYER_1, 'cancel-attack');
    const afterQuarrels = dispatch(combatState, cancelAction);
    expect(afterQuarrels.chain).not.toBeNull();
    expect(afterQuarrels.chain!.priority).toBe(PLAYER_2);

    // Ire of the East is a viable chain response targeting the Orc Quarrels
    // chain entry.
    const irePlays = viableActionsForHandCard(afterQuarrels, PLAYER_2, 'play-short-event', HAZARD_PLAYER, IRE_OF_THE_EAST)
      .map(ea => ea.action as PlayShortEventAction);
    expect(irePlays).toHaveLength(1);
    const quarrelsEntry = afterQuarrels.chain!.entries.find(e => e.card?.definitionId === ORC_QUARRELS)!;
    expect(irePlays[0].targetInstanceId).toBe(quarrelsEntry.card!.instanceId);

    // Playing it does not count against the hazard limit: the M/H hazard
    // counter is unchanged by the chain response.
    const hazardsBefore = afterQuarrels.phaseState.phase === Phase.MovementHazard
      ? afterQuarrels.phaseState.hazardsPlayedThisCompany : -1;
    const afterIre = dispatch(afterQuarrels, irePlays[0]);
    expect(afterIre.chain!.entries).toHaveLength(2);
    const hazardsAfter = afterIre.phaseState.phase === Phase.MovementHazard
      ? afterIre.phaseState.hazardsPlayedThisCompany : -2;
    expect(hazardsAfter).toBe(hazardsBefore);

    // Chain resolves LIFO: Ire negates Orc Quarrels, so the attack survives.
    const resolved = resolveChain(afterIre);
    expect(resolved.chain).toBeNull();
    expect(resolved.combat).not.toBeNull();

    // Orc Quarrels goes to its owner's discard; Ire of the East is removed
    // from the game — out-of-play pile, not the discard pile.
    expectInDiscardPile(resolved, RESOURCE_PLAYER, orcQuarrelsId);
    expectNotInHand(resolved, HAZARD_PLAYER, ireId);
    expect(resolved.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.instanceId === ireId)).toBe(true);
    expect(resolved.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === ireId)).toBe(false);
  });

  test('not offered when the minion short-event was played by a Ringwraith player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL, IRE_OF_THE_EAST], siteDeck: [DOL_GULDUR] },
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
    const afterQuarrels = dispatch(combatState, cancelAction);
    expect(afterQuarrels.chain).not.toBeNull();

    // The Orc Quarrels entry was declared by a Ringwraith, not a
    // Fallen-wizard — Ire of the East has no valid target.
    expect(viableActionsForHandCard(afterQuarrels, PLAYER_2, 'play-short-event', HAZARD_PLAYER, IRE_OF_THE_EAST))
      .toHaveLength(0);
  });

  test('not offered against a hero short-event played by a Fallen-wizard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [OSTISEN] }], hand: [ORC_PATROL, IRE_OF_THE_EAST], siteDeck: [RIVENDELL] },
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

    // Concealment is a hero short-event — not a minion short-event, so Ire
    // of the East has no valid target even though the declarer is a
    // Fallen-wizard.
    expect(viableActionsForHandCard(afterConceal, PLAYER_2, 'play-short-event', HAZARD_PLAYER, IRE_OF_THE_EAST))
      .toHaveLength(0);
  });

  test('not offered while no chain is live', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL, IRE_OF_THE_EAST], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Combat is active but no chain is open — Ire of the East targets only
    // entries "earlier in the same chain of effects".
    expect(combatState.chain).toBeNull();
    expect(viableActionsForHandCard(combatState, PLAYER_2, 'play-short-event', HAZARD_PLAYER, IRE_OF_THE_EAST))
      .toHaveLength(0);
  });

  test('control: without Ire of the East, the minion short-event resolves and cancels the attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
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
