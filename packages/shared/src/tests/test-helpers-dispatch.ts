/**
 * @module test-helpers-dispatch
 *
 * Action-dispatch and execution helpers for tests: the low-level reduce wrappers
 * (dispatch, dispatchResult, actionAs, executeAction), multi-action drivers
 * (runActions, resolveChain), pending-resolution enqueue helpers
 * (enqueueCorruptionCheck, enqueueTransferCorruptionCheck, enqueueGoldRingTest),
 * gold-ring test drivers (testGoldRingViaWizard, ringPlayOffer,
 * offeredRingInstanceIds), and setupAutoAttackStep.
 * Split out of test-helpers.ts (re-exported from the
 * barrel); imports only engine modules and the base layers, so nothing imports
 * it back (no cycle).
 */

import { expect } from 'vitest';
import { reduce } from '../engine/reducer.js';
import type { ReducerResult } from '../engine/reducer.js';
import { Phase, computeLegalActions } from '../index.js';
import type { PlayerId, GameState, CardInstanceId, GameAction, SitePhaseState, PendingResolution, PlayRingAfterTestAction } from '../index.js';
import { enqueueResolution } from '../engine/pending.js';
import { viableActions } from './test-helpers-queries.js';

/**
 * Run a sequence of actions, asserting no errors.
 * Returns the final state.
 */
export function runActions(
  state: GameState,
  actions: readonly GameAction[],
): GameState {
  for (const action of actions) {
    const result = reduce(state, action);
    if (result.error) throw new Error(`Action ${action.type} failed: ${result.error}`);
    state = result.state;
  }
  return state;
}

/**
 * Narrow an {@link GameAction} to a specific shape. Used to reach into
 * payload-specific fields (e.g. `cardInstanceId`) without repeating the
 * cast at every call site.
 */
export function actionAs<T extends GameAction>(action: GameAction): T {
  return action as T;
}

/**
 * Enqueue a transfer-style corruption-check pending resolution onto the
 * given state. Used by tests that simulate a just-completed item transfer
 * without going through the full transfer reducer flow.
 *
 * Replaces the legacy pattern of poking
 * `OrganizationPhaseState.pendingCorruptionCheck` directly.
 */
export function enqueueTransferCorruptionCheck(
  state: GameState,
  playerId: PlayerId,
  characterId: CardInstanceId,
  transferredItemId: CardInstanceId,
): GameState {
  return enqueueResolution(state, {
    source: transferredItemId,
    actor: playerId,
    scope: { kind: 'phase', phase: Phase.Organization },
    kind: {
      type: 'corruption-check',
      characterId,
      modifier: 0,
      reason: 'Transfer',
      possessions: [],
      transferredItemId,
    },
  });
}

/**
 * Enqueue a generic corruption-check pending resolution for a character.
 * Used by tests that need to trigger a corruption check in the pending
 * resolution queue (outside of Free Council) without going through the
 * full hazard-play flow.
 */
export function enqueueCorruptionCheck(
  state: GameState,
  playerId: PlayerId,
  characterId: CardInstanceId,
  modifier = 0,
  possessions: CardInstanceId[] = [],
): GameState {
  return enqueueResolution(state, {
    source: characterId,
    actor: playerId,
    scope: { kind: 'phase', phase: state.phaseState.phase as Phase },
    kind: {
      type: 'corruption-check',
      characterId,
      modifier,
      reason: 'Test',
      possessions,
      transferredItemId: null,
    },
  });
}

/**
 * Enqueue a `gold-ring-test` pending resolution for the given player,
 * gold ring instance, and character. Used by ring-test rule tests to set
 * up the state just before the player rolls.
 */
export function enqueueGoldRingTest(
  state: GameState,
  playerId: PlayerId,
  goldRingInstanceId: CardInstanceId,
  characterInstanceId: CardInstanceId,
  rollModifier = 0,
): GameState {
  return enqueueResolution(state, {
    source: goldRingInstanceId,
    actor: playerId,
    scope: { kind: 'phase', phase: Phase.Organization },
    kind: {
      type: 'gold-ring-test',
      goldRingInstanceId,
      characterInstanceId,
      rollModifier,
    },
  });
}

/**
 * Drive the Rule 9.21 Wizard gold-ring test end to end: activate the player's
 * single granted action (a Wizard's `test-gold-ring`, which applies
 * `enqueue-gold-ring-test`), then roll the queued `gold-ring-test` with `total`
 * cheated in. Returns the state after the roll — by then the gold ring is
 * discarded and a `ring-play-offer` is queued for the player.
 *
 * Asserts the state offers exactly one granted action and one roll, so the
 * fixture must contain a single Wizard and a single gold ring in his company.
 */
export function testGoldRingViaWizard(
  state: GameState,
  playerId: PlayerId,
  total: number,
): GameState {
  const grants = viableActions(state, playerId, 'activate-granted-action');
  expect(grants.length).toBe(1);
  const afterActivate = dispatch(state, grants[0].action);

  return rollGoldRingTest(afterActivate, playerId, total);
}

