/**
 * @module engine/region-keying
 *
 * Helpers for `region-keying-boost` environment effects (Withered Lands,
 * td-85). A boost lets one region in a company's site path count as additional
 * regions of another type when checking whether a hazard creature can be keyed
 * to that company.
 *
 * The creature-keying matchers live in two places — `findCreatureKeyingMatches`
 * (legal-actions, for emitting playable creatures) and `checkCreatureKeying`
 * (reducer, for validating a play). Both consult these helpers so the boost is
 * honoured identically on the read and write paths. The underlying site path is
 * never mutated: instead `regionPathsWithBoosts` produces candidate paths and
 * the caller tests each.
 */

import type { GameState } from '../types/state.js';
import type { RegionType } from '../types/common.js';
import type { CardEffect, RegionKeyingBoost, RegionTypeRemap } from '../types/effects.js';
import { matchesCondition } from '../effects/condition-matcher.js';

export type { RegionKeyingBoost, RegionTypeRemap };

/**
 * Collect every region treatment offered by active `region-keying-boost`
 * constraints (e.g. Withered Lands). The constraints are global environment
 * effects, so all are returned regardless of which company is being keyed.
 */
export function collectRegionKeyingBoosts(state: GameState): RegionKeyingBoost[] {
  const boosts: RegionKeyingBoost[] = [];
  for (const c of state.activeConstraints) {
    if (c.kind.type === 'region-keying-boost') {
      boosts.push(...c.kind.boosts);
    }
  }
  return boosts;
}

/**
 * Build the set of candidate region-type paths a creature may be keyed against:
 * the base path plus, for each applicable boost, one variant where a single
 * region of the boost's `from` type is replaced by `count` regions of its
 * `asType`. A boost contributes a variant only when the path actually contains
 * a region of its `from` type. Boosts are never combined — each variant applies
 * exactly one boost (the card grants "one ... or one ... or one"), so the base
 * path is always included as the no-boost option.
 */
export function regionPathsWithBoosts(
  basePath: readonly RegionType[],
  boosts: readonly RegionKeyingBoost[],
): RegionType[][] {
  const paths: RegionType[][] = [[...basePath]];
  for (const b of boosts) {
    const idx = basePath.indexOf(b.from);
    if (idx === -1) continue;
    const variant = [...basePath];
    variant.splice(idx, 1);
    for (let i = 0; i < b.count; i++) variant.push(b.asType);
    paths.push(variant);
  }
  return paths;
}

/**
 * Collect every region-type substitution offered by active `region-type-remap`
 * effects (e.g. Fell Winter, le-111). Scans both players' `cardsInPlay` for the
 * effect and — for each whose optional `when` gate holds against the given
 * in-play name list (Fell Winter's remap requires Doors of Night in play) —
 * returns its `remap` entries. Because the gate is evaluated live, the remap
 * activates and deactivates as its gating card enters or leaves play.
 */
export function collectRegionTypeRemaps(
  state: GameState,
  inPlayNames: readonly string[],
): RegionTypeRemap[] {
  const remaps: RegionTypeRemap[] = [];
  const whenCtx = { inPlay: inPlayNames };
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = state.cardPool[card.definitionId] as
        { effects?: readonly CardEffect[] } | undefined;
      const effects = def?.effects;
      if (!effects) continue;
      for (const e of effects) {
        if (e.type !== 'region-type-remap') continue;
        if (e.when && !matchesCondition(e.when, whenCtx)) continue;
        remaps.push(...e.remap);
      }
    }
  }
  return remaps;
}

/**
 * Apply the collected region-type remaps to a traversed region-type path. Every
 * region is mapped from its **printed** type (the remaps are applied
 * simultaneously, never chained), so a table of `border→wilderness` and
 * `free→border` turns `[free, border]` into `[border, wilderness]` — not
 * `[border, wilderness]` via a cascade of `free→border→wilderness`. Returns the
 * path unchanged when there are no remaps.
 */
export function applyRegionTypeRemaps(
  path: readonly RegionType[],
  remaps: readonly RegionTypeRemap[],
): RegionType[] {
  if (remaps.length === 0) return [...path];
  return path.map(rt => {
    const entry = remaps.find(r => r.from === rt);
    return entry ? entry.to : rt;
  });
}

/**
 * One active `region-type-conversion` (Girdle of Radagast, wh-110): the set of
 * region **names** whose type is replaced by {@link to} for creature keying.
 */
export interface RegionTypeConversion {
  readonly regions: ReadonlySet<string>;
  readonly to: RegionType;
}

/**
 * The set of region names anchored by a site-bound `region-type-conversion`
 * card: the bound site's own `region`, plus (when `includeAdjacent`) every
 * region named in that region card's `adjacentRegions`. Returns an empty set
 * when the site or its region cannot be resolved.
 */
function anchoredRegionSet(
  state: GameState,
  siteDefId: string,
  includeAdjacent: boolean,
): Set<string> {
  const set = new Set<string>();
  const siteDef = state.cardPool[siteDefId as keyof typeof state.cardPool] as
    { region?: string } | undefined;
  const region = siteDef?.region;
  if (!region) return set;
  set.add(region);
  if (includeAdjacent) {
    for (const cardDef of Object.values(state.cardPool)) {
      const rc = cardDef as { cardType?: string; name?: string; adjacentRegions?: readonly string[] };
      if (rc.cardType === 'region' && rc.name === region) {
        for (const adj of rc.adjacentRegions ?? []) set.add(adj);
        break;
      }
    }
  }
  return set;
}

/**
 * Collect every persistent `region-type-conversion` in play (Girdle of
 * Radagast, wh-110). Scans both players' `cardsInPlay` for the effect on a card
 * bound to a site (`attachedToSite`), resolving each into the set of region
 * names it converts and the target type. Because the conversion is read live
 * from `cardsInPlay`, it activates and deactivates as the card enters or leaves
 * play.
 */
export function collectRegionTypeConversions(state: GameState): RegionTypeConversion[] {
  const out: RegionTypeConversion[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      if (card.pendingTriggerAttack) continue;
      const siteDefId = card.attachedToSite;
      if (!siteDefId) continue;
      const def = state.cardPool[card.definitionId] as
        { effects?: readonly CardEffect[] } | undefined;
      const effects = def?.effects;
      if (!effects) continue;
      for (const e of effects) {
        if (e.type !== 'region-type-conversion') continue;
        const regions = anchoredRegionSet(state, siteDefId as string, e.includeAdjacent ?? false);
        if (regions.size > 0) out.push({ regions, to: e.to });
      }
    }
  }
  return out;
}

/**
 * Replace the type of every traversed region whose **name** is targeted by an
 * active conversion (the last matching conversion wins). The type path and name
 * path are index-parallel (each declared region contributes one type and one
 * name together), so the replacement is applied per index. Returns the path
 * unchanged when there are no conversions.
 */
export function applyRegionTypeConversions(
  pathTypes: readonly RegionType[],
  pathNames: readonly string[],
  conversions: readonly RegionTypeConversion[],
): RegionType[] {
  if (conversions.length === 0) return [...pathTypes];
  return pathTypes.map((rt, i) => {
    const name = pathNames[i];
    if (name === undefined) return rt;
    let value = rt;
    for (const conv of conversions) {
      if (conv.regions.has(name)) value = conv.to;
    }
    return value;
  });
}
