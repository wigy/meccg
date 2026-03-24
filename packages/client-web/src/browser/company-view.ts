/**
 * @module company-view
 *
 * Renders companies on the board during play phases (post-setup).
 * Defaults to showing the active player's first company at full scale.
 * Falls back to an all-companies overview when no company is focused.
 *
 * The title character (highest mind, then MP, then prowess) determines
 * the company's display name (e.g. "Aragorn's Company at Rivendell").
 */

import type {
  PlayerView,
  GameAction,
  CardDefinition,
  CardInstanceId,
  CardInPlay,
  CharacterInPlay,
  Company,
  CompanyId,
  OpponentCompanyView,
  PlayCharacterAction,
  MoveToInfluenceAction,
  TransferItemAction,
  SplitCompanyAction,
  MoveToCompanyAction,
  MergeCompaniesAction,
  SelectCompanyAction,
  DeclarePathAction,
  RegionType,
} from '@meccg/shared';
import { cardImageProxyPath, isCharacterCard, isItemCard, isSiteCard, Phase, CardStatus, viableActions, describeAction, getTitleCharacter } from '@meccg/shared';
import { $, createCardImage, createRegionTypeIcon } from './render-utils.js';
import { getSelectedCharacterForPlay, clearCharacterPlaySelection, openMovementViewer, setTargetingInstruction } from './render.js';

// ---- View state ----

/** The company currently focused in single-company view, or null for all-companies overview. */
let focusedCompanyId: CompanyId | null = null;

/**
 * Saved company ID to return to when toggling back from all-companies view.
 * Set whenever we leave single view so the toggle can restore it.
 */
let savedFocusedCompanyId: CompanyId | null = null;

/** Whether we are currently showing all-companies as an override (toggle). */
let allCompaniesOverride = false;

/**
 * Move-to-influence two-step selection state.
 * When a character with move-to-influence options is clicked, its instance ID
 * is stored here and valid controller targets are highlighted.
 */
let influenceMoveSourceId: CardInstanceId | null = null;

/**
 * Transfer-item two-step selection state.
 * When an item card is clicked, its instance ID and bearer are stored here.
 * Valid target characters are then highlighted for the second click.
 */
let transferItemSourceId: CardInstanceId | null = null;
let transferItemFromCharId: CardInstanceId | null = null;

/**
 * Move-to-company two-step selection state.
 * When a character is chosen for "move to company", their instance ID and
 * source company are stored here. Target companies are then highlighted.
 */
let companyMoveSourceId: CardInstanceId | null = null;
let companyMoveSourceCompanyId: CompanyId | null = null;

/**
 * Merge-companies two-step selection state.
 * When a title character is chosen for "join company", the source company ID
 * is stored here. Target companies at the same site are then highlighted.
 */
let mergeSourceCompanyId: CompanyId | null = null;


/** Track the last active player so we can reset view state on turn change. */
let lastActivePlayer: string | null = null;

// ---- Title character logic ----

/**
 * Determine the title character of a company for display purposes.
 * If an avatar (mind === null) is in the company, it is always the title character.
 * Otherwise, the character with the highest mind is chosen.
 * Tiebreaker: marshalling points, then prowess.
 * Returns the title character's CharacterInPlay, or undefined if the company is empty.
 */

/**
 * Get the display name for a company based on its title character and current site.
 * Returns e.g. "Aragorn's Company at Rivendell" or "Company" if no title character found.
 */
function getCompanyName(
  company: Company | OpponentCompanyView,
  charMap: Readonly<Record<string, CharacterInPlay>>,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const titleChar = getTitleCharacter(company.characters, charMap, cardPool);
  if (!titleChar) return 'Company';
  const def = cardPool[titleChar.definitionId as string];
  if (!def) return 'Company';
  const name = def.name;
  // Simple possessive: add 's or just ' for names ending in s
  const possessive = name.endsWith('s') ? `${name}'` : `${name}'s`;
  let label = `${possessive} Company`;

  // Append site name if the company is at a site
  if (company.currentSite) {
    const siteDefId = view.visibleInstances[company.currentSite.instanceId as string];
    if (siteDefId) {
      const siteDef = cardPool[siteDefId as string];
      if (siteDef) {
        label += ` at ${siteDef.name}`;
      }
    }
  }

  return label;
}

// ---- DOM rendering ----

/**
 * Render a single character column: character card + items stacked below.
 * Applies tapped/wounded transforms based on character status.
 */
