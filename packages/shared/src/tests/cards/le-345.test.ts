/**
 * @module le-345.test
 *
 * Card test: Strange Rations (le-345)
 * Type: minion-resource-item (minor)
 * Effects: 2 (grant-action untap-bearer, grant-action extra-region-movement)
 *
 * "Discard to untap bearer. Alternatively, discard during organization phase
 *  to allow its bearer's company to play an additional region card."
 *
 * Strange Rations is the minion-alignment twin of Cram (td-105): identical
 * text, identical effect encoding. Corruption is 1 per the authoritative
 * database.
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                                  |
 * |---|--------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Discard to untap bearer              | IMPLEMENTED | grant-action untap-bearer, cost: discard self          |
 * | 2 | Available in any phase (CRF 2.1.1)   | IMPLEMENTED | anyPhase: true                                         |
 * | 3 | Discard for extra region movement    | IMPLEMENTED | grant-action extra-region-movement, cost: discard self |
 * | 4 | +1 max region distance in M/H phase  | IMPLEMENTED | extraRegionDistance on Company                         |
 *
 * Playable: YES
 * Certified: 2026-06-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions,
  CardStatus,
  dispatch, expectCharStatus, expectCharItemCount, expectInDiscardPile,
  makeMHState, makeSitePhase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const STRANGE_RATIONS = 'le-345' as CardDefinitionId;
const CALENDAL = 'le-4' as CardDefinitionId;        // minion character
const GORBAG = 'le-11' as CardDefinitionId;         // minion character
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const BANDIT_LAIR = 'le-351' as CardDefinitionId;   // non-haven, nearest = Dol Guldur

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Strange Rations (le-345)', () => {
  beforeEach(() => resetMint());

  // ── Ability 1: untap-bearer ──

  test('untap-bearer grant-action available when bearer is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS], status: CardStatus.Tapped }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
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
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer');
    expect(untapActions.length).toBe(0);
  });

  test('activating untap-bearer discards Strange Rations and untaps character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS], status: CardStatus.Tapped }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer')!;
    expect(untapAction).toBeDefined();

    const next = dispatch(state, untapAction.action);

    // Character should now be untapped
    expectCharStatus(next, RESOURCE_PLAYER, CALENDAL, CardStatus.Untapped);

    // Strange Rations should be removed from items
    expectCharItemCount(next, RESOURCE_PLAYER, CALENDAL, 0);

    // Strange Rations should be in discard pile
    expectInDiscardPile(next, RESOURCE_PLAYER, STRANGE_RATIONS);
  });

  // ── Ability 2: extra-region-movement ──

  test('extra-region-movement grant-action available during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions.length).toBe(1);
  });

  test('activating extra-region-movement discards Strange Rations and sets extraRegionDistance', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement')!;
    expect(extraAction).toBeDefined();

    const next = dispatch(state, extraAction.action);

    // Strange Rations should be removed from items
    expectCharItemCount(next, RESOURCE_PLAYER, CALENDAL, 0);

    // Strange Rations should be in discard pile
    expectInDiscardPile(next, RESOURCE_PLAYER, STRANGE_RATIONS);

    // Company should have extraRegionDistance set
    expect(next.players[0].companies[0].extraRegionDistance).toBe(1);
  });

  test('extra-region-movement NOT available when company already has planned movement', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
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
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS, STRANGE_RATIONS] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });

    // Activate first Strange Rations for extra-region-movement
    const actions1 = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraAction1 = actions1.find(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement')!;
    const afterFirst = dispatch(state, extraAction1.action);

    // Second Strange Rations should NOT offer extra-region-movement (already has bonus)
    const actions2 = viableActions(afterFirst, PLAYER_1, 'activate-granted-action');
    const extraActions2 = actions2.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions2.length).toBe(0);
  });

  test('untap-bearer grant-action available during end-of-org step', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS], status: CardStatus.Tapped }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
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

  test('tapped character with Strange Rations sees both untap-bearer and extra-region-movement', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS], status: CardStatus.Tapped }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
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
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS], status: CardStatus.Tapped }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
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
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS], status: CardStatus.Tapped }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
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
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS], status: CardStatus.Tapped }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });
    const ready = { ...state, phaseState: makeSitePhase() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer');
    expect(untapActions.length).toBe(1);
  });

  test('activating untap-bearer during movement/hazard phase discards Strange Rations and untaps character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS], status: CardStatus.Tapped }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action');
    const untapAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-bearer')!;
    expect(untapAction).toBeDefined();

    const next = dispatch(ready, untapAction.action);
    expectCharStatus(next, RESOURCE_PLAYER, CALENDAL, CardStatus.Untapped);
    expectCharItemCount(next, RESOURCE_PLAYER, CALENDAL, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, STRANGE_RATIONS);
  });

  test('extra-region-movement NOT available during movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [{ defId: CALENDAL, items: [STRANGE_RATIONS] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    const actions = viableActions(ready, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions.length).toBe(0);
  });
});
