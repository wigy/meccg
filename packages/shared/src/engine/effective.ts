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
import type { CardDefinitionId, SiteType } from '../types/common.js';
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

/**
 * Returns the effective {@link SiteType} of a site definition after folding
 * in any active `site.type` `override` `attribute-modifier` constraint whose
 * `filter.site.definitionId` matches. Returns `printedType` when none applies.
 *
 * Site-type overrides are matched purely by their `site.definitionId` filter
 * (not by the constraint's entity target), mirroring the existing consumers in
 * `legal-actions/movement-hazard.ts` and `reducer-untap.ts`. This lets a
 * site-transforming card (e.g. Hold Rebuilt and Repaired, as-88) change the
 * type of every in-play copy of the bound site. The last matching override
 * wins.
 */
export function getEffectiveSiteType(
  state: GameState,
  siteDefinitionId: CardDefinitionId,
  printedType: SiteType,
): SiteType {
  let value: SiteType = printedType;
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'attribute-modifier') continue;
    if (c.kind.attribute !== 'site.type' || c.kind.op !== 'override') continue;
    const filterSiteDefId = (c.kind.filter as { 'site.definitionId'?: string } | undefined)?.['site.definitionId'];
    if (filterSiteDefId !== (siteDefinitionId as string)) continue;
    value = c.kind.value as SiteType;
  }
  return value;
}

/**
 * True when an active `auto-attack.detainment` `override` `attribute-modifier`
 * constraint (filter `site.definitionId`) matches the given site — i.e. a card
 * has decreed that every automatic-attack at that site is detainment
 * regardless of the defending alignment. Used by Hold Rebuilt and Repaired
 * (as-88: "all automatic-attacks become detainment").
 */
export function siteAutoAttacksForcedDetainment(
  state: GameState,
  siteDefinitionId: CardDefinitionId,
): boolean {
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'attribute-modifier') continue;
    if (c.kind.attribute !== 'auto-attack.detainment' || c.kind.op !== 'override') continue;
    const filterSiteDefId = (c.kind.filter as { 'site.definitionId'?: string } | undefined)?.['site.definitionId'];
    if (filterSiteDefId !== (siteDefinitionId as string)) continue;
    if (c.kind.value) return true;
  }
  return false;
}

function matchesEntity(a: ConstraintTarget, b: ConstraintTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'company' && b.kind === 'company') return a.companyId === b.companyId;
  if (a.kind === 'character' && b.kind === 'character') return a.characterId === b.characterId;
  if (a.kind === 'player' && b.kind === 'player') return a.playerId === b.playerId;
  return false;
}
