/**
 * @module engine/pending-reducers
 *
 * Reducer dispatch for {@link PendingResolution} entries. While any
 * resolution is queued for the actor of an incoming action, this module's
 * {@link applyResolution} runs *before* the per-phase reducer — replacing
 * the six bespoke short-circuits the per-phase reducers used to carry.
 *
 * Each `kind` of pending resolution has its own handler. New resolution
 * kinds are added here in lock-step with the discriminated union in
 * `types/pending.ts`.
 */

import type {
  GameState,
  GameAction,
  PendingResolution,
  CardInstance,
  GameEffect,
} from '../index.js';
import type { ReducerResult } from './reducer-utils.js';
import { dequeueResolution, enqueueResolution } from './pending.js';
import { getPlayerIndex } from '../index.js';
import { resolveInstanceId } from '../types/state.js';
import { roll2d6, clonePlayers, cleanupEmptyCompanies } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';
import {
  resolveInfluenceAttemptRoll,
  resolveOpponentInfluenceDefend,
  applyOnGuardRevealAtResource,
  executeDeferredSiteAction,
} from './reducer-site.js';
import { autoResolve } from './chain-reducer.js';

/**
 * Resolve the top pending resolution for the action's actor by dispatching
 * to the kind-specific handler. The handler is responsible for dequeuing
 * the resolution it consumed (via {@link dequeueResolution}).
 *
 * Returns the resulting {@link ReducerResult}, or an `error` if the
 * incoming action does not satisfy the pending resolution. The caller in
 * `reducer.ts` falls through to the per-phase reducer when this function
 * returns `null` to indicate "no resolution applies — let the phase
 * reducer handle it."
 */
export function applyResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  switch (top.kind.type) {
    case 'corruption-check':
      return applyCorruptionCheckResolution(state, action, top);
    case 'order-effects':
      return applyOrderEffectsResolution(state, action, top);
    case 'on-guard-window':
      return applyOnGuardWindowResolution(state, action, top);
    case 'opponent-influence-defend':
      return applyOpponentInfluenceDefendResolution(state, action, top);
    case 'faction-influence-roll':
      return applyFactionInfluenceRollResolution(state, action, top);
  }
}

// ---- Per-kind handlers (filled in during migration) ----
//
// Each handler is initially a stub returning null so the per-phase
// reducer continues to handle the action through its legacy code path.
// The migration steps replace these stubs one at a time, deleting the
// per-phase short-circuits as each kind moves over.

/**
 * Unified corruption-check resolver. Handles transfer (with extra
 * remove-transferred-item-on-failure logic), wound, and Lure variants
 * via the discriminating `transferredItemId` and `reason` fields on
 * the resolution.
 *
 * Failure modes (CoE 2.II.5 / 2.III.x):
 *  - roll > CP: passed; no effect.
 *  - roll == CP or CP - 1: character + possessions discarded; followers
 *    promoted to general influence.
 *  - roll < CP - 1: character eliminated (removed from game), possessions
 *    discarded.
 *
 * For transfer checks, on failure we additionally remove the transferred
 * item from its new bearer (since the transfer didn't "stick"). The item
 * is included in the discard via `action.possessions`.
 */
function applyCorruptionCheckResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'corruption-check') {
    return { state, error: `Pending corruption check requires a corruption-check action, got '${action.type}'` };
  }
  if (top.kind.type !== 'corruption-check') return null;

  const { characterId, transferredItemId, reason } = top.kind;
  if (action.characterId !== characterId) {
    return { state, error: 'Wrong character for pending corruption check' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const char = player.characters[characterId as string];
  if (!char) {
    // Character was eliminated since the resolution was queued — drop it.
    logDetail(`Corruption check (${reason}): character ${characterId as string} no longer in play — dequeuing`);
    return { state: dequeueResolution(state, top.id) };
  }

  const charDefId = resolveInstanceId(state, characterId);
  const charDef = charDefId ? state.cardPool[charDefId as string] : undefined;
  const charName = charDef?.name ?? '?';
  const cp = action.corruptionPoints;
  const modifier = action.corruptionModifier;

  // Roll 2d6 + modifier
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + modifier;
  const modStr = modifier !== 0 ? ` ${modifier >= 0 ? '+' : ''}${modifier}` : '';
  logDetail(`Corruption check for ${charName} (${reason}): rolled ${roll.die1} + ${roll.die2}${modStr} = ${total} vs CP ${cp}`);

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Corruption: ${charName}`,
  };

  // Store the roll on the player
  const playersAfterRoll = clonePlayers(state);
  playersAfterRoll[playerIndex] = { ...playersAfterRoll[playerIndex], lastDiceRoll: roll };

  if (total > cp) {
    logDetail(`Corruption check passed (${total} > ${cp})`);
    const stateAfterDequeue = dequeueResolution({
      ...state,
      players: playersAfterRoll,
      rng,
      cheatRollTotal,
    }, top.id);
    return { state: stateAfterDequeue, effects: [rollEffect] };
  }

  // Failed — discard or eliminate the character
  const newCharacters = { ...player.characters };

  // For transfer checks, remove the transferred item from its new bearer
  // (the transfer didn't stick — the item is included in the discard via
  // action.possessions).
  if (transferredItemId) {
    for (const [cid, cData] of Object.entries(newCharacters)) {
      if (cid === characterId as string) continue;
      const itemIdx = cData.items.findIndex(i => i.instanceId === transferredItemId);
      if (itemIdx >= 0) {
        newCharacters[cid] = { ...cData, items: cData.items.filter(i => i.instanceId !== transferredItemId) };
        break;
      }
    }
  }

  if (total >= cp - 1) {
    // Roll == CP or CP - 1: character + possessions discarded (not followers)
    logDetail(`Corruption check FAILED (${total} within 1 of ${cp}) — discarding ${charName} and ${action.possessions.length} possession(s)`);

    delete newCharacters[characterId as string];

    const newCompanies = player.companies.map(c => ({
      ...c,
      characters: c.characters.filter(id => id !== characterId),
    }));

    // Followers lose their controller — promote to general influence
    for (const followerId of char.followers) {
      const follower = newCharacters[followerId as string];
      if (follower) {
        newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      }
    }

    const toDiscard: CardInstance[] = [
      { instanceId: characterId, definitionId: char.definitionId },
      ...action.possessions.map(id => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! })),
    ];
    const newDiscardPile = [...player.discardPile, ...toDiscard];

    playersAfterRoll[playerIndex] = {
      ...playersAfterRoll[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      discardPile: newDiscardPile,
    };
  } else {
    // Roll < CP - 1: character eliminated, possessions discarded
    logDetail(`Corruption check FAILED (${total} < ${cp - 1}) — eliminating ${charName}, discarding ${action.possessions.length} possession(s)`);

    delete newCharacters[characterId as string];

    const newCompanies = player.companies.map(c => ({
      ...c,
      characters: c.characters.filter(id => id !== characterId),
    }));

    for (const followerId of char.followers) {
      const follower = newCharacters[followerId as string];
      if (follower) {
        newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      }
    }

    const newEliminatedPile = [...player.eliminatedPile, { instanceId: characterId, definitionId: char.definitionId }];
    const newDiscardPile = [
      ...player.discardPile,
      ...action.possessions.map(id => ({ instanceId: id, definitionId: resolveInstanceId(state, id)! })),
    ];

    playersAfterRoll[playerIndex] = {
      ...playersAfterRoll[playerIndex],
      characters: newCharacters,
      companies: newCompanies,
      eliminatedPile: newEliminatedPile,
      discardPile: newDiscardPile,
    };
  }

  const cleanedState = cleanupEmptyCompanies({
    ...state,
    players: playersAfterRoll,
    rng,
    cheatRollTotal,
  });

  return {
    state: dequeueResolution(cleanedState, top.id),
    effects: [rollEffect],
  };
}

function applyOrderEffectsResolution(
  _state: GameState,
  _action: GameAction,
  _top: PendingResolution,
): ReducerResult | null {
  return null;
}

/**
 * Resolve a queued `on-guard-window` resolution.
 *
 * Two stages:
 *
 *  - **`reveal-window`** — actor is the hazard player. They may reveal
 *    one on-guard card, which dequeues this resolution, requeues a new
 *    `awaiting-pass` resolution for the *resource* player, and
 *    initiates a chain for the revealed card. Or they may pass, which
 *    dequeues the resolution and runs the deferred action immediately.
 *  - **`awaiting-pass`** — actor is the resource player. Their only
 *    legal action is `pass`, which dequeues the resolution and runs
 *    the deferred action.
 */
function applyOnGuardWindowResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (top.kind.type !== 'on-guard-window') return null;
  const { stage, deferredAction } = top.kind;

  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending on-guard-window' };
  }

  if (stage === 'reveal-window') {
    if (action.type === 'pass') {
      logDetail('On-guard window: hazard player passes — running deferred action');
      const dequeued = dequeueResolution(state, top.id);
      return executeDeferredSiteAction(dequeued, deferredAction);
    }
    if (action.type === 'reveal-on-guard') {
      logDetail('On-guard window: hazard player reveals — initiating chain, replacing resolution with awaiting-pass for active player');
      const revealResult = applyOnGuardRevealAtResource(state, action);
      if (revealResult.error) return revealResult;
      // Dequeue the reveal-window resolution and enqueue an awaiting-pass
      // resolution for the resource player. The chain takes priority
      // over the resolution; once it resolves, the active player's only
      // legal action is `pass`, which runs the deferred action.
      let newState = dequeueResolution(revealResult.state, top.id);
      const activePlayer = newState.activePlayer;
      if (activePlayer !== null) {
        newState = enqueueResolution(newState, {
          source: top.source,
          actor: activePlayer,
          scope: top.scope,
          kind: {
            type: 'on-guard-window',
            stage: 'awaiting-pass',
            deferredAction,
          },
        });
      }
      return { state: newState, effects: revealResult.effects };
    }
    return { state, error: `Expected pass or reveal-on-guard during on-guard window, got '${action.type}'` };
  }

  // stage === 'awaiting-pass'
  if (action.type !== 'pass') {
    return { state, error: `Expected pass to close on-guard window awaiting-pass, got '${action.type}'` };
  }
  logDetail('On-guard window: active player passes — running deferred action');
  const dequeued = dequeueResolution(state, top.id);
  return executeDeferredSiteAction(dequeued, deferredAction);
}

/**
 * Resolve a queued `opponent-influence-defend` resolution. The hazard
 * player rolls 2d6, the engine computes the final result, and the
 * consequences are applied (target discarded on success, revealed card
 * discarded on failure). The actual roll-and-resolve logic lives in
 * `reducer-site.ts:resolveOpponentInfluenceDefend` and is invoked here.
 */
function applyOpponentInfluenceDefendResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'opponent-influence-defend') {
    return { state, error: `Pending opponent-influence-defend requires that action, got '${action.type}'` };
  }
  if (top.kind.type !== 'opponent-influence-defend') return null;

  // Validate the actor is the resolution's actor (the hazard player).
  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending opponent-influence-defend' };
  }

  const result = resolveOpponentInfluenceDefend(state, top.kind.attempt);
  if (result.error) return result;

  return {
    state: dequeueResolution(result.state, top.id),
    effects: result.effects,
  };
}

/**
 * Resolve a queued `faction-influence-roll` resolution. The resource
 * player confirms the roll, the engine computes the dice result against
 * the faction's influence number (with all post-chain modifiers), and
 * the faction is placed in cardsInPlay (success) or discard (failure).
 *
 * The actual roll-and-resolve logic lives in
 * `reducer-site.ts:resolveInfluenceAttemptRoll`.
 */
function applyFactionInfluenceRollResolution(
  state: GameState,
  action: GameAction,
  top: PendingResolution,
): ReducerResult | null {
  if (action.type !== 'faction-influence-roll') {
    return { state, error: `Pending faction-influence-roll requires that action, got '${action.type}'` };
  }
  if (top.kind.type !== 'faction-influence-roll') return null;

  if (action.player !== top.actor) {
    return { state, error: 'Wrong player for pending faction-influence-roll' };
  }

  // Reconstruct the chain-entry shape that resolveInfluenceAttemptRoll expects
  const entry = {
    card: { instanceId: top.kind.factionInstanceId, definitionId: top.kind.factionDefinitionId },
    declaredBy: top.actor,
    payload: {
      type: 'influence-attempt' as const,
      influencingCharacterId: top.kind.influencingCharacterId,
    },
  };

  // Run the roll. The chain still holds the unresolved influence-attempt
  // entry — find it, mark it resolved, and re-enter chain auto-resolution
  // so the chain can complete normally (handles deferred passives, parent
  // chain restoration, etc.).
  const rollResult = resolveInfluenceAttemptRoll(state, entry);
  let postRoll = dequeueResolution(rollResult.state, top.id);

  if (postRoll.chain) {
    const chain = postRoll.chain;
    const targetId = top.kind.factionInstanceId;
    const newEntries = chain.entries.map(e =>
      e.payload.type === 'influence-attempt'
        && !e.resolved
        && e.card?.instanceId === targetId
        ? { ...e, resolved: true }
        : e,
    );
    postRoll = { ...postRoll, chain: { ...chain, entries: newEntries } };

    const continued = autoResolve(postRoll);
    return {
      state: continued.state,
      effects: [...rollResult.effects, ...(continued.effects ?? [])],
    };
  }

  return {
    state: postRoll,
    effects: rollResult.effects,
  };
}