/**
 * Roll the `gold-ring-test` pending resolution already queued for the player,
 * with `total` cheated in as the 2d6 result. Returns the state after the roll —
 * by then the gold ring is discarded and a `ring-play-offer` is queued.
 *
 * Complements {@link testGoldRingViaWizard}: use this when the test was queued
 * by something other than a Wizard's granted action (e.g. a Test of Fire /
 * Test of Form short event, or a Darkhaven auto-test).
 */
export function rollGoldRingTest(
  state: GameState,
  playerId: PlayerId,
  total: number,
): GameState {
  const rolls = viableActions(state, playerId, 'gold-ring-test-roll');
  expect(rolls.length).toBe(1);
  return dispatch({ ...state, cheatRollTotal: total }, rolls[0].action);
}

/**
 * The single `ring-play-offer` pending resolution queued for the player, so
 * ring-test tests can assert on `eligibleCategories` / `searchCategories`.
 * Throws if the player's only pending resolution is something else.
 */
export function ringPlayOffer(
  state: GameState,
  playerId: PlayerId,
): Extract<PendingResolution['kind'], { type: 'ring-play-offer' }> {
  const pending = state.pendingResolutions.filter(r => r.actor === playerId);
  expect(pending.length).toBe(1);
  if (pending[0].kind.type !== 'ring-play-offer') {
    throw new Error(`expected ring-play-offer, got ${pending[0].kind.type}`);
  }
  return pending[0].kind;
}

/**
 * Instance ids of the rings the player may currently play via
 * `play-ring-after-test` (the rings the gold-ring test actually offered).
 */
export function offeredRingInstanceIds(
  state: GameState,
  playerId: PlayerId,
): readonly CardInstanceId[] {
  return viableActions(state, playerId, 'play-ring-after-test')
    .map(a => (a.action as PlayRingAfterTestAction).ringInstanceId);
}

/**
 * Resolve an active chain by having both players pass priority until
 * the chain is cleared. Returns the resulting state.
 */
export function resolveChain(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 20 && current.chain !== null; i++) {
    const priorityPlayer = current.chain.priority;
    const actions = computeLegalActions(current, priorityPlayer);
    const pass = actions.find(ea => ea.viable && ea.action.type === 'pass-chain-priority');
    if (!pass) break;
    const result = reduce(current, pass.action);
    if (result.error) break;
    current = result.state;
  }
  return current;
}

// ─── Opponent influence helpers ─────────────────────────────────────────────

/**
 * Execute the first viable action of the given type for a player.
 * Optionally sets a cheat dice roll. For `resolve-strike`, picks the
 * tap or no-tap variant based on the `tapToFight` parameter (default false).
 */
export function executeAction(
  state: GameState,
  player: PlayerId,
  actionType: string,
  roll?: number,
  tapToFight = false,
): GameState {
  const s = roll !== undefined ? { ...state, cheatRollTotal: roll } : state;
  const actions = viableActions(s, player, actionType);
  expect(actions.length).toBeGreaterThan(0);
  let action = actions[0].action;
  if (actionType === 'resolve-strike') {
    const preferred = actions.find(a => 'tapToFight' in a.action && (a.action as { tapToFight: boolean }).tapToFight === tapToFight);
    if (preferred) action = preferred.action;
  }
  const result = reduce(s, action);
  expect(result.error).toBeUndefined();
  return result.state;
}

/**
 * Transitions a site phase state to the automatic-attacks step.
 *
 * @param state - A state with a SitePhaseState (e.g. from `buildSitePhaseState`).
 */
export function setupAutoAttackStep<T extends GameState>(state: T): T {
  const base = state.phaseState as SitePhaseState;
  const autoAttackState: SitePhaseState = {
    phase: base.phase,
    step: 'automatic-attacks',
    activeCompanyIndex: base.activeCompanyIndex,
    handledCompanyIds: base.handledCompanyIds,
    siteEntered: false,
    resourcePlayed: base.resourcePlayed,
    minorItemAvailable: base.minorItemAvailable,
    hoardBountyAvailable: base.hoardBountyAvailable,
    thoroughSearchAvailable: base.thoroughSearchAvailable,
    declaredAgentAttack: base.declaredAgentAttack,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: base.awaitingOnGuardReveal,
    pendingResourceAction: base.pendingResourceAction,
    opponentInteractionThisTurn: base.opponentInteractionThisTurn,
    pendingOpponentInfluence: base.pendingOpponentInfluence,
  };
  return { ...state, phaseState: autoAttackState };
}

/**
 * Apply an action and assert it produced no error. Returns the new state.
 *
 * Replaces the common two-line pattern:
 * ```
 * const result = reduce(state, action);
 * expect(result.error).toBeUndefined();
 * state = result.state;
 * ```
 */
export function dispatch(state: GameState, action: GameAction): GameState {
  const result = reduce(state, action);
  expect(result.error).toBeUndefined();
  return result.state;
}

/**
 * Apply an action and assert it produced no error. Returns the full
 * {@link ReducerResult} so tests can inspect emitted effects. Use
 * {@link dispatch} when only the next state is needed.
 */
export function dispatchResult(state: GameState, action: GameAction): ReducerResult {
  const result = reduce(state, action);
  expect(result.error).toBeUndefined();
  return result;
}

/**
 * Find the first viable action of a given type, optionally narrowed by a
 * predicate. Returns undefined if no match is found.
 */
