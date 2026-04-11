/**
 * @module company-site
 *
 * Renders the site area for a company: current site card, movement path
 * with region cards or arrows, destination site, and on-guard overlays.
 * Also provides helpers for resolving card definitions and computing
 * region types along a movement path.
 */

import type {
  PlayerView,
  GameAction,
  CardDefinition,
  CardInstanceId,
  Company,
  OpponentCompanyView,
  DeclarePathAction,
  RegionType,
} from '@meccg/shared';
import { cardImageProxyPath, isSiteCard, Phase, CardStatus, viableActions, describeAction } from '@meccg/shared';
import { createCardImage, createRegionTypeIcon } from './render-utils.js';
import { openMovementViewer, getSelectedHazardForPlay, getSelectedHazardOnGuardAction, clearHazardPlaySelection } from './render.js';
import { getCachedInstanceLookup } from './company-view-state.js';

/** Resolve a card instance ID to its definition via the cached instance lookup. */
export function resolveCardDef(
  instanceId: CardInstanceId,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): CardDefinition | undefined {
  const defId = getCachedInstanceLookup()(instanceId);
  return defId ? cardPool[defId as string] : undefined;
}

/**
 * Get the region types traversed for a movement path action.
 *
 * For starter movement: uses the site's `sitePath` (haven to non-haven or
 * non-haven to haven) or the origin haven's `havenPaths` (haven to haven).
 * For region movement: looks up each region's `regionType` from the card pool.
 */
export function getPathRegionTypes(
  action: DeclarePathAction,
  originDef: CardDefinition | undefined,
  destDef: CardDefinition | undefined,
  cardPool: Readonly<Record<string, CardDefinition>>,
): RegionType[] {
  if (action.movementType === 'starter') {
    if (!originDef || !destDef || !isSiteCard(originDef) || !isSiteCard(destDef)) return [];
    const originIsHaven = originDef.siteType === 'haven';
    const destIsHaven = destDef.siteType === 'haven';
    if (originIsHaven && destIsHaven) {
      return [...(originDef.havenPaths?.[destDef.name] ?? [])];
    }
    if (originIsHaven && !destIsHaven) {
      return [...destDef.sitePath];
    }
    if (!originIsHaven && destIsHaven) {
      return [...originDef.sitePath];
    }
    return [];
  }

  if (action.movementType === 'region' && action.regionPath) {
    const types: RegionType[] = [];
    for (const id of action.regionPath) {
      const def = cardPool[id as string];
      if (def && def.cardType === 'region') {
        types.push(def.regionType);
      }
    }
    return types;
  }

  return [];
}

/**
 * If a hazard is selected for character targeting, make a site card clickable
 * to place the hazard on-guard instead. Returns true if the handler was applied.
 */
function applyHazardOnGuardClick(
  img: HTMLImageElement,
  onAction?: (action: GameAction) => void,
): boolean {
  const selectedHazard = getSelectedHazardForPlay();
  if (!selectedHazard || !onAction) return false;
  const ogAction = getSelectedHazardOnGuardAction();
  if (!ogAction) return false;
  img.classList.add('company-card--influence-target');
  img.style.cursor = 'pointer';
  img.addEventListener('click', (e) => {
    e.stopPropagation();
    clearHazardPlaySelection();
    onAction(ogAction);
  });
  return true;
}

/**
 * Render the site area for a company: current site, movement path, destination.
 */
