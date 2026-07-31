/**
 * @module apply-dispatcher
 *
 * Shared apply-effect dispatcher. Over time this module will replace
 * the six bespoke short-event resolution branches in `chain-reducer.ts`
 * with a single loop driven by each card's declared effects — see
 * `specs/2026-04-23-chain-effect-dispatch-plan.md`.
 *
 * Phases A–B have landed: {@link applyEffect} handles `move` (delegating
 * to {@link applyMove}), `cancel-attack`, and `strike-modifier`, and
 * returns the state unchanged for every other effect type. The chain
 * resolver's single dispatch loop is gated by
 * {@link shouldFireOnChainResolution}, which names exactly the effect
 * types that fire on chain resolution today; later phases broaden both
 * the dispatcher and the predicate one apply type at a time, porting the
 * chain's remaining bespoke branches (environment cancel, fetch-to-deck
 * enqueue, dice-check / call-of-home, permanent/long-event resolve).
 *
 * Invariant: `applyEffect` never mutates its input state. It either
 * returns a new state, or `{ state, needsInput: true }` when the effect
 * enqueues a pending resolution and the chain entry must stay
 * unresolved.
 */

import type { GameState, PlayerId, CardInstanceId } from '../index.js';
import { getPlayerIndex } from '../state-utils.js';
import type { CardEffect } from '../types/effects.js';
import type { MoveContext } from './reducer-move.js';
import { applyMove } from './reducer-move.js';
import { resolveCancelAttackEntry, resolveChainStrikeModifier } from './combat-cancel.js';
import { addConstraint } from './pending.js';
import { resolveInstanceId } from '../types/state.js';
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
  | { readonly state: GameState; readonly needsInput?: false; readonly effects?: readonly import('../index.js').GameEffect[] }
  | { readonly state: GameState; readonly needsInput: true; readonly effects?: readonly import('../index.js').GameEffect[] }
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
    // Capture the defending player/company before the cancel clears combat —
    // needed to target the deferred free-cancel grant (Darkness Wielded
    // ba-55) and the tap-on-strike-assignment constraint (Fifteen Birds in
    // Five Firtrees dm-129).
    const defendingPlayerId = state.combat?.defendingPlayerId;
    const defendingCompanyId = state.combat?.companyId;
    let next = resolveCancelAttackEntry(state);
    if (effect.alsoCancelLaterAttack && defendingPlayerId) {
      const sourceDefinitionId = resolveInstanceId(next, ctx.sourceCardId);
      if (sourceDefinitionId) {
        next = addConstraint(next, {
          source: ctx.sourceCardId,
          sourceDefinitionId,
          scope: { kind: 'turn' },
          target: { kind: 'player', playerId: defendingPlayerId },
          kind: {
            type: 'free-attack-cancel',
            restrictToBalrogCompany: !!effect.alsoCancelLaterAttackRestrictToBalrogCompany,
            ...(effect.alsoCancelLaterAttackSameCompanyOnly && defendingCompanyId
              ? { restrictToCompanyId: defendingCompanyId }
              : {}),
            ...(effect.alsoCancelLaterAttackRequireNonUnique ? { requireNonUniqueCreature: true } : {}),
          },
        });
        logDetail(`applyEffect: cancel-attack granted a deferred free cancellation this turn to ${defendingPlayerId as string} (source: ${sourceDefinitionId as string})`);
      }
    }
    if (effect.installsTapOnStrikeAssignment && defendingCompanyId) {
      const sourceDefinitionId = resolveInstanceId(next, ctx.sourceCardId);
      if (sourceDefinitionId) {
        next = addConstraint(next, {
          source: ctx.sourceCardId,
          sourceDefinitionId,
          scope: { kind: 'turn' },
          target: { kind: 'company', companyId: defendingCompanyId },
          kind: { type: 'tap-on-strike-assignment' },
        });
        logDetail(`applyEffect: cancel-attack installed tap-on-strike-assignment on company ${defendingCompanyId as string} for the rest of the turn (source: ${sourceDefinitionId as string})`);
      }
    }
    return { state: next };
  }
  if (effect.type === 'strike-modifier') {
    const mode = effect.dodge ? 'dodge' : effect.reroll ? 'reroll' : 'modify';
    logDetail(`applyEffect: strike-modifier dispatched (mode: ${mode})`);
    const result = resolveChainStrikeModifier(state, effect);
    if (result.error !== undefined) return { error: result.error };
    return { state: result.state, ...(result.effects ? { effects: result.effects } : {}) };
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
  const sourcePlayerIndex = getPlayerIndex(state, entry.declaredBy);
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
 * Whether `effect` should fire through the chain resolver's shared
 * dispatch loop for the given resolving entry.
 *
 * This is the single gating seam for chain-resolution effect dispatch:
 * the loop in `chain-reducer.ts`'s `resolveEntry` runs `applyEffect` for
 * exactly the effect types this predicate approves. It currently names
 * the two effect types already migrated onto the shared dispatcher —
 * `cancel-attack` (Concealment, Vanishment, Dark Quarrels, Many Turns and
 * Doublings) and `strike-modifier` (Dodge, Lucky Strike, Risky Blow).
 *
 * Each later migration phase broadens this predicate in lock-step with
 * `applyEffect`: e.g. `on-event` effects will fire only when their
 * `event` matches a chain-resolution trigger for the payload type
 * (`company-arrives-at-site` for moving short events, `self-enters-play`
 * for permanent/long events). `move` is intentionally NOT approved yet —
 * move effects are not dispatched through this loop today — and is added
 * when the move-dependent phases land.
 */
export function shouldFireOnChainResolution(
  effect: CardEffect,
  _entry: { readonly payload: { readonly type: string } },
): boolean {
  return effect.type === 'cancel-attack' || effect.type === 'strike-modifier';
}
