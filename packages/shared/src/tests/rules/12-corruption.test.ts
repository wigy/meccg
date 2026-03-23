/**
 * @module 12-corruption.test
 *
 * Tests for CoE Rules Section 7: Corruption.
 *
 * Rule references from docs/coe-rules.txt lines 585-603.
 *
 * Corruption checks are triggered after item transfers during Organization.
 * The character rolls 2d6 + modifier vs their corruption point total:
 * - roll > CP: pass, no effect
 * - roll == CP or CP-1: character and possessions discarded (not followers)
 * - roll < CP-1: character eliminated, possessions discarded
 */

import { describe, test, expect } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  runActions, reduce,
  Phase,
  ARAGORN, BILBO, LEGOLAS,
  THE_ONE_RING, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN,
  buildTestState,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type {
  EvaluatedAction, GameState, PlayerId,
  TransferItemAction,
} from '../../index.js';
import type { CorruptionCheckAction } from '../../types/actions.js';

function buildOrgState(opts: { activePlayer: PlayerId; players: Parameters<typeof buildTestState>[0]['players']; seed?: number }) {
  return buildTestState({ ...opts });
}

function viableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => a.viable && a.action.type === type);
}

/**
 * Helper: build state with Aragorn holding The One Ring + Dagger at Rivendell
 * with Bilbo, transfer the Dagger to Bilbo (triggering corruption check for
 * Aragorn who still holds The One Ring = 6 CP), then return the state ready
 * for the corruption check.
 */
