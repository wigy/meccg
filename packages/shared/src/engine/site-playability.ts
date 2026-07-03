/**
 * @module engine/site-playability
 *
 * Shared predicates for "is this resource playable at this site by the
 * site's own rules?" — the question the site phase answers for hand cards
 * and that dynamic fetch filters (Strider ba-1's "any one item, ally, or
 * faction playable at his current site") answer for pile cards.
 *
 * Two rule sources are covered:
 *
 * - **Items** are playable where the site's printed `playableResources`
 *   list includes the item's subtype (CoE 2.V.2).
 * - **Allies and factions** name the sites they are playable at via their
 *   `playableAt` entries (CoE 2.V.3, 7.x) — site name, site type, or
 *   region entries, optionally gated by a `when` condition.
 *
 * Deliberately NOT covered here: tap-state of the site, company presence,
 * uniqueness, influence-check viability — those are play-time concerns,
 * not site-rule concerns. Callers needing the effective (overridden) site
 * type pass it via `effectiveSiteType`; the default is the printed type.
 */

import type { CardDefinition, SiteCard } from '../index.js';
import type { PlayableAtEntry } from '../types/cards-resources.js';
import type { SiteType } from '../types/common.js';
import { isAllyCard, isFactionCard, isItemCard } from '../types/cards.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { normalizeCreatureRace } from './effects/index.js';

/**
 * True when `entry` (a faction/ally `playableAt` specifier) matches the
 * given site. Region entries match any non-haven site in the named region;
 * site entries match by name; site-type entries match the (effective) site
 * type. An optional `when` condition is evaluated against a context
 * exposing the site's name, type, region, and automatic-attack races.
 */
export function siteMatchesEntry(
  siteDef: SiteCard,
  entry: PlayableAtEntry,
  effectiveSiteType: SiteType = siteDef.siteType,
): boolean {
  if ('region' in entry) {
    // Region entries match any non-haven site in the named region.
    if (effectiveSiteType === 'haven') return false;
    return siteDef.region === entry.region;
  }
  const baseMatches = 'site' in entry
    ? siteDef.name === entry.site
    : effectiveSiteType === entry.siteType;
  if (!baseMatches) return false;
  if (!entry.when) return true;
  const autoAttackRaces = siteDef.automaticAttacks.map(a => normalizeCreatureRace(a.creatureType));
  const ctx: Record<string, unknown> = {
    site: {
      name: siteDef.name,
      siteType: effectiveSiteType,
      region: siteDef.region,
      autoAttack: { race: autoAttackRaces },
    },
  };
  return matchesCondition(entry.when, ctx);
}

/**
 * True when `def` (an item, ally, or faction definition) is playable at
 * `siteDef` by the site's own rules. Non-resource card types return false —
 * this predicate only answers the item/ally/faction question.
 */
export function resourcePlayableAtSite(
  def: CardDefinition,
  siteDef: SiteCard,
  effectiveSiteType: SiteType = siteDef.siteType,
): boolean {
  if (isItemCard(def)) {
    return (siteDef.playableResources as readonly string[]).includes(def.subtype);
  }
  if (isAllyCard(def) || isFactionCard(def)) {
    return def.playableAt.some(entry => siteMatchesEntry(siteDef, entry, effectiveSiteType));
  }
  return false;
}
