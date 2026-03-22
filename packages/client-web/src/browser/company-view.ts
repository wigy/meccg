/**
 * @module company-view
 *
 * Renders companies on the board during play phases (post-setup).
 * Supports two view modes:
 * - **All Companies**: Every company in the game (both players) at medium scale.
 * - **Single**: One company at full scale, reached by clicking a company in the overview.
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
} from '@meccg/shared';
import { cardImageProxyPath, isCharacterCard, Phase, CardStatus, viableActions } from '@meccg/shared';
import { $, createCardImage } from './render-utils.js';
import { getSelectedCharacterForPlay, clearCharacterPlaySelection, openMovementViewer } from './render.js';

// ---- View state ----

const FOCUSED_COMPANY_KEY = 'meccg-focused-company';

/** Which of the two company display modes is active. */
type CompanyViewMode = 'single' | 'all-companies';

/** Current view mode — defaults to all-companies overview. */
let viewMode: CompanyViewMode = 'all-companies';

/** The company currently focused in single-company view. Null = first company. */
let focusedCompanyId: CompanyId | null = null;

/** Whether we've attempted to restore the focused company from localStorage. */
let restoredFromStorage = false;

/** Save the focused company name to localStorage. */
function saveFocusedCompany(
  company: Company | OpponentCompanyView,
  charMap: Readonly<Record<string, CharacterInPlay>>,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const name = getCompanyName(company, charMap, view, cardPool);
  localStorage.setItem(FOCUSED_COMPANY_KEY, name);
}

/** Clear the focused company from localStorage. */
function clearFocusedCompany(): void {
  localStorage.removeItem(FOCUSED_COMPANY_KEY);
}

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
function getTitleCharacter(
  characters: readonly { toString(): string }[],
  charMap: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): CharacterInPlay | undefined {
  // Avatar is always the title character if present
  for (const charInstId of characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    const def = cardPool[char.definitionId as string];
    if (def && isCharacterCard(def) && def.mind === null) {
      return char;
    }
  }

  let titleChar: CharacterInPlay | undefined;
  let bestMind = -Infinity;
  let bestMP = -Infinity;
  let bestProwess = -Infinity;
  let bestName = '';

  for (const charInstId of characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    const def = cardPool[char.definitionId as string];
    if (!def || !isCharacterCard(def)) continue;

    const mind = def.mind ?? 0;
    const mp = def.marshallingPoints;
    const prowess = char.effectiveStats.prowess;
    const name = def.name;

    if (
      mind > bestMind ||
      (mind === bestMind && mp > bestMP) ||
      (mind === bestMind && mp === bestMP && prowess > bestProwess) ||
      (mind === bestMind && mp === bestMP && prowess === bestProwess && name < bestName)
    ) {
      titleChar = char;
      bestMind = mind;
      bestMP = mp;
      bestProwess = prowess;
      bestName = name;
    }
  }
  return titleChar;
}

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
    const siteDefId = view.visibleInstances[company.currentSite as string];
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

  const hasAttachments = char.items.length > 0 || char.allies.length > 0;
  const img = createCardImage(char.definitionId as string, def, imgPath, 'company-card');
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

  col.appendChild(wrap);

  // Items and allies — shown side by side
  const allAttachments = [...char.items, ...char.allies];
  if (allAttachments.length > 0) {
    const attachments = document.createElement('div');
    attachments.className = 'character-attachments';
    for (const att of allAttachments) {
      const attDef = cardPool[att.definitionId as string];
      if (!attDef) continue;
      const attImg = cardImageProxyPath(attDef);
      if (!attImg) continue;
      const attEl = createCardImage(att.definitionId as string, attDef, attImg, 'company-card company-card--item');
      if (att.status === CardStatus.Tapped) {
        attEl.classList.add('company-card--tapped');
      }
      attachments.appendChild(attEl);
    }
    col.appendChild(attachments);
  }

  return col;
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
    const siteDefId = view.visibleInstances[company.currentSite as string];
    if (siteDefId) {
      const siteDef = cardPool[siteDefId as string];
      if (siteDef) {
        const imgPath = cardImageProxyPath(siteDef);
        if (imgPath) {
          const cls = options?.hasLegalMovement
            ? 'company-card company-card--site company-card--movable'
            : 'company-card company-card--site';
          const img = createCardImage(siteDefId as string, siteDef, imgPath, cls);
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
        pathEl.appendChild(createCardImage(regionDefId as string, regionDef, imgPath, 'company-card company-card--region'));
      }
      area.appendChild(pathEl);
    } else {
      const arrow = document.createElement('div');
      arrow.className = 'company-movement-arrow';
      arrow.textContent = '\u2192'; // →
      area.appendChild(arrow);
    }

    // Destination site
    const destDefId = view.visibleInstances[company.destinationSite as string];
    if (destDefId) {
      const destDef = cardPool[destDefId as string];
      if (destDef) {
        const imgPath = cardImageProxyPath(destDef);
        if (imgPath) {
          area.appendChild(createCardImage(destDefId as string, destDef, imgPath, 'company-card company-card--site'));
        }
      }
    }
  } else if ('hasPlannedMovement' in company && company.hasPlannedMovement) {
    // Opponent has planned movement but destination is hidden
    const arrow = document.createElement('div');
    arrow.className = 'company-movement-arrow';
    arrow.textContent = '\u2192 ?';
    area.appendChild(arrow);
  }

  return area;
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
  options?: { hideTitle?: boolean; hasLegalMovement?: boolean; onAction?: (action: GameAction) => void },
): HTMLElement {
  const block = document.createElement('div');
  const isSelfTurn = view.activePlayer !== null && view.activePlayer === view.self.id;
  const isInactive = (owner === 'self' && !isSelfTurn) || (owner === 'opponent' && isSelfTurn);
  block.className = isInactive ? 'company-block company-block--inactive' : 'company-block';
  block.dataset.companyId = company.id as string;

  // Company name (omitted in single-company detail view)
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

  // Characters — title character always rendered first (leftmost after site)
  const titleChar = getTitleCharacter(company.characters, charMap, cardPool);
  if (titleChar) {
    row.appendChild(renderCharacterColumn(titleChar, cardPool, true));
  }
  for (const charInstId of company.characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    if (titleChar && char.instanceId === titleChar.instanceId) continue;
    row.appendChild(renderCharacterColumn(char, cardPool, false));
  }
  block.appendChild(row);

  return block;
}

