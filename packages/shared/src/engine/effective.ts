/**
 * @module engine/effective
 *
 * Resolve the effective value of an entity attribute by folding in any
 * active `attribute-modifier` constraints that match the entity, the
 * named attribute, and an optional per-read context.
 *
 * This is the single consumer path for the generic attribute-modifier
 * primitive (see {@link ActiveConstraint} in `types/pending.ts`). Before
 * this helper, every attribute override lived in its own constraint
 * kind with bespoke filter logic at each read site. Now every read
 * routes through `resolveEffective`, and the constraint kind is one.
 */

import type { GameState } from '../index.js';
import type { ActiveConstraint, AttributePath, ConstraintId } from '../types/pending.js';
import { matchesCondition } from '../effects/condition-matcher.js';

type ConstraintTarget = ActiveConstraint['target'];

/**
 * Apply all `attribute-modifier` constraints matching `entity`,
 * `attribute`, and `context` on top of `baseValue`.
 *
 * Returns the effective value plus the IDs of the constraints that
 * contributed — callers with consume-on-use semantics (e.g.
 * `auto-attack.prowess`) remove those constraints after applying.
 *
 * Multiple `add` modifiers sum. Multiple `override` modifiers produce
 * the first match in insertion order; mixing `add` with a later
 * `override` replaces the sum with the overriding value.
 */
export function resolveEffective<T extends number | string>(
  state: GameState,
  entity: ConstraintTarget,
  attribute: AttributePath,
  baseValue: T,
  context?: Record<string, unknown>,
): { value: T; consumedIds: readonly ConstraintId[] } {
  const consumedIds: ConstraintId[] = [];
  let value: T = baseValue;
  for (const c of state.activeConstraints) {
    if (!matchesEntity(c.target, entity)) continue;
    if (c.kind.type !== 'attribute-modifier') continue;
    if (c.kind.attribute !== attribute) continue;
    if (c.kind.filter && (!context || !matchesCondition(c.kind.filter, context))) continue;
    if (c.kind.op === 'add') {
      if (typeof value !== 'number' || typeof c.kind.value !== 'number') continue;
      value = (value + c.kind.value) as T;
    } else {
      value = c.kind.value as T;
    }
    consumedIds.push(c.id);
  }
  return { value, consumedIds };
}

function matchesEntity(a: ConstraintTarget, b: ConstraintTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'company' && b.kind === 'company') return a.companyId === b.companyId;
  if (a.kind === 'character' && b.kind === 'character') return a.characterId === b.characterId;
  if (a.kind === 'player' && b.kind === 'player') return a.playerId === b.playerId;
  return false;
}
