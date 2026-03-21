/**
 * @module company-view
 *
 * Renders companies on the board during play phases (post-setup).
 * Supports three view modes:
 * - **Single**: One company at full scale with prev/next navigation.
 * - **My Companies**: All of the viewing player's companies at 60% scale.
 * - **All Companies**: Both players' companies at 40% scale.
 *
 * The company leader (highest mind, then MP, then prowess) determines
 * the company's display name (e.g. "Aragorn's Company at Rivendell").
 */

import type {
  PlayerView,
  GameAction,
  CardDefinition,
  CharacterInPlay,
  Company,
  CompanyId,
  OpponentCompanyView,
} from '@meccg/shared';
import { cardImageProxyPath, isCharacterCard, Phase, CardStatus } from '@meccg/shared';
import { $, createCardImage } from './render-utils.js';

// ---- View state ----

/** Which of the three company display modes is active. */
type CompanyViewMode = 'single' | 'my-companies' | 'all-companies';

/** Current view mode — defaults to all-companies (inactive player's view). */
let viewMode: CompanyViewMode = 'all-companies';

/** The company currently focused in single-company view. Null = first company. */
let focusedCompanyId: CompanyId | null = null;

/** Track the last active player so we can reset view state on turn change. */
let lastActivePlayer: string | null = null;

// ---- Company leader logic ----

/**
 * Determine the leader of a company — the character with highest mind.
 * Tiebreaker: marshalling points, then prowess.
 * Returns the leader's CharacterInPlay, or undefined if the company is empty.
 */
function getCompanyLeader(
  characters: readonly { toString(): string }[],
  charMap: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): CharacterInPlay | undefined {
  let leader: CharacterInPlay | undefined;
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
      leader = char;
      bestMind = mind;
      bestMP = mp;
      bestProwess = prowess;
      bestName = name;
    }
  }
  return leader;
}

/**
 * Get the display name for a company based on its leader and current site.
 * Returns e.g. "Aragorn's Company at Rivendell" or "Company" if no leader found.
 */