// ---- View mode renderers ----

/** Render single-company detail view. Click empty space to return to overview. */
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
    viewMode = 'all-companies';
    clearFocusedCompany();
    renderAllCompaniesView(container, view, cardPool);
    return;
  }

  // Company block at full scale — clicking empty space returns to overview
  const single = document.createElement('div');
  single.className = 'company-single';
  single.style.setProperty('--company-scale', '1');
  single.onclick = (e) => {
    // Navigate back unless the click landed on a card image
    if (!(e.target instanceof HTMLImageElement)) {
      viewMode = 'all-companies';
      clearFocusedCompany();
      renderCompanyViews(view, cardPool, lastOnAction!);
    }
  };
  const movableIds = getMovableCompanyIds(view);
  const hasLegalMovement = movableIds.has(company.id as string);
  single.appendChild(renderCompanyBlock(company, charMap, view, cardPool, owner, { hideTitle: true, hasLegalMovement, onAction: lastOnAction! }));
  container.appendChild(single);
}

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
      area.appendChild(createCardImage(siteDefId as string, siteDef, imgPath, 'company-card company-card--site'));
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
      const img = createCardImage(card.definitionId as string, def, imgPath, 'company-card');
      if (card.status === CardStatus.Tapped) img.classList.add('company-card--tapped');
      group.appendChild(img);
    }
    row.appendChild(group);
  };

  renderGroup(selfCards, !isSelfTurn);
  renderGroup(oppCards, isSelfTurn);
  container.appendChild(row);
}

