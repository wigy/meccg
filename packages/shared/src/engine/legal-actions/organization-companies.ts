/**
 * @module legal-actions/organization-companies
 *
 * Company management actions during the organization phase: movement planning,
 * influence reassignment, item transfers between characters, company splitting,
 * character movement between companies, and company merging.
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardInstanceId,
  GameAction,
  SiteCard,
  PlayerState,
  Company,
  CardEffect,
  CompanyId,
  CardDefinition,
  CardDefinitionId,
  Alignment as AlignmentType,
} from '../../index.js';
import { hasNoDirectInfluenceRestriction, hasFollowerGrantPermission } from '../../effects/play-flags.js';
import { buildMovementMap, getReachableSites } from '../../movement-map.js';
import { BASE_MAX_REGION_DISTANCE } from '../../rules/definitions/movement.js';
import { isCharacterCard, isItemCard, isSiteCard, isAvatarCharacter } from '../../types/cards.js';
import { SiteType, Race, RegionType, Alignment } from '../../types/common.js';
import { resolveInstanceId } from '../../types/state.js';
import { logDetail } from './log.js';
import { playerById, defById, getCardEffects, companyEffectiveSizeExemptingLeaders, companyHasImmobileCharacter, isHavenForPlayer, generalInfluenceControlLimit, isSiteProtectedForPlayer, inPlayNamesForPlayerDeep, siteDeniesCompanyMove, fwSiteVersionForbidden } from '../reducer-utils.js';
import { siteHasOpponentCompany } from '../evil-hour.js';
import { resolveDef } from '../effects/index.js';
import { applyRegionMovementReduction } from '../recompute-derived.js';
import { companyMovementRestrictions, companyMovementTax, isMovementTaxSatisfied } from '../effects/company-restrictions.js';
import { CardStatus } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import { viableWithRegress } from '../reverse-actions.js';
import { isBalrogAvatarDef, companyContainsBalrogAvatar, totalMarshallingPoints } from '../../state-utils.js';
import { availableDI } from './organization.js';
import { controlCostOf, directInfluenceControlAllowed } from '../control-cost.js';

/**
 * Group a player's companies by the instance ID of the site they currently
 * occupy. Companies with no current site are omitted. Used to find companies
 * (and their characters) that share a site for merges and inter-company moves.
 */
function groupCompaniesBySite(player: PlayerState): Map<string, PlayerState['companies'][number][]> {
  const map = new Map<string, PlayerState['companies'][number][]>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteKey = company.currentSite.instanceId as string;
    const existing = map.get(siteKey) ?? [];
    existing.push(company);
    map.set(siteKey, existing);
  }
  return map;
}

/**
 * Look up a site card definition by site name, scanning the card pool.
 * Returns undefined if no matching site is found.
 */
function findSiteByName(state: GameState, name: string): SiteCard | undefined {
  for (const def of Object.values(state.cardPool)) {
    if (isSiteCard(def) && def.name === name) return def;
  }
  return undefined;
}

/**
 * Resolve a site name against one site card's `adjacentSites` map.
 *
 * Handles wildcard keys of the form `"*region:<RegionName>"`: if a key
 * starts with `*region:`, the target site's region is looked up and
 * compared to `<RegionName>`. Returns the required roll, or `undefined`
 * if the target is not listed as adjacent on the given site card.
 */
export function resolveAdjacency(state: GameState, site: SiteCard, targetName: string): number | undefined {
  const adj = site.adjacentSites;
  if (!adj) return undefined;

  // Direct name match
  if (adj[targetName] !== undefined) return adj[targetName];

  // Wildcard: "*region:<regionName>"
  for (const [key, roll] of Object.entries(adj)) {
    if (!key.startsWith('*region:')) continue;
    const regionName = key.slice('*region:'.length);
    const targetCard = findSiteByName(state, targetName);
    if (targetCard?.region === regionName) return roll;
  }
  return undefined;
}

/** Printed site types that Caverns Unchoked (ba-51) may bridge to. */
const CAVERNS_UNCHOKED_DEFAULT_SITE_TYPES: readonly SiteType[] = [
  SiteType.ShadowHold,
  SiteType.RuinsAndLairs,
  SiteType.BorderHold,
];

/**
 * True when `player` owns the site definition `siteDefId` — it sits in their
 * location deck or is one of their companies' current sites. Backs the "each
 * other site (of yours)" clause of Caverns Unchoked (ba-51).
 */
function playerOwnsSiteDef(player: PlayerState, siteDefId: CardDefinitionId): boolean {
  if (player.siteDeck.some(s => s.definitionId === siteDefId)) return true;
  return player.companies.some(
    c => c.currentSite?.definitionId === siteDefId || c.destinationSite?.definitionId === siteDefId,
  );
}

/**
 * Dynamic Under-deeps adjacency granted by Caverns Unchoked (ba-51). While the
 * card is in `forPlayer`'s `cardsInPlay` bound to an Under-deeps site U
 * (`attachedToSite`), each *other* site of theirs that is normally a Shadow-hold
 * / Ruins & Lairs / Border-hold and lies in U's region is adjacent to U at a
 * required roll of 0 (an Under-deeps site and its surface site always share a
 * region, so U's own `region` names the surface region).
 *
 * Returns 0 when one of `siteA`/`siteB` is such a bound Under-deeps site and the
 * other is a qualifying same-region site of `forPlayer`; otherwise `undefined`.
 * `forPlayer` is required — only the card owner's companies benefit ("of
 * yours"), so player-agnostic callers (e.g. hazard-creature keying) pass
 * `undefined` and see no dynamic adjacency.
 */
export function cavernsUnchokedAdjacencyRoll(
  state: GameState,
  siteA: SiteCard,
  siteB: SiteCard,
  forPlayer: PlayerId | undefined,
): number | undefined {
  if (!forPlayer) return undefined;
  const player = playerById(state, forPlayer);
  if (!player) return undefined;

  for (const card of player.cardsInPlay) {
    if (card.attachedToSite === undefined) continue;
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const effect = getCardEffects(def).find(
      (e): e is import('../../index.js').SurfaceRegionAdjacencyEffect => e.type === 'surface-region-adjacency',
    );
    if (!effect) continue;

    const udDefId = card.attachedToSite;
    const udDef = defById(state, udDefId);
    if (!udDef || !isSiteCard(udDef)) continue;

    // Identify which side is the bound Under-deeps site and which is the "other"
    // same-region site X.
    let other: SiteCard;
    if (siteA.id === udDefId) other = siteB;
    else if (siteB.id === udDefId) other = siteA;
    else continue;
    if (other.id === udDefId) continue; // the UD site paired with itself — no adjacency

    if (other.region !== udDef.region) continue;
    const siteTypes = effect.siteTypes.length > 0 ? effect.siteTypes : CAVERNS_UNCHOKED_DEFAULT_SITE_TYPES;
    if (!siteTypes.includes(other.siteType)) continue;
    if (!playerOwnsSiteDef(player, other.id)) continue;

    logDetail(`Caverns Unchoked: ${udDef.name} ↔ ${other.name} adjacent (roll 0) for ${forPlayer as string}`);
    return 0;
  }
  return undefined;
}

/**
 * Surface-site roll reduction granted by Breach the Hold (ba-50). While the
 * card is in `forPlayer`'s `cardsInPlay` bound to an Under-deeps site U
 * (`attachedToSite`) via a `surface-site-roll-zero` effect, the Under-deeps
 * movement roll required for one of `forPlayer`'s companies to ascend from U to
 * U's **surface site** — the non-Under-deeps site listed in U's `adjacentSites`
 * — is reduced to 0.
 *
 * Returns 0 when `origin` is the bound Under-deeps site U and `dest` is a
 * surface (non-Under-deeps) site adjacent to U; otherwise `undefined`.
 * `forPlayer` is required — only the card owner's companies benefit, so
 * player-agnostic callers pass `undefined` and see no reduction.
 */