function renderCharacterColumn(
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
  isTitleCharacter: boolean,
  charMap?: Readonly<Record<string, CharacterInPlay>>,
  influenceClick?: { cls: string; handler: (e: Event) => void },
  influenceClickBuilder?: (id: CardInstanceId) => { cls: string; handler: (e: Event) => void } | undefined,
  itemClickBuilder?: (itemInstId: CardInstanceId, charInstId: CardInstanceId) => { cls: string; handler: (e: Event) => void } | undefined,
): HTMLElement {
  const col = document.createElement('div');
  col.className = 'character-column';

  const def = cardPool[char.definitionId as string];
  if (!def) return col;
  const imgPath = cardImageProxyPath(def);
  if (!imgPath) return col;

  // Character card wrapper (for positioning badge)
  const wrap = document.createElement('div');
  wrap.className = 'character-card-wrap';

  const hasFollowers = charMap != null && char.followers.length > 0;
  const hasAttachments = char.items.length > 0 || char.allies.length > 0 || hasFollowers;
  const img = createCardImage(char.definitionId as string, def, imgPath, 'company-card', char.instanceId as string);
  if (hasAttachments) img.classList.add('company-card--faded');
  if (char.status === CardStatus.Tapped) {
    img.classList.add('company-card--tapped');
    wrap.classList.add('character-card-wrap--tapped');
  } else if (char.status === CardStatus.Inverted) {
    img.classList.add('company-card--wounded');
  }
  wrap.appendChild(img);

  // Stats badge
  const badge = document.createElement('div');
  badge.className = 'char-stats-badge';
  badge.textContent = `${char.effectiveStats.prowess}/${char.effectiveStats.body}`;
  wrap.appendChild(badge);

  // Mind badge (left edge, above DI)
  if (isCharacterCard(def) && def.mind !== null) {
    const mindBadge = document.createElement('div');
    mindBadge.className = 'char-mind-badge';
    mindBadge.textContent = String(def.mind);
    wrap.appendChild(mindBadge);
  }

  // Direct influence badge (left edge, middle)
  const diBadge = document.createElement('div');
  diBadge.className = 'char-di-badge';
  diBadge.textContent = String(char.effectiveStats.directInfluence);
  wrap.appendChild(diBadge);

  // Title character indicator
  if (isTitleCharacter) {
    const titleBadge = document.createElement('div');
    titleBadge.className = 'char-title-badge';
    titleBadge.textContent = '\u2606'; // star
    wrap.appendChild(titleBadge);
  }

  // Influence move highlight and click handler
  if (influenceClick) {
    if (influenceClick.cls) img.classList.add(influenceClick.cls);
    img.style.cursor = 'pointer';
    img.addEventListener('click', influenceClick.handler);
  }

  col.appendChild(wrap);

  // Items, allies, and followers — shown side by side in one row
  const allAttachments = [...char.items, ...char.allies];
  if (allAttachments.length > 0 || hasFollowers) {
    const attachments = document.createElement('div');
    attachments.className = 'character-attachments';
    for (const att of allAttachments) {
      const attDef = cardPool[att.definitionId as string];
      if (!attDef) continue;
      const attImg = cardImageProxyPath(attDef);
      if (!attImg) continue;
      const attEl = createCardImage(att.definitionId as string, attDef, attImg, 'company-card company-card--item', att.instanceId as string);
      if (att.status === CardStatus.Tapped) {
        attEl.classList.add('company-card--tapped');
      }
      // Item transfer click handler (only for items, not allies)
      const isItem = char.items.some(i => i.instanceId === att.instanceId);
      if (isItem && itemClickBuilder) {
        const itemClick = itemClickBuilder(att.instanceId, char.instanceId);
        if (itemClick) {
          if (itemClick.cls) attEl.classList.add(itemClick.cls);
          attEl.style.cursor = 'pointer';
          attEl.addEventListener('click', itemClick.handler);
        }
      }
      // Wrap item in a container for CP badge positioning
      if (isItemCard(attDef) && attDef.corruptionPoints > 0) {
        const itemWrap = document.createElement('div');
        itemWrap.className = 'item-card-wrap';
        itemWrap.appendChild(attEl);
        const cpBadge = document.createElement('div');
        cpBadge.className = 'item-cp-badge';
        cpBadge.textContent = `${attDef.corruptionPoints} CP`;
        itemWrap.appendChild(cpBadge);
        attachments.appendChild(itemWrap);
      } else {
        attachments.appendChild(attEl);
      }
    }
    // Followers rendered as overlapping cards like items, with their own items below
    if (hasFollowers) {
      for (const followerId of char.followers) {
        const follower = charMap[followerId as string];
        if (!follower) continue;
        const fDef = cardPool[follower.definitionId as string];
        if (!fDef) continue;
        const fImg = cardImageProxyPath(fDef);
        if (!fImg) continue;

        // Wrap follower + its items in a mini-column
        const followerCol = document.createElement('div');
        followerCol.className = 'follower-column';

        const followerHasItems = follower.items.length > 0 || follower.allies.length > 0;
        const fWrap = document.createElement('div');
        fWrap.className = 'character-card-wrap';
        const fEl = createCardImage(follower.definitionId as string, fDef, fImg, 'company-card company-card--follower', follower.instanceId as string);
        if (followerHasItems) fEl.classList.add('company-card--faded');
        if (follower.status === CardStatus.Tapped) {
          fEl.classList.add('company-card--tapped');
          fWrap.classList.add('character-card-wrap--tapped');
        } else if (follower.status === CardStatus.Inverted) {
          fEl.classList.add('company-card--wounded');
        }
        const followerInfluenceClick = influenceClickBuilder?.(followerId);
        if (followerInfluenceClick) {
          if (followerInfluenceClick.cls) fEl.classList.add(followerInfluenceClick.cls);
          fEl.style.cursor = 'pointer';
          fEl.addEventListener('click', followerInfluenceClick.handler);
        }
        fWrap.appendChild(fEl);

        // Follower stats badge
        const fStatsBadge = document.createElement('div');
        fStatsBadge.className = 'char-stats-badge';
        fStatsBadge.textContent = `${follower.effectiveStats.prowess}/${follower.effectiveStats.body}`;
        fWrap.appendChild(fStatsBadge);

        // Follower mind badge
        if (isCharacterCard(fDef) && fDef.mind !== null) {
          const fMindBadge = document.createElement('div');
          fMindBadge.className = 'char-mind-badge';
          fMindBadge.textContent = String(fDef.mind);
          fWrap.appendChild(fMindBadge);
        }

        // Follower direct influence badge
        const fDiBadge = document.createElement('div');
        fDiBadge.className = 'char-di-badge';
        fDiBadge.textContent = String(follower.effectiveStats.directInfluence);
        fWrap.appendChild(fDiBadge);

        followerCol.appendChild(fWrap);

        // Follower's own items and allies
        const followerAttachments = [...follower.items, ...follower.allies];
        if (followerAttachments.length > 0) {
          const fAttRow = document.createElement('div');
          fAttRow.className = 'character-attachments';
          for (const fAtt of followerAttachments) {
            const fAttDef = cardPool[fAtt.definitionId as string];
            if (!fAttDef) continue;
            const fAttImg = cardImageProxyPath(fAttDef);
            if (!fAttImg) continue;
            const fAttEl = createCardImage(fAtt.definitionId as string, fAttDef, fAttImg, 'company-card company-card--item', fAtt.instanceId as string);
            if (fAtt.status === CardStatus.Tapped) {
              fAttEl.classList.add('company-card--tapped');
            }
            // Item transfer click handler for follower items
            const fIsItem = follower.items.some(i => i.instanceId === fAtt.instanceId);
            if (fIsItem && itemClickBuilder) {
              const fItemClick = itemClickBuilder(fAtt.instanceId, follower.instanceId);
              if (fItemClick) {
                if (fItemClick.cls) fAttEl.classList.add(fItemClick.cls);
                fAttEl.style.cursor = 'pointer';
                fAttEl.addEventListener('click', fItemClick.handler);
              }
            }
            // Wrap item in a container for CP badge positioning
            if (isItemCard(fAttDef) && fAttDef.corruptionPoints > 0) {
              const fItemWrap = document.createElement('div');
              fItemWrap.className = 'item-card-wrap';
              fItemWrap.appendChild(fAttEl);
              const fCpBadge = document.createElement('div');
              fCpBadge.className = 'item-cp-badge';
              fCpBadge.textContent = `${fAttDef.corruptionPoints} CP`;
              fItemWrap.appendChild(fCpBadge);
              fAttRow.appendChild(fItemWrap);
            } else {
              fAttRow.appendChild(fAttEl);
            }
          }
          followerCol.appendChild(fAttRow);
        }

        attachments.appendChild(followerCol);
      }
    }
    col.appendChild(attachments);
  }

  return col;
}

/** Resolve a card instance ID to its definition via the visible instances map. */
function resolveCardDef(
  instanceId: CardInstanceId,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): CardDefinition | undefined {
  const defId = view.visibleInstances[instanceId as string];
  return defId ? cardPool[defId as string] : undefined;
}

