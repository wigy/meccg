/**
 * @module td-105.test
 *
 * Card test: Cram (td-105)
 * Type: hero-resource-item (minor)
 * Effects: 2 (grant-action untap-bearer, grant-action extra-region-movement)
 *
 * "Discard to untap bearer. Alternatively, discard during organization phase
 *  to allow its bearer's company to play an additional region card."
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                           |
 * |---|--------------------------------------|-------------|-------------------------------------------------|
 * | 1 | Discard to untap bearer              | IMPLEMENTED | grant-action untap-bearer, cost: discard self   |
 * | 2 | Discard for extra region movement    | IMPLEMENTED | grant-action extra-region-movement, cost: discard self |
 * | 3 | +1 max region distance in M/H phase  | IMPLEMENTED | extraRegionDistance on Company                   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  CRAM,
  LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  CardStatus,
  dispatch, expectCharStatus, expectCharItemCount, expectInDiscardPile,
  makeMHState, makeSitePhase, RESOURCE_PLAYER,
  findCharInstanceId, companyIdAt,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CombatState } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Cram (td-105)', () => {
  beforeEach(() => resetMint());

  // ── Ability 1: untap-bearer ──

  test('untap-bearer grant-action available when bearer is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer');
    expect(untapActions.length).toBe(1);
  });

  test('untap-bearer NOT available when bearer is untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer');
    expect(untapActions.length).toBe(0);
  });

  test('activating untap-bearer discards Cram and untaps character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer')!;
    expect(untapAction).toBeDefined();

    const next = dispatch(state, untapAction.action);

    // Character should now be untapped
    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);

    // Cram should be removed from items
    expectCharItemCount(next, RESOURCE_PLAYER, ARAGORN, 0);

    // Cram should be in discard pile
    expectInDiscardPile(next, RESOURCE_PLAYER, CRAM);
  });

  // ── Ability 2: extra-region-movement ──

  test('extra-region-movement grant-action available during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions.length).toBe(1);
  });

  test('activating extra-region-movement discards Cram and sets extraRegionDistance', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement')!;
    expect(extraAction).toBeDefined();

    const next = dispatch(state, extraAction.action);

    // Cram should be removed from items
    expectCharItemCount(next, RESOURCE_PLAYER, ARAGORN, 0);

    // Cram should be in discard pile
    expectInDiscardPile(next, RESOURCE_PLAYER, CRAM);

    // Company should have extraRegionDistance set
    expect(next.players[0].companies[0].extraRegionDistance).toBe(1);
  });

  test('extra-region-movement NOT available when company already has planned movement', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Plan movement first
    const moveActions = viableActions(state, PLAYER_1, 'plan-movement');
    expect(moveActions.length).toBeGreaterThan(0);
    const afterMove = dispatch(state, moveActions[0].action);

    // Extra-region-movement should not be available
    const actions = viableActions(afterMove, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions.length).toBe(0);
  });

  test('extra-region-movement NOT available when company already has extra region distance', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM, CRAM] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Activate first Cram for extra-region-movement
    const actions1 = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraAction1 = actions1.find(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement')!;
    const afterFirst = dispatch(state, extraAction1.action);

    // Second Cram should NOT offer extra-region-movement (already has bonus)
    const actions2 = viableActions(afterFirst, PLAYER_1, 'activate-granted-action');
    const extraActions2 = actions2.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions2.length).toBe(0);
  });

  // ── Bug report (game ms7w6tw6-vw1zk3): the Long-event → Movement/Hazard
  // transition wiped `extraRegionDistance`, so a 5-region path declared with
  // Cram's bonus during the organization phase was re-validated against the
  // base 4-region maximum, negated per rule 5.04, and the company was sent
  // back to its site of origin. Rule 2.II.7.ii anchors path legality at
  // organization-phase declaration time — the bonus must survive into the
  // M/H phase and only reset after movement resolves (M/H → Site).
  test('extraRegionDistance survives the long-event → movement/hazard transition', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: LORIEN }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // Cram was discarded during the organization phase: the company carries
    // +1 region distance into its declared movement.
    const withBonus: typeof state = {
      ...state,
      players: [
        { ...state.players[0], companies: [{ ...state.players[0].companies[0], extraRegionDistance: 1 }] },
        state.players[1],
      ],
    };

    const next = dispatch(withBonus, { type: 'pass', player: PLAYER_1 });

    expect(next.phaseState.phase).toBe(Phase.MovementHazard);
    expect(next.players[0].companies[0].extraRegionDistance).toBe(1);
    expect(next.players[0].companies[0].destinationSite).not.toBeNull();
  });

  test('untap-bearer grant-action available during end-of-org step', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const orgPhase = state.phaseState as import('../../index.js').OrganizationPhaseState;
    const endOfOrgState: typeof state = {
      ...state,
      phaseState: { ...orgPhase, step: 'end-of-org' as const },
    };

    const actions = viableActions(endOfOrgState, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer');
    expect(untapActions.length).toBe(1);
  });

  // ── Both abilities on same card ──

  test('tapped character with Cram sees untap-bearer but also extra-region-movement', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const actionIds = actions.map(ea => (ea.action as ActivateGrantedAction).actionId);

    // Both abilities should be available (untap because tapped, extra-region because no movement planned)
    expect(actionIds).toContain('untap-bearer');
    expect(actionIds).toContain('extra-region-movement');
  });

  // ── Rule 2.1.1: untap-bearer available in any phase ──

  test('untap-bearer available during long-event phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer');
    expect(untapActions.length).toBe(1);
  });

  test('untap-bearer available during movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer');
    expect(untapActions.length).toBe(1);
  });

  test('untap-bearer available during site phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeSitePhase() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer');
    expect(untapActions.length).toBe(1);
  });

  test('activating untap-bearer during movement/hazard phase discards Cram and untaps character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action');
    const untapAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer')!;
    expect(untapAction).toBeDefined();

    const next = dispatch(ready, untapAction.action);
    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectCharItemCount(next, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, CRAM);
  });

  // ── Bug report (tw-314-adjacent): untap-bearer while facing an automatic
  // attack. A character who tapped for their own ability (e.g. Fatty Bolger
  // tapping to cancel a strike against a fellow Hobbit) and then must resolve
  // their own strike is stuck facing it already-tapped, unless they can use
  // Cram to untap first. Combat is a self-contained sub-state machine
  // (`combatActions` in legal-actions/combat.ts) that bypasses the normal
  // per-phase action list where `grantedActionActivations` usually runs, so
  // without wiring untap-bearer into combat's resolve-strike case, this
  // any-phase grant is silently unreachable for the whole strike sequence.
  test('untap-bearer available while resolving a strike in combat', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM], status: CardStatus.Tapped }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-creature' as never },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 5,
      creatureBody: 5,
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const ready = { ...state, phaseState: makeMHState(), combat };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer');
    expect(untapActions.length).toBe(1);

    const next = dispatch(ready, untapActions[0].action);
    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectCharItemCount(next, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, CRAM);
    // Combat itself is untouched by the grant-action activation.
    expect(next.combat?.phase).toBe('resolve-strike');
  });

  test('extra-region-movement NOT available during movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions.length).toBe(0);
  });
});