export function breachTheHoldSurfaceRoll(
  state: GameState,
  origin: SiteCard,
  dest: SiteCard,
  forPlayer: PlayerId | undefined,
): number | undefined {
  if (!forPlayer) return undefined;
  const player = playerById(state, forPlayer);
  if (!player) return undefined;
  // The surface site is never itself an Under-deeps site.
  if (dest.keywords?.includes('under-deeps')) return undefined;

  for (const card of player.cardsInPlay) {
    if (card.attachedToSite === undefined) continue;
    const def = defById(state, card.definitionId);
    if (!def) continue;
    if (!getCardEffects(def).some(e => e.type === 'surface-site-roll-zero')) continue;

    // `origin` must be the bound Under-deeps site, and `dest` must be listed as
    // adjacent to it (its surface entrance).
    if (origin.id !== card.attachedToSite) continue;
    if (resolveAdjacency(state, origin, dest.name) === undefined) continue;

    logDetail(`Breach the Hold: ${origin.name} → ${dest.name} surface ascent roll reduced to 0 for ${forPlayer as string}`);
    return 0;
  }
  return undefined;
}

/**
 * Dynamic Under-deeps adjacency granted by a `dynamic-under-deeps-adjacency`
 * site-rule (Ancient Deep-hold ba-83). A site carrying the rule ("one Under-deeps
 * <type> chosen by you when playing this card (N)") is Under-deeps-adjacent, at
 * the rule's `roll`, to any **other** Under-deeps site whose effective type is
 * one of the rule's `siteTypes`. Symmetric and player-agnostic, standing in for
 * the printed `adjacentSites` entry the card leaves to be chosen at play time.
 *
 * Returns the required roll when one of `siteA`/`siteB` carries the rule and the
 * other is a qualifying Under-deeps site; otherwise `undefined`.
 */
export function dynamicUnderDeepsAdjacencyRoll(
  state: GameState,
  siteA: SiteCard,
  siteB: SiteCard,
): number | undefined {
  const check = (self: SiteCard, other: SiteCard): number | undefined => {
    const eff = getCardEffects(self).find(
      (e): e is import('../../types/effects/site-rules.js').DynamicUnderDeepsAdjacencySiteRule =>
        e.type === 'site-rule' && e.rule === 'dynamic-under-deeps-adjacency',
    );
    if (!eff) return undefined;
    if (other.id === self.id) return undefined;
    // The connected site must itself be an Under-deeps site ("no surface site").
    if (!other.keywords?.includes('under-deeps')) return undefined;
    // …and of one of the required (printed) types (e.g. Ruins & Lairs). Adjacency
    // operates on site definitions, and Under-deeps sites are type-immutable
    // (MEAS §6(d)), so the printed type is the effective type here.
    if (eff.siteTypes.length > 0 && !eff.siteTypes.includes(other.siteType)) return undefined;
    logDetail(`Dynamic Under-deeps adjacency: ${self.name} ↔ ${other.name} (roll ${eff.roll})`);
    return eff.roll;
  };
  return check(siteA, siteB) ?? check(siteB, siteA);
}

/**
 * Check whether two sites are Under-deeps-adjacent in either direction.
 *
 * Returns true when either site's `adjacentSites` lists the other (or
 * matches via a wildcard region key), when Caverns Unchoked (ba-51) bridges
 * them for `forPlayer`, or when a `dynamic-under-deeps-adjacency` site-rule
 * (Ancient Deep-hold ba-83) connects them. At least one of the two sites must
 * carry the `under-deeps` keyword for the result to be meaningful.
 */
export function isUnderDeepsAdjacent(state: GameState, origin: SiteCard, dest: SiteCard, forPlayer?: PlayerId): boolean {
  if (resolveAdjacency(state, origin, dest.name) !== undefined) return true;
  if (resolveAdjacency(state, dest, origin.name) !== undefined) return true;
  if (cavernsUnchokedAdjacencyRoll(state, origin, dest, forPlayer) !== undefined) return true;
  if (dynamicUnderDeepsAdjacencyRoll(state, origin, dest) !== undefined) return true;
  return false;
}

/**
 * True when `siteDef` is the **surface site** of an Under-deeps site — i.e. it
 * is the roll-0 surface entrance named in some Under-deeps site's
 * `adjacentSites` map (the entry whose required roll is 0 and whose key is a
 * concrete site name, not a `*region:` wildcard). Under-deeps sites themselves
 * are not surface sites. Used by Tempest of Fire (ba-77), which "cannot be
 * played on an Under-deeps site or surface site thereof".
 */