/** Render all companies (both players) at medium scale. Click any company to zoom in. */
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

  // Collect site instance IDs that already have companies
  const companySiteIds = new Set<string>();
  for (const company of view.self.companies) {
    if (company.currentSite) companySiteIds.add(company.currentSite as string);
  }

  // Self companies
  for (const company of view.self.companies) {
    const hasLegalMovement = movableIds.has(company.id as string);
    const block = renderCompanyBlock(company, view.self.characters, view, cardPool, 'self', { hasLegalMovement, onAction: lastOnAction! });

    if (targetActions && company.currentSite && targetActions.has(company.currentSite as string)) {
      // This company is a valid target for playing the selected character
      block.classList.add('company-block--target');
      const actions = targetActions.get(company.currentSite as string)!;
      block.onclick = () => {
        // For now, use the first action (GI preferred, DI options come later)
        clearCharacterPlaySelection();
        lastOnAction!(actions[0]);
      };
    } else {
      block.classList.add('company-block--clickable');
      block.onclick = () => {
        viewMode = 'single';
        focusedCompanyId = company.id;
        saveFocusedCompany(company, view.self.characters, view, cardPool);
        renderCompanyViews(view, cardPool, lastOnAction!);
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
    block.classList.add('company-block--clickable');
    block.onclick = () => {
      viewMode = 'single';
      focusedCompanyId = company.id;
      saveFocusedCompany(company, view.opponent.characters, view, cardPool);
      renderCompanyViews(view, cardPool, lastOnAction!);
    };
    overview.appendChild(block);
  }

  container.appendChild(overview);
}

// ---- Top-level entry point ----

/** Cached args for re-renders triggered by navigation. */
let lastOnAction: ((action: GameAction) => void) | null = null;
let lastView: PlayerView | null = null;
let lastCardPool: Readonly<Record<string, CardDefinition>> | null = null;

/** Install a click listener on visual-view so clicking empty space exits single view. */
let emptySpaceListenerInstalled = false;
function installEmptySpaceListener(): void {
  if (emptySpaceListenerInstalled) return;
  emptySpaceListenerInstalled = true;
  const visualView = $('visual-view');
  visualView.addEventListener('click', (e) => {
    if (viewMode !== 'single' || !lastOnAction || !lastView || !lastCardPool) return;
    // Stay in single view if the click landed on a card image or a clickable company block
    const target = e.target as HTMLElement;
    if (target instanceof HTMLImageElement) return;
    if (target.closest('.company-block--clickable, .company-block--target')) return;
    viewMode = 'all-companies';
    clearFocusedCompany();
    renderCompanyViews(lastView, lastCardPool, lastOnAction);
  });
}

/** Reset all company view state. Call when leaving the game screen. */
export function resetCompanyViews(): void {
  viewMode = 'all-companies';
  focusedCompanyId = null;
  restoredFromStorage = false;
  lastActivePlayer = null;
  lastOnAction = null;
  lastView = null;
  lastCardPool = null;
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
  installEmptySpaceListener();

  // Restore focused company from localStorage on first render
  if (!restoredFromStorage) {
    restoredFromStorage = true;
    const savedName = localStorage.getItem(FOCUSED_COMPANY_KEY);
    if (savedName) {
      // Search self companies
      for (const c of view.self.companies) {
        if (getCompanyName(c, view.self.characters, view, cardPool) === savedName) {
          viewMode = 'single';
          focusedCompanyId = c.id;
          break;
        }
      }
      // Search opponent companies if not found
      if (viewMode !== 'single') {
        for (const c of view.opponent.companies) {
          if (getCompanyName(c, view.opponent.characters, view, cardPool) === savedName) {
            viewMode = 'single';
            focusedCompanyId = c.id;
            break;
          }
        }
      }
      // If not found, clear the stale entry
      if (viewMode !== 'single') clearFocusedCompany();
    }
  }

  // Reset view state on active player change
  const activeId = view.activePlayer as string | null;
  if (activeId !== lastActivePlayer) {
    lastActivePlayer = activeId;
  }

  // Validate focused company still exists (check both players)
  if (focusedCompanyId) {
    const exists =
      view.self.companies.some(c => c.id === focusedCompanyId) ||
      view.opponent.companies.some(c => c.id === focusedCompanyId);
    if (!exists) focusedCompanyId = null;
  }

  const board = $('visual-board');
  board.innerHTML = '';

  // Cards in play row (permanent resources, factions, etc.) — always at top
  renderCardsInPlayRow(board, view, cardPool);

  // Force all-companies view when targeting for character play
  const effectiveMode = getSelectedCharacterForPlay() ? 'all-companies' : viewMode;

  switch (effectiveMode) {
    case 'single':
      renderSingleView(board, view, cardPool);
      break;
    case 'all-companies':
      renderAllCompaniesView(board, view, cardPool);
      break;
  }
}
