/**
 * @module forced-join
 *
 * CoE rule 2.IV.6.1 — the failure branch of the forced end-of-movement/hazard
 * join (rule 2.IV.6):
 *
 * > If a resource player attempts to join multiple companies at the end of a
 * > turn's movement/hazard phases but doing so would violate a company
 * > composition rule, only one company of the hazard player's choice remains
 * > and the other(s) must immediately return to their site(s) of origin.
 *
 * Runs in `finalizeCompanyMH` immediately before `autoMergeNonHavenCompanies`.
 * For every group of the resource player's companies sharing a non-haven site
 * whose union would break a composition rule (see
 * `joinCompositionViolation` — size max of seven, race mixing, leaders,
 * Ringwraith companies), the companies that cannot stay are sent back to the
 * site they left at M/H Step 8 (`Company.arrivedFrom`). A company that did not
 * move (or whose origin site can no longer be recovered) cannot be sent back,
 * so it is the only possible survivor; when more than one company could
 * survive, the hazard player picks via a `forced-join-keep-company` pending
 * resolution answered with `select-company`.
 */
import type { GameState, GameAction, PlayerId, EvaluatedAction, PendingResolution, Company, CompanyId, SiteInPlay } from '../index.js';
import { isSiteCard } from '../types/cards.js';
import { SiteType } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { getPlayerIndex } from '../state-utils.js';
import { logDetail } from './legal-actions/log.js';
import { joinCompositionViolation } from './legal-actions/organization-companies.js';
import { defById, findById, removeById, updatePlayer } from './reducer-utils.js';
import type { ReducerResult } from './reducer-utils.js';
import { enqueueResolution, dequeueResolution } from './pending.js';

/**
 * Where a company's recorded origin site can be recovered from: shared with
 * another of the owner's companies still standing there, or pulled back out of
 * one of the owner's site piles (Step 8 returned it to the location deck, or
 * discarded it if tapped, or stored it out of play for stolen knowledge).
 */
type OriginSource = 'sibling' | 'siteDeck' | 'siteDiscardPile' | 'outOfPlayPile';

/**
 * Locate the origin site of `company` (its `arrivedFrom`), or `null` when the
 * company did not move this turn, its origin is the site it is at, or the
 * origin card cannot be found any more (e.g. an `acts-as-site` card that was
 * discarded on leaving).
 */
function locateOrigin(state: GameState, playerIndex: number, company: Company): { site: SiteInPlay; source: OriginSource } | null {
  const origin = company.arrivedFrom;
  if (!origin || !company.currentSite) return null;
  if (origin.instanceId === company.currentSite.instanceId) return null;
  const player = state.players[playerIndex];
  const sibling = player.companies.find(c => c.id !== company.id && c.currentSite?.instanceId === origin.instanceId);
  if (sibling?.currentSite) return { site: sibling.currentSite, source: 'sibling' };
  if (findById(player.siteDeck, origin.instanceId)) return { site: origin, source: 'siteDeck' };
  if (findById(player.siteDiscardPile, origin.instanceId)) return { site: origin, source: 'siteDiscardPile' };
  if (findById(player.outOfPlayPile, origin.instanceId)) return { site: origin, source: 'outOfPlayPile' };
  return null;
}

/**
 * Send `companyId` back to the site it left this turn (rule 2.IV.6.1). The
 * origin site card is reclaimed from wherever Step 8 put it (or shared with a
 * sibling company still there). Any on-guard cards the company held stay at
 * the site it is leaving, so they pass to `keptCompanyId`, which also takes
 * over the physical site card if the departing company was holding it.
 */
function returnCompanyToOrigin(state: GameState, playerIndex: number, companyId: CompanyId, keptCompanyId: CompanyId): GameState {
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === companyId);
  if (!company) return state;
  const located = locateOrigin(state, playerIndex, company);
  if (!located) {
    logDetail(`Rule 2.IV.6.1: company ${companyId as string} has no recoverable site of origin — cannot return it`);
    return state;
  }
  const { site, source } = located;
  const siteName = defById(state, site.definitionId)?.name ?? (site.definitionId as string);
  logDetail(`Rule 2.IV.6.1: company ${companyId as string} returns to its site of origin ${siteName} (${site.status as string}, reclaimed from ${source})`);

  return updatePlayer(state, playerIndex, p => {
    const companies = p.companies.map(c => {
      if (c.id === companyId) {
        return {
          ...c,
          currentSite: { instanceId: site.instanceId, definitionId: site.definitionId, status: site.status },
          siteCardOwned: source !== 'sibling',
          onGuardCards: [],
          arrivedFrom: undefined,
        };
      }
      if (c.id === keptCompanyId) {
        return {
          ...c,
          siteCardOwned: c.siteCardOwned || company.siteCardOwned,
          onGuardCards: [...c.onGuardCards, ...company.onGuardCards],
        };
      }
      return c;
    });
    return {
      ...p,
      companies,
      siteDeck: source === 'siteDeck' ? removeById(p.siteDeck, site.instanceId) : p.siteDeck,
      siteDiscardPile: source === 'siteDiscardPile' ? removeById(p.siteDiscardPile, site.instanceId) : p.siteDiscardPile,
      outOfPlayPile: source === 'outOfPlayPile' ? removeById(p.outOfPlayPile, site.instanceId) : p.outOfPlayPile,
    };
  });
}