export function isUnderDeepsSurfaceSite(state: GameState, siteDef: CardDefinition | null | undefined): boolean {
  if (!siteDef || !isSiteCard(siteDef)) return false;
  // A surface site is itself never an Under-deeps site.
  if (siteDef.keywords?.includes('under-deeps')) return false;
  const targetName = siteDef.name;
  for (const def of Object.values(state.cardPool)) {
    if (!isSiteCard(def)) continue;
    if (!def.keywords?.includes('under-deeps')) continue;
    const adj = def.adjacentSites;
    if (!adj) continue;
    for (const [key, roll] of Object.entries(adj)) {
      if (roll === 0 && !key.startsWith('*region:') && key === targetName) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Out He Sprang (ba-71): while this permanent-event is in play for the given
 * player (and Great Shadow is not), a company containing The Balrog avatar may
 * use region movement — overriding his printed "may not use region or starter
 * movement" lock — provided at least one endpoint (its current site or its
 * planned destination) is an Under-deeps **surface site**. The number of
 * regions the company may span is derived from the player's marshalling-point
 * total via the card's ascending `[maxMp, regions]` bands (0–8 → 1, 9–16 → 2,
 * 17–24 → 3, 25+ → 4). This allowance replaces every other region-distance
 * effect and may not be modified (except by A More Evil Hour, not yet ported).
 *
 * Returns the region allowance (≥ 1) when the grant applies to this company, or
 * `null` when it does not. Both endpoints are read from the company itself
 * (`currentSite` / `destinationSite`), so the same result holds at the
 * organization-phase movement plan, the M/H select-company region-cap step, and
 * the M/H reveal-path (declare-path) step.
 */
export function balrogOutHeSprangRegionAllowance(
  state: GameState,
  player: PlayerState,
  company: Company,
): number | null {
  // Only a company containing The Balrog avatar benefits from the override.
  if (!companyContainsBalrogAvatar(state, player, company)) return null;
  const inPlay = inPlayNamesForPlayerDeep(state, player);
  // Scan the player's in-play cards for the grant effect (name-independent).
  let grant: import('../../types/effects.js').BalrogSurfaceRegionMovementEffect | undefined;
  for (const c of player.cardsInPlay) {
    const eff = getCardEffects(defById(state, c.definitionId))
      .find((e): e is import('../../types/effects.js').BalrogSurfaceRegionMovementEffect => e.type === 'balrog-surface-region-movement');
    if (eff) { grant = eff; break; }
  }
  if (!grant) return null;
  // Suppressed while the named card (Great Shadow) is in play.
  if (grant.suppressedByInPlay && inPlay.includes(grant.suppressedByInPlay)) {
    logDetail(`Out He Sprang: suppressed — ${grant.suppressedByInPlay} is in play`);
    return null;
  }
  // At least one endpoint (origin or destination) must be an Under-deeps surface site.
  const originDef = company.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
  const destDef = company.destinationSite ? defById(state, company.destinationSite.definitionId) : undefined;
  const originSurface = isUnderDeepsSurfaceSite(state, originDef);
  const destSurface = isUnderDeepsSurfaceSite(state, destDef);
  if (!originSurface && !destSurface) return null;
  // Region allowance from The Balrog player's MP total, via the ascending bands.
  const mp = totalMarshallingPoints(player);
  let allowance = grant.regionAllowanceByMp.length > 0
    ? grant.regionAllowanceByMp[grant.regionAllowanceByMp.length - 1][1]
    : 1;
  for (const [maxMp, regions] of grant.regionAllowanceByMp) {
    if (mp <= maxMp) { allowance = regions; break; }
  }
  logDetail(`Out He Sprang: The Balrog's company may use region movement — MP total ${mp} → ${allowance} region(s) (origin surface=${originSurface}, dest surface=${destSurface})`);
  return allowance;
}

/**
 * True when a site definition carries the Deep Mines movement rule (wh-55):
 * an Under-deeps-style site reachable only from a protected Wizardhaven.
 */
export function isDeepMinesSite(def: CardDefinition | null | undefined): boolean {
  if (!def) return false;
  return getCardEffects(def).some(e => e.type === 'site-rule' && e.rule === 'deep-mines-movement');
}

/**
 * True when `siteDef` is a *protected Wizardhaven* of the given Fallen-wizard
 * player — a Wizardhaven for that player ({@link isHavenForPlayer}, so a
 * Fallen-wizard haven or a Hidden-Haven conversion) that also carries an active
 * `site-protected` constraint owned by them (Guarded Haven wh-74 family, or an
 * inherently protected Wizardhaven such as Rhosgobel). This is the surface site
 * from which Deep Mines (wh-55) may be reached. Only Fallen-wizards qualify.
 */
export function isProtectedWizardhavenFor(
  state: GameState,
  siteDef: CardDefinition | undefined,
  siteDefId: CardDefinitionId | undefined,
  playerId: PlayerId,
  alignment: AlignmentType,
): boolean {
  if (alignment !== 'fallen-wizard') return false;
  if (!isHavenForPlayer(siteDef, alignment, { state, siteDefinitionId: siteDefId, playerId })) return false;
  return isSiteProtectedForPlayer(state, siteDefId, playerId);
}

/** Minimum stage points a Fallen-wizard needs to descend to Deep Mines (>6). */
export const DEEP_MINES_MIN_STAGE_POINTS = 6;

/**
 * True when the moving Fallen-wizard company at `origin` may descend to the Deep
 * Mines site `dest`: `dest` is a Deep Mines site, `origin` is one of the
 * player's protected Wizardhavens, and the player has more than six stage
 * points. Consulted by both the plan-movement offer (organization phase) and
 * the declare-path offer (movement/hazard phase).
 */
export function isDeepMinesDescentLegal(
  state: GameState,
  origin: SiteCard,
  originDefId: CardDefinitionId | undefined,
  dest: CardDefinition | undefined,
  player: PlayerState,
): boolean {
  if (!isDeepMinesSite(dest)) return false;
  if (player.stagePoints <= DEEP_MINES_MIN_STAGE_POINTS) return false;
  return isProtectedWizardhavenFor(state, origin, originDefId, player.id, player.alignment);
}

/**
 * True when a Fallen-wizard company **at** a Deep Mines site may ascend back to
 * the surface — the card's "the sites are adjacent and the movement roll
 * required to move between them is 0" runs both ways, so a company at Deep Mines
 * may return to one of the player's protected Wizardhavens (roll 0). No stage
 * point requirement applies to the ascent (only the descent is gated). Without
 * this the site would be a movement dead-end (it carries no region/site path).
 */
export function isDeepMinesAscentLegal(
  state: GameState,
  origin: SiteCard,
  dest: CardDefinition | undefined,
  destDefId: CardDefinitionId | undefined,
  player: PlayerState,
): boolean {
  if (!isDeepMinesSite(origin)) return false;
  return isProtectedWizardhavenFor(state, dest, destDefId, player.id, player.alignment);
}

/**
 * Collect all sites reachable via Under-deeps movement from the given
 * current site. At least one side of each pair must carry the
 * `under-deeps` keyword; adjacency is checked bidirectionally.
 */
function getUnderDeepsReachable(state: GameState, currentSiteDef: SiteCard, candidateSites: readonly SiteCard[], forPlayer: PlayerId): SiteCard[] {
  const currentIsUD = currentSiteDef.keywords?.includes('under-deeps') ?? false;
  const results: SiteCard[] = [];

  for (const dest of candidateSites) {
    if (dest.name === currentSiteDef.name) continue;
    const destIsUD = dest.keywords?.includes('under-deeps') ?? false;

    // At least one side must be Under-deeps
    if (!currentIsUD && !destIsUD) continue;

    if (isUnderDeepsAdjacent(state, currentSiteDef, dest, forPlayer)) {
      results.push(dest);
    }
  }
  return results;
}

/**
 * Returns true if a Ringwraith company has a mode card (Black Rider,
 * Fell Rider, or Heralded Lord) bound to it via `cardsInPlay`.
 *
 * Mode cards are permanent-event resources with a `ringwraith-mode` effect.
 * They are bound to the company via `CardInPlay.companyId`. Without a mode
 * card the Ringwraith may only move Darkhaven-to-Darkhaven (MELE §1.2).
 */
function ringwraithHasModeCard(
  state: GameState,
  company: { readonly id: import('../../index.js').CompanyId },
  player: PlayerState,
): boolean {
  for (const card of player.cardsInPlay) {
    if (card.companyId !== company.id) continue;
    const def = defById(state, card.definitionId);
    if (!def) continue;
    if (getCardEffects(def).some(e => e.type === 'ringwraith-mode')) return true;
  }
  return false;
}

/**
 * Returns the total passive movement bonus (extra regions) granted to a company
 * by allies carrying a `passive-movement-bonus` effect whose condition is met.
 *
 * The bonus applies when every character in the company has at least one ally
 * whose name is in the effect's `allyNames` list. Duplicate effects (same value
 * + same allyNames) are de-duplicated; the result is the max unique bonus found.
 */
function collectPassiveMovementBonus(
  state: GameState,
  characterIds: readonly CardInstanceId[],
  player: PlayerState,
): number {
  const seenKeys = new Set<string>();
  let bonus = 0;

  for (const charId of characterIds) {
    const char = player.characters[charId];
    if (!char) continue;

    for (const ally of char.allies) {
      const allyDef = state.cardPool[ally.definitionId] as { effects?: readonly CardEffect[] } | undefined;
      if (!allyDef?.effects) continue;

      for (const eff of allyDef.effects) {
        if (eff.type !== 'passive-movement-bonus') continue;
        const key = `${eff.value}:${eff.allyNames.slice().sort().join(',')}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const allQualify = characterIds.every(cId => {
          const c = player.characters[cId];
          return c?.allies.some(a => {
            const aDef = state.cardPool[a.definitionId] as { name?: string } | undefined;
            return aDef?.name !== undefined && eff.allyNames.includes(aDef.name);
          });
        });

        if (allQualify) {
          logDetail(`Passive movement bonus +${eff.value} regions: all company characters have a qualifying ally`);
          bonus = Math.max(bonus, eff.value);
        }
      }
    }
  }

  return bonus;
}

/**
 * True when `company` is bound by an Enchanted Stream (as-27) movement tax that
 * has not yet been satisfied this organization phase. While unpaid, the company
 * may not voluntarily declare movement or split — the controlling player must
 * first tap the required untapped characters via `pay-movement-tax`. Returns
 * false when no tax is in play (the common case).
 */
export function companyMovementTaxUnpaid(
  state: GameState,
  player: PlayerState,
  company: Company,
): boolean {
  const tax = companyMovementTax(state, company);
  if (!tax) return false;
  const untappedCount = company.characters.filter(
    cId => player.characters[cId]?.status === CardStatus.Untapped,
  ).length;
  const paid = (state.phaseState.phase === Phase.Organization
    ? state.phaseState.movementTaxPaid?.[company.id as string]
    : 0) ?? 0;
  const satisfied = isMovementTaxSatisfied(tax, untappedCount, paid);
  if (!satisfied) {
    logDetail(`Company ${company.id as string}: Enchanted Stream movement tax unpaid (${paid}/${tax.taxTapCharacters}, ${untappedCount} untapped) — voluntary move/split blocked`);
  }
  return !satisfied;
}

/**
 * Computes plan-movement actions for each company.
 * For every company, emits one viable action per reachable site in the player's
 * site deck, determined by the movement map (starter and region movement),
 * plus Under-deeps movement when applicable.
 * Companies that already have a destination planned are skipped.
 */
export function planMovementActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];
  // Build the movement map for this player's alignment so same-named sites of
  // the opposing side don't pollute its haven/region topology. The candidate
  // sites already come from the player's (single-alignment) site deck.
  const movementMap = buildMovementMap(state.cardPool, player.alignment);

  for (const company of player.companies) {
    if (!company.currentSite) continue;
    if (company.destinationSite !== null) continue;
    // Hide in Dark Places (le-192) locks its scout's company stationary for the
    // turn via a `company-cannot-move` constraint — such a company may not
    // declare movement.
    if (state.activeConstraints.some(
      c => c.kind.type === 'company-cannot-move'
        && c.target.kind === 'company'
        && c.target.companyId === company.id,
    )) {
      logDetail(`Company ${company.id as string} is locked stationary (company-cannot-move) — no movement offered`);
      continue;
    }

    // A company containing a character who may not move (Shifter of Hues wh-115
    // on Radagast) cannot move; splitting the others off is the way around it.
    if (companyHasImmobileCharacter(state, player, company)) {
      logDetail(`Company ${company.id as string} holds a character with bearer-cannot-move — no movement offered`);
      continue;
    }

    // Enchanted Stream (as-27): the bound company may not voluntarily move to a
    // new site until it has tapped its untapped characters (to a max of two)
    // toward the movement tax this org phase. Until paid, offer no movement; the
    // `pay-movement-tax` actions are emitted by `payMovementTaxActions`.
    if (companyMovementTaxUnpaid(state, player, company)) {
      continue;
    }

    const currentSiteDef = resolveDef(state, company.currentSite.instanceId);
    if (!currentSiteDef || !isSiteCard(currentSiteDef)) continue;

    // Build candidate sites from the player's site deck
    const candidateSites: SiteCard[] = [];
    const siteInstMap = new Map<string, CardInstanceId>();
    // Heart Grown Cold (wh-21) and its kin lock which alignment of a site card a
    // Fallen-wizard may use for a location. A barred version is dropped before it
    // can claim the name → instance slot, so the surviving version of the same
    // location (if the deck holds one) becomes the destination the player uses.
    for (const siteCard of player.siteDeck) {
      const siteDef = defById(state, siteCard.definitionId);
      if (!siteDef || !isSiteCard(siteDef)) continue;
      if (fwSiteVersionForbidden(state, player, siteDef)) continue;
      candidateSites.push(siteDef);
      siteInstMap.set(siteDef.name, siteCard.instanceId);
    }

    // Rule 3.37 / 3.39: a company may declare movement to a site card that
    // this player already has in play, either:
    //   (a) as another company's currentSite, or
    //   (b) as another company's pending destinationSite (face-down movement
    //       already declared this organization phase).
    // Such a destination is not drawn from the site deck; the card instance
    // is shared.
    for (const sibling of player.companies) {
      if (sibling.id === company.id) continue;
      const siblingSites = [sibling.currentSite, sibling.destinationSite];
      for (const siblingSite of siblingSites) {
        if (!siblingSite) continue;
        if (siblingSite.instanceId === company.currentSite.instanceId) continue;
        const siblingDef = defById(state, siblingSite.definitionId);
        if (!siblingDef || !isSiteCard(siblingDef)) continue;
        // Deck entries win — if the same site name is already a deck candidate,
        // keep the deck instance as the canonical choice. Likewise, once we've
        // added a sibling-in-play entry for this name we don't add a second
        // (e.g. currentSite wins over destinationSite if both siblings reference
        // the same site name via different instances, though in practice they
        // share the instance once movement resolves).
        if (siteInstMap.has(siblingDef.name)) continue;
        // The same alignment lock applies to a site already in play: a
        // Fallen-wizard barred from the hero card cannot join a sibling standing
        // on it either.
        if (fwSiteVersionForbidden(state, player, siblingDef)) continue;
        candidateSites.push(siblingDef);
        siteInstMap.set(siblingDef.name, siblingSite.instanceId);
        logDetail(`  sibling-in-play destination ${siblingDef.name} via company ${sibling.id as string}`);
      }
    }

    // A deny-company-move site-rule (Rivendell as-160: "A Ringwraith may not
    // move to this site") drops the destination for a matching company across
    // every movement pass (regular, Eagle/Gwaihir, Under-deeps, Deep Mines).
    for (let i = candidateSites.length - 1; i >= 0; i--) {
      if (siteDeniesCompanyMove(state, player, company, candidateSites[i])) {
        candidateSites.splice(i, 1);
      }
    }

    // Rule 2.II.7.1: no two companies sharing an origin may declare movement
    // to the same new site during one organization phase. Drop any candidate
    // whose definition is already another sibling-at-same-origin's
    // destinationSite. Compare by definitionId, not instanceId, because two
    // companies at the same named site may hold different card instances.
    const blockedByRule_2_II_7_1 = new Set<string>(); // definitionIds
    for (const sibling of player.companies) {
      if (sibling.id === company.id) continue;
      if (!sibling.currentSite) continue;
      if (sibling.currentSite.definitionId !== company.currentSite.definitionId) continue;
      if (sibling.destinationSite) {
        blockedByRule_2_II_7_1.add(sibling.destinationSite.definitionId as string);
      }
    }

    // Gwaihir special movement: can reach any non-shadow/dark site
    if (company.specialMovement === 'gwaihir') {
      // MEAS §6(b): Eagle-mounts and Gwaihir cannot move to or from an
      // Under-deeps site. When the origin is Under-deeps, special movement is
      // unavailable entirely.
      if (currentSiteDef.keywords?.includes('under-deeps')) {
        logDetail(`Company ${company.id as string} at ${currentSiteDef.name} is under-deeps — excluded from Eagle/Gwaihir movement`);
        continue;
      }
      const regionTypeMap = buildRegionTypeMap(state);
      logDetail(`Company ${company.id as string} at ${currentSiteDef.name}: Gwaihir special movement — filtering sites`);
      for (const siteDef of candidateSites) {
        const destInstId = siteInstMap.get(siteDef.name);
        if (!destInstId) continue;
        if (blockedByRule_2_II_7_1.has(siteDef.id)) {
          logDetail(`  ${siteDef.name} blocked by rule 2.II.7.1 (sibling at same origin already targets it)`);
          continue;
        }
        // MEAS §6(b): an Under-deeps destination is never reachable by Eagle/Gwaihir.
        if (siteDef.keywords?.includes('under-deeps')) {
          logDetail(`  ${siteDef.name} is under-deeps — excluded from Eagle/Gwaihir movement`);
          continue;
        }
        // Exclude sites in Shadow-land (shadow) or Dark-domain (dark) regions
        const regionType = siteDef.region ? regionTypeMap.get(siteDef.region) : undefined;
        if (regionType === 'shadow' || regionType === 'dark') {
          logDetail(`  ${siteDef.name} in ${siteDef.region} (${regionType}) — excluded by Gwaihir`);
          continue;
        }
        logDetail(`  ${siteDef.name} in ${siteDef.region ?? '?'} (${regionType ?? '?'}) — reachable via Gwaihir`);
        const candidate: GameAction = {
          type: 'plan-movement',
          player: playerId,
          companyId: company.id,
          destinationSite: destInstId,
        };
        actions.push(viableWithRegress(candidate, state.reverseActions));
      }
      continue;
    }

    // CoE 3.44 / MEAS §3: region movement spans a maximum of 4 consecutive
    // regions, or 6 when an effect grants extra region distance. The total is
    // hard-capped at 6 no matter how much extra distance is granted.
    const MAX_EXTENDED_REGION_DISTANCE = BASE_MAX_REGION_DISTANCE + 2;
    const requestedMaxRegions = BASE_MAX_REGION_DISTANCE + (company.extraRegionDistance ?? 0) + collectPassiveMovementBonus(state, company.characters, player);
    const cappedMaxRegions = Math.min(requestedMaxRegions, MAX_EXTENDED_REGION_DISTANCE);
    if (cappedMaxRegions < requestedMaxRegions) {
      logDetail(`Company ${company.id as string}: region distance capped at ${MAX_EXTENDED_REGION_DISTANCE} (requested ${requestedMaxRegions})`);
    }
    // Environment hazards (e.g. No Way Forward) reduce the max region distance
    // game-wide, never below the environment's floor.
    let effectiveMaxRegions = applyRegionMovementReduction(state, cappedMaxRegions);
    if (effectiveMaxRegions < cappedMaxRegions) {
      logDetail(`Company ${company.id as string}: region distance reduced to ${effectiveMaxRegions} by an in-play environment (was ${cappedMaxRegions})`);
    }
    // A company-bound movement restriction (Going Ever Under Dark ba-37) hard-
    // caps region distance ("limited in all cases to N regions maximum") and
    // forbids starter movement.
    const moveRestriction = companyMovementRestrictions(player, company, state);
    if (moveRestriction?.regionMovementMax != null && moveRestriction.regionMovementMax < effectiveMaxRegions) {
      logDetail(`Company ${company.id as string}: region distance capped at ${moveRestriction.regionMovementMax} by a movement-restriction card (was ${effectiveMaxRegions})`);
      effectiveMaxRegions = moveRestriction.regionMovementMax;
    }
    const currentIsUD = currentSiteDef.keywords?.includes('under-deeps') ?? false;
    // Under-deeps sites are only reachable via under-deeps movement (handled below), never via
    // regular starter/region movement. When already at an under-deeps site, regular movement
    // does not apply at all.
    // Deep Mines (wh-55) is reachable only via its own descent pass (below),
    // never via ordinary starter/region movement — exclude it here too.
    const regularCandidates = currentIsUD
      ? []
      : candidateSites.filter(s => !(s.keywords?.includes('under-deeps') ?? false) && !isDeepMinesSite(s));
    // A More Evil Hour (ba-48): the targeted company may move up to two
    // additional regions when moving to — or away from — a site holding an
    // opponent's company. When its *origin* holds one, the +2 applies to the
    // whole leaving move (any destination); otherwise the +2 applies only to
    // destinations that themselves hold an opponent's company.
    const evilHour = company.evilHourMovementBonus === true;
    const originHasOpp = evilHour && siteHasOpponentCompany(state, playerId, currentSiteDef.name);
    const planMax = originHasOpp ? effectiveMaxRegions + 2 : effectiveMaxRegions;
    let reachable = getReachableSites(movementMap, currentSiteDef, regularCandidates, planMax);
    if (evilHour && !originHasOpp) {
      const extended = getReachableSites(movementMap, currentSiteDef, regularCandidates, effectiveMaxRegions + 2);
      const seenExt = new Set(reachable.map(r => `${r.site.name}:${r.movementType}`));
      for (const r of extended) {
        if (r.movementType !== 'region') continue;
        if (seenExt.has(`${r.site.name}:${r.movementType}`)) continue;
        if (siteHasOpponentCompany(state, playerId, r.site.name)) {
          logDetail(`Company ${company.id as string}: A More Evil Hour extends region reach to opponent-occupied ${r.site.name}`);
          reachable.push(r);
        }
      }
    }

    // MEWH §7: a Fallen-wizard's companies must use region movement — they may
    // not use starter (printed-path) movement between adjacent sites/havens.
    if (player.alignment === 'fallen-wizard') {
      const beforeStarter = reachable.length;
      reachable = reachable.filter(r => r.movementType === 'region');
      if (reachable.length !== beforeStarter) {
        logDetail(`Company ${company.id as string}: Fallen-wizard must use region movement — dropped ${beforeStarter - reachable.length} starter destination(s)`);
      }
    }

    // A company-bound movement restriction (Going Ever Under Dark ba-37)
    // forbids starter movement: drop every starter-only destination.
    if (moveRestriction?.noStarterMovement) {
      const beforeStarter = reachable.length;
      reachable = reachable.filter(r => r.movementType !== 'starter');
      if (reachable.length !== beforeStarter) {
        logDetail(`Company ${company.id as string}: movement-restriction forbids starter movement — dropped ${beforeStarter - reachable.length} starter destination(s)`);
      }
    }

    // MELE §1.2: Ringwraith movement restrictions.
    // Check whether this company has a Ringwraith avatar.
    const hasRingwraithAvatar = player.alignment === 'ringwraith' && company.characters.some(cId => {
      const char = player.characters[cId];
      if (!char) return false;
      const def = defById(state, char.definitionId);
      return def && isCharacterCard(def) && isAvatarCharacter(def) && def.race === Race.Ringwraith;
    });

    if (hasRingwraithAvatar) {
      const hasModeCard = ringwraithHasModeCard(state, company, player);

      // Gate: without a mode card, Ringwraith may only move to Darkhaven (siteType: haven).
      if (!hasModeCard) {
        const before = reachable.length;
        reachable = reachable.filter(r => r.site.siteType === SiteType.Haven);
        logDetail(`Company ${company.id as string}: Ringwraith has no mode card — restricted to Darkhaven destinations (${before} → ${reachable.length})`);
      }

      // Ringwraith companies may never move through Coastal Seas regions (MELE §1.1).
      const beforeCoastal = reachable.length;
      reachable = reachable.filter(r => !(r.site.sitePath ?? []).includes(RegionType.Coastal));
      if (reachable.length !== beforeCoastal) {
        logDetail(`Company ${company.id as string}: filtered out ${beforeCoastal - reachable.length} Coastal Seas destination(s) for Ringwraith`);
      }
    }

    // Deduplicate: a site reachable by both starter and region movement only needs one action
    const seen = new Set<string>();
    logDetail(`Company ${company.id as string} at ${currentSiteDef.name}: ${reachable.length} reachable site(s)`);

    for (const r of reachable) {
      const destInstId = siteInstMap.get(r.site.name);
      if (!destInstId) continue;
      if (seen.has(destInstId as string)) continue;
      seen.add(destInstId as string);
      if (blockedByRule_2_II_7_1.has(r.site.id)) {
        logDetail(`  ${r.site.name} blocked by rule 2.II.7.1 (sibling at same origin already targets it)`);
        continue;
      }
      const candidate: GameAction = {
        type: 'plan-movement',
        player: playerId,
        companyId: company.id,
        destinationSite: destInstId,
      };
      actions.push(viableWithRegress(candidate, state.reverseActions));
    }

    // --- Under-deeps movement pass ---
    const udReachable = getUnderDeepsReachable(state, currentSiteDef, candidateSites, playerId);
    logDetail(`Company ${company.id as string} at ${currentSiteDef.name}: ${udReachable.length} Under-deeps destination(s)`);
    for (const dest of udReachable) {
      const destInstId = siteInstMap.get(dest.name);
      if (!destInstId) continue;
      if (seen.has(destInstId as string)) continue;
      seen.add(destInstId as string);
      if (blockedByRule_2_II_7_1.has(dest.id)) {
        logDetail(`  ${dest.name} blocked by rule 2.II.7.1 (sibling at same origin already targets it)`);
        continue;
      }
      logDetail(`  Under-deeps destination: ${dest.name}`);
      const candidate: GameAction = {
        type: 'plan-movement',
        player: playerId,
        companyId: company.id,
        destinationSite: destInstId,
      };
      actions.push(viableWithRegress(candidate, state.reverseActions));
    }

    // --- Deep Mines descent / ascent pass (wh-55) ---
    // A company may descend to a Deep Mines site only from one of the moving
    // Fallen-wizard's protected Wizardhavens and only while he has more than six
    // stage points (roll 0, resolved as Under-deeps movement). Rule 2.II.7.1
    // ("no two same-origin companies to the same new site definition") already
    // enforces the card's "Cannot be duplicated on a given Wizardhaven" clause.
    // The adjacency runs both ways ("the movement roll required to move between
    // them is 0"), so a company already at Deep Mines may ascend back to a
    // protected Wizardhaven (no stage-point gate on the way out).
    const originIsDeepMines = isDeepMinesSite(currentSiteDef);
    for (const dest of candidateSites) {
      const legal = originIsDeepMines
        ? isDeepMinesAscentLegal(state, currentSiteDef, dest, dest.id, player)
        : isDeepMinesDescentLegal(state, currentSiteDef, company.currentSite.definitionId, dest, player);
      if (!legal) continue;
      const destInstId = siteInstMap.get(dest.name);
      if (!destInstId) continue;
      if (seen.has(destInstId as string)) continue;
      seen.add(destInstId as string);
      if (blockedByRule_2_II_7_1.has(dest.id)) {
        logDetail(`  ${dest.name} blocked by rule 2.II.7.1 (sibling at same origin already targets Deep Mines)`);
        continue;
      }
      logDetail(originIsDeepMines
        ? `  Deep Mines ascent destination: ${dest.name} (from ${currentSiteDef.name})`
        : `  Deep Mines descent destination: ${dest.name} (from protected Wizardhaven ${currentSiteDef.name}, ${player.stagePoints} stage points)`);
      const candidate: GameAction = {
        type: 'plan-movement',
        player: playerId,
        companyId: company.id,
        destinationSite: destInstId,
      };
      actions.push(viableWithRegress(candidate, state.reverseActions));
    }
  }

  return actions;
}

/**
 * Builds a map from region name to its region type by scanning the card pool.
 * Used to check whether a site's region is shadow-land, dark-domain, etc.
 */
function buildRegionTypeMap(state: GameState): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, card] of Object.entries(state.cardPool)) {
    if (card.cardType === 'region') {
      map.set(card.name, (card as { regionType: string }).regionType);
    }
  }
  return map;
}

/**
 * Computes move-to-influence actions during the organization phase.
 *
 * Two types of influence reassignment (CoE rules lines 227-228):
 *
 * 1. **To DI (become follower)**: A non-avatar character under GI, who has
 *    no followers themselves, can be moved under the DI of a non-follower
 *    character in the same company. The character's mind must not exceed
 *    the controller's available direct influence.
 *
 * 2. **To GI (un-follow)**: A follower can be moved to general influence,
 *    provided the total non-follower mind would not exceed the player's
 *    maximum general influence.
 */
export function moveToInfluenceActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const company of player.companies) {
    for (const charInstId of company.characters) {
      const char = player.characters[charInstId];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;

      const isAvatar = charDef.mind === null;

      if (char.controlledBy === 'general' && !isAvatar && char.followers.length === 0) {
        // Block DI assignment when an attached hazard forbids it (e.g. Rebel-talk)
        if (hasNoDirectInfluenceRestriction(char.hazards, state.cardPool)) {
          logDetail(`  → blocked: ${charDef.name} has no-direct-influence restriction`);
        } else {
        // Rule 227: Move non-avatar character without followers to DI of a
        // non-follower character in the same company
        // A `control-restriction` may override the influence-to-control cost
        // and limit which controllers may hold this character under DI.
        const controlCost = controlCostOf(state, char, charDef.mind) ?? charDef.mind;
        for (const ctrlInstId of company.characters) {
          if (ctrlInstId === charInstId) continue;
          const ctrl = player.characters[ctrlInstId];
          if (!ctrl) continue;
          // Controller must be under GI (non-follower)
          if (ctrl.controlledBy !== 'general') continue;
          // The Balrog (ba-3) "may not have any followers" — excluded even
          // though he is under general influence, unless a fána card such as
          // Great Shadow (ba-62) grants him the permission (`grants-followers`
          // play-flag on an attached item).
          const ctrlDef = resolveDef(state, ctrl.instanceId);
          if (isBalrogAvatarDef(ctrlDef) && !hasFollowerGrantPermission(ctrl.items, state.cardPool)) continue;
          // Enforce control-source restriction (e.g. "only by general influence
          // or a Fallen-wizard"): skip controllers the restriction disallows.
          const ctrlName = isCharacterCard(ctrlDef) ? ctrlDef.name : '?';
          if (!directInfluenceControlAllowed(state, char, ctrl, player.alignment)) {
            logDetail(`  → blocked: ${charDef.name} may not be controlled by ${ctrlName} (control-source restriction)`);
            continue;
          }
          const avail = availableDI(state, ctrl.instanceId, player, charDef);
          if (avail >= controlCost) {
            logDetail(`  → viable: move ${charDef.name} (control cost ${controlCost}) under DI of ${ctrlName} (avail DI ${avail})`);
            const candidate: GameAction = {
              type: 'move-to-influence',
              player: playerId,
              characterInstanceId: charInstId,
              controlledBy: ctrlInstId,
            };
            actions.push(viableWithRegress(candidate, state.reverseActions));
          }
        }
        }
      } else if (char.controlledBy !== 'general') {
        // Rule 228: Move a follower to general influence if GI allows. A
        // `control-restriction` may override the influence-to-control cost.
        const remainingGI = generalInfluenceControlLimit(state, playerId) - player.generalInfluenceUsed;
        const controlCost = controlCostOf(state, char, charDef.mind);
        if (controlCost !== null && controlCost <= remainingGI) {
          logDetail(`  → viable: move ${charDef.name} (control cost ${controlCost}) to GI (remaining GI ${remainingGI})`);
          const candidate: GameAction = {
            type: 'move-to-influence',
            player: playerId,
            characterInstanceId: charInstId,
            controlledBy: 'general',
          };
          actions.push(viableWithRegress(candidate, state.reverseActions));
        }
      }
    }
  }

  return actions;
}

/**
 * Computes transfer-item actions during the organization phase.
 *
 * Per CoE rules (2.II.5), items can be transferred between two characters
 * at the same site (not necessarily in the same company). After the transfer,
 * the initial bearer must make a corruption check — the reducer enqueues a
 * {@link PendingResolution} of kind `corruption-check` via the unified
 * pending-resolution system; that resolution gates all other organization
 * actions until it is resolved.
 *
 * Only true **item cards** are transferable. `CharacterInPlay.items` also
 * carries non-item attachments that were merely *placed with* a character so
 * their effects apply — recruitment-vehicle Stage resources such as Open to
 * the Summons (wh-46), Thrall of the Voice (wh-82) or Orders from Lugbúrz
 * (as-94). Those are permanent resource-events, not items: rule 2.II.5 grants
 * no way to move them, and their card text binds them to the character they
 * were placed with. They must never be offered for transfer.
 *
 * Emits one viable action per valid (item, fromCharacter, toCharacter) triple.
 */
export function transferItemActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  // Build a map from site instance ID → list of character instance IDs at that site
  const siteToCharacters = new Map<string, CardInstanceId[]>();
  for (const [siteKey, companies] of groupCompaniesBySite(player)) {
    siteToCharacters.set(siteKey, companies.flatMap(c => c.characters));
  }

  // For each character with items, find valid transfer targets at the same site
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteKey = company.currentSite.instanceId as string;
    const charsAtSite = siteToCharacters.get(siteKey) ?? [];

    for (const charInstId of company.characters) {
      const char = player.characters[charInstId];
      if (!char || char.items.length === 0) continue;

      const charDef = resolveDef(state, char.instanceId);
      const charName = isCharacterCard(charDef) ? charDef.name : '?';

      for (const item of char.items) {
        const itemDef = defById(state, item.definitionId);
        const itemName = itemDef?.name ?? '?';

        // Non-item attachments (Stage resources placed with a character) are
        // not transferable — CoE 2.II.5 covers items only.
        if (!isItemCard(itemDef)) {
          logDetail(`  → not transferable: ${itemName} on ${charName} is not an item card (${itemDef?.cardType ?? 'unknown type'})`);
          continue;
        }

        for (const targetInstId of charsAtSite) {
          if (targetInstId === charInstId) continue;
          const target = player.characters[targetInstId];
          if (!target) continue;

          const targetDef = resolveDef(state, target.instanceId);
          const targetName = isCharacterCard(targetDef) ? targetDef.name : '?';

          logDetail(`  → viable: transfer ${itemName} from ${charName} to ${targetName}`);
          const candidate: GameAction = {
            type: 'transfer-item',
            player: playerId,
            itemInstanceId: item.instanceId,
            fromCharacterId: charInstId,
            toCharacterId: targetInstId,
          };
          actions.push(viableWithRegress(candidate, state.reverseActions));
        }
      }
    }
  }

  return actions;
}

/** Regular item subtypes (minor/major/greater) that are storable at any Haven per CoE rule 2.II.4. */
const REGULAR_ITEM_SUBTYPES = new Set(['minor', 'major', 'greater']);

/**
 * Computes store-item actions during the organization phase.
 *
 * Two categories of items are storable (CoE rule 2.II.4):
 *
 * 1. **Regular items** (subtype minor, major, or greater) without an explicit
 *    `storable-at` restriction: storable at any Haven site.
 * 2. **Items with a `storable-at` effect**: storable only at sites whose name
 *    appears in the effect's `sites` list, or whose type appears in
 *    `siteTypes`. This covers special items (e.g. Rescue Prisoners) and
 *    items with alternative storage sites (e.g. Sapling of the White Tree).
 *
 * After storage, the initial bearer must make a corruption check.
 * Emits one action per valid (item, character) pair.
 */
export function storeItemActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const company of player.companies) {
    if (!company.currentSite) continue;

    const siteDef = resolveDef(state, company.currentSite.instanceId);
    if (!siteDef || !isSiteCard(siteDef)) continue;
    const siteName = siteDef.name;
    const siteType = siteDef.siteType;

    // MEBA: "A Balrog player may not store anything at Barad-dûr" — it is not one
    // of the Balrog's Darkhavens (only Moria and The Under-gates are).
    if (player.alignment === Alignment.Balrog && siteName === 'Barad-dûr') {
      logDetail(`Store-item: Balrog player may not store at ${siteName} — skipping company`);
      continue;
    }

    // `no-storage` site-rule (Geann a-Lisch le-374): "Resources may never be
    // stored at this site." Suppress every store-item offer for a company here.
    if (siteDef.effects?.some(e => e.type === 'site-rule' && e.rule === 'no-storage')) {
      logDetail(`Store-item: ${siteName} carries no-storage site-rule — skipping company`);
      continue;
    }

    for (const charInstId of company.characters) {
      const char = player.characters[charInstId];
      if (!char || char.items.length === 0) continue;

      const charDef = resolveDef(state, char.instanceId);
      const charName = isCharacterCard(charDef) ? charDef.name : '?';

      for (const item of char.items) {
        const itemDef = defById(state, item.definitionId);
        if (!itemDef) continue;

        const effects = ('effects' in itemDef)
          ? (itemDef as { effects?: readonly { type: string; sites?: readonly string[]; siteTypes?: readonly string[] }[] }).effects
          : undefined;
        const storableEffect = effects?.find(e => e.type === 'storable-at');

        let isStorable = false;
        if (storableEffect) {
          const siteNameMatch = storableEffect.sites?.includes(siteName) ?? false;
          const siteTypeMatch = storableEffect.siteTypes?.includes(siteType) ?? false;
          isStorable = siteNameMatch || siteTypeMatch;
        } else if (isItemCard(itemDef) && siteType === 'haven') {
          isStorable = REGULAR_ITEM_SUBTYPES.has(itemDef.subtype);
        }

        if (!isStorable) continue;

        const itemName = itemDef.name ?? '?';
        logDetail(`  → viable: store ${itemName} from ${charName} at ${siteName}`);
        actions.push({
          action: {
            type: 'store-item',
            player: playerId,
            itemInstanceId: item.instanceId,
            characterId: charInstId,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Computes split-company actions during the organization phase.
 *
 * A character under general influence (with no restriction on having followers)
 * can split off from their company to form a new company at the same site.
 * The character's followers automatically accompany them. The source company
 * must retain at least one GI character after the split.
 *
 * Emits one action per GI character that can legally split off. Followers
 * move automatically with their host in the reducer.
 */
export function splitCompanyActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const company of player.companies) {
    if (!company.currentSite) continue;

    // Count GI characters (non-followers) in this company
    const giChars = company.characters.filter(id => {
      const c = player.characters[id];
      return c && c.controlledBy === 'general';
    });

    // Need at least 2 GI characters to split (one stays, one leaves)
    if (giChars.length < 2) continue;

    // Enchanted Stream (as-27): a bound company may not voluntarily split until
    // its movement tax has been paid this org phase.
    if (companyMovementTaxUnpaid(state, player, company)) continue;

    for (const charInstId of giChars) {
      const char = player.characters[charInstId];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;

      // Validate all followers are actually in this company (guards against stale state)
      const followersInCompany = char.followers.every(f => company.characters.some(c => c === f));
      if (!followersInCompany) {
        logDetail(`  → skip: ${charDef.name} has followers not in this company (stale state)`);
        continue;
      }

      logDetail(`  → viable: split ${charDef.name} (+ ${char.followers.length} followers) from ${company.id as string}`);
      const candidate: GameAction = {
        type: 'split-company',
        player: playerId,
        sourceCompanyId: company.id,
        characterId: charInstId,
      };
      actions.push(viableWithRegress(candidate, state.reverseActions));
    }
  }

  return actions;
}

/**
 * Computes move-to-company actions during the organization phase.
 *
 * A character under general influence can move to a different company at
 * the same site. Their followers automatically accompany them. The source
 * company must retain at least one GI character after the move.
 *
 * Emits one action per valid (character, targetCompany) pair.
 */
export function moveToCompanyActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  // Build map from site instance ID → companies at that site
  const siteToCompanies = groupCompaniesBySite(player);

  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const companiesAtSite = siteToCompanies.get(company.currentSite.instanceId as string) ?? [];
    if (companiesAtSite.length < 2) continue;

    // Count GI characters in this company
    const giChars = company.characters.filter(id => {
      const c = player.characters[id];
      return c && c.controlledBy === 'general';
    });

    // Need at least 2 GI characters so one can leave and one stays
    if (giChars.length < 2) continue;

    for (const charInstId of giChars) {
      const char = player.characters[charInstId];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;

      for (const targetCompany of companiesAtSite) {
        if (targetCompany.id === company.id) continue;

        const atHaven = companyAtHaven(state, targetCompany, player.alignment, player.id);
        const resultingCharIds = [...targetCompany.characters, charInstId];

        // Rules 3.24–3.26 apply only at non-haven sites.
        if (!atHaven) {
          const extraLeaderSlots = countCompanyCardEffect(state, targetCompany.id, 'extra-leader-slot');
          const resultingSize = companyEffectiveSizeExemptingLeaders(state, resultingCharIds, extraLeaderSlots);
          if (resultingSize > 7) {
            logDetail(`  → skip: move ${charDef.name} to ${targetCompany.id as string} — would exceed size limit (${resultingSize} > 7)`);
            continue;
          }
          if (wouldViolateRaceMixing(state, resultingCharIds)) {
            logDetail(`  → skip: move ${charDef.name} to ${targetCompany.id as string} — race-mixing restriction (rule 3.25)`);
            continue;
          }
          if (wouldViolateLeaderRestriction(state, resultingCharIds, targetCompany.id)) {
            logDetail(`  → skip: move ${charDef.name} to ${targetCompany.id as string} — leader restriction (rule 3.26)`);
            continue;
          }
        }

        logDetail(`  → viable: move ${charDef.name} from ${company.id as string} to ${targetCompany.id as string}`);
        const candidate: GameAction = {
          type: 'move-to-company',
          player: playerId,
          characterInstanceId: charInstId,
          sourceCompanyId: company.id,
          targetCompanyId: targetCompany.id,
        };
        actions.push(viableWithRegress(candidate, state.reverseActions));
      }
    }
  }

  return actions;
}

/**
 * Computes merge-companies actions during the organization phase.
 *
 * Two companies at the same site can be merged into one. All characters
 * from the source company move into the target company, and the source
 * company is dissolved. This increases the combined company's hazard limit
 * but consolidates combat strength.
 *
 * Emits one action per valid (sourceCompany, targetCompany) pair at the same site.
 */
/**
 * Check whether a company's current site is a haven.
 * Havens exempt companies from size limits, race-mixing, and leader restrictions.
 */
function companyAtHaven(
  state: GameState,
  company: { currentSite?: { instanceId: CardInstanceId } | null },
  alignment: import('../../index.js').Alignment,
  playerId: PlayerId,
): boolean {
  if (!company.currentSite) return false;
  const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
  if (!siteDefId) return false;
  const siteDef = defById(state, siteDefId);
  // MEWH §9: the race-mixing exception (Orc/Troll may share a company with
  // Elf/Dwarf/Dúnadan/Hobbit) applies only at a *haven for this player*. For a
  // Fallen-wizard that means a Wizardhaven — not a METW Haven or MELE Darkhaven.
  // `isHavenForPlayer` is identical to the plain siteType check for every other
  // alignment, so non-Fallen-wizard behaviour is unchanged. A site converted to
  // a Wizardhaven for this player (Hidden Haven, wh-75) also qualifies.
  return isHavenForPlayer(siteDef, alignment, { state, siteDefinitionId: siteDefId, playerId });
}

/** The MECCG races that cannot mix with Orcs/Trolls (CoE rule 3.25). */
const HERO_RACES = new Set<Race>([Race.Dunadan, Race.Dwarf, Race.Elf, Race.Hobbit]);
/** The MECCG races that cannot mix with hero races (CoE rule 3.25). */
const DARK_RACES = new Set<Race>([Race.Orc, Race.Troll]);

/**
 * Check if combining the given characters would violate the race-mixing
 * restriction (CoE rule 3.25): Dúnedain, Dwarves, Elves, and Hobbits
 * cannot be in the same company as Orcs and Trolls.
 */
function wouldViolateRaceMixing(state: GameState, charInstIds: readonly CardInstanceId[]): boolean {
  let hasHeroRace = false;
  let hasDarkRace = false;
  for (const id of charInstIds) {
    const defId = resolveInstanceId(state, id);
    const def = defId ? defById(state, defId) : undefined;
    if (!def || !isCharacterCard(def)) continue;
    if (HERO_RACES.has(def.race)) hasHeroRace = true;
    if (DARK_RACES.has(def.race)) hasDarkRace = true;
  }
  return hasHeroRace && hasDarkRace;
}

/**
 * Count how many company-bound permanent events in play on `companyId`
 * carry the given effect type. Used for stacking marker effects such as
 * `extra-troll-leader-slot` and `extra-leader-slot`, where each copy in play
 * grants one slot.
 */
function countCompanyCardEffect(state: GameState, companyId: CompanyId, effectType: CardEffect['type']): number {
  let count = 0;
  for (const p of state.players) {
    for (const card of p.cardsInPlay) {
      if ((card.companyId as string | undefined) !== (companyId as string)) continue;
      const def = state.cardPool[card.definitionId];
      if (getCardEffects(def).some(e => e.type === effectType)) count++;
    }
  }
  return count;
}

/**
 * Check if the given characters would violate the leader restriction
 * (CoE rule 3.26): a company may only contain one Leader-keyword character.
 *
 * When `companyId` is provided, checks whether the target company has a
 * company-bound permanent event with `extra-troll-leader-slot` (e.g. *Orders
 * from Lugbúrz*), which allows one Troll Leader in addition to one other
 * leader (total of two leaders, one of which must be a Troll), or with
 * `extra-leader-slot` (e.g. *Orders from the Great Demon*, ba-70), which
 * allows one additional Leader of any race per copy in play.
 */
function wouldViolateLeaderRestriction(
  state: GameState,
  charInstIds: readonly CardInstanceId[],
  companyId?: CompanyId,
): boolean {
  let leaderCount = 0;
  let trollLeaderCount = 0;
  for (const id of charInstIds) {
    const defId = resolveInstanceId(state, id);
    const def = defId ? defById(state, defId) : undefined;
    if (!def || !isCharacterCard(def)) continue;
    // Natural Leader keyword on the character card
    let isLeader = def.keywords?.includes('leader') ?? false;
    // Also check attached items for grant-keyword: 'leader' effects
    if (!isLeader) {
      for (const player of state.players) {
        const char = player.characters[id];
        if (!char) continue;
        for (const item of char.items) {
          const itemDef = state.cardPool[item.definitionId];
          const effects = getCardEffects(itemDef);
          if (effects.some(e => e.type === 'grant-keyword' && (e as { keyword: string }).keyword === 'leader')) {
            isLeader = true;
          }
        }
        break;
      }
    }
    if (isLeader) {
      leaderCount++;
      if (def.race === Race.Troll) trollLeaderCount++;
    }
  }

  if (leaderCount <= 1) return false;

  if (companyId) {
    // When the company has an extra-troll-leader-slot permanent event, one
    // Troll leader is permitted alongside one other leader (total two).
    if (leaderCount === 2 && trollLeaderCount >= 1 && countCompanyCardEffect(state, companyId, 'extra-troll-leader-slot') > 0) {
      logDetail(`wouldViolateLeaderRestriction: extra-troll-leader-slot active on company ${companyId as string} — allowing Troll leader alongside other leader`);
      return false;
    }

    // Each extra-leader-slot permanent event in play permits one additional
    // Leader of any race (e.g. Orders from the Great Demon, ba-70).
    const extraLeaderSlots = countCompanyCardEffect(state, companyId, 'extra-leader-slot');
    if (extraLeaderSlots > 0 && leaderCount <= 1 + extraLeaderSlots) {
      logDetail(`wouldViolateLeaderRestriction: ${extraLeaderSlots} extra-leader-slot(s) active on company ${companyId as string} — allowing ${leaderCount} leaders`);
      return false;
    }
  }

  return leaderCount > 1;
}

export function mergeCompaniesActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  // Build map from site instance ID → companies at that site
  const siteToCompanies = groupCompaniesBySite(player);

  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const companiesAtSite = siteToCompanies.get(company.currentSite.instanceId as string) ?? [];
    if (companiesAtSite.length < 2) continue;

    for (const targetCompany of companiesAtSite) {
      if (targetCompany.id === company.id) continue;

      const atHaven = companyAtHaven(state, targetCompany, player.alignment, player.id);
      const mergedCharIds = [...targetCompany.characters, ...company.characters];

      // Rules 3.24–3.26 apply only at non-haven sites.
      if (!atHaven) {
        const extraLeaderSlots = countCompanyCardEffect(state, targetCompany.id, 'extra-leader-slot')
          + countCompanyCardEffect(state, company.id, 'extra-leader-slot');
        const mergedSize = companyEffectiveSizeExemptingLeaders(state, mergedCharIds, extraLeaderSlots);
        if (mergedSize > 7) {
          logDetail(`  → skip: merge ${company.id as string} into ${targetCompany.id as string} — would exceed size limit (${mergedSize} > 7)`);
          continue;
        }
        if (wouldViolateRaceMixing(state, mergedCharIds)) {
          logDetail(`  → skip: merge ${company.id as string} into ${targetCompany.id as string} — race-mixing restriction (rule 3.25)`);
          continue;
        }
        if (wouldViolateLeaderRestriction(state, mergedCharIds, targetCompany.id)) {
          logDetail(`  → skip: merge ${company.id as string} into ${targetCompany.id as string} — leader restriction (rule 3.26)`);
          continue;
        }
      }

      logDetail(`  → viable: merge company ${company.id as string} into ${targetCompany.id as string}`);
      const candidate: GameAction = {
        type: 'merge-companies',
        player: playerId,
        sourceCompanyId: company.id,
        targetCompanyId: targetCompany.id,
      };
      actions.push(viableWithRegress(candidate, state.reverseActions));
    }
  }

  return actions;
}
