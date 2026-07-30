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

import type { CardDefinition, GameState } from '../index.js';
import type { ActiveConstraint, AttributePath, ConstraintId } from '../types/pending.js';
import type { CardDefinitionId, CardInstanceId, RegionType, SiteType } from '../types/common.js';
import type { SiteInstanceTransformEffect } from '../types/effects.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { isSiteCard } from '../types/cards.js';
import { hasSiteFlag, getCardEffects, defById, siteRegionTypeOf, isSiteProtectedForPlayer, isWizardhavenConversionFor } from './reducer-utils.js';

/**
 * The transform decision for a specific in-play site instance produced by a
 * {@link SiteInstanceTransformEffect} (Roots of the Earth, ba-74).
 *
 * `role: 'associated'` — the queried instance is the controller's own current
 * site (the copy the carrying card is attached to); `role: 'other'` — any other
 * in-play copy of the same site definition.
 */
export interface SiteInstanceTransform {
  readonly role: 'associated' | 'other';
  readonly effect: SiteInstanceTransformEffect;
}

/**
 * Resolves the {@link SiteInstanceTransformEffect} (if any) that applies to a
 * given site *instance*. Scans both players' `cardsInPlay` for a kept
 * (`!pendingTriggerAttack`) card bound to `siteDefinitionId` (`attachedToSite`)
 * carrying a `site-instance-transform` effect. The queried instance is the
 * "associated" copy iff it is the current site of one of the carrying card's
 * controller's companies; otherwise it is an "other version".
 *
 * Returns `undefined` when no such card is in play **or** when no instance id is
 * supplied — an instance is required to tell the associated copy apart from the
 * other versions, so definition-only callers see no transform (and existing
 * behaviour is preserved).
 */
export function resolveSiteInstanceTransform(
  state: GameState,
  siteDefinitionId: CardDefinitionId,
  siteInstanceId: CardInstanceId | undefined,
): SiteInstanceTransform | undefined {
  if (siteInstanceId === undefined) return undefined;
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      if (card.pendingTriggerAttack) continue;
      if (card.attachedToSite !== siteDefinitionId) continue;
      const effect = getCardEffects(defById(state, card.definitionId)).find(
        (e): e is SiteInstanceTransformEffect => e.type === 'site-instance-transform',
      );
      if (!effect) continue;
      const isAssociated = player.companies.some(
        co => co.currentSite?.instanceId === siteInstanceId,
      );
      return { role: isAssociated ? 'associated' : 'other', effect };
    }
  }
  return undefined;
}

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
    // A `persistent` modifier keeps applying to every automatic-attack the
    // company faces at the site (Come By Night Upon Them le-176) — do not report
    // it as consumed, so the reducer leaves it in place until its scope sweeps
    // it. Ordinary one-shot boosts (Choking Shadows) are consumed after the
    // first attack.
    if (!c.kind.persistent) consumedIds.push(c.id);
  }
  return { value, consumedIds };
}

/**
 * True when a site-scoped constraint filter selects the given site.
 *
 * Two filter shapes are supported, and every reader of a site-scoped
 * `attribute-modifier` constraint routes through this helper so they can never
 * disagree:
 *
 * - `{ 'site.definitionId': … }` — the single site *definition* the card was
 *   played on (Hold Rebuilt and Repaired as-88, Hidden Haven wh-75, …). This
 *   still covers every in-play copy of that definition.
 * - `{ 'site.name': … }` — **all versions** of the site, i.e. the hero, minion,
 *   Fallen-wizard and Balrog printings of the same named location, which are
 *   distinct definitions sharing one name. Emitted by an `allVersions`
 *   add-constraint (Nature's Revenge wh-27: "All versions of the site become
 *   Ruins & Lairs"), mirroring the name matching Long Grievous Siege (ba-40)
 *   already uses for its site-bound automatic-attack.
 * - `{ 'site.printedType': … }` — **every site of one printed type**, bound to
 *   no definition at all. Emitted by a `printedSiteType` add-constraint
 *   (Witch-king of Angmar tw-113: "causes all Shadow-holds [{S}] to become
 *   Dark-holds [{D}]"). Callers that hold only a definition id must pass the
 *   site's printed type for this shape to match; those that cannot (they never
 *   see a class-wide retype) simply omit it.
 */
