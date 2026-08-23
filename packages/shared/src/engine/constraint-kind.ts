/**
 * @module constraint-kind
 *
 * Builds the {@link ActiveConstraint} `kind` payload (and resolves the
 * active company's bound site) for the add-constraint applies declared by
 * short events and permanent events. Extracted from `chain-reducer.ts` into
 * this neutral leaf module — it depends only on `reducer-utils`, the state
 * helpers, and the type modules, and is imported by chain-reducer rather
 * than the reverse — so the shared apply dispatcher (`apply-dispatcher.ts`)
 * can reach it without forming an `apply-dispatcher` <-> `chain-reducer`
 * import cycle when add-constraint migrates onto the dispatcher.
 *
 * Pure relocation: the logic is unchanged from its previous home.
 */

import type { GameState } from '../index.js';
import type { SiteFlag } from '../types/pending.js';
import type { Race } from '../types/common.js';
import { Alignment } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { activePlayerState } from './reducer-utils.js';
import { resolveInstanceId } from '../types/state.js';

/**
 * Map a DSL constraint-scope name to a {@link ConstraintScope}, using
 * `companyId` for the company-bound scopes. Returns null for an unknown scope
 * or a company-bound scope with no company. Shared by every add-constraint
 * applier (chain short-event arrival/self-enters-play, M/H arrival, play-option).
 */
export function parseConstraintScope(
  scopeName: string,
  companyId: import('../types/common.js').CompanyId | null,
): import('../types/pending.js').ConstraintScope | null {
  switch (scopeName) {
    case 'turn':
      return { kind: 'turn' };
    case 'until-cleared':
      return { kind: 'until-cleared' };
    case 'company-site-phase':
    case 'company-mh-phase':
      return companyId ? { kind: scopeName, companyId } : null;
    default:
      return null;
  }
}

/**
 * Site-bound constraint flags that bind to the site the card is played on
 * (the explicit play-action site, else the active site-phase company's
 * current site). All produce one {@link SiteFlag} `site-flag` constraint with
 * the same `{ siteDefinitionId }` shape and resolution, differing only in the
 * flag — e.g. Rebuild the Town, Double-dealing (wh-66), Guarded Haven (wh-74) /
 * Fortress of Isen (wh-68), Saruman's Machinery (wh-120). The map key is the
 * DSL constraint name; the value is the {@link SiteFlag} it produces.
 */
const SITE_BOUND_FLAGS: Record<string, SiteFlag> = {
  'skip-automatic-attacks': 'skip-automatic-attacks',
  'wizardhaven-conversion': 'wizardhaven-conversion',
  'site-nothing-playable': 'site-nothing-playable-as-written',
  'cancel-attacks-at-site': 'cancel-attacks-at-site',
  'cross-alignment-resources-unlocked': 'cross-alignment-resources-unlocked',
  'site-protected': 'site-protected',
  'technology-item-unlocked': 'technology-item-unlocked',
};

/**
 * Build the {@link ActiveConstraint} `kind` payload for a supported
 * constraint name. Returns null when the constraint name is unknown or
 * when required fields are missing from the effect. Shared between the
 * short-event and permanent-event add-constraint code paths.
 */
