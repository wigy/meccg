/**
 * @module le-160.test
 *
 * Card test: A Nice Place to Hide (le-160)
 * Type: minion-resource-event (short)
 * Effects: 1 (cancel-attack: tap a scout to cancel one attack)
 *
 * "Scout only. Tap scout to cancel an attack against his company."
 *
 * This is the minion-side counterpart to Concealment (tw-204) — same
 * rule wording, same DSL encoding. The cancel-attack engine is
 * alignment-agnostic, so the card works through the exact same legal
 * action and chain-reducer path.
 *
 * Fixture alignment: minion-resource event — tests build state with
 * minion characters (le-17 Jerrek warrior/scout, le-18 Lagduf warrior,
 * le-36 Ostisen scout) at minion sites (Moria le-392 shadow-hold,
 * Dol Guldur le-367 haven, Minas Morgul le-390 haven).
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                               |
 * |---|-------------------------------------------|-------------|-------------------------------------|
 * | 1 | cancel-attack during assign-strikes       | IMPLEMENTED | combat legal actions + reducer       |
 * | 2 | Requires untapped scout in company        | IMPLEMENTED | legal action filter                  |
 * | 3 | Taps scout as cost                        | IMPLEMENTED | reducer taps character               |
 * | 4 | Discards card from hand                   | IMPLEMENTED | reducer moves card to discard        |
 * | 5 | Cancels combat via chain                  | IMPLEMENTED | opponent response window             |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ORC_PATROL,
  pool, viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  CardStatus,
  handCardId, companyIdAt, dispatch, expectCharStatus, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CancelAttackAction, CardDefinitionId } from '../../index.js';
import { RegionType, SiteType, describeAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';

const A_NICE_PLACE_TO_HIDE = 'le-160' as CardDefinitionId;

// Minion fixtures — only referenced in this test file, so declared
// locally per the `card-ids.ts` constants policy in CLAUDE.md.
const JERREK = 'le-17' as CardDefinitionId;       // warrior/scout, orc, prow 5
const OSTISEN = 'le-36' as CardDefinitionId;      // scout, man, prow 3
const LAGDUF = 'le-18' as CardDefinitionId;       // warrior only, orc (no scout)

const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold

describe('A Nice Place to Hide (le-160)', () => {
  beforeEach(() => resetMint());

  test('cancel-attack action is available when defending minion company has untapped scout and the card in hand', () => {
    // Jerrek has the scout skill and is untapped.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [JERREK] }], hand: [A_NICE_PLACE_TO_HIDE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
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
    expect(cancelActions.length).toBe(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    expect(cancelAction.cardInstanceId).toBe(handCardId(combatState, RESOURCE_PLAYER));
  });

  test('executing cancel-attack taps scout, discards card, and cancels combat via chain', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [JERREK] }], hand: [A_NICE_PLACE_TO_HIDE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
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
    expect(cancelActions.length).toBe(1);
    const declared = dispatch(combatState, cancelActions[0].action);

    // Chain active; combat still live until chain resolves.
    expect(declared.chain).not.toBeNull();
    expect(declared.combat).not.toBeNull();

    // Scout cost paid at declaration.
    expectCharStatus(declared, RESOURCE_PLAYER, JERREK, CardStatus.Tapped);

    // Short event moves to discard at declaration.
    expect(declared.players[0].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, A_NICE_PLACE_TO_HIDE);

    const after = resolveChain(declared);

    expect(after.combat).toBeNull();
    expect(after.chain).toBeNull();

    expectInDiscardPile(after, HAZARD_PLAYER, ORC_PATROL);
    expect(after.players[1].cardsInPlay.find(c => c.definitionId === ORC_PATROL)).toBeUndefined();
  });

  test('cancel-attack is NOT available when there is no scout in the company', () => {
    // Lagduf is warrior only — no scout skill.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [A_NICE_PLACE_TO_HIDE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [JERREK] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
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

  test('cancel-attack is NOT available when the scout is tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [{ defId: JERREK, status: CardStatus.Tapped }] }],
          hand: [A_NICE_PLACE_TO_HIDE],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
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

  test('A Nice Place to Hide is NOT playable during the long-event phase (no attack)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [JERREK] }], hand: [A_NICE_PLACE_TO_HIDE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const shortEventActions = actions.filter(a => a.action.type === 'play-short-event');
    expect(shortEventActions).toHaveLength(0);

    const notPlayable = actions.filter(a => a.action.type === 'not-playable');
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('cancel-attack action description names the card and scout for opponent notification', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [JERREK] }], hand: [A_NICE_PLACE_TO_HIDE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
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
    expect(cancelActions.length).toBe(1);

    const instLookup = (id: string) => resolveInstanceId(combatState, id as never);
    const desc = describeAction(cancelActions[0].action, pool, instLookup);
    expect(desc).toContain('Cancel attack');
    expect(desc).toContain('A Nice Place to Hide');
    expect(desc).toContain('Jerrek');
  });

  test('multiple scouts in company generate one cancel-attack action per scout', () => {
    // Jerrek (warrior/scout) and Ostisen (scout) are both untapped —
    // two distinct cancel-attack actions expected.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [JERREK, OSTISEN] }], hand: [A_NICE_PLACE_TO_HIDE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
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
    expect(cancelActions).toHaveLength(2);

    const scoutIds = cancelActions.map(a => (a.action as CancelAttackAction).scoutInstanceId);
    expect(new Set(scoutIds).size).toBe(2);
  });

  test('cancel-attack is NOT available to the attacking player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [JERREK] }], hand: [A_NICE_PLACE_TO_HIDE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
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
    // P2 is the attacker — must have no cancel-attack actions.
    const cancelActions = viableActions(combatState, PLAYER_2, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  // Regression parity with tw-204: cancel-attack declaration must initiate
  // a chain, giving the opponent a response window before combat cancels.
  test('cancel-attack declaration initiates a chain and gives opponent priority to respond', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [JERREK] }], hand: [A_NICE_PLACE_TO_HIDE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
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

    expect(declared.chain).not.toBeNull();
    expect(declared.chain!.entries).toHaveLength(1);
    expect(declared.chain!.entries[0].card?.definitionId).toBe(A_NICE_PLACE_TO_HIDE);
    expect(declared.chain!.entries[0].declaredBy).toBe(PLAYER_1);

    expect(declared.combat).not.toBeNull();
    expect(declared.chain!.priority).toBe(PLAYER_2);
  });
});