export function siteConstraintFilterMatches(
  filter: unknown,
  siteDefinitionId: CardDefinitionId | undefined,
  siteName: string | undefined,
  printedType?: SiteType,
): boolean {
  const f = filter as { 'site.definitionId'?: string; 'site.name'?: string; 'site.printedType'?: string } | undefined;
  if (!f) return false;
  if (f['site.definitionId'] !== undefined) {
    return f['site.definitionId'] === (siteDefinitionId as string | undefined);
  }
  if (f['site.name'] !== undefined) {
    return siteName !== undefined && f['site.name'] === siteName;
  }
  if (f['site.printedType'] !== undefined) {
    return printedType !== undefined && f['site.printedType'] === (printedType as string);
  }
  return false;
}

/**
 * The printed name of a site definition, for {@link siteConstraintFilterMatches}
 * callers that only hold a definition id.
 */
export function siteNameOf(state: GameState, siteDefinitionId: CardDefinitionId | undefined): string | undefined {
  if (siteDefinitionId === undefined) return undefined;
  return (state.cardPool[siteDefinitionId] as { name?: string } | undefined)?.name;
}

/**
 * Returns the effective {@link SiteType} of a site definition after folding
 * in any active `site.type` `override` `attribute-modifier` constraint whose
 * filter matches ({@link siteConstraintFilterMatches}). Returns `printedType`
 * when none applies.
 *
 * Site-type overrides are matched purely by their filter (not by the
 * constraint's entity target), mirroring the existing consumers in
 * `legal-actions/movement-hazard.ts` and `reducer-untap.ts`. This lets a
 * site-transforming card (e.g. Hold Rebuilt and Repaired, as-88) change the
 * type of every in-play copy of the bound site — or, for a name-scoped
 * override, of every printed version of it, or, for a printed-type-scoped
 * override, every site of one printed type at once (Witch-king of Angmar
 * tw-113). The last matching override wins.
 *
 * `excludeCharacterPlayOverrides`: when true, skips any override flagged
 * `excludesCharacterPlay` (The White Tree tw-348: a Haven "for the purposes
 * of healing and playing hazards" only). Pass this from callers that decide
 * whether a character may be played/recruited at the site; every other
 * consumer (hazard keying, movement, item/faction/ally playability, healing)
 * should omit it so those overrides still apply in full.
 */
export function getEffectiveSiteType(
  state: GameState,
  siteDefinitionId: CardDefinitionId,
  printedType: SiteType,
  siteInstanceId?: CardInstanceId,
  excludeCharacterPlayOverrides = false,
): SiteType {
  // Roots of the Earth (ba-74): a `site-instance-transform` retypes a specific
  // Under-deeps instance and every other version differently. This is the
  // sanctioned exception to the MEAS §6(d) short-circuit below, so resolve it
  // first and return immediately, bypassing the Under-deeps immutability guard.
  const transform = resolveSiteInstanceTransform(state, siteDefinitionId, siteInstanceId);
  if (transform) {
    return (transform.role === 'associated'
      ? transform.effect.associated.siteType
      : transform.effect.others.siteType);
  }

  // MEAS §6(d): an environment card that changes a site's type (Choking
  // Shadows, Quiet Lands, …) cannot change the type of an Under-deeps site.
  // Short-circuit before folding any override constraint so every consumer
  // (hazard keying, item playability, untap) sees the unchanged printed type.
  const siteDef = state.cardPool[siteDefinitionId] as { keywords?: readonly string[] } | undefined;
  if (siteDef?.keywords?.includes('under-deeps')) {
    return printedType;
  }

  let value: SiteType = printedType;
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'attribute-modifier') continue;
    if (c.kind.attribute !== 'site.type' || c.kind.op !== 'override') continue;
    // Houses of Healing (td-125): a `healingOnly` override promotes the site to
    // a Haven for the untap-phase healing sweep only (see `reducer-untap.ts`).
    // The general effective type is unchanged, so hazard keying, movement,
    // bring-into-play, and item/faction/ally playability all see the printed type.
    if (c.kind.healingOnly) continue;
    if (excludeCharacterPlayOverrides && c.kind.excludesCharacterPlay) continue;
    if (!siteConstraintFilterMatches(c.kind.filter, siteDefinitionId, siteNameOf(state, siteDefinitionId), printedType)) continue;
    value = c.kind.value as SiteType;
  }
  return value;
}

/**
 * Returns the effective {@link RegionType} of a named region after folding in
 * any active `region.type` `override` `attribute-modifier` constraint whose
 * `filter.region.name` matches. Returns `printedType` when none applies.
 *
 * Rule 5.09: a region-type override created against a specific region name
 * (e.g. Deeper Shadow, le-179, via its `'destination'` token — resolved to
 * a concrete name by `constraint-kind.ts` at creation time) is scoped to
 * `company-mh-phase`/`turn`, so it is only ever visible while that
 * constraint is active — matching the rule's "reflected in that same site
 * path... but nowhere else" behavior for the turn it's in effect. The last
 * matching override wins.
 */
