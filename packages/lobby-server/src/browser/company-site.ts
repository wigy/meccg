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
  CardInPlay,
  CardInstanceId,
  Company,
  OpponentCompanyView,
  DeclarePathAction,
  RegionType,
  ActivateGrantedAction,
  DeclareAgentAttackAction,
} from '@meccg/shared';
import { cardImageProxyPath, cardsAttachedToSite, isSiteCard, Phase, CardStatus, viableActions, describeAction } from '@meccg/shared';
import { createCardImage, createCardImageFromDefId, createCardImageOrBack, createRegionTypeIcon } from './render-utils.js';
import { openMovementViewer, getSelectedHazardForPlay, getSelectedHazardOnGuardAction, clearHazardPlaySelection } from './render.js';
import { getCachedInstanceLookup } from './company-view-state.js';
import { showGrantedActionTooltip } from './company-modals.js';
import { showTooltipMenu, type TooltipMenuItem } from './tooltip-menu.js';

/**
 * Compute the DOM `data-instance-id` for a company's site card element.
 *
 * Site card instances are deliberately shared across sibling companies that
 * occupy — or are moving to — the same physical location: the engine models a
 * single site card drawn once from the location deck (see `handlePlanMovement`
 * in `reducer-organization`), so several companies legitimately carry the same
 * underlying `instanceId` for their current/destination site. The FLIP card
 * animation tracks elements by `data-instance-id` and collapses duplicates to a
 * single remembered position, which made these shared site cards "jump" from
 * one another's previous slot on every re-render of the all-companies overview.
 *
 * To keep each rendered site element uniquely and stably identified, the first
 * company to render a given site instance keeps the raw id (so its card still
 * animates in from the site deck pile), and every later company rendering the
 * same instance gets a company-scoped id. `rendered` accumulates the instance
 * ids already emitted this render pass — pass one shared set across all
 * companies of the overview. When no set is supplied (single-company views,
 * where duplication is impossible) the raw id is always used.
 */
export function siteElementInstanceId(
  companyId: string,
  siteInstanceId: CardInstanceId,
  rendered?: Set<string>,
): string {
  const raw = siteInstanceId as string;
  if (!rendered) return raw;
  if (rendered.has(raw)) return `${companyId}:${raw}`;
  rendered.add(raw);
  return raw;
}

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
/**
 * Show a tooltip for declaring an agent attack from the site overlay.
 * Groups multiple home-site variants of the same action under a single "Declare Agent Attack" button
 * when there is only one option, or lists them labelled by home site when there are multiple.
 */
function showAgentAttackTooltip(
  anchor: HTMLElement,
  actions: DeclareAgentAttackAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const items = actions.map((action): TooltipMenuItem => {
    let label = 'Declare Agent Attack';
    if (action.homeSiteInstanceId) {
      const cachedInstanceLookup = getCachedInstanceLookup();
      const homeDefId = cachedInstanceLookup(action.homeSiteInstanceId);
      const homeDef = homeDefId ? cardPool[homeDefId as string] : undefined;
      label = `Declare Agent Attack at ${homeDef?.name ?? 'home site'}`;
    }
    return { label, onClick: () => onAction(action) };
  });

  showTooltipMenu(anchor, items, { placement: 'auto' });
}

