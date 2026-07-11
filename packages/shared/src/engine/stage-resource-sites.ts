/**
 * @module stage-resource-sites
 *
 * Eligibility helpers for pairing a drafted site-targeting Stage resource —
 * Hidden Haven (wh-75) — with a Ruins & Lairs site chosen from the player's
 * own site deck during the Fallen-wizard character draft.
 *
 * A Stage resource is "site-targeting" when it carries a `play-target` effect
 * with `target: 'site'` (only Hidden Haven today). The chosen site must match
 * that effect's site filter — the same filter the site phase evaluates when
 * the card is played normally (`legal-actions/site.ts`). At draft finalize the
 * pairing converts the site into a starting Wizardhaven (unless both players
 * chose the same site definition, CRF 22).
 *
 * These helpers live in their own module rather than `reducer-utils.ts` to
 * avoid an import cycle: they pull `getEffectiveSiteType` from `effective.ts`,
 * which would otherwise be reachable from `reducer-utils.ts` and back.
 */

import type { GameState, CardDefinition, CardInstance, PlayTargetEffect, DraftPlayerState } from '../index.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { isSiteCard } from '../types/cards.js';
import { getEffectiveSiteType } from './effective.js';
import { defById, siteRegionTypeOf, isStageResourceCard } from './reducer-utils.js';

/**
 * True if `def` is a Stage resource that must be paired with a site at draft
 * time — it carries a `play-target` effect with `target: 'site'` (Hidden
 * Haven, wh-75). Detected by effect shape, not card id, so future site-bound
 * Stage resources work unchanged.
 */
export function stageResourceNeedsSite(def: CardDefinition | undefined): boolean {
  if (!isStageResourceCard(def)) return false;
  return !!(def as { effects?: readonly { type: string; target?: string }[] }).effects
    ?.some(e => e.type === 'play-target' && e.target === 'site');
}

/**
 * True if `siteCard` (from a player's site deck) is a valid target for
 * `stageResourceDef`'s `play-target` site filter — i.e. a legal Ruins & Lairs
 * for Hidden Haven. Mirrors the site-filter evaluation in
 * `legal-actions/site.ts` (lines ~848-863): the candidate site definition is
 * augmented with its `regionType` (from the separate region card) and its
 * `effectiveSiteType` (after any active site-type override) so the filter can
 * gate on either. When the play-target effect has no filter, every site
 * qualifies.
 */
export function siteMatchesStageResourceTarget(
  state: GameState,
  stageResourceDef: CardDefinition | undefined,
  siteCard: CardInstance,
): boolean {
  const effects = (stageResourceDef as { effects?: readonly PlayTargetEffect[] } | undefined)?.effects;
  const sitePlayTarget = effects?.find(e => e.type === 'play-target' && e.target === 'site');
  if (!sitePlayTarget) return false;
  const siteDef = defById(state, siteCard.definitionId);
  if (!siteDef || !isSiteCard(siteDef)) return false;
  if (!sitePlayTarget.filter) return true;
  const regionType = siteRegionTypeOf(state, siteDef);
  const effectiveSiteType = getEffectiveSiteType(state, siteDef.id, siteDef.siteType, siteCard.instanceId);
  const matchTarget = {
    ...(siteDef as unknown as Record<string, unknown>),
    regionType,
    effectiveSiteType,
  };
  return matchesCondition(sitePlayTarget.filter, matchTarget);
}

/**
 * The drafted site-targeting Stage resources (Hidden Haven, wh-75) that still
 * lack a paired site, regardless of whether an eligible site exists. Used to
 * enumerate which resources still need a pairing offer.
 */
export function unpairedSiteStageResources(
  state: GameState,
  draftPlayer: DraftPlayerState,
): readonly CardInstance[] {
  const pairings = draftPlayer.stageResourceSites ?? [];
  return draftPlayer.draftedStageResources.filter(
    c => stageResourceNeedsSite(defById(state, c.definitionId))
      && !pairings.some(p => p.stageResourceInstanceId === c.instanceId),
  );
}

/**
 * The unpaired site-targeting Stage resources for which the player's site deck
 * actually contains at least one eligible Ruins & Lairs — i.e. a pairing is
 * possible right now. CRF 22 requires the site to be brought out when Hidden
 * Haven is revealed, so while any such resource exists the draft stays open: it
 * blocks stopping (`legal-actions/draft.ts`, `reducer-setup.ts`) and suppresses
 * the auto-stop on hitting the company-size / mind / empty-pool limits. When no
 * eligible site exists (e.g. the deck has no qualifying Ruins & Lairs), the
 * requirement cannot be met, so it does NOT block — the unpaired Hidden Haven
 * simply falls to hand at finalize to be played normally later.
 */
export function blockingSiteStageResources(
  state: GameState,
  draftPlayer: DraftPlayerState,
  siteDeck: readonly CardInstance[],
): readonly CardInstance[] {
  return unpairedSiteStageResources(state, draftPlayer).filter(sr => {
    const def = defById(state, sr.definitionId);
    return siteDeck.some(siteCard => siteMatchesStageResourceTarget(state, def, siteCard));
  });
}