export function getEffectiveRegionType(
  state: GameState,
  regionName: string,
  printedType: RegionType,
): RegionType {
  let value: RegionType = printedType;
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'attribute-modifier') continue;
    if (c.kind.attribute !== 'region.type' || c.kind.op !== 'override') continue;
    const filterRegionName = (c.kind.filter as { 'region.name'?: string } | undefined)?.['region.name'];
    if (filterRegionName !== regionName) continue;
    value = c.kind.value as RegionType;
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

/**
 * True when an active `cancel-attacks-at-site` constraint matches the given
 * site — i.e. Hidden Haven (wh-75) has decreed that every attack against a
 * company occupying that site is canceled. Consulted at each attack-initiation
 * point in `reducer-site.ts` (on-guard creature attacks and declared agent
 * attacks; the site's own automatic-attacks are separately removed by the
 * accompanying `skip-automatic-attacks` constraint).
 */
export function siteAttacksCanceled(
  state: GameState,
  siteDefinitionId: CardDefinitionId,
): boolean {
  return hasSiteFlag(state.activeConstraints, 'cancel-attacks-at-site', siteDefinitionId);
}

/**
 * Build the DSL condition context a `play-target` `target: "site"` filter is
 * matched against: the site definition itself (so any printed field — `name`,
 * `siteType`, `playableResources`, `keywords`, `lairOf`, … — is addressable)
 * plus the four derived facts that do not live on the card:
 *
 * - `regionType` — the type of the region the site sits in (it lives on a
 *   separate region card). "in a Wilderness [{w}]" (Hidden Haven wh-75,
 *   Nature's Revenge wh-27).
 * - `effectiveSiteType` — the type after any `site-type-override` /
 *   wizardhaven-conversion, so "your Wizardhaven [{H}]" matches a dynamically
 *   converted haven (Guarded Haven wh-74).
 * - `isWizardhaven` — the site is a Fallen-wizard haven for *some* player,
 *   either printed (`fallen-wizard` alignment haven) or converted into one by
 *   a `wizardhaven-conversion` (Hidden Haven wh-75, Mischief in a Mean Way
 *   wh-77). Distinguishes a Wizardhaven from a METW Haven or MELE Darkhaven.
 * - `isProtected` — the site is a protected site for some player, whether via
 *   a `site-protected` constraint (The Fortress of Isen wh-68, Fortress of the
 *   Towers wh-69, Guarded Haven wh-74) or inherently (Rhosgobel wh-57). Backs
 *   "on a **non-protected** Wizardhaven" (Nature's Revenge wh-27).
 *
 * Shared by every site play-target matcher — the site phase
 * (`legal-actions/site.ts`), the organization phase
 * (`legal-actions/organization-events.ts`) and the movement/hazard phase
 * (`legal-actions/movement-hazard.ts`) — so all three evaluate identical
 * predicates. Callers may spread extra keys on top for context only they can
 * compute (e.g. `isUnderDeepsSurface`).
 */
export function buildSiteFilterContext(
  state: GameState,
  siteDef: CardDefinition,
  siteInstanceId?: CardInstanceId,
): Record<string, unknown> {
  const base = { ...(siteDef as unknown as Record<string, unknown>) };
  if (!isSiteCard(siteDef)) return base;
  const siteDefId = siteDef.id;
  const isWizardhaven = (siteDef.siteType === 'haven' && siteDef.alignment === 'fallen-wizard')
    || state.players.some(p => isWizardhavenConversionFor(state, siteDefId, p.id));
  const isProtected = state.players.some(p => isSiteProtectedForPlayer(state, siteDefId, p.id));
  return {
    ...base,
    regionType: siteRegionTypeOf(state, siteDef),
    effectiveSiteType: getEffectiveSiteType(state, siteDefId, siteDef.siteType, siteInstanceId),
    isWizardhaven,
    isProtected,
  };
}

function matchesEntity(a: ConstraintTarget, b: ConstraintTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'company' && b.kind === 'company') return a.companyId === b.companyId;
  if (a.kind === 'character' && b.kind === 'character') return a.characterId === b.characterId;
  if (a.kind === 'player' && b.kind === 'player') return a.playerId === b.playerId;
  return false;
}