export function renderSiteArea(
  company: Company | OpponentCompanyView,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  options?: { hasLegalMovement?: boolean; onAction?: (action: GameAction) => void },
): HTMLElement {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const area = document.createElement('div');
  area.className = 'company-site-area';

  // Current site
  if (company.currentSite) {
    const siteDefId = cachedInstanceLookup(company.currentSite.instanceId);
    if (siteDefId) {
      const siteDef = cardPool[siteDefId as string];
      if (siteDef) {
        const imgPath = cardImageProxyPath(siteDef);
        if (imgPath) {
          const siteOwned = company.siteCardOwned !== false;
          let cls = 'company-card company-card--site';
          if (company.currentSite.status === CardStatus.Tapped) cls += ' company-card--tapped';
          if (options?.hasLegalMovement) cls += ' company-card--movable';
          if (!siteOwned) cls += ' company-card--site-ghost';
          const img = createCardImage(siteDefId as string, siteDef, imgPath, cls, company.currentSite.instanceId);
          if (options?.hasLegalMovement && options.onAction) {
            const companyId = company.id as string;
            const onAction = options.onAction;
            img.addEventListener('click', (e) => {
              e.stopPropagation();
              openMovementViewer(view, cardPool, companyId, onAction);
            });
          } else {
            applyHazardOnGuardClick(img, options?.onAction);
          }
          area.appendChild(img);
        }
      }
    }
  }

  // Path choice list during reveal-new-site step — only for the active company
  if (options?.onAction && view.phaseState.phase === Phase.MovementHazard && view.phaseState.step === 'reveal-new-site') {
    const isSelfTurn = view.activePlayer === view.self.id;
    const resourceCompanies = isSelfTurn ? view.self.companies : view.opponent.companies;
    const mhActiveCompany = resourceCompanies[view.phaseState.activeCompanyIndex];
    const isActiveCompany = mhActiveCompany && company.id === mhActiveCompany.id;
    const pathActions = isActiveCompany ? viableActions(view.legalActions).filter(
      (a): a is DeclarePathAction => a.type === 'declare-path',
    ) : [];
    if (pathActions.length > 0) {
      const originDef = company.currentSite ? resolveCardDef(company.currentSite.instanceId, view, cardPool) : undefined;
      const destSiteId = 'destinationSite' in company ? company.destinationSite?.instanceId ?? null : null;
      const destDef = destSiteId ? resolveCardDef(destSiteId, view, cardPool) : undefined;

      const pathList = document.createElement('div');
      pathList.className = 'path-choice-list';
      for (const action of pathActions) {
        const btn = document.createElement('button');
        btn.className = 'char-action-tooltip__btn';

        const label = document.createElement('div');
        label.textContent = describeAction(action, cardPool);
        btn.appendChild(label);

        const regionTypes = getPathRegionTypes(action, originDef, destDef, cardPool);
        if (regionTypes.length > 0) {
          const detail = document.createElement('div');
          detail.className = 'path-choice-detail';
          for (const rt of regionTypes) {
            detail.appendChild(createRegionTypeIcon(rt, 32));
          }
          btn.appendChild(detail);
        }

        const onAction = options.onAction;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          onAction(action);
        });
        pathList.appendChild(btn);
      }
      area.appendChild(pathList);
    }
  }

  // Movement path and destination (only for own companies with full Company type)
  if ('destinationSite' in company && company.destinationSite) {
    // Movement arrow
    if (company.movementPath.length > 0) {
      const pathEl = document.createElement('div');
      pathEl.className = 'company-movement-path';
      for (const regionInstId of company.movementPath) {
        const regionDefId = cachedInstanceLookup(regionInstId);
        if (!regionDefId) continue;
        const regionDef = cardPool[regionDefId as string];
        if (!regionDef) continue;
        const imgPath = cardImageProxyPath(regionDef);
        if (!imgPath) continue;
        pathEl.appendChild(createCardImage(regionDefId as string, regionDef, imgPath, 'company-card company-card--region', regionInstId as string));
      }
      area.appendChild(pathEl);
    } else {
      const arrow = document.createElement('div');
      arrow.className = 'company-movement-arrow';
      arrow.innerHTML = '<svg viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
        + '<path d="M2 8h17M14 2l6 6-6 6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
        + '</svg>';
      area.appendChild(arrow);
    }

    // Destination site — highlight and make clickable if cancel-movement is available
    const destDefId = cachedInstanceLookup(company.destinationSite.instanceId);
    if (destDefId) {
      const destDef = cardPool[destDefId as string];
      if (destDef) {
        const imgPath = cardImageProxyPath(destDef);
        if (imgPath) {
          const cancelAction = options?.onAction && viableActions(view.legalActions).find(
            a => a.type === 'cancel-movement' && a.companyId === company.id,
          );
          const cls = cancelAction
            ? 'company-card company-card--site company-card--cancelable'
            : 'company-card company-card--site';
          const img = createCardImage(destDefId as string, destDef, imgPath, cls, company.destinationSite.instanceId as string);
          // Show site-back until the site is revealed during M/H. Covers Org,
          // Long-Event, and early M/H steps before reveal-new-site.
          const notYetRevealed = view.phaseState.phase !== Phase.MovementHazard
            || !view.phaseState.siteRevealed;
          if (notYetRevealed) {
            img.src = '/images/site-back.jpg';
          }
          if (cancelAction && options?.onAction) {
            const onAction = options.onAction;
            img.addEventListener('click', (e) => {
              e.stopPropagation();
              onAction(cancelAction);
            });
          } else {
            applyHazardOnGuardClick(img, options?.onAction);
          }
          area.appendChild(img);
        }
      }
    }
  } else if ('hasPlannedMovement' in company && company.hasPlannedMovement) {
    // Opponent has planned movement — show arrow + revealed site or card back
    const arrow = document.createElement('div');
    arrow.className = 'company-movement-arrow';
    arrow.innerHTML = '<svg viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M2 8h17M14 2l6 6-6 6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
      + '</svg>';
    area.appendChild(arrow);
    const revealedSite = company.revealedDestinationSite;
    const revealedDefId = revealedSite?.definitionId;
    const revealedDef = revealedDefId ? cardPool[revealedDefId as string] : undefined;
    const revealedImg = revealedDef ? cardImageProxyPath(revealedDef) : undefined;
    if (revealedDefId && revealedDef && revealedImg) {
      const siteImg = createCardImage(revealedDefId as string, revealedDef, revealedImg, 'company-card company-card--site', revealedSite.instanceId as string);
      applyHazardOnGuardClick(siteImg, options?.onAction);
      area.appendChild(siteImg);
    } else {
      const back = document.createElement('img');
      back.src = '/images/site-back.jpg';
      back.alt = 'Hidden destination';
      back.className = 'company-card company-card--site';
      applyHazardOnGuardClick(back, options?.onAction);
      area.appendChild(back);
    }
  }

  // On-guard cards — rendered overlapping the site (offset down 50%)
  const ogCards = company.onGuardCards;
  if (ogCards.length > 0) {
    // Find reveal-on-guard legal actions (hazard player during reveal step)
    const revealActions = options?.onAction
      ? viableActions(view.legalActions).filter(
        (a): a is import('@meccg/shared').RevealOnGuardAction => a.type === 'reveal-on-guard',
      )
      : [];

    // Find the last site image in the area to attach on-guard overlay
    const siteImages = area.querySelectorAll<HTMLImageElement>('.company-card--site');
    const targetSite = siteImages[siteImages.length - 1];
    if (targetSite) {
      // Wrap the target site in a positioned container
      const wrapper = document.createElement('div');
      wrapper.className = 'on-guard-wrapper';
      targetSite.replaceWith(wrapper);
      wrapper.appendChild(targetSite);

      for (const og of ogCards) {
        const ogDefId = cachedInstanceLookup(og.instanceId);
        const ogDef = ogDefId ? cardPool[ogDefId as string] : undefined;
        const ogImgPath = ogDef ? cardImageProxyPath(ogDef) : undefined;
        const revealAction = revealActions.find(a => a.cardInstanceId === og.instanceId);
        const revealCls = revealAction ? ' on-guard-card--revealable' : '';

        let ogImg: HTMLImageElement;
        if (ogDef && ogImgPath) {
          ogImg = createCardImage(ogDefId as string, ogDef, ogImgPath, `company-card company-card--site on-guard-card${revealCls}`, og.instanceId as string);
        } else {
          ogImg = document.createElement('img');
          ogImg.alt = 'On-guard card';
          ogImg.className = `company-card company-card--site on-guard-card${revealCls}`;
        }
        // Show card-back unless revealed (face-up); hover preview shows real card either way
        if (!('revealed' in og) || !og.revealed) {
          ogImg.src = '/images/card-back.jpg';
        }
        if (revealAction && options?.onAction) {
          ogImg.style.cursor = 'pointer';
          const onAction = options.onAction;
          ogImg.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(revealAction);
          });
        }
        wrapper.appendChild(ogImg);
      }
    }
  }

  // Active constraints (Stealth, River, etc.) — small cards beside the site
  const companyConstraints = (view.activeConstraints ?? []).filter(
    c => c.target.kind === 'company' && c.target.companyId === company.id,
  );
  if (companyConstraints.length > 0) {
    // Wrap the on-guard wrapper (if present) or the last site card
    const ogWrapper = area.querySelector('.on-guard-wrapper') as HTMLElement | null;
    const siteImages = area.querySelectorAll('.company-card--site');
    const anchorTarget = ogWrapper ?? siteImages[siteImages.length - 1] as HTMLElement | null;
    if (anchorTarget) {
      const anchor = document.createElement('div');
      anchor.className = 'constraint-anchor';
      anchorTarget.replaceWith(anchor);
      anchor.appendChild(anchorTarget);

      const strip = document.createElement('div');
      strip.className = 'constraint-strip';
      for (const constraint of companyConstraints) {
        const cDefId = cachedInstanceLookup(constraint.source);
        const cDef = cDefId ? cardPool[cDefId as string] : undefined;
        const cImgPath = cDef ? cardImageProxyPath(cDef) : undefined;

        let cImg: HTMLImageElement;
        if (cDef && cImgPath) {
          cImg = createCardImage(cDefId as string, cDef, cImgPath, 'constraint-card', constraint.source as string);
        } else {
          cImg = document.createElement('img');
          cImg.src = '/images/card-back.jpg';
          cImg.alt = 'Active constraint';
          cImg.className = 'constraint-card';
        }
        strip.appendChild(cImg);
      }
      anchor.appendChild(strip);
    }
  }

  return area;
}