/**
 * Get the region types traversed for a movement path action.
 *
 * For starter movement: uses the site's `sitePath` (haven→non-haven or
 * non-haven→haven) or the origin haven's `havenPaths` (haven→haven).
 * For region movement: looks up each region's `regionType` from the card pool.
 */
function getPathRegionTypes(
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
 * Render the site area for a company: current site, movement path, destination.
 */
function renderSiteArea(
  company: Company | OpponentCompanyView,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  options?: { hasLegalMovement?: boolean; onAction?: (action: GameAction) => void },
): HTMLElement {
  const area = document.createElement('div');
  area.className = 'company-site-area';

  // Current site
  if (company.currentSite) {
    const siteDefId = view.visibleInstances[company.currentSite.instanceId as string];
    if (siteDefId) {
      const siteDef = cardPool[siteDefId as string];
      if (siteDef) {
        const imgPath = cardImageProxyPath(siteDef);
        if (imgPath) {
          const siteOwned = company.siteCardOwned !== false;
          let cls = 'company-card company-card--site';
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
      const destSiteId = 'destinationSite' in company ? company.destinationSite : null;
      const destDef = destSiteId ? resolveCardDef(destSiteId, view, cardPool) : undefined;

      const pathList = document.createElement('div');
      pathList.className = 'path-choice-list';
      for (const action of pathActions) {
        const btn = document.createElement('button');
        btn.className = 'char-action-tooltip__btn';

        const label = document.createElement('div');
        label.textContent = describeAction(action, cardPool, view.visibleInstances);
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
        const regionDefId = view.visibleInstances[regionInstId as string];
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
    const destDefId = view.visibleInstances[company.destinationSite as string];
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
          const img = createCardImage(destDefId as string, destDef, imgPath, cls, company.destinationSite as string);
          if (cancelAction && options?.onAction) {
            const onAction = options.onAction;
            img.addEventListener('click', (e) => {
              e.stopPropagation();
              onAction(cancelAction);
            });
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
    const revealedDefId = revealedSite ? view.visibleInstances[revealedSite as string] : undefined;
    const revealedDef = revealedDefId ? cardPool[revealedDefId as string] : undefined;
    const revealedImg = revealedDef ? cardImageProxyPath(revealedDef) : undefined;
    if (revealedDefId && revealedDef && revealedImg) {
      area.appendChild(createCardImage(revealedDefId as string, revealedDef, revealedImg, 'company-card company-card--site', revealedSite as string));
    } else {
      const back = document.createElement('img');
      back.src = '/images/site-back.jpg';
      back.alt = 'Hidden destination';
      back.className = 'company-card company-card--site';
      area.appendChild(back);
    }
  }

  return area;
}

/** Remove any open character action tooltip and its backdrop from the DOM. */
function dismissTooltip(): void {
  const existing = document.querySelector('.char-action-tooltip');
  if (existing) existing.remove();
  const backdrop = document.querySelector('.char-action-backdrop');
  if (backdrop) backdrop.remove();
}

/**
 * Show a small tooltip near a character card with action choices:
 * "Reassign Influence" and "Split / Move Company".
 */
function showCharacterActionTooltip(
  anchor: HTMLElement,
  charInstId: CardInstanceId,
  cardPool: Readonly<Record<string, CardDefinition>>,
  options: {
    onAction?: (action: GameAction) => void;
    influenceActions?: Map<string, MoveToInfluenceAction[]>;
    splitActions?: Map<string, SplitCompanyAction>;
    moveToCompanyActions?: Map<string, MoveToCompanyAction[]>;
    mergeActions?: Map<string, MergeCompaniesAction[]>;
    companyId?: CompanyId;
  },
): void {
  dismissTooltip();
  const onAction = options.onAction!;

  const tooltip = document.createElement('div');
  tooltip.className = 'char-action-tooltip';

  const influenceActions = options.influenceActions?.get(charInstId as string);
  const splitActions = options.splitActions?.get(charInstId as string);
  const moveActions = options.moveToCompanyActions?.get(charInstId as string);

  if (influenceActions && influenceActions.length > 0) {
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = 'Reassign Influence';
    btn.onclick = (e) => {
      e.stopPropagation();
      dismissTooltip();
      if (influenceActions.length === 1 && influenceActions[0].controlledBy === 'general') {
        onAction(influenceActions[0]);
      } else {
        influenceMoveSourceId = charInstId;
        const sourceDefId = lastView?.visibleInstances[charInstId as string];
        const sourceName = sourceDefId ? cardPool[sourceDefId as string]?.name : undefined;
        setTargetingInstruction(
          `Click a highlighted character to reassign ${sourceName ?? 'character'} influence`,
        );
        renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
      }
    };
    tooltip.appendChild(btn);
  }

  if (splitActions) {
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = 'Split to New Company';
    btn.onclick = (e) => {
      e.stopPropagation();
      dismissTooltip();
      onAction(splitActions);
    };
    tooltip.appendChild(btn);
  }

  if (moveActions && moveActions.length > 0) {
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = 'Move to Company';
    btn.onclick = (e) => {
      e.stopPropagation();
      dismissTooltip();
      companyMoveSourceId = charInstId;
      companyMoveSourceCompanyId = moveActions[0].sourceCompanyId;
      const sourceDefId = lastView?.visibleInstances[charInstId as string];
      const sourceName = sourceDefId ? cardPool[sourceDefId as string]?.name : undefined;
      setTargetingInstruction(
        `Click a company to move ${sourceName ?? 'character'} there`,
      );
      renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
    };
    tooltip.appendChild(btn);
  }

  const mergeActionsForCompany = options.companyId
    ? options.mergeActions?.get(options.companyId as string)
    : undefined;
  if (mergeActionsForCompany && mergeActionsForCompany.length > 0) {
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = 'Join Company';
    btn.onclick = (e) => {
      e.stopPropagation();
      dismissTooltip();
      if (mergeActionsForCompany.length === 1) {
        // Only one target — execute directly
        onAction(mergeActionsForCompany[0]);
      } else {
        // Multiple targets — enter targeting mode
        mergeSourceCompanyId = options.companyId!;
        setTargetingInstruction('Click a company to join into');
        renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
      }
    };
    tooltip.appendChild(btn);
  }

  // Create a modal backdrop that blocks interaction and dismisses on click
  const backdrop = document.createElement('div');
  backdrop.className = 'char-action-backdrop';
  backdrop.onclick = () => dismissTooltip();
  document.body.appendChild(backdrop);

  // Position near the anchor element
  const rect = anchor.getBoundingClientRect();
  tooltip.style.position = 'fixed';
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.top}px`;
  document.body.appendChild(tooltip);
}

/**
 * Render a complete company block: name label, site area, character columns.
 * Used at both scales via the --company-scale CSS variable.
 */
function renderCompanyBlock(
  company: Company | OpponentCompanyView,
  charMap: Readonly<Record<string, CharacterInPlay>>,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  owner: 'self' | 'opponent',
  options?: {
    hideTitle?: boolean;
    hasLegalMovement?: boolean;
    onAction?: (action: GameAction) => void;
    /** Map from character instance ID → move-to-influence actions for that character. */
    influenceActions?: Map<string, MoveToInfluenceAction[]>;
    /** Map from item instance ID → transfer-item actions for that item. */
    transferActions?: Map<string, TransferItemAction[]>;
    /** Map from character instance ID → split-company actions for that character. */
    splitActions?: Map<string, SplitCompanyAction>;
    /** Map from character instance ID → move-to-company actions for that character. */
    moveToCompanyActions?: Map<string, MoveToCompanyAction[]>;
    /** Map from source company ID → merge-companies actions for that company. */
    mergeActions?: Map<string, MergeCompaniesAction[]>;
  },
): HTMLElement {
  const block = document.createElement('div');
  const isSelfTurn = view.activePlayer !== null && view.activePlayer === view.self.id;
  let isInactive = (owner === 'self' && !isSelfTurn) || (owner === 'opponent' && isSelfTurn);

  // During M/H phase (after select-company), dim all companies except the active one
  if (view.phaseState.phase === Phase.MovementHazard) {
    const mh = view.phaseState;
    if (mh.step !== 'select-company') {
      const resourceCompanies = isSelfTurn ? view.self.companies : view.opponent.companies;
      const activeCompany = resourceCompanies[mh.activeCompanyIndex];
      if (activeCompany && company.id !== activeCompany.id) {
        isInactive = true;
      }
    }
  }

  block.className = isInactive ? 'company-block company-block--inactive' : 'company-block';
  block.dataset.companyId = company.id as string;

  // Company name (omitted in single-company view)
  if (!options?.hideTitle) {
    const nameEl = document.createElement('div');
    nameEl.className = `company-name company-name--${owner}`;
    nameEl.textContent = getCompanyName(company, charMap, view, cardPool);
    block.appendChild(nameEl);

    // Moved badge
    if (company.moved) {
      const movedBadge = document.createElement('span');
      movedBadge.className = 'company-moved-badge';
      movedBadge.textContent = '\u2713'; // checkmark
      nameEl.appendChild(movedBadge);
    }
  }

  // Cards row: site on the left, then characters
  const row = document.createElement('div');
  row.className = 'company-row';

  // Site area (leftmost)
  row.appendChild(renderSiteArea(company, view, cardPool, {
    hasLegalMovement: options?.hasLegalMovement,
    onAction: options?.onAction,
  }));

  // Characters — title character always rendered first (leftmost after site).
  // Followers are rendered nested under their controlling character, not as
  // separate columns, so collect follower IDs to skip in the main loop.
  const followerIds = new Set<string>();
  for (const charInstId of company.characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    for (const fId of char.followers) {
      followerIds.add(fId as string);
    }
  }

  const titleChar = getTitleCharacter(company.characters, charMap, cardPool);

  /** Build the influence click handler for a character, if applicable. */
  const buildInfluenceClick = (charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    if (!options?.influenceActions || !options.onAction) return undefined;
    const onAction = options.onAction;
    const actions = options.influenceActions.get(charInstId as string);

    if (influenceMoveSourceId) {
      // Targeting mode: this character is a valid controller target
      const targetAction = viableActions(lastView!.legalActions).find(
        a => a.type === 'move-to-influence'
          && a.characterInstanceId === influenceMoveSourceId
          && a.controlledBy === charInstId,
      ) as MoveToInfluenceAction | undefined;
      if (targetAction) {
        return {
          cls: 'company-card--influence-target',
          handler: (e) => {
            e.stopPropagation();
            influenceMoveSourceId = null;
            setTargetingInstruction(null);
            onAction(targetAction);
          },
        };
      }
      // Source character itself — clicking again deselects
      if (charInstId === influenceMoveSourceId) {
        return {
          cls: 'company-card--influence-selected',
          handler: (e) => {
            e.stopPropagation();
            influenceMoveSourceId = null;
            setTargetingInstruction(null);
            renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
          },
        };
      }
      return undefined;
    }

    if (!actions || actions.length === 0) return undefined;

    // All actions are regress — still clickable but no glow
    const allRegress = actions.every(a => a.regress);
    const cls = allRegress ? '' : 'company-card--influence-source';

    if (actions.length === 1 && actions[0].controlledBy === 'general') {
      // Single option: move to GI — execute directly
      const action = actions[0];
      return {
        cls,
        handler: (e) => {
          e.stopPropagation();
          onAction(action);
        },
      };
    }

    // Multiple options (or to-DI): enter targeting mode
    return {
      cls,
      handler: (e) => {
        e.stopPropagation();
        influenceMoveSourceId = charInstId;
        const sourceDefId = lastView?.visibleInstances[charInstId as string];
        const sourceName = sourceDefId ? cardPool[sourceDefId as string]?.name : undefined;
        setTargetingInstruction(
          `Click a highlighted character to reassign ${sourceName ?? 'character'} influence`,
        );
        renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
      },
    };
  };

  /** Build the item click handler for an item on a character, if applicable. */
  const buildItemClick = (itemInstId: CardInstanceId, charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    if (!options?.onAction) return undefined;
    const onAction = options.onAction;

    if (transferItemSourceId) {
      // We're in targeting mode — clicking a character card is the target, not items
      // Items during targeting mode: the selected item gets a green highlight
      if (itemInstId === transferItemSourceId) {
        return {
          cls: 'company-card--transfer-selected',
          handler: (e) => {
            e.stopPropagation();
            transferItemSourceId = null;
            transferItemFromCharId = null;
            setTargetingInstruction(null);
            renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
          },
        };
      }
      return undefined;
    }

    // Not in targeting mode — check if this item has transfer actions
    if (!options.transferActions) return undefined;
    const actions = options.transferActions.get(itemInstId as string);
    if (!actions || actions.length === 0) return undefined;

    const allRegress = actions.every(a => a.regress);
    const cls = allRegress ? '' : 'company-card--transfer-source';

    if (actions.length === 1) {
      // Single target — execute directly
      const action = actions[0];
      return {
        cls,
        handler: (e) => {
          e.stopPropagation();
          onAction(action);
        },
      };
    }

    // Multiple targets — enter targeting mode
    return {
      cls,
      handler: (e) => {
        e.stopPropagation();
        transferItemSourceId = itemInstId;
        transferItemFromCharId = charInstId;
        const itemDefId = lastView?.visibleInstances[itemInstId as string];
        const itemName = itemDefId ? cardPool[itemDefId as string]?.name : undefined;
        setTargetingInstruction(
          `Click a highlighted character to receive ${itemName ?? 'item'}`,
        );
        renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
      },
    };
  };

  /** Build the character click handler for transfer targeting, if applicable. */
  const buildTransferTargetClick = (charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    if (!transferItemSourceId || !transferItemFromCharId || !options?.onAction) return undefined;
    const onAction = options.onAction;

    // Find the transfer action for this target character
    const targetAction = viableActions(lastView!.legalActions).find(
      a => a.type === 'transfer-item'
        && a.itemInstanceId === transferItemSourceId
        && a.fromCharacterId === transferItemFromCharId
        && a.toCharacterId === charInstId,
    ) as TransferItemAction | undefined;

    if (targetAction) {
      return {
        cls: 'company-card--transfer-target',
        handler: (e) => {
          e.stopPropagation();
          transferItemSourceId = null;
          transferItemFromCharId = null;
          setTargetingInstruction(null);
          onAction(targetAction);
        },
      };
    }
    return undefined;
  };

  /** Build click handler for split/move-company actions on a character. */
  const buildCompanyMoveClick = (charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    if (!options?.onAction) return undefined;
    const onAction = options.onAction;

    // In company-move targeting mode, this character is the source — clicking deselects
    if (companyMoveSourceId === charInstId) {
      return {
        cls: 'company-card--influence-selected',
        handler: (e) => {
          e.stopPropagation();
          companyMoveSourceId = null;
          companyMoveSourceCompanyId = null;
          setTargetingInstruction(null);
          renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
        },
      };
    }

    const splitAction = options.splitActions?.get(charInstId as string);
    const moveActions = options.moveToCompanyActions?.get(charInstId as string);
    if (!splitAction && (!moveActions || moveActions.length === 0)) return undefined;

    const allRegress = [
      ...(splitAction ? [splitAction] : []),
      ...(moveActions ?? []),
    ].every(a => 'regress' in a && a.regress);
    const cls = allRegress ? '' : 'company-card--influence-source';

    // Split action only, no move actions — execute directly
    if (splitAction && (!moveActions || moveActions.length === 0)) {
      return {
        cls,
        handler: (e) => {
          e.stopPropagation();
          onAction(splitAction);
        },
      };
    }

    // Only move-to-company actions (no split) — enter targeting mode directly
    if (!splitAction && moveActions && moveActions.length > 0) {
      return {
        cls,
        handler: (e) => {
          e.stopPropagation();
          companyMoveSourceId = charInstId;
          companyMoveSourceCompanyId = moveActions[0].sourceCompanyId;
          const sourceDefId = lastView?.visibleInstances[charInstId as string];
          const sourceName = sourceDefId ? cardPool[sourceDefId as string]?.name : undefined;
          setTargetingInstruction(
            `Click a company to move ${sourceName ?? 'character'} there`,
          );
          renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
        },
      };
    }

    // Both split and move available — show tooltip for disambiguation
    return {
      cls,
      handler: (e) => {
        e.stopPropagation();
        showCharacterActionTooltip(e.target as HTMLElement, charInstId, cardPool, {
          ...options,
          companyId: company.id,
        });
      },
    };
  };

  /** Check if a character is the title character of this company. */
  const isTitleChar = (charInstId: CardInstanceId): boolean =>
    titleChar !== undefined && titleChar.instanceId === charInstId;

  /** Get merge actions for this company if the character is the title character. */
  const getMergeActionsForChar = (charInstId: CardInstanceId): MergeCompaniesAction[] | undefined => {
    if (!isTitleChar(charInstId)) return undefined;
    const acts = options?.mergeActions?.get(company.id as string);
    return acts && acts.length > 0 ? acts : undefined;
  };

  /** Combine influence, transfer-target, and company-move click handlers for a character. */
  const buildCombinedClick = (charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    // Transfer targeting takes priority when active
    if (transferItemSourceId) return buildTransferTargetClick(charInstId);

    // Company-move targeting: no character actions, just waiting for company click
    if (companyMoveSourceId) {
      // Source character deselects on click
      if (companyMoveSourceId === charInstId) return buildCompanyMoveClick(charInstId);
      return undefined;
    }

    // Merge targeting: no character actions, just waiting for company click
    if (mergeSourceCompanyId) return undefined;

    // Influence targeting takes priority when active
    if (influenceMoveSourceId) return buildInfluenceClick(charInstId);

    const influenceResult = buildInfluenceClick(charInstId);
    const companyResult = buildCompanyMoveClick(charInstId);
    const mergeActionsForChar = getMergeActionsForChar(charInstId);

    // Count how many action types are available
    const actionTypes = [influenceResult, companyResult, mergeActionsForChar].filter(Boolean).length;

    if (actionTypes === 0) return undefined;

    // Determine if merge actions are all regressive
    const mergeAllRegress = mergeActionsForChar
      ? mergeActionsForChar.every(a => a.regress)
      : true;
    const mergeCls = mergeActionsForChar && !mergeAllRegress ? 'company-card--influence-source' : '';

    // Multiple types — always show tooltip for disambiguation
    if (actionTypes > 1) {
      const cls = influenceResult?.cls || companyResult?.cls || mergeCls;
      return {
        cls,
        handler: (e) => {
          e.stopPropagation();
          showCharacterActionTooltip(e.target as HTMLElement, charInstId, cardPool, {
            ...options!,
            companyId: company.id,
          });
        },
      };
    }

    // Single type: merge only — enter merge flow directly
    if (mergeActionsForChar && !influenceResult && !companyResult) {
      return {
        cls: mergeCls,
        handler: (e) => {
          e.stopPropagation();
          if (mergeActionsForChar.length === 1) {
            options!.onAction!(mergeActionsForChar[0]);
          } else {
            mergeSourceCompanyId = company.id;
            setTargetingInstruction('Click a company to join into');
            renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
          }
        },
      };
    }

    // Single type: influence or company-move only
    if (!companyResult) return influenceResult;
    return companyResult;
  };

  if (titleChar) {
    row.appendChild(renderCharacterColumn(titleChar, cardPool, true, charMap, buildCombinedClick(titleChar.instanceId), buildCombinedClick, buildItemClick));
  }
  for (const charInstId of company.characters) {
    if (followerIds.has(charInstId as string)) continue;
    const char = charMap[charInstId as string];
    if (!char) continue;
    if (titleChar && char.instanceId === titleChar.instanceId) continue;
    row.appendChild(renderCharacterColumn(char, cardPool, false, charMap, buildCombinedClick(charInstId), buildCombinedClick, buildItemClick));
  }
  block.appendChild(row);

  return block;
}

// ---- View mode renderers ----


/**
 * Find all viable play-character actions for the selected character instance.
 * Returns a map from site instance ID to the list of actions at that site.
 */
function getPlayCharacterActions(
  view: PlayerView,
  characterInstanceId: CardInstanceId,
): Map<string, PlayCharacterAction[]> {
  const result = new Map<string, PlayCharacterAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'play-character') continue;
    if (action.characterInstanceId !== characterInstanceId) continue;
    const key = action.atSite as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable move-to-influence actions, keyed by the source character instance ID.
 * Each entry maps to the list of actions available for that character.
 */
function getMoveToInfluenceActions(view: PlayerView): Map<string, MoveToInfluenceAction[]> {
  const result = new Map<string, MoveToInfluenceAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'move-to-influence') continue;
    const key = action.characterInstanceId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable transfer-item actions, keyed by the item instance ID.
 * Each entry maps to the list of transfer actions for that item.
 */
function getTransferItemActions(view: PlayerView): Map<string, TransferItemAction[]> {
  const result = new Map<string, TransferItemAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'transfer-item') continue;
    const key = action.itemInstanceId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable split-company actions, keyed by the character instance ID.
 * Each character can have at most one split action (from one source company).
 */
function getSplitCompanyActions(view: PlayerView): Map<string, SplitCompanyAction> {
  const result = new Map<string, SplitCompanyAction>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'split-company') continue;
    result.set(action.characterId as string, action);
  }
  return result;
}

/**
 * Collect all viable move-to-company actions, keyed by the character instance ID.
 */
function getMoveToCompanyActions(view: PlayerView): Map<string, MoveToCompanyAction[]> {
  const result = new Map<string, MoveToCompanyAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'move-to-company') continue;
    const key = action.characterInstanceId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable merge-companies actions, keyed by the source company ID.
 * Each source company can merge into one or more target companies at the same site.
 */
function getMergeCompaniesActions(view: PlayerView): Map<string, MergeCompaniesAction[]> {
  const result = new Map<string, MergeCompaniesAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'merge-companies') continue;
    const key = action.sourceCompanyId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/** Collect company IDs that have at least one viable plan-movement action. */
function getMovableCompanyIds(view: PlayerView): Set<string> {
  const ids = new Set<string>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type === 'plan-movement') ids.add(action.companyId as string);
  }
  return ids;
}

/**
 * Render a dummy company block for a site from the site deck where
 * no company exists yet. Shows the site card with an "empty company" label.
 */
function renderDummyCompanyBlock(
  siteInstanceId: CardInstanceId,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const block = document.createElement('div');
  block.className = 'company-block';

  const siteDefId = view.visibleInstances[siteInstanceId as string];
  const siteDef = siteDefId ? cardPool[siteDefId as string] : undefined;
  const siteName = siteDef?.name ?? 'Unknown site';

  // Company name
  const nameEl = document.createElement('div');
  nameEl.className = 'company-name company-name--self';
  nameEl.textContent = `New company at ${siteName}`;
  block.appendChild(nameEl);

  // Cards row: just the site card
  const row = document.createElement('div');
  row.className = 'company-row';

  if (siteDef) {
    const area = document.createElement('div');
    area.className = 'company-site-area';
    const imgPath = cardImageProxyPath(siteDef);
    if (imgPath) {
      area.appendChild(createCardImage(siteDefId as string, siteDef, imgPath, 'company-card company-card--site', siteInstanceId as string));
    }
    row.appendChild(area);
  }
  block.appendChild(row);

  return block;
}

/**
 * Render the cards-in-play row for both players.
 * Shows permanent resources, factions, and other general cards on the table.
 * Positioned at the top of the board above the company overview.
 */
function renderCardsInPlayRow(
  container: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const selfCards = view.self.cardsInPlay;
  const oppCards = view.opponent.cardsInPlay;
  if (selfCards.length === 0 && oppCards.length === 0) return;

  const isSelfTurn = view.activePlayer !== null && view.activePlayer === view.self.id;
  const row = document.createElement('div');
  row.className = 'cards-in-play-row';
  row.style.setProperty('--company-scale', '0.6');

  const renderGroup = (cards: readonly CardInPlay[], inactive: boolean) => {
    if (cards.length === 0) return;
    const group = document.createElement('div');
    group.className = inactive ? 'cards-in-play-group cards-in-play-group--inactive' : 'cards-in-play-group';
    for (const card of cards) {
      const def = cardPool[card.definitionId as string];
      if (!def) continue;
      const imgPath = cardImageProxyPath(def);
      if (!imgPath) continue;
      const img = createCardImage(card.definitionId as string, def, imgPath, 'company-card', card.instanceId as string);
      if (card.status === CardStatus.Tapped) img.classList.add('company-card--tapped');
      group.appendChild(img);
    }
    row.appendChild(group);
  };

  renderGroup(selfCards, !isSelfTurn);
  renderGroup(oppCards, isSelfTurn);
  container.appendChild(row);
}

/** Render a single focused company at full scale. */
function renderSingleView(
  container: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  // Find the focused company across both players
  let company: Company | OpponentCompanyView | undefined;
  let charMap: Readonly<Record<string, CharacterInPlay>> = view.self.characters;
  let owner: 'self' | 'opponent' = 'self';

  if (focusedCompanyId) {
    company = view.self.companies.find(c => c.id === focusedCompanyId);
    if (!company) {
      company = view.opponent.companies.find(c => c.id === focusedCompanyId);
      if (company) {
        charMap = view.opponent.characters;
        owner = 'opponent';
      }
    }
  }

  if (!company) {
    // Focused company no longer exists — fall back to overview
    focusedCompanyId = null;
    renderAllCompaniesView(container, view, cardPool);
    return;
  }

  // Determine which list of companies to cycle through
  const isSelfTurn = view.activePlayer !== null && view.activePlayer === view.self.id;
  const cycleCompanies = isSelfTurn ? view.self.companies : view.opponent.companies;
  const currentIndex = cycleCompanies.findIndex(c => c.id === focusedCompanyId);

  const single = document.createElement('div');
  single.className = 'company-single';
  single.style.setProperty('--company-scale', '1');

  // Left arrow — previous company
  if (cycleCompanies.length > 1) {
    const leftArrow = document.createElement('button');
    leftArrow.className = 'company-nav-arrow company-nav-arrow--left';
    leftArrow.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48"><polyline points="15,4 7,12 15,20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    leftArrow.onclick = () => {
      const prev = currentIndex <= 0 ? cycleCompanies.length - 1 : currentIndex - 1;
      focusedCompanyId = cycleCompanies[prev].id;
      savedFocusedCompanyId = focusedCompanyId;
      renderCompanyViews(view, cardPool, lastOnAction!);
    };
    single.appendChild(leftArrow);
  }

  const movableIds = getMovableCompanyIds(view);
  const hasLegalMovement = movableIds.has(company.id as string);
  const influenceActions = owner === 'self' ? getMoveToInfluenceActions(view) : undefined;
  const transferActions = owner === 'self' ? getTransferItemActions(view) : undefined;
  const splitActions = owner === 'self' ? getSplitCompanyActions(view) : undefined;
  const moveToCompanyActs = owner === 'self' ? getMoveToCompanyActions(view) : undefined;
  single.appendChild(renderCompanyBlock(company, charMap, view, cardPool, owner, { hideTitle: true, hasLegalMovement, onAction: lastOnAction!, influenceActions, transferActions, splitActions, moveToCompanyActions: moveToCompanyActs }));

  // Right arrow — next company
  if (cycleCompanies.length > 1) {
    const rightArrow = document.createElement('button');
    rightArrow.className = 'company-nav-arrow company-nav-arrow--right';
    rightArrow.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48"><polyline points="9,4 17,12 9,20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    rightArrow.onclick = () => {
      const next = currentIndex >= cycleCompanies.length - 1 ? 0 : currentIndex + 1;
      focusedCompanyId = cycleCompanies[next].id;
      savedFocusedCompanyId = focusedCompanyId;
      renderCompanyViews(view, cardPool, lastOnAction!);
    };
    single.appendChild(rightArrow);
  }

  container.appendChild(single);
}

/** Render all companies (both players) at medium scale. */
function renderAllCompaniesView(
  container: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const overview = document.createElement('div');
  overview.className = 'company-overview-all';
  overview.style.setProperty('--company-scale', '0.6');

  // Check if we're in character-play targeting mode
  const selectedChar = getSelectedCharacterForPlay();
  const targetActions = selectedChar
    ? getPlayCharacterActions(view, selectedChar)
    : null;

  // Companies with legal movement available
  const movableIds = getMovableCompanyIds(view);

  // Move-to-influence actions (for highlighting characters)
  const influenceActions = getMoveToInfluenceActions(view);

  // Transfer-item actions (for highlighting transferable items)
  const transferActions = getTransferItemActions(view);

  // Split-company, move-to-company, and merge-companies actions
  const splitActions = getSplitCompanyActions(view);
  const moveToCompanyActs = getMoveToCompanyActions(view);
  const mergeActions = getMergeCompaniesActions(view);

  // Select-company actions (M/H phase company selection)
  const selectCompanyActions = new Map<string, SelectCompanyAction>();
  for (const a of viableActions(view.legalActions)) {
    if (a.type === 'select-company') {
      selectCompanyActions.set(a.companyId as string, a);
    }
  }

  // Collect site instance IDs that already have companies
  const companySiteIds = new Set<string>();
  for (const company of view.self.companies) {
    if (company.currentSite) companySiteIds.add(company.currentSite.instanceId as string);
  }

  // Self companies
  for (const company of view.self.companies) {
    const hasLegalMovement = movableIds.has(company.id as string);
    const block = renderCompanyBlock(company, view.self.characters, view, cardPool, 'self', { hasLegalMovement, onAction: lastOnAction!, influenceActions, transferActions, splitActions, moveToCompanyActions: moveToCompanyActs, mergeActions });

    if (selectCompanyActions.size > 0) {
      // M/H phase select-company step: highlight selectable companies
      const selectAction = selectCompanyActions.get(company.id as string);
      if (selectAction) {
        block.classList.add('company-block--target');
        block.onclick = (e) => {
          e.stopPropagation();
          lastOnAction!(selectAction);
        };
      }
    } else if (mergeSourceCompanyId) {
      // Merge targeting mode: highlight valid target companies
      const mergeAction = viableActions(view.legalActions).find(
        a => a.type === 'merge-companies'
          && a.sourceCompanyId === mergeSourceCompanyId
          && a.targetCompanyId === company.id,
      ) as MergeCompaniesAction | undefined;
      if (mergeAction) {
        block.classList.add('company-block--target');
        block.onclick = (e) => {
          e.stopPropagation();
          mergeSourceCompanyId = null;
          setTargetingInstruction(null);
          lastOnAction!(mergeAction);
        };
      } else if (company.id === mergeSourceCompanyId) {
        // Source company — clicking cancels merge targeting
        block.classList.add('company-block--clickable');
        block.onclick = (e) => {
          e.stopPropagation();
          mergeSourceCompanyId = null;
          setTargetingInstruction(null);
          renderCompanyViews(lastView!, lastCardPool!, lastOnAction!);
        };
      }
    } else if (companyMoveSourceId && companyMoveSourceCompanyId) {
      // Company-move targeting mode: highlight valid target companies
      const moveAction = viableActions(view.legalActions).find(
        a => a.type === 'move-to-company'
          && a.characterInstanceId === companyMoveSourceId
          && a.sourceCompanyId === companyMoveSourceCompanyId
          && a.targetCompanyId === company.id,
      ) as MoveToCompanyAction | undefined;
      if (moveAction) {
        block.classList.add('company-block--target');
        block.onclick = (e) => {
          e.stopPropagation();
          companyMoveSourceId = null;
          companyMoveSourceCompanyId = null;
          setTargetingInstruction(null);
          lastOnAction!(moveAction);
        };
      }
    } else if (targetActions && company.currentSite && targetActions.has(company.currentSite.instanceId as string)) {
      // This company is a valid target for playing the selected character
      block.classList.add('company-block--target');
      const actions = targetActions.get(company.currentSite.instanceId as string)!;
      block.onclick = () => {
        // For now, use the first action (GI preferred, DI options come later)
        clearCharacterPlaySelection();
        lastOnAction!(actions[0]);
      };
    }
    overview.appendChild(block);
  }

  // Dummy companies for site-deck sites with no existing company
  if (targetActions) {
    for (const [siteInstId, actions] of targetActions) {
      if (companySiteIds.has(siteInstId)) continue;
      const siteInstanceId = siteInstId as CardInstanceId;
      const block = renderDummyCompanyBlock(siteInstanceId, view, cardPool);
      block.classList.add('company-block--target');
      block.onclick = () => {
        clearCharacterPlaySelection();
        lastOnAction!(actions[0]);
      };
      overview.appendChild(block);
    }
  }

  // Opponent companies
  for (const company of view.opponent.companies) {
    const block = renderCompanyBlock(company, view.opponent.characters, view, cardPool, 'opponent');
    overview.appendChild(block);
  }

  container.appendChild(overview);
}

/**
 * Render a toggle icon on the right edge of the board.
 * In single view it shows a grid icon (switch to all-companies).
 * In all-companies view it shows a focus icon (return to the saved company).
 */
function renderViewToggle(
  container: HTMLElement,
  showingSingle: boolean,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const btn = document.createElement('button');
  btn.className = 'company-view-toggle';
  btn.title = showingSingle ? 'Show all companies' : 'Return to focused company';
  // Grid icon (4 squares) for "show all", crosshair for "focus on one"
  btn.innerHTML = showingSingle
    ? '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/><rect x="13" y="3" width="8" height="8" rx="1" fill="currentColor"/><rect x="3" y="13" width="8" height="8" rx="1" fill="currentColor"/><rect x="13" y="13" width="8" height="8" rx="1" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="2" x2="12" y2="7" stroke="currentColor" stroke-width="2"/><line x1="12" y1="17" x2="12" y2="22" stroke="currentColor" stroke-width="2"/><line x1="2" y1="12" x2="7" y2="12" stroke="currentColor" stroke-width="2"/><line x1="17" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2"/></svg>';

  btn.onclick = () => {
    if (showingSingle) {
      // Save current focus so we can restore it later
      savedFocusedCompanyId = focusedCompanyId;
      allCompaniesOverride = true;
    } else {
      // Restore the saved focused company
      allCompaniesOverride = false;
      if (savedFocusedCompanyId) {
        focusedCompanyId = savedFocusedCompanyId;
      }
    }
    renderCompanyViews(view, cardPool, lastOnAction!);
  };

  container.appendChild(btn);
}

// ---- Top-level entry point ----

/** Install keyboard listener for left/right arrow navigation. */
let keyboardNavInstalled = false;
function installKeyboardNav(): void {
  if (keyboardNavInstalled) return;
  keyboardNavInstalled = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cls = e.key === 'ArrowLeft' ? 'company-nav-arrow--left' : 'company-nav-arrow--right';
    const arrow: HTMLButtonElement | null = document.querySelector(`.${cls}`);
    if (!arrow) return;
    e.preventDefault();
    arrow.classList.add('btn--flash');
    arrow.click();
    // The click triggers a re-render which replaces the element, so the flash
    // class is applied to the new arrow after re-render via a short timeout.
    requestAnimationFrame(() => {
      const newArrow = document.querySelector(`.${cls}`);
      if (newArrow) {
        newArrow.classList.add('btn--flash');
        setTimeout(() => newArrow.classList.remove('btn--flash'), 300);
      }
    });
  });
}

/** Cached args for re-renders triggered by navigation. */
let lastOnAction: ((action: GameAction) => void) | null = null;
let lastView: PlayerView | null = null;
let lastCardPool: Readonly<Record<string, CardDefinition>> | null = null;


/** Reset all company view state. Call when leaving the game screen. */
export function resetCompanyViews(): void {
  focusedCompanyId = null;
  savedFocusedCompanyId = null;
  allCompaniesOverride = false;
  lastActivePlayer = null;
  lastOnAction = null;
  lastView = null;
  lastCardPool = null;
  influenceMoveSourceId = null;
  transferItemSourceId = null;
  transferItemFromCharId = null;
  companyMoveSourceId = null;
  companyMoveSourceCompanyId = null;
  mergeSourceCompanyId = null;
  dismissTooltip();
  setTargetingInstruction(null);
}

/** Phases where company views are displayed (normal play, after setup and before council). */
const COMPANY_VIEW_PHASES = new Set([
  Phase.Untap,
  Phase.Organization,
  Phase.LongEvent,
  Phase.MovementHazard,
  Phase.Site,
  Phase.EndOfTurn,
]);

/**
 * Render company views in the visual board area.
 * Active during normal play phases (untap through end-of-turn).
 * No-op during setup, Free Council, and game-over phases.
 */
export function renderCompanyViews(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  if (!COMPANY_VIEW_PHASES.has(view.phaseState.phase)) return;

  lastOnAction = onAction;
  lastView = view;
  lastCardPool = cardPool;
  installKeyboardNav();

  // Reset view state on active player change
  const activeId = view.activePlayer as string | null;
  if (activeId !== lastActivePlayer) {
    lastActivePlayer = activeId;
  }

  // Clear influence move selection if the source character no longer has valid actions
  if (influenceMoveSourceId) {
    const stillValid = viableActions(view.legalActions).some(
      a => a.type === 'move-to-influence' && a.characterInstanceId === influenceMoveSourceId,
    );
    if (!stillValid) {
      influenceMoveSourceId = null;
      setTargetingInstruction(null);
    }
  }

  // Clear transfer item selection if the source item no longer has valid actions
  if (transferItemSourceId) {
    const stillValid = viableActions(view.legalActions).some(
      a => a.type === 'transfer-item' && a.itemInstanceId === transferItemSourceId,
    );
    if (!stillValid) {
      transferItemSourceId = null;
      transferItemFromCharId = null;
      setTargetingInstruction(null);
    }
  }

  // Clear company-move selection if the source character no longer has valid actions
  if (companyMoveSourceId) {
    const stillValid = viableActions(view.legalActions).some(
      a => a.type === 'move-to-company' && a.characterInstanceId === companyMoveSourceId,
    );
    if (!stillValid) {
      companyMoveSourceId = null;
      companyMoveSourceCompanyId = null;
      setTargetingInstruction(null);
    }
  }

  // Clear merge selection if the source company no longer has valid merge actions
  if (mergeSourceCompanyId) {
    const stillValid = viableActions(view.legalActions).some(
      a => a.type === 'merge-companies' && a.sourceCompanyId === mergeSourceCompanyId,
    );
    if (!stillValid) {
      mergeSourceCompanyId = null;
      setTargetingInstruction(null);
    }
  }

  // Validate focused company still exists
  if (focusedCompanyId) {
    const exists =
      view.self.companies.some(c => c.id === focusedCompanyId) ||
      view.opponent.companies.some(c => c.id === focusedCompanyId);
    if (!exists) focusedCompanyId = null;
  }

  // Auto-focus the active player's first company when entering play phases
  if (!focusedCompanyId && view.activePlayer !== null) {
    const isSelfTurn = view.activePlayer === view.self.id;
    const activeCompanies = isSelfTurn ? view.self.companies : view.opponent.companies;
    if (activeCompanies.length > 0) {
      focusedCompanyId = activeCompanies[0].id;
    }
  }

  const board = $('visual-board');
  board.innerHTML = '';

  // Cards in play row (permanent resources, factions, etc.) — always at top
  renderCardsInPlayRow(board, view, cardPool);

  const showingSingle = focusedCompanyId !== null && !allCompaniesOverride;

  if (showingSingle) {
    renderSingleView(board, view, cardPool);
  } else {
    renderAllCompaniesView(board, view, cardPool);
  }

  // Toggle icon on the right edge of the board
  renderViewToggle(board, showingSingle, view, cardPool);
}
