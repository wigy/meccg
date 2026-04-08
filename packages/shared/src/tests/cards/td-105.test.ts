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
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  CRAM,
  LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  findCharInstanceId,
  CardStatus,
} from '../test-helpers.js';
import type { ActivateGrantedAction } from '../../index.js';

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

    const result = reduce(state, untapAction.action);
    expect(result.error).toBeUndefined();

    // Character should now be untapped
    const aragornId = findCharInstanceId(result.state, 0, ARAGORN);
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Untapped);

    // Cram should be removed from items
    expect(result.state.players[0].characters[aragornId as string].items).toHaveLength(0);

    // Cram should be in discard pile
    expect(result.state.players[0].discardPile.some(c => c.definitionId === CRAM)).toBe(true);
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

    const result = reduce(state, extraAction.action);
    expect(result.error).toBeUndefined();

    // Cram should be removed from items
    const aragornId = findCharInstanceId(result.state, 0, ARAGORN);
    expect(result.state.players[0].characters[aragornId as string].items).toHaveLength(0);

    // Cram should be in discard pile
    expect(result.state.players[0].discardPile.some(c => c.definitionId === CRAM)).toBe(true);

    // Company should have extraRegionDistance set
    expect(result.state.players[0].companies[0].extraRegionDistance).toBe(1);
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
    const afterMove = reduce(state, moveActions[0].action);
    expect(afterMove.error).toBeUndefined();

    // Extra-region-movement should not be available
    const actions = viableActions(afterMove.state, PLAYER_1, 'activate-granted-action');
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
    const afterFirst = reduce(state, extraAction1.action);
    expect(afterFirst.error).toBeUndefined();

    // Second Cram should NOT offer extra-region-movement (already has bonus)
    const actions2 = viableActions(afterFirst.state, PLAYER_1, 'activate-granted-action');
    const extraActions2 = actions2.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions2.length).toBe(0);
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
});