/** Keep `keepId` at the shared site and return every other company in `companyIds` to its origin. */
function keepOnlyCompany(state: GameState, playerIndex: number, companyIds: readonly CompanyId[], keepId: CompanyId): GameState {
  logDetail(`Rule 2.IV.6.1: company ${keepId as string} remains; returning ${companyIds.filter(id => id !== keepId).join(', ')} to their sites of origin`);
  let s = state;
  for (const id of companyIds) {
    if (id === keepId) continue;
    s = returnCompanyToOrigin(s, playerIndex, id, keepId);
  }
  return updatePlayer(s, playerIndex, p => ({
    ...p,
    companies: p.companies.map(c => c.id === keepId ? { ...c, arrivedFrom: undefined } : c),
  }));
}

/**
 * Apply rule 2.IV.6.1 to the resource player's companies at the end of all
 * movement/hazard phases. Must run before `autoMergeNonHavenCompanies`, which
 * then only joins the groups that can legally combine (and skips any group
 * still awaiting the hazard player's `forced-join-keep-company` choice).
 */
export function resolveForcedJoinConflicts(state: GameState, playerIndex: number): GameState {
  const initial = state.players[playerIndex];
  if (initial.companies.length < 2) return state;

  // Same grouping as `autoMergeNonHavenCompanies` (Left Behind companies are
  // never forced to combine; havens never force a join).
  const groups = new Map<string, Company[]>();
  for (const c of initial.companies) {
    if (!c.currentSite || c.leftBehind) continue;
    const key = c.currentSite.instanceId as string;
    const existing = groups.get(key);
    if (existing) existing.push(c);
    else groups.set(key, [c]);
  }

  let s = state;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const siteDef = defById(s, group[0].currentSite!.definitionId);
    if (isSiteCard(siteDef) && siteDef.siteType === SiteType.Haven) continue;
    const player = s.players[playerIndex];
    const violation = joinCompositionViolation(s, player, group[0], group.slice(1));
    const ids = group.map(c => c.id);
    if (!violation) {
      logDetail(`Rule 2.IV.6: companies ${ids.join(', ')} at ${siteDef?.name ?? '?'} can legally join`);
      continue;
    }
    logDetail(`Rule 2.IV.6.1: joining companies ${ids.join(', ')} at ${siteDef?.name ?? '?'} would break company composition — ${violation}`);

    const candidates = group.filter(keep =>
      group.every(other => other.id === keep.id || locateOrigin(s, playerIndex, other) !== null));
    for (const c of group) {
      const canStay = candidates.includes(c);
      logDetail(`  ${c.id as string}: ${canStay ? 'may remain' : 'cannot remain (another company here has no site of origin to return to)'}`);
    }
    if (candidates.length === 0) {
      logDetail(`Rule 2.IV.6.1: no company can be left alone at the site (origins unrecoverable) — falling back to the plain join`);
      continue;
    }
    if (candidates.length === 1) {
      s = keepOnlyCompany(s, playerIndex, ids, candidates[0].id);
      continue;
    }
    const hazard = s.players.find(p => p.id !== player.id)!;
    logDetail(`Rule 2.IV.6.1: ${candidates.length} companies could remain — hazard player ${hazard.name} chooses`);
    s = enqueueResolution(s, {
      source: null,
      actor: hazard.id,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'forced-join-keep-company',
        ownerId: player.id,
        companyIds: ids,
        candidateCompanyIds: candidates.map(c => c.id),
      },
    });
  }
  return s;
}

/**
 * Legal actions for a `forced-join-keep-company` resolution: the hazard player
 * names, with `select-company`, the one company that stays at the site.
 */
export function forcedJoinKeepCompanyActions(state: GameState, actor: PlayerId, top: PendingResolution): EvaluatedAction[] {
  const kind = top.kind;
  if (kind.type !== 'forced-join-keep-company') return [];
  const owner = state.players.find(p => p.id === kind.ownerId);
  if (!owner) return [];
  const actions: EvaluatedAction[] = [];
  for (const id of kind.candidateCompanyIds) {
    if (!owner.companies.some(c => c.id === id)) continue;
    logDetail(`forced-join-keep-company: hazard player may keep ${id as string} at the site`);
    actions.push({ action: { type: 'select-company', player: actor, companyId: id }, viable: true });
  }
  return actions;
}

/**
 * Apply the hazard player's `select-company` choice for a
 * `forced-join-keep-company` resolution: the named company remains, every
 * other company of the failed join returns to its site of origin.
 */
export function applyForcedJoinKeepCompanyResolution(state: GameState, action: GameAction, top: PendingResolution): ReducerResult | null {
  const kind = top.kind;
  if (kind.type !== 'forced-join-keep-company') return null;
  if (action.type !== 'select-company') {
    return { state, error: `Pending forced-join-keep-company requires 'select-company', got '${action.type}'` };
  }
  if (action.player !== top.actor) return { state, error: 'Wrong player for pending forced-join-keep-company' };
  if (!kind.candidateCompanyIds.includes(action.companyId)) {
    return { state, error: `forced-join-keep-company: ${action.companyId as string} is not a company that may remain` };
  }
  const ownerIndex = getPlayerIndex(state, kind.ownerId);
  logDetail(`forced-join-keep-company: hazard player keeps ${action.companyId as string}`);
  return { state: dequeueResolution(keepOnlyCompany(state, ownerIndex, kind.companyIds, action.companyId), top.id) };
}