function setupCorruptionCheck(seed: number): { state: GameState; checkAction: CorruptionCheckAction } {
  const state = buildOrgState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        hand: [],
        siteDeck: [],
        companies: [{
          site: RIVENDELL,
          characters: [
            { defId: ARAGORN, items: [THE_ONE_RING, DAGGER_OF_WESTERNESSE] },
            { defId: BILBO },
          ],
        }],
      },
      {
        id: PLAYER_2,
        hand: [],
        siteDeck: [],
        companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
      },
    ],
    seed,
  });

  // Get and execute the transfer action
  const actions = computeLegalActions(state, PLAYER_1);
  const transfers = viableOfType(actions, 'transfer-item');
  // Find the Dagger transfer (not The One Ring)
  const daggerTransfer = transfers.find(ea => {
    const a = ea.action as TransferItemAction;
    const inst = state.instanceMap[a.itemInstanceId as string];
    return inst?.definitionId === DAGGER_OF_WESTERNESSE;
  });
  expect(daggerTransfer).toBeDefined();

  const stateAfterTransfer = runActions(state, [daggerTransfer!.action]);

  // Only legal action should be corruption-check
  const postActions = computeLegalActions(stateAfterTransfer, PLAYER_1);
  const checks = viableOfType(postActions, 'corruption-check');
  expect(checks).toHaveLength(1);

  const checkAction = checks[0].action as CorruptionCheckAction;
  // Aragorn holds The One Ring (6 CP) + transferred Dagger (1 CP) = 7 CP
  expect(checkAction.corruptionPoints).toBe(7);

  return { state: stateAfterTransfer, checkAction };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('7 Corruption checks', () => {
  test('[7] roll > CP: check succeeds, no effect', () => {
    // seed=245 → rolls 6+6=12, which is > 7 CP → pass
    const { state, checkAction } = setupCorruptionCheck(245);

    const result = reduce(state, checkAction);
    expect(result.error).toBeUndefined();

    // Aragorn still in play with The One Ring
    const aragorn = Object.values(result.state.players[0].characters)
      .find(c => c.definitionId === ARAGORN);
    expect(aragorn).toBeDefined();
    expect(aragorn!.items).toHaveLength(1);

    // No cards in discard or eliminated
    expect(result.state.players[0].discardPile).toHaveLength(0);
    expect(result.state.players[0].eliminatedPile).toHaveLength(0);

    // Pending check cleared
    const orgState = result.state.phaseState as import('../../index.js').OrganizationPhaseState;
    expect(orgState.pendingCorruptionCheck).toBeNull();
  });

  test('[7] roll = CP or CP-1: hero character discarded with non-follower cards', () => {
    // seed=4 → rolls 1+6=7, which == 7 CP → discard
    const { state, checkAction } = setupCorruptionCheck(4);

    const result = reduce(state, checkAction);
    expect(result.error).toBeUndefined();

    // Aragorn no longer in play
    const aragorn = Object.values(result.state.players[0].characters)
      .find(c => c.definitionId === ARAGORN);
    expect(aragorn).toBeUndefined();

    // Bilbo still in play but the transferred Dagger was removed from him
    const bilbo = Object.values(result.state.players[0].characters)
      .find(c => c.definitionId === BILBO);
    expect(bilbo).toBeDefined();
    expect(bilbo!.items).toHaveLength(0);

    // Aragorn + The One Ring + Dagger go to discard pile (not eliminated)
    expect(result.state.players[0].discardPile).toHaveLength(3);
    expect(result.state.players[0].eliminatedPile).toHaveLength(0);

    // Pending check cleared
    const orgState = result.state.phaseState as import('../../index.js').OrganizationPhaseState;
    expect(orgState.pendingCorruptionCheck).toBeNull();
  });

  test.todo('[7] roll = CP or CP-1: wizard avatar eliminated with non-follower cards');
  test.todo('[7] roll = CP or CP-1: minion character taps, check considered successful');

  test('[7] roll <= CP-2: character eliminated, non-follower cards discarded', () => {
    // seed=7 → rolls 1+1=2, which < 6 (CP-1=6) → eliminate
    const { state, checkAction } = setupCorruptionCheck(7);

    const result = reduce(state, checkAction);
    expect(result.error).toBeUndefined();

    // Aragorn no longer in play
    const aragorn = Object.values(result.state.players[0].characters)
      .find(c => c.definitionId === ARAGORN);
    expect(aragorn).toBeUndefined();

    // Aragorn goes to eliminated pile, The One Ring + Dagger to discard pile
    expect(result.state.players[0].eliminatedPile).toHaveLength(1);
    expect(result.state.players[0].discardPile).toHaveLength(2);

    // Pending check cleared
    const orgState = result.state.phaseState as import('../../index.js').OrganizationPhaseState;
    expect(orgState.pendingCorruptionCheck).toBeNull();
  });

  test('[7] corruption check after transfer: only corruption-check action is legal', () => {
    const { state } = setupCorruptionCheck(42);

    const actions = computeLegalActions(state, PLAYER_1);
    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');
  });

  test('[7] followers stay in play when character fails corruption check', () => {
    // Build state where Aragorn has a follower (Bilbo under DI) and The One Ring
    const state = buildOrgState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: ARAGORN, items: [THE_ONE_RING, DAGGER_OF_WESTERNESSE] },
              { defId: BILBO, followerOf: 0 },
              { defId: LEGOLAS },  // Transfer target (GI character)
            ],
          }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
      seed: 7,  // → rolls 1+1=2, Aragorn has 6 CP → eliminate
    });

    // Transfer Dagger from Aragorn to Legolas (player 1's Legolas)
    const actions = computeLegalActions(state, PLAYER_1);
    const transfers = viableOfType(actions, 'transfer-item');
    const daggerToLegolas = transfers.find(ea => {
      const a = ea.action as TransferItemAction;
      const inst = state.instanceMap[a.itemInstanceId as string];
      return inst?.definitionId === DAGGER_OF_WESTERNESSE;
    });
    expect(daggerToLegolas).toBeDefined();

    const stateAfterTransfer = runActions(state, [daggerToLegolas!.action]);
    const postActions = computeLegalActions(stateAfterTransfer, PLAYER_1);
    const checks = viableOfType(postActions, 'corruption-check');
    expect(checks).toHaveLength(1);

    const result = reduce(stateAfterTransfer, checks[0].action);
    expect(result.error).toBeUndefined();

    // Aragorn eliminated
    const aragorn = Object.values(result.state.players[0].characters)
      .find(c => c.definitionId === ARAGORN);
    expect(aragorn).toBeUndefined();

    // Bilbo still in play, promoted to general influence
    const bilbo = Object.values(result.state.players[0].characters)
      .find(c => c.definitionId === BILBO);
    expect(bilbo).toBeDefined();
    expect(bilbo!.controlledBy).toBe('general');
  });

  test.todo('[7] tap characters in same company for +1 modifier each to corruption check');
  test.todo('[7] required corruption check must be made even with zero CP');
  test.todo('[7] allies, ringwraiths, and balrogs not affected by corruption');
});

describe('7 Corruption cards', () => {
  test.todo('[7] corruption card: hazard with corruption keyword');
  test.todo('[7] only one corruption card may be played on each character per turn');
  test.todo('[7] corruption card can only be played when initiating new chain of effects');
  test.todo('[7] corruption cards cannot be played on dwarves also cannot be played on orcs');
  test.todo('[7] removing corruption card: tap character and roll, or -3 to stay untapped');
});
