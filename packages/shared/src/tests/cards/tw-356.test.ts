/**
 * @module tw-356.test
 *
 * Card test: Vanishment (tw-356)
 * Type: hero-resource-event (short, spell)
 * Effects: 1 (cancel-attack: requires wizard in company, wizard makes corruption check -2)
 *
 * "Spell. Wizard only. Cancels an attack against the Wizard's company.
 * Wizard makes a corruption check modified by -2."
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                               |
 * |---|------------------------------------------------|-------------|-------------------------------------|
 * | 1 | cancel-attack during assign-strikes            | IMPLEMENTED | combat legal actions + reducer       |
 * | 2 | Requires wizard (race) in company              | IMPLEMENTED | requiredRace filter in legal actions |
 * | 3 | Wizard makes corruption check (-2 modifier)    | IMPLEMENTED | enqueues pending resolution          |
 * | 4 | Discards Vanishment from hand                  | IMPLEMENTED | reducer moves card to discard        |
 * | 5 | Cancels combat (nullifies state.combat)        | IMPLEMENTED | reducer sets combat to null          |
 * | 6 | Creature moves to attacker's discard           | IMPLEMENTED | reducer handles creature cleanup     |
 * | 7 | Tapped wizard can still pay the cost           | IMPLEMENTED | corruption check doesn't require untapped |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  ORC_PATROL, VANISHMENT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  CardStatus,
  handCardId, companyIdAt, dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CancelAttackAction } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';

describe('Vanishment (tw-356)', () => {
  beforeEach(() => resetMint());

  test('cancel-attack available when wizard is in defending company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [VANISHMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.phase).toBe('assign-strikes');

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    expect(cancelAction.scoutInstanceId).toBeDefined();
  });

  test('cancel-attack NOT available when no wizard is in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [VANISHMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('executing cancel-attack discards card, cancels combat, and enqueues corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [VANISHMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    const declared = dispatch(combatState, cancelActions[0].action);

    // Declaration initiates chain; card + corruption check already set up
    expect(declared.chain).not.toBeNull();
    expect(declared.combat).not.toBeNull();
    expect(declared.players[0].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, VANISHMENT);
    expect(declared.pendingResolutions).toHaveLength(1);
    expect(declared.pendingResolutions[0].kind.type).toBe('corruption-check');
    const ccKind = declared.pendingResolutions[0].kind as { type: 'corruption-check'; modifier: number };
    expect(ccKind.modifier).toBe(-2);

    // Resolve chain — combat cancelled, creature to attacker's discard
    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
    expectInDiscardPile(after, HAZARD_PLAYER, ORC_PATROL);
  });

  test('tapped wizard can still use Vanishment (corruption check does not require untapped)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [VANISHMENT], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    // Tap Gandalf before combat
    const gandalfId = base.players[0].companies[0].characters[0];
    const gandalfData = base.players[0].characters[gandalfId as string];
    const p0 = {
      ...base.players[0],
      characters: {
        ...base.players[0].characters,
        [gandalfId as string]: { ...gandalfData, status: CardStatus.Tapped },
      },
    };
    const tappedState = {
      ...base,
      players: [p0, base.players[1]] as const,
    };

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...tappedState, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);

    const declared = dispatch(combatState, cancelActions[0].action);
    expectInDiscardPile(declared, RESOURCE_PLAYER, VANISHMENT);
    expect(declared.pendingResolutions).toHaveLength(1);
    expect(declared.pendingResolutions[0].kind.type).toBe('corruption-check');
    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
  });
});