export function buildConstraintKind(
  state: GameState,
  onEvent: import('../types/effects.js').OnEventEffect,
  constraintKind: string,
  explicitSiteDefId?: import('../types/common.js').CardDefinitionId,
): import('../types/pending.js').ActiveConstraint['kind'] | null {
  // Site-bound flags all resolve the played-at site and differ only in flag.
  const siteFlag = SITE_BOUND_FLAGS[constraintKind];
  if (siteFlag) {
    const siteDefId = explicitSiteDefId ?? activeCompanySiteDefId(state);
    if (!siteDefId) return null;
    return { type: 'site-flag', flag: siteFlag, siteDefinitionId: siteDefId };
  }
  switch (constraintKind) {
    case 'site-phase-do-nothing':
      return { type: 'site-phase-do-nothing' };
    case 'no-creature-hazards-on-company':
      return { type: 'no-creature-hazards-on-company' };
    case 'only-creatures-keyed-to-site':
      return { type: 'only-creatures-keyed-to-site' };
    case 'only-creatures-keyed-to-site-at-ruins-lairs':
      return { type: 'only-creatures-keyed-to-site-at-ruins-lairs' };
    case 'only-creatures-keyed-to-site-if-safe-path':
      return { type: 'only-creatures-keyed-to-site-if-safe-path' };
    case 'extra-mh-phase': {
      // Master of Esgaroth (td-135). The destination gate is stored on the
      // constraint and evaluated when the company's M/H phase ends, since the
      // card is played before the move resolves.
      const required = (onEvent.apply as { requiresDestinationSiteType?: import('../types/common.js').SiteType })
        .requiresDestinationSiteType;
      return { type: 'extra-mh-phase', ...(required ? { requiresDestinationSiteType: required } : {}) };
    }
    case 'no-creatures-keyed-to-site': {
      const unless = (onEvent.apply as { unlessSiteRegionType?: import('../types/common.js').RegionType }).unlessSiteRegionType;
      return { type: 'no-creatures-keyed-to-site', ...(unless ? { unlessSiteRegionType: unless } : {}) };
    }
    case 'deny-scout-resources':
      return { type: 'deny-scout-resources' };
    case 'auto-attack-prowess-boost': {
      const value = (onEvent.apply as { value?: number }).value;
      const siteType = (onEvent.apply as { siteType?: import('../types/common.js').SiteType }).siteType;
      if (value === undefined || !siteType) return null;
      return {
        type: 'attribute-modifier',
        attribute: 'auto-attack.prowess',
        op: 'add',
        value,
        filter: { 'site.type': siteType },
      };
    }
    case 'site-type-override': {
      const overrideType = (onEvent.apply as { overrideType?: import('../types/common.js').SiteType }).overrideType;
      if (!overrideType) return null;
      const ps = state.phaseState;
      let siteDefinitionId: import('../types/common.js').CardDefinitionId | null = explicitSiteDefId ?? null;
      if (siteDefinitionId === null && ps.phase === Phase.MovementHazard) {
        // M/H phase: resolve from active company's destination site
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[ps.activeCompanyIndex];
        if (company?.destinationSite?.instanceId) {
          siteDefinitionId = resolveInstanceId(state, company.destinationSite.instanceId) ?? null;
        }
        if (!siteDefinitionId && ps.destinationSiteName) {
          for (const [defId, d] of Object.entries(state.cardPool)) {
            const ct = (d as { cardType?: string }).cardType;
            const name = (d as { name?: string }).name;
            if (ct?.includes('site') && name === ps.destinationSiteName) {
              siteDefinitionId = defId as import('../types/common.js').CardDefinitionId;
              break;
            }
          }
        }
      } else if (ps.phase === Phase.Site) {
        // Site phase: resolve from active company's current site
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[ps.activeCompanyIndex];
        if (company?.currentSite) {
          siteDefinitionId = company.currentSite.definitionId;
        }
      }
      if (!siteDefinitionId) return null;
      // Houses of Healing (td-125): `purpose: 'healing'` makes this a
      // healing-only override — `getEffectiveSiteType` skips it, so only the
      // untap-phase haven-healing sweep honours it.
      // The White Tree (tw-348): `purpose: 'healing-and-hazards'` still lets
      // every general consumer of `getEffectiveSiteType` see the override
      // (hazard keying, movement, item/faction/ally playability, healing),
      // but flags it `excludesCharacterPlay` so character recruiting does not
      // treat the site as a haven.
      const purpose = (onEvent.apply as { purpose?: string }).purpose;
      // Nature's Revenge (wh-27): "All versions of the site become Ruins &
      // Lairs" — scope the override by printed *name* so the hero, minion,
      // Fallen-wizard and Balrog printings of the location (distinct
      // definitions sharing a name) are all retyped, not just the one the
      // card was played on.
      const allVersions = (onEvent.apply as { allVersions?: boolean }).allVersions === true;
      const siteName = (state.cardPool[siteDefinitionId] as { name?: string } | undefined)?.name;
      if (allVersions && siteName === undefined) return null;
      return {
        type: 'attribute-modifier',
        attribute: 'site.type',
        op: 'override',
        value: overrideType,
        filter: allVersions
          ? { 'site.name': siteName! }
          : { 'site.definitionId': siteDefinitionId as string },
        ...(purpose === 'healing' ? { healingOnly: true } : {}),
        ...(purpose === 'healing-and-hazards' ? { excludesCharacterPlay: true } : {}),
      };
    }
    case 'region-type-override': {
      const overrideType = (onEvent.apply as { overrideType?: import('../types/common.js').RegionType }).overrideType;
      let regionName = (onEvent.apply as { regionName?: string }).regionName;
      if (!overrideType || !regionName) return null;
      // Special token: pick the destination region (last entry in the
      // resolved site-path names) for the active company. This lets a
      // short event declare "transform wherever the company is going"
      // without knowing specific region names at card-definition time.
      if (regionName === 'destination' && state.phaseState.phase === Phase.MovementHazard) {
        const mh = state.phaseState;
        if (mh.resolvedSitePathNames.length === 0) return null;
        regionName = mh.resolvedSitePathNames[mh.resolvedSitePathNames.length - 1];
      }
      return {
        type: 'attribute-modifier',
        attribute: 'region.type',
        op: 'override',
        value: overrideType,
        filter: { 'region.name': regionName },
      };
    }
    case 'auto-attacks-detainment': {
      // "All automatic-attacks become detainment" (Hold Rebuilt and Repaired,
      // as-88). Resolve the bound site from the active company's current site
      // during the site phase and flag every automatic-attack at that site
      // (by definition id) as detainment for as long as the constraint lives.
      const ps = state.phaseState;
      let siteDefId: import('../types/common.js').CardDefinitionId | null = null;
      if (ps.phase === Phase.Site) {
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[ps.activeCompanyIndex];
        if (company?.currentSite) {
          siteDefId = company.currentSite.definitionId;
        }
      }
      if (!siteDefId) return null;
      return {
        type: 'attribute-modifier',
        attribute: 'auto-attack.detainment',
        op: 'override',
        value: 1,
        filter: { 'site.definitionId': siteDefId as string },
      };
    }
    case 'mirror-automatic-attacks': {
      // Whole Villages Roused (wh-31): only ever installed via the
      // company-arrives-at-site arrival trigger, so the destination site is
      // resolved exactly like site-type-override's M/H branch.
      if (state.phaseState.phase !== Phase.MovementHazard) return null;
      const activePlayer = activePlayerState(state);
      const company = activePlayer?.companies[state.phaseState.activeCompanyIndex];
      const siteInstanceId = company?.destinationSite?.instanceId;
      if (!siteInstanceId) return null;
      const siteDefId = resolveInstanceId(state, siteInstanceId);
      if (!siteDefId) return null;
      const siteDef = state.cardPool[siteDefId] as { name?: string; cardType?: string } | undefined;
      if (!siteDef?.name || (siteDef.cardType !== 'hero-site' && siteDef.cardType !== 'minion-site')) return null;

      // The "corresponding" site card: same printed name, the other alignment.
      const mirrorCardType = siteDef.cardType === 'hero-site' ? 'minion-site' : 'hero-site';
      const mirrorEntry = Object.entries(state.cardPool).find(
        ([, d]) => (d as { name?: string; cardType?: string }).name === siteDef.name
          && (d as { cardType?: string }).cardType === mirrorCardType,
      );
      if (!mirrorEntry) return null;
      const mirrorSiteDefinitionId = mirrorEntry[0] as import('../types/common.js').CardDefinitionId;
      const prowessBoost = (onEvent.apply as { value?: number }).value ?? 0;

      if (siteDef.cardType === 'hero-site') {
        // "The site has the automatic-attacks indicated on the corresponding
        // minion site card (detainment against hero companies)".
        const heroPlayer = state.players.find(
          p => p.alignment === Alignment.Wizard || p.alignment === Alignment.FallenWizard,
        );
        return {
          type: 'mirror-automatic-attacks',
          siteInstanceId,
          mirrorSiteDefinitionId,
          prowessBoost,
          ...(heroPlayer ? { detainmentAgainstPlayer: heroPlayer.id } : {}),
        };
      }
      // "The site has the automatic-attacks indicated on the corresponding
      // hero site card (detainment against overt companies)".
      return {
        type: 'mirror-automatic-attacks',
        siteInstanceId,
        mirrorSiteDefinitionId,
        prowessBoost,
        detainmentAgainstOvert: true,
      };
    }
    case 'hazard-limit-multiplier': {
      const value = (onEvent.apply as { value?: number }).value;
      if (typeof value !== 'number') return null;
      return { type: 'hazard-limit-multiplier', value };
    }
    case 'auto-attack-duplicate':
      return { type: 'auto-attack-duplicate' };
    case 'auto-attack-race-duplicate': {
      const race = (onEvent.apply as { race?: Race }).race;
      if (!race) return null;
      return { type: 'auto-attack-race-duplicate', race };
    }
    case 'only-race-creatures-on-company': {
      const race = (onEvent.apply as { race?: Race }).race;
      if (!race) return null;
      return { type: 'only-race-creatures-on-company', race };
    }
    case 'hazard-limit-modifier': {
      const value = (onEvent.apply as { value?: number }).value;
      if (typeof value !== 'number') return null;
      return { type: 'hazard-limit-modifier', value };
    }
    case 'hazard-limit-region-count': {
      // Lost in Border-lands (tw-51/le-118) and its "Lost in X" siblings: a
      // hazard-event short event ("its hazard limit increases by one for
      // every <region type> in its site path"), unlike Fair Sailing
      // (tw-232, a resource short event routed through
      // `applyShortEventOnEntersPlay` in reducer-events.ts). Hazard short
      // events resolve through the chain's generic self-enters-play
      // add-constraint path (`applyAddConstraintFromOnEvent`), which builds
      // its constraint kind here — so this kind needs its own case in this
      // builder even though the constraint itself (and its consumption in
      // `snapshotHazardLimit`/`effectiveHazardLimit`) is shared.
      const apply = onEvent.apply as { regionType?: import('../types/common.js').RegionType; value?: number; floor?: number };
      const { regionType, value: perCount, floor } = apply;
      if (!regionType || typeof perCount !== 'number' || typeof floor !== 'number') return null;
      return { type: 'hazard-limit-region-count', regionType, perCount, floor };
    }
    case 'nazgul-boost-pending': {
      const apply = onEvent.apply as {
        race?: Race;
        strikesModifier?: number;
        prowessModifier?: number;
        grantAttackerChoosesDefenders?: true;
        keyingRegionTypes?: import('../types/common.js').RegionType[];
        keyingSiteTypes?: import('../types/common.js').SiteType[];
      };
      if (!apply.race || apply.strikesModifier === undefined || apply.prowessModifier === undefined) return null;
      return {
        type: 'nazgul-boost-pending',
        race: apply.race,
        strikesModifier: apply.strikesModifier,
        prowessModifier: apply.prowessModifier,
        grantAttackerChoosesDefenders: true,
        ...(apply.keyingRegionTypes ? { keyingRegionTypes: apply.keyingRegionTypes } : {}),
        ...(apply.keyingSiteTypes ? { keyingSiteTypes: apply.keyingSiteTypes } : {}),
      };
    }
    case 'granted-action': {
      const payload = (onEvent.apply as { grantedAction?: import('../types/effects.js').GrantedActionConstraintPayload }).grantedAction;
      if (!payload) return null;
      return {
        type: 'granted-action',
        action: payload.action,
        phase: payload.phase as import('../types/state-phases.js').Phase | undefined,
        window: payload.window,
        cost: payload.cost,
        when: payload.when,
        apply: payload.apply,
      };
    }
    default:
      return null;
  }
}

/**
 * Resolve the definition id of the site the active company currently occupies
 * during the site phase. Shared by the site-bound permanent-event constraints
 * (Hidden Haven's Wizardhaven conversion, playability suppression, and
 * attack cancellation), which all bind to "the site the card is played at".
 * Returns null outside the site phase or when the company has no current site.
 */
function activeCompanySiteDefId(
  state: GameState,
): import('../types/common.js').CardDefinitionId | null {
  const ps = state.phaseState;
  if (ps.phase !== Phase.Site) return null;
  const activePlayer = activePlayerState(state);
  const company = activePlayer?.companies[ps.activeCompanyIndex];
  return company?.currentSite?.definitionId ?? null;
}
