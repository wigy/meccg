/**
 * @module apply-dispatcher
 *
 * Shared apply-effect dispatcher. Over time this module will replace
 * the six bespoke short-event resolution branches in `chain-reducer.ts`
 * with a single loop driven by each card's declared effects — see
 * `specs/2026-04-23-chain-effect-dispatch-plan.md`.
 *
 * Phase A (initial landing) defines the types and a minimal dispatcher
 * that handles `move` effects (delegating to {@link applyMove}) and
 * ignores everything else. Later phases port the chain's bespoke
 * branches (`cancel-attack`, environment cancel, fetch-to-deck enqueue,
 * muster-roll / call-of-home, permanent/long-event resolve) onto this
 * dispatcher.
 *
 * Invariant: `applyEffect` never mutates its input state. It either
 * returns a new state, or `{ state, needsInput: true }` when the effect
 * enqueues a pending resolution and the chain entry must stay
 * unresolved.
 */

import type { GameState, PlayerId, CardInstanceId } from '../index.js';
import type { CardEffect } from '../types/effects.js';
import type { MoveContext } from './reducer-move.js';
import { applyMove } from './reducer-move.js';
import { resolveCancelAttackEntry } from './reducer-combat.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Runtime context passed to {@link applyEffect} from a chain-resolution
 * call site. Extends {@link MoveContext} with chain-specific fields
 * (the player who declared the entry, the entry's target references).
 *
 * Grant-action callers build the subset they need and pass it through
 * as well — the shared dispatcher treats them uniformly.
 */
export interface ChainApplyContext extends MoveContext {
  /** The player who declared the chain entry (or activated the grant-action). */
  readonly declaredBy: PlayerId;
  /** Chain entry's target character, if any (e.g. target of Wizard Uncloaked). */
  readonly targetCharacterId?: CardInstanceId;
  /** Chain entry's target instance (e.g. environment being cancelled). */
  readonly targetInstanceId?: CardInstanceId;
  /** Faction-targeting short events (e.g. Muster Disperses). */
  readonly targetFactionInstanceId?: CardInstanceId;
}

/** Result of dispatching one apply through the shared dispatcher. */
export type ApplyEffectResult =
  | { readonly state: GameState; readonly needsInput?: false }
  | { readonly state: GameState; readonly needsInput: true }
  | { readonly error: string };

/**
 * Dispatch a card `effect` through the shared apply path.
 *
 * Phase A supports the `move` effect only. Later phases extend the
 * dispatcher with `cancel-attack`, `cancel-chain-entry`, `add-constraint`,
 * `enqueue-roll`, and the event-resolution destinations introduced by
 * the chain-effect dispatch plan.
 *
 * Effects not yet handled by the dispatcher return the input state
 * unchanged. The chain's bespoke branches continue to handle them
 * until they migrate in later phases.
 */
export function applyEffect(
  state: GameState,
  effect: CardEffect,
  ctx: ChainApplyContext,
): ApplyEffectResult {
  if (effect.type === 'move') {
    const r = applyMove(state, effect, ctx);
    if ('error' in r) return { error: r.error };
    return { state: r.state };
  }
  if (effect.type === 'cancel-attack') {
    // Combat cancel fired from chain resolution (e.g. Concealment,
    // Vanishment, Dark Quarrels, Many Turns and Doublings).
    logDetail(`applyEffect: cancel-attack dispatched for ${ctx.sourceCardId as string}`);
    return { state: resolveCancelAttackEntry(state) };
  }
  // Other effect types are still handled by the bespoke branches in
  // chain-reducer.ts / reducer-events.ts. Phases C–G migrate them
  // onto this dispatcher one at a time.
  return { state };
}

/**
 * Construct a {@link ChainApplyContext} from a chain entry. Used by
 * Phases B+ where the chain resolver iterates a card's effects through
 * {@link applyEffect}.
 */
export function buildChainApplyContext(
  state: GameState,
  entry: {
    readonly declaredBy: PlayerId;
    readonly card: { readonly instanceId: CardInstanceId } | null;
    readonly payload: {
      readonly type: string;
      readonly targetCharacterId?: CardInstanceId;
      readonly targetInstanceId?: CardInstanceId;
      readonly targetFactionInstanceId?: CardInstanceId;
    };
  },
): ChainApplyContext {
  const sourcePlayerIndex = state.players[0].id === entry.declaredBy ? 0 : 1;
  const sourceCardId = entry.card?.instanceId ?? ('' as CardInstanceId);
  const ctx: ChainApplyContext = {
    declaredBy: entry.declaredBy,
    sourceCardId,
    sourcePlayerIndex,
    ...(entry.payload.targetCharacterId ? { targetCharacterId: entry.payload.targetCharacterId } : {}),
    ...(entry.payload.targetInstanceId ? { targetInstanceId: entry.payload.targetInstanceId } : {}),
    ...(entry.payload.targetFactionInstanceId ? { targetFactionInstanceId: entry.payload.targetFactionInstanceId } : {}),
  };
  return ctx;
}

/**
 * Whether `effect` should fire on chain resolution for the given
 * resolving entry's payload type.
 *
 * Top-level effects (not wrapped in `on-event`) fire for any resolving
 * entry. `on-event` effects fire only when their `event` matches a
 * chain-resolution trigger for the payload type (e.g.
 * `company-arrives-at-site` fires for short events in M/H phase;
 * `self-enters-play` fires for permanent events).
 *
 * Phase A implements a conservative default: only top-level `move`
 * effects fire. Later phases broaden the predicate as they migrate
 * more on-event subtypes onto the shared dispatcher.
 */
export function shouldFireOnChainResolution(
  effect: CardEffect,
  _entry: { readonly payload: { readonly type: string } },
): boolean {
  if (effect.type === 'move') {
    logDetail(`shouldFireOnChainResolution: move effect approved`);
    return true;
  }
  return false;
}
