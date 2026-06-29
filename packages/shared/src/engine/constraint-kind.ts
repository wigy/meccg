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
import { Phase } from '../types/state-phases.js';
import { activePlayerState } from './reducer-utils.js';
import { resolveInstanceId } from '../types/state.js';

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
  switch (constraintKind) {
    case 'site-phase-do-nothing':
      return { type: 'site-phase-do-nothing' };
    case 'no-creature-hazards-on-company':
      return { type: 'no-creature-hazards-on-company' };
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
      return {
        type: 'attribute-modifier',
        attribute: 'site.type',
        op: 'override',
        value: overrideType,
        filter: { 'site.definitionId': siteDefinitionId as string },
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
    case 'auto-attack-duplicate':
      return { type: 'auto-attack-duplicate' };
    case 'auto-attack-race-duplicate': {
      const race = (onEvent.apply as { race?: string }).race;
      if (!race) return null;
      return { type: 'auto-attack-race-duplicate', race };
    }
    case 'granted-action': {
      const payload = onEvent.apply.grantedAction;
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
    case 'skip-automatic-attacks': {
      const ps = state.phaseState;
      let siteDefId: import('../types/common.js').CardDefinitionId | null = explicitSiteDefId ?? null;
      if (siteDefId === null && ps.phase === Phase.Site) {
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[ps.activeCompanyIndex];
        if (company?.currentSite) {
          siteDefId = company.currentSite.definitionId;
        }
      }
      if (!siteDefId) return null;
      return { type: 'skip-automatic-attacks', siteDefinitionId: siteDefId };
    }
    case 'wizardhaven-conversion': {
      const siteDefId = explicitSiteDefId ?? activeCompanySiteDefId(state);
      if (!siteDefId) return null;
      return { type: 'wizardhaven-conversion', siteDefinitionId: siteDefId };
    }
    case 'site-nothing-playable': {
      const siteDefId = explicitSiteDefId ?? activeCompanySiteDefId(state);
      if (!siteDefId) return null;
      return { type: 'site-nothing-playable-as-written', siteDefinitionId: siteDefId };
    }
    case 'cancel-attacks-at-site': {
      const siteDefId = explicitSiteDefId ?? activeCompanySiteDefId(state);
      if (!siteDefId) return null;
      return { type: 'cancel-attacks-at-site', siteDefinitionId: siteDefId };
    }
    case 'cross-alignment-resources-unlocked': {
      // Double-dealing (wh-66): bind to the site the card is played on. The play
      // action carries the bound site (`explicitSiteDefId`); these site-targeting
      // Stage resources are played during the organization phase (rule 5.F1),
      // where there is no active site-phase company, so prefer the explicit site.
      const siteDefId = explicitSiteDefId ?? activeCompanySiteDefId(state);
      if (!siteDefId) return null;
      return { type: 'cross-alignment-resources-unlocked', siteDefinitionId: siteDefId };
    }
    case 'site-protected': {
      // Guarded Haven (wh-74) / The Fortress of Isen (wh-68) / Fortress of the
      // Towers (wh-69): bind to the Wizardhaven the card is played on so the
      // opponent may not play marshalling-point cards at any version of it.
      const siteDefId = explicitSiteDefId ?? activeCompanySiteDefId(state);
      if (!siteDefId) return null;
      return { type: 'site-protected', siteDefinitionId: siteDefId };
    }
    case 'technology-item-unlocked': {
      // Saruman's Machinery (wh-120): bind to the protected Isengard / The
      // White Towers the card is played on so one Technology item may be played
      // there whether the site is tapped or untapped.
      const siteDefId = explicitSiteDefId ?? activeCompanySiteDefId(state);
      if (!siteDefId) return null;
      return { type: 'technology-item-unlocked', siteDefinitionId: siteDefId };
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
