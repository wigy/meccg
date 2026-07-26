/**
 * @module wh-14.test
 *
 * Card test: Blind to the West (wh-14)
 * Type: hazard-event (short)
 * Effects: 2
 *   1. on-event self-enters-play → cancel-chain-entry (select: target,
 *      filter: hero short-event declared by a fallen-wizard player,
 *      removeFromGame: true)
 *   2. play-flag no-hazard-limit
 *
 * Text:
 *   "Targets and cancels one hero short-event played by a Fallen-wizard
 *    earlier in the same chain of effects. This card can be played at any
 *    time and does not count against the hazard limit. Remove this card
 *    from the game."
 *
 * The minion-side twin of this card is Ire of the East (wh-24); the only
 * difference is the target card type in the filter.
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

const BLIND_TO_THE_WEST = 'wh-14' as CardDefinitionId;
const ORC_QUARRELS = 'le-216' as CardDefinitionId;   // minion short-event: cancels an Orc attack

// Minion fixtures, used only by the "wrong card type" case where the
// Fallen-wizard declares a minion short-event instead of a hero one.
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

describe('Blind to the West (wh-14)', () => {
  beforeEach(() => resetMint());

  test('cancels a fallen-wizard hero short-event on the chain; removed from game, no hazard-limit cost', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [OSTISEN] }], hand: [ORC_PATROL, BLIND_TO_THE_WEST], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const blindId = findHandCardId(stateAtMH, HAZARD_PLAYER, BLIND_TO_THE_WEST);
    const concealmentId = findHandCardId(stateAtMH, RESOURCE_PLAYER, CONCEALMENT);
    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );
    expect(combatState.combat).not.toBeNull();

    // Fallen-wizard taps Aragorn (scout) for Concealment (hero short-event) to
    // cancel the Orc attack — chain opens, hazard player gets priority.
    const cancelAction = firstAction<CancelAttackAction>(combatState, PLAYER_1, 'cancel-attack');
    const afterConcealment = dispatch(combatState, cancelAction);
    expect(afterConcealment.chain).not.toBeNull();
    expect(afterConcealment.chain!.priority).toBe(PLAYER_2);

    // Blind to the West is a viable chain response targeting the Concealment
    // chain entry.
    const blindPlays = viableActionsForHandCard(afterConcealment, PLAYER_2, 'play-short-event', HAZARD_PLAYER, BLIND_TO_THE_WEST)
      .map(ea => ea.action as PlayShortEventAction);
    expect(blindPlays).toHaveLength(1);
    const concealmentEntry = afterConcealment.chain!.entries.find(e => e.card?.definitionId === CONCEALMENT)!;
    expect(blindPlays[0].targetInstanceId).toBe(concealmentEntry.card!.instanceId);

    // Playing it does not count against the hazard limit: the M/H hazard
    // counter is unchanged by the chain response.
    const hazardsBefore = afterConcealment.phaseState.phase === Phase.MovementHazard
      ? afterConcealment.phaseState.hazardsPlayedThisCompany : -1;
    const afterBlind = dispatch(afterConcealment, blindPlays[0]);
    expect(afterBlind.chain!.entries).toHaveLength(2);
    const hazardsAfter = afterBlind.phaseState.phase === Phase.MovementHazard
      ? afterBlind.phaseState.hazardsPlayedThisCompany : -2;
    expect(hazardsAfter).toBe(hazardsBefore);

    // Chain resolves LIFO: Blind to the West negates Concealment, so the
    // attack survives.
    const resolved = resolveChain(afterBlind);
    expect(resolved.chain).toBeNull();
    expect(resolved.combat).not.toBeNull();

    // Concealment goes to its owner's discard; Blind to the West is removed
    // from the game — out-of-play pile, not the discard pile.
    expectInDiscardPile(resolved, RESOURCE_PLAYER, concealmentId);
    expectNotInHand(resolved, HAZARD_PLAYER, blindId);
    expect(resolved.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.instanceId === blindId)).toBe(true);
    expect(resolved.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === blindId)).toBe(false);
  });

  test('not offered when the hero short-event was played by a hero (Wizard) player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [OSTISEN] }], hand: [ORC_PATROL, BLIND_TO_THE_WEST], siteDeck: [RIVENDELL] },
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
    const afterConcealment = dispatch(combatState, cancelAction);
    expect(afterConcealment.chain).not.toBeNull();

    // The Concealment entry was declared by a Wizard, not a Fallen-wizard —
    // Blind to the West has no valid target.
    expect(viableActionsForHandCard(afterConcealment, PLAYER_2, 'play-short-event', HAZARD_PLAYER, BLIND_TO_THE_WEST))
      .toHaveLength(0);
  });

  test('not offered against a minion short-event played by a Fallen-wizard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL, BLIND_TO_THE_WEST], siteDeck: [DOL_GULDUR] },
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

    // Orc Quarrels is a minion short-event — that is Ire of the East's (wh-24)
    // target, not this card's, even though the declarer is a Fallen-wizard.
    expect(viableActionsForHandCard(afterQuarrels, PLAYER_2, 'play-short-event', HAZARD_PLAYER, BLIND_TO_THE_WEST))
      .toHaveLength(0);
  });

  test('not offered while no chain is live', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [OSTISEN] }], hand: [ORC_PATROL, BLIND_TO_THE_WEST], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Combat is active but no chain is open — Blind to the West targets only
    // entries "earlier in the same chain of effects".
    expect(combatState.chain).toBeNull();
    expect(viableActionsForHandCard(combatState, PLAYER_2, 'play-short-event', HAZARD_PLAYER, BLIND_TO_THE_WEST))
      .toHaveLength(0);
  });

  test('control: without Blind to the West, the hero short-event resolves and cancels the attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [CONCEALMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [OSTISEN] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
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

    // With no interruption, Concealment cancels the attack.
    expect(resolved.chain).toBeNull();
    expect(resolved.combat).toBeNull();
  });
});