export function renderSiteArea(
  company: Company | OpponentCompanyView,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  options?: {
    hasLegalMovement?: boolean;
    onAction?: (action: GameAction) => void;
    /**
     * Activate-granted-action legal actions, keyed by source card instance ID.
     * Used to make constraint cards clickable (e.g. tapping a ranger to cancel
     * a River constraint).
     */
    grantedActions?: Map<string, ActivateGrantedAction[]>;
    /**
     * Declare-agent-attack actions for agents threatening this company's current
     * site. When present, each distinct agent is shown as a half-size thumbnail
     * overlapping the top-right of the site card, highlighted with the standard
     * selectable (golden) glow. Clicking opens a tooltip with the attack options.
     */
    agentAttackActions?: DeclareAgentAttackAction[];
    /**
     * The owning player's `cardsInPlay`. Cards bound to this company's current
     * site (via `attachedToSite`, e.g. Hidden Haven) are rendered beneath the
     * site card as a small attachments strip — mirroring how items hang under
     * a character.
     */
    cardsInPlay?: readonly CardInPlay[];
    /**
     * Shared set accumulating the site instance ids already rendered this pass.
     * Threaded across all companies of the all-companies overview so a site
     * instance shared by sibling companies gets a company-scoped
     * `data-instance-id` on every occurrence after the first — see
     * {@link siteElementInstanceId}. Omitted for single-company views.
     */
    renderedSiteInstances?: Set<string>;
  },
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
          const siteElId = siteElementInstanceId(company.id as string, company.currentSite.instanceId, options?.renderedSiteInstances);
          const img = createCardImage(siteDefId as string, siteDef, imgPath, cls, siteElId);
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

          // Cards bound to this site location (e.g. Hidden Haven) render beneath
          // the site card as an attachments strip, like items under a character.
          const attached = options?.cardsInPlay
            ? cardsAttachedToSite(options.cardsInPlay, siteDefId)
            : [];
          if (attached.length > 0) {
            const column = document.createElement('div');
            column.className = 'company-site-column';
            column.appendChild(img);
            const strip = document.createElement('div');
            strip.className = 'site-attachments';
            for (const ac of attached) {
              const acEl = createCardImageFromDefId(ac.definitionId, cardPool, 'company-card company-card--item company-card--site-attachment', ac.instanceId as string);
              if (!acEl) continue;
              if (ac.status === CardStatus.Tapped) acEl.classList.add('company-card--tapped');
              strip.appendChild(acEl);
            }
            if (strip.childElementCount > 0) column.appendChild(strip);
            area.appendChild(column);
          } else {
            area.appendChild(img);
          }
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
          const destElId = siteElementInstanceId(company.id as string, company.destinationSite.instanceId, options?.renderedSiteInstances);
          const img = createCardImage(destDefId as string, destDef, imgPath, cls, destElId);
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
      const revealedElId = siteElementInstanceId(company.id as string, revealedSite.instanceId, options?.renderedSiteInstances);
      const siteImg = createCardImage(revealedDefId as string, revealedDef, revealedImg, 'company-card company-card--site', revealedElId);
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
        const revealAction = revealActions.find(a => a.cardInstanceId === og.instanceId);
        const revealCls = revealAction ? ' on-guard-card--revealable' : '';

        const ogImg = createCardImageOrBack(og.instanceId, ogDefId, cardPool, `company-card company-card--site on-guard-card${revealCls}`, 'On-guard card');
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

  // Active constraints (Stealth, River, etc.) — small cards beside the site.
  // Multiple constraints may share the same source card (e.g. River adds both
  // site-phase-do-nothing and a granted-action cancel-river) — dedupe by source
  // so each source card shows exactly once in the strip.
  const companyConstraints = (view.activeConstraints ?? []).filter(
    c => c.target.kind === 'company' && c.target.companyId === company.id,
  );
  const uniqueConstraintsBySource = new Map<string, typeof companyConstraints[number]>();
  for (const c of companyConstraints) {
    const key = c.source as string;
    if (!uniqueConstraintsBySource.has(key)) uniqueConstraintsBySource.set(key, c);
  }
  if (uniqueConstraintsBySource.size > 0) {
    // Wrap the on-guard wrapper (if present) or the last site card
    const ogWrapper = area.querySelector<HTMLElement>('.on-guard-wrapper');
    const siteImages = area.querySelectorAll('.company-card--site');
    const anchorTarget = ogWrapper ?? siteImages[siteImages.length - 1] as HTMLElement | null;
    if (anchorTarget) {
      const anchor = document.createElement('div');
      anchor.className = 'constraint-anchor';
      anchorTarget.replaceWith(anchor);
      anchor.appendChild(anchorTarget);

      const strip = document.createElement('div');
      strip.className = 'constraint-strip';
      const onAction = options?.onAction;
      for (const constraint of uniqueConstraintsBySource.values()) {
        const cImg = createCardImageOrBack(
          constraint.source,
          constraint.sourceDefinitionId ?? cachedInstanceLookup(constraint.source),
          cardPool,
          'constraint-card',
          'Active constraint',
        );

        // If the constraint source has activatable granted actions (e.g.
        // ranger tap to cancel River), make the card clickable.
        const grantedForSource = options?.grantedActions?.get(constraint.source as string);
        if (onAction && grantedForSource && grantedForSource.length > 0) {
          cImg.classList.add('constraint-card--activatable');
          cImg.style.cursor = 'pointer';
          if (grantedForSource.length === 1) {
            const action = grantedForSource[0];
            cImg.addEventListener('click', (e) => {
              e.stopPropagation();
              onAction(action);
            });
          } else {
            cImg.addEventListener('click', (e) => {
              e.stopPropagation();
              const getCharacterName = (id: CardInstanceId): string | undefined => {
                const defId = cachedInstanceLookup(id);
                return defId ? cardPool[defId as string]?.name : undefined;
              };
              showGrantedActionTooltip(e.currentTarget as HTMLElement, grantedForSource, onAction, getCharacterName);
            });
          }
        }

        strip.appendChild(cImg);
      }
      anchor.appendChild(strip);
    }
  }

  // Agent attack overlay: half-size agent thumbnail(s) at top-right of site card,
  // golden glow + clickable during declare-agent-attack step.
  if (options?.agentAttackActions && options.agentAttackActions.length > 0 && options.onAction) {
    const attackActions = options.agentAttackActions;
    const onAction = options.onAction;

    // Group by agent instance ID (multiple actions = multiple home-site choices for same agent)
    const byAgent = new Map<string, DeclareAgentAttackAction[]>();
    for (const a of attackActions) {
      const key = a.agentInstanceId as string;
      if (!byAgent.has(key)) byAgent.set(key, []);
      byAgent.get(key)!.push(a);
    }

    // Wrap the outermost site element in a relative container
    const constraintAnchor = area.querySelector<HTMLElement>('.constraint-anchor');
    const onGuardWrapper = area.querySelector<HTMLElement>('.on-guard-wrapper');
    const siteImages = area.querySelectorAll<HTMLElement>('.company-card--site');
    const siteTarget = constraintAnchor ?? onGuardWrapper ?? (siteImages[siteImages.length - 1] as HTMLElement | null);

    if (siteTarget) {
      const wrapper = document.createElement('div');
      wrapper.className = 'agent-attack-wrapper';
      siteTarget.replaceWith(wrapper);
      wrapper.appendChild(siteTarget);

      let thumbIndex = 0;
      for (const [agentInstId, actions] of byAgent) {
        const thumb = createCardImageOrBack(
          agentInstId as CardInstanceId,
          cachedInstanceLookup(agentInstId as CardInstanceId),
          cardPool,
          'agent-attack-thumb',
          'Agent',
        );
        thumb.style.setProperty('--agent-thumb-index', String(thumbIndex++));
        thumb.style.cursor = 'pointer';
        thumb.addEventListener('click', (e) => {
          e.stopPropagation();
          showAgentAttackTooltip(thumb, actions, cardPool, onAction);
        });
        wrapper.appendChild(thumb);
      }
    }
  }

  return area;
}