function getCompanyName(
  company: Company | OpponentCompanyView,
  charMap: Readonly<Record<string, CharacterInPlay>>,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const leader = getCompanyLeader(company.characters, charMap, cardPool);
  if (!leader) return 'Company';
  const def = cardPool[leader.definitionId as string];
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
  isLeader: boolean,
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

  const img = createCardImage(char.definitionId as string, def, imgPath, 'company-card');
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

  // Leader indicator
  if (isLeader) {
    const leaderBadge = document.createElement('div');
    leaderBadge.className = 'char-leader-badge';
    leaderBadge.textContent = '\u2606'; // star
    wrap.appendChild(leaderBadge);
  }

  col.appendChild(wrap);

  // Items
  if (char.items.length > 0) {
    const attachments = document.createElement('div');
    attachments.className = 'character-attachments';
    for (const item of char.items) {
      const itemDef = cardPool[item.definitionId as string];
      if (!itemDef) continue;
      const itemImg = cardImageProxyPath(itemDef);
      if (!itemImg) continue;
      const itemEl = createCardImage(item.definitionId as string, itemDef, itemImg, 'company-card company-card--item');
      if (item.status === CardStatus.Tapped) {
        itemEl.classList.add('company-card--tapped');
      }
      attachments.appendChild(itemEl);
    }
    col.appendChild(attachments);
  }

  // Allies
  if (char.allies.length > 0) {
    const allyContainer = document.createElement('div');
    allyContainer.className = 'character-attachments';
    for (const ally of char.allies) {
      const allyDef = cardPool[ally.definitionId as string];
      if (!allyDef) continue;
      const allyImg = cardImageProxyPath(allyDef);
      if (!allyImg) continue;
      const allyEl = createCardImage(ally.definitionId as string, allyDef, allyImg, 'company-card company-card--item');
      if (ally.status === CardStatus.Tapped) {
        allyEl.classList.add('company-card--tapped');
      }
      allyContainer.appendChild(allyEl);
    }
    col.appendChild(allyContainer);
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
          area.appendChild(createCardImage(siteDefId as string, siteDef, imgPath, 'company-card company-card--site'));
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
 * Used at all three scales via the --company-scale CSS variable.
 */
function renderCompanyBlock(
  company: Company | OpponentCompanyView,
  charMap: Readonly<Record<string, CharacterInPlay>>,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const block = document.createElement('div');
  block.className = 'company-block';
  block.dataset.companyId = company.id as string;

  // Company name
  const nameEl = document.createElement('div');
  nameEl.className = 'company-name';
  nameEl.textContent = getCompanyName(company, charMap, view, cardPool);
  block.appendChild(nameEl);

  // Moved badge
  if (company.moved) {
    const movedBadge = document.createElement('span');
    movedBadge.className = 'company-moved-badge';
    movedBadge.textContent = '\u2713'; // checkmark
    nameEl.appendChild(movedBadge);
  }

  // Site area
  block.appendChild(renderSiteArea(company, view, cardPool));

  // Characters
  const charsEl = document.createElement('div');
  charsEl.className = 'company-characters';
  const leader = getCompanyLeader(company.characters, charMap, cardPool);
  for (const charInstId of company.characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    const isLeader = leader !== undefined && char.instanceId === leader.instanceId;
    charsEl.appendChild(renderCharacterColumn(char, cardPool, isLeader));
  }
  block.appendChild(charsEl);

  return block;
}

// ---- View mode renderers ----

/** Render single-company detail view with navigation. */
function renderSingleView(
  container: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const companies = view.self.companies;
  if (companies.length === 0) {
    container.innerHTML = '<div class="company-empty">No companies</div>';
    return;
  }

  // Resolve focused company
  let focusedIndex = 0;
  if (focusedCompanyId) {
    const idx = companies.findIndex(c => c.id === focusedCompanyId);
    if (idx >= 0) focusedIndex = idx;
    else focusedCompanyId = companies[0].id;
  } else {
    focusedCompanyId = companies[0].id;
  }

  const company = companies[focusedIndex];

  // Navigation bar
  const nav = document.createElement('div');
  nav.className = 'company-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'company-nav-btn';
  prevBtn.textContent = '\u25C0'; // ◀
  prevBtn.disabled = companies.length <= 1;
  prevBtn.onclick = () => {
    focusedCompanyId = companies[(focusedIndex - 1 + companies.length) % companies.length].id;
    renderCompanyViews(view, cardPool, lastOnAction!);
  };

  const nextBtn = document.createElement('button');
  nextBtn.className = 'company-nav-btn';
  nextBtn.textContent = '\u25B6'; // ▶
  nextBtn.disabled = companies.length <= 1;
  nextBtn.onclick = () => {
    focusedCompanyId = companies[(focusedIndex + 1) % companies.length].id;
    renderCompanyViews(view, cardPool, lastOnAction!);
  };

  const label = document.createElement('span');
  label.className = 'company-nav-label';
  label.textContent = `Company ${focusedIndex + 1} of ${companies.length}`;

  const modeBtn = document.createElement('button');
  modeBtn.className = 'company-nav-btn company-nav-mode';
  modeBtn.textContent = 'Overview';
  modeBtn.onclick = () => {
    viewMode = 'my-companies';
    renderCompanyViews(view, cardPool, lastOnAction!);
  };

  nav.appendChild(prevBtn);
  nav.appendChild(label);
  nav.appendChild(nextBtn);
  nav.appendChild(modeBtn);
  container.appendChild(nav);

  // Company block at full scale
  const single = document.createElement('div');
  single.className = 'company-single';
  single.style.setProperty('--company-scale', '1');
  single.appendChild(renderCompanyBlock(company, view.self.characters, view, cardPool));
  container.appendChild(single);
}

/** Render overview of the player's own companies at medium scale. */
function renderMyCompaniesView(
  container: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  // Navigation bar with mode toggle
  const nav = document.createElement('div');
  nav.className = 'company-nav';

  const backBtn = document.createElement('button');
  backBtn.className = 'company-nav-btn';
  backBtn.textContent = '\u25C0 Back';
  backBtn.onclick = () => {
    viewMode = 'single';
    renderCompanyViews(view, cardPool, lastOnAction!);
  };

  const label = document.createElement('span');
  label.className = 'company-nav-label';
  label.textContent = 'My Companies';

  const allBtn = document.createElement('button');
  allBtn.className = 'company-nav-btn company-nav-mode';
  allBtn.textContent = 'All Companies';
  allBtn.onclick = () => {
    viewMode = 'all-companies';
    renderCompanyViews(view, cardPool, lastOnAction!);
  };

  nav.appendChild(backBtn);
  nav.appendChild(label);
  nav.appendChild(allBtn);
  container.appendChild(nav);

  // Company grid
  const grid = document.createElement('div');
  grid.className = 'company-overview';
  grid.style.setProperty('--company-scale', '0.6');

  for (const company of view.self.companies) {
    const block = renderCompanyBlock(company, view.self.characters, view, cardPool);
    block.classList.add('company-block--clickable');
    block.onclick = () => {
      viewMode = 'single';
      focusedCompanyId = company.id;
      renderCompanyViews(view, cardPool, lastOnAction!);
    };
    grid.appendChild(block);
  }

  if (view.self.companies.length === 0) {
    grid.innerHTML = '<div class="company-empty">No companies</div>';
  }

  container.appendChild(grid);
}

/** Render all companies (both players) at smallest scale. */
function renderAllCompaniesView(
  container: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  // Navigation bar
  const nav = document.createElement('div');
  nav.className = 'company-nav';

  const backBtn = document.createElement('button');
  backBtn.className = 'company-nav-btn';
  backBtn.textContent = '\u25C0 Back';
  backBtn.onclick = () => {
    viewMode = 'my-companies';
    renderCompanyViews(view, cardPool, lastOnAction!);
  };

  const label = document.createElement('span');
  label.className = 'company-nav-label';
  label.textContent = 'All Companies';

  nav.appendChild(backBtn);
  nav.appendChild(label);
  container.appendChild(nav);

  const overview = document.createElement('div');
  overview.className = 'company-overview-all';
  overview.style.setProperty('--company-scale', '0.4');

  // Self companies section
  const selfSection = document.createElement('div');
  selfSection.className = 'company-section';
  const selfLabel = document.createElement('div');
  selfLabel.className = 'company-section-label';
  selfLabel.textContent = `${view.self.name}'s Companies`;
  selfSection.appendChild(selfLabel);

  for (const company of view.self.companies) {
    const block = renderCompanyBlock(company, view.self.characters, view, cardPool);
    block.classList.add('company-block--clickable');
    block.onclick = () => {
      viewMode = 'single';
      focusedCompanyId = company.id;
      renderCompanyViews(view, cardPool, lastOnAction!);
    };
    selfSection.appendChild(block);
  }
  overview.appendChild(selfSection);

  // Opponent companies section
  const oppSection = document.createElement('div');
  oppSection.className = 'company-section';
  const oppLabel = document.createElement('div');
  oppLabel.className = 'company-section-label';
  oppLabel.textContent = `${view.opponent.name}'s Companies`;
  oppSection.appendChild(oppLabel);

  for (const company of view.opponent.companies) {
    const block = renderCompanyBlock(company, view.opponent.characters, view, cardPool);
    block.classList.add('company-block--clickable');
    block.onclick = () => {
      // Clicking opponent company just highlights it (can't navigate to single view for opponent)
    };
    oppSection.appendChild(block);
  }
  overview.appendChild(oppSection);

  container.appendChild(overview);
}

// ---- Top-level entry point ----

/** Cached onAction callback for re-renders triggered by navigation. */
let lastOnAction: ((action: GameAction) => void) | null = null;

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

  // Reset view state on active player change
  const activeId = view.activePlayer as string | null;
  if (activeId !== lastActivePlayer) {
    lastActivePlayer = activeId;
    // Active player sees single view, inactive sees all
    const isActive = view.activePlayer === view.self.id;
    viewMode = isActive ? 'single' : 'all-companies';
    focusedCompanyId = null;
  }

  // Validate focused company still exists
  if (focusedCompanyId) {
    const exists = view.self.companies.some(c => c.id === focusedCompanyId);
    if (!exists) focusedCompanyId = null;
  }

  const board = $('visual-board');
  board.innerHTML = '';

  switch (viewMode) {
    case 'single':
      renderSingleView(board, view, cardPool);
      break;
    case 'my-companies':
      renderMyCompaniesView(board, view, cardPool);
      break;
    case 'all-companies':
      renderAllCompaniesView(board, view, cardPool);
      break;
  }
}
